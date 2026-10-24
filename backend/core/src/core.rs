use crate::api::{
    AcceptArgs, AppInfo, ApplyMergeArgs, BranchArgs, CommitArgs, CommitIdArgs, DiffArgs, ImageArgs,
    PathArgs, PrepareArgs, RecentRepo, RepoInfo, RepoViewArgs, ReportEnv, SettingsArgs, StatusArgs,
    TargetArgs, TaskArgs, TerminalAckArgs, TerminalOpenArgs, TerminalResizeArgs, TerminalWriteArgs,
    ToolTab, UiKeyArgs, UiValueArgs, VersionArgs,
};
use crate::diffcache::{DiffCache, Prepare};
use crate::error::{ApiError, Error, Result};
use crate::events::{EventSink, Task};
use crate::filediff::{DiffTarget, FileDiff};
use crate::gitops::{self, Cancels, CommitResult, Destination, PushResult};
use crate::history::{self, BranchLog, CommitDetails, CommitDiff, HistoryCache};
use crate::merge::{self, MergeOutcome};
use crate::merge3;
use crate::repo::Repo;
use crate::shellenv::ShellEnv;
use crate::status::{self, FileChange, Untracked};
use crate::store::{RepoState, Store};
use crate::terminal::Terminals;
use crate::update;
use crate::watcher::RepoWatcher;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

type BaseKey = (
    PathBuf,
    Option<gix::ObjectId>,
    Option<gix::ObjectId>,
    String,
    Vec<gix::ObjectId>,
);

const UPDATES: &str = "updates";
const UPDATE_TASK: &str = "update";

pub struct Core {
    store: Mutex<Store>,
    repo: Mutex<Option<OpenRepo>>,
    env: ShellEnv,
    events: Arc<dyn EventSink>,
    diffs: Arc<DiffCache>,
    history: HistoryCache,
    cancels: Cancels,
    runs: AtomicU64,
    actions: Mutex<()>,
    terminals: Terminals,
    bases: Mutex<Option<(BaseKey, Option<gix::ObjectId>)>>,
    update_url: Mutex<String>,
    update_max_time: AtomicU64,
    data_dir: PathBuf,
    release: Mutex<Option<update::Release>>,
    update_ready: Mutex<Option<(String, PathBuf)>>,
    update_failure: Mutex<Option<String>>,
}

struct OpenRepo {
    repo: Repo,
    watcher: std::result::Result<RepoWatcher, String>,
    status_read: bool,
}

impl Core {
    pub fn new(data_dir: &Path, env: ShellEnv, events: Arc<dyn EventSink>) -> Result<Core> {
        let store = Store::open(data_dir)?;
        let pending = update::pending(&data_dir.join(UPDATES), env!("CARGO_PKG_VERSION"));
        Ok(Core {
            store: Mutex::new(store),
            repo: Mutex::new(None),
            env,
            events,
            diffs: Arc::new(DiffCache::default()),
            history: HistoryCache::default(),
            cancels: Cancels::default(),
            runs: AtomicU64::new(0),
            actions: Mutex::new(()),
            terminals: Terminals::default(),
            bases: Mutex::new(None),
            update_url: Mutex::new(update::source()),
            update_max_time: AtomicU64::new(update::MAX_TIME),
            data_dir: data_dir.to_path_buf(),
            release: Mutex::new(None),
            update_ready: Mutex::new(pending.ready),
            update_failure: Mutex::new(pending.failure),
        })
    }

    pub fn shutdown(&self) {
        self.terminals.close_all();
        if self.cancels.cancel(UPDATE_TASK) {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    }

    pub fn set_update_url(&self, url: &str) {
        if let Ok(mut current) = self.update_url.lock() {
            *current = url.to_string();
        }
    }

    pub fn set_update_max_time(&self, seconds: u64) {
        self.update_max_time.store(seconds, Ordering::SeqCst);
    }

    pub fn update_ready(&self) -> Option<PathBuf> {
        self.update_ready
            .lock()
            .ok()
            .and_then(|ready| ready.clone())
            .map(|(_, image)| image)
    }

    pub fn updates_dir(&self) -> PathBuf {
        self.data_dir.join(UPDATES)
    }

    fn update_state(&self) -> update::UpdateState {
        let ready = self
            .update_ready
            .lock()
            .ok()
            .and_then(|ready| ready.clone())
            .map(|(version, _)| version);
        let failure = self
            .update_failure
            .lock()
            .ok()
            .and_then(|failure| failure.clone());
        let page = ready
            .as_ref()
            .map(|version| format!("{}tag/v{version}", update::RELEASES))
            .or_else(|| {
                failure
                    .as_ref()
                    .map(|_| format!("{}latest", update::RELEASES))
            });
        update::UpdateState {
            ready,
            failure,
            page,
        }
    }

    fn dismiss_update(&self) {
        if let Ok(mut failure) = self.update_failure.lock() {
            *failure = None;
        }
        if self.update_ready().is_none() {
            let _ = std::fs::remove_dir_all(self.updates_dir());
        }
    }

    pub fn env(&self) -> &ShellEnv {
        &self.env
    }

    pub fn dispatch(&self, cmd: &str, args: Value) -> std::result::Result<Value, ApiError> {
        self.run(cmd, args).map_err(ApiError::from)
    }

    fn run(&self, cmd: &str, args: Value) -> Result<Value> {
        match cmd {
            "app_info" => reply(self.app_info()?),
            "report_env" => reply(self.report_env()),
            "get_settings" => reply(self.store()?.settings().clone()),
            "set_settings" => {
                let a: SettingsArgs = parse(args)?;
                let mut store = self.store()?;
                let before = store.settings().diff.clone();
                store.save_settings(a.settings)?;
                let after = &store.settings().diff;
                if before.whitespace != after.whitespace || before.highlight != after.highlight {
                    self.diffs.clear();
                }
                reply(store.settings().clone())
            }
            "check_update" => {
                let url = self
                    .update_url
                    .lock()
                    .map(|url| url.clone())
                    .unwrap_or_else(|_| update::source());
                let release = update::check(
                    &self.env,
                    &url,
                    self.update_max_time.load(Ordering::SeqCst),
                    env!("CARGO_PKG_VERSION"),
                )?;
                let check = release.check.clone();
                if let Ok(mut stored) = self.release.lock() {
                    *stored = Some(release);
                }
                reply(check)
            }
            "download_update" => {
                let a: VersionArgs = parse(args)?;
                reply(self.download_update(&a.version)?)
            }
            "update_state" => reply(self.update_state()),
            "dismiss_update" => {
                self.dismiss_update();
                reply(())
            }
            "recent_repos" => reply(self.recent()?),
            "remove_recent" => {
                let a: PathArgs = parse(args)?;
                self.store()?.remove_recent(&a.path)?;
                reply(self.recent()?)
            }
            "open_repo" => {
                let a: PathArgs = parse(args)?;
                reply(self.open_repo(Path::new(&a.path))?)
            }
            "status" => {
                let a: StatusArgs = parse(args)?;
                reply(self.status(&a.path, a.untracked.unwrap_or_default())?)
            }
            "diff" => {
                let a: DiffArgs = parse(args)?;
                reply(&*self.diff(a)?)
            }
            "branch_log" => {
                let a: PathArgs = parse(args)?;
                reply(&*self.branch_log(&a.path)?)
            }
            "commit_details" => {
                let a: CommitIdArgs = parse(args)?;
                reply(self.commit_details(a)?)
            }
            "branches" => {
                let a: PathArgs = parse(args)?;
                let (repo, _, _) = self.open_root(&a.path)?;
                reply(gitops::branches(&repo.to_thread_local())?)
            }
            "switch_branch" => {
                let a: BranchArgs = parse(args)?;
                reply(self.switch_branch(a)?)
            }
            "fetch" => {
                let a: PathArgs = parse(args)?;
                self.fetch(&a.path)?;
                reply(Value::Null)
            }
            "commit" => {
                let a: CommitArgs = parse(args)?;
                reply(self.commit(a)?)
            }
            "commit_messages" => {
                let a: PathArgs = parse(args)?;
                let (_, root, _) = self.open_root(&a.path)?;
                reply(self.store()?.commit_messages(&root.display().to_string())?)
            }
            "head_message" => {
                let a: PathArgs = parse(args)?;
                let (repo, _, _) = self.open_root(&a.path)?;
                reply(gitops::head_message(&repo.to_thread_local()))
            }
            "push" => {
                let a: PathArgs = parse(args)?;
                reply(self.push(&a.path)?)
            }
            "pull" => {
                let a: PathArgs = parse(args)?;
                reply(self.pull(&a.path)?)
            }
            "merge_state" => {
                let a: PathArgs = parse(args)?;
                let (repo, root, _) = self.open_root(&a.path)?;
                let repo = repo.to_thread_local();
                let branch = repo
                    .head_name()
                    .ok()
                    .flatten()
                    .map(|name| name.shorten().to_string());
                reply(merge::state(
                    &self.env,
                    &root,
                    repo.git_dir(),
                    branch.as_deref(),
                )?)
            }
            "merge_target" => {
                let a: PathArgs = parse(args)?;
                reply(self.merge_target(&a.path)?)
            }
            "accept_side" => {
                let a: AcceptArgs = parse(args)?;
                let _exclusive = self.exclusive()?;
                let (_, root, _) = self.open_root(&a.path)?;
                merge::accept(&self.env, &root, &a.files, a.side)?;
                reply(())
            }
            "merge_file" => {
                let a: crate::api::MergeFileArgs = parse(args)?;
                let (repo, _, _) = self.open_root(&a.path)?;
                reply(merge3::read(&repo.to_thread_local(), &a.file)?)
            }
            "apply_merge" => {
                let a: ApplyMergeArgs = parse(args)?;
                let _exclusive = self.exclusive()?;
                let (_, root, _) = self.open_root(&a.path)?;
                merge::write_result(&self.env, &root, &a.file, &a.text, a.crlf)?;
                reply(())
            }
            "abort_merge" => {
                let a: PathArgs = parse(args)?;
                let _exclusive = self.exclusive()?;
                let (repo, root, _) = self.open_root(&a.path)?;
                merge::abort(&self.env, &root, repo.to_thread_local().git_dir())?;
                reply(())
            }
            "read_image" => {
                let a: ImageArgs = parse(args)?;
                let (repo, root, _) = self.open_root(&a.path)?;
                let Some(file) = crate::images::resolve(&a.document, &a.source) else {
                    return reply(Value::Null);
                };
                reply(crate::images::read(
                    &repo.to_thread_local(),
                    &root,
                    a.rev.as_deref(),
                    &file,
                )?)
            }
            "terminal_open" => {
                let a: TerminalOpenArgs = parse(args)?;
                let (_, root, _) = self.open_root(&a.path)?;
                reply(
                    self.terminals
                        .open(&self.env, &root, a.cols, a.rows, self.events.clone())?,
                )
            }
            "terminal_write" => {
                let a: TerminalWriteArgs = parse(args)?;
                self.terminals.write(&a.id, &a.data)?;
                reply(Value::Null)
            }
            "terminal_ack" => {
                let a: TerminalAckArgs = parse(args)?;
                self.terminals.ack(&a.id, a.bytes as usize)?;
                reply(Value::Null)
            }
            "terminal_resize" => {
                let a: TerminalResizeArgs = parse(args)?;
                self.terminals.resize(&a.id, a.cols, a.rows)?;
                reply(Value::Null)
            }
            "terminal_close" => {
                let a: TaskArgs = parse(args)?;
                self.terminals.close(&a.id)?;
                reply(Value::Null)
            }
            "terminal_list" => {
                let a: PathArgs = parse(args)?;
                let (_, root, _) = self.open_root(&a.path)?;
                reply(self.terminals.list(&root)?)
            }
            "cancel" => {
                let a: TaskArgs = parse(args)?;
                reply(self.cancels.cancel(&a.id))
            }
            "prepare_diffs" => {
                let a: PrepareArgs = parse(args)?;
                self.prepare_diffs(a)?;
                reply(Value::Null)
            }
            "set_target" => {
                let a: TargetArgs = parse(args)?;
                self.set_target(a)?;
                reply(Value::Null)
            }
            "current_repo" => reply(self.current_repo()?),
            "close_repo" => {
                *self.repo_slot()? = None;
                self.diffs.clear();
                reply(Value::Null)
            }
            "set_repo_view" => {
                let a: RepoViewArgs = parse(args)?;
                self.set_repo_view(a)?;
                reply(Value::Null)
            }
            "get_ui_value" => {
                let a: UiKeyArgs = parse(args)?;
                reply(self.store()?.ui_value(&a.key)?)
            }
            "set_ui_value" => {
                let a: UiValueArgs = parse(args)?;
                self.store()?.set_ui_value(&a.key, &a.value)?;
                reply(Value::Null)
            }
            other => Err(Error::UnknownCommand(other.to_string())),
        }
    }

    fn store(&self) -> Result<MutexGuard<'_, Store>> {
        self.store
            .lock()
            .map_err(|_| Error::Store("store lock poisoned".into()))
    }

    fn repo_slot(&self) -> Result<MutexGuard<'_, Option<OpenRepo>>> {
        self.repo
            .lock()
            .map_err(|_| Error::Store("repository lock poisoned".into()))
    }

    fn report_env(&self) -> ReportEnv {
        let first_line = |output: std::io::Result<std::process::Output>| {
            output
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .and_then(|text| text.lines().next().map(|line| line.trim().to_string()))
                .filter(|line| !line.is_empty())
        };
        ReportEnv {
            version: env!("CARGO_PKG_VERSION").to_string(),
            macos: first_line(
                std::process::Command::new("/usr/bin/sw_vers")
                    .arg("-productVersion")
                    .output(),
            ),
            arch: std::env::consts::ARCH.to_string(),
            git: first_line(self.env.git(Path::new("/")).arg("--version").output())
                .map(|line| line.trim_start_matches("git version ").to_string()),
        }
    }

    fn app_info(&self) -> Result<AppInfo> {
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            settings_notice: self.store()?.notice().map(str::to_string),
            home: std::env::var("HOME").ok(),
        })
    }

    fn recent(&self) -> Result<Vec<RecentRepo>> {
        Ok(self
            .store()?
            .recent()?
            .into_iter()
            .map(|r| RecentRepo {
                exists: Path::new(&r.path).exists(),
                path: r.path,
                name: r.name,
                branch: r.branch,
                last_opened: r.last_opened,
            })
            .collect())
    }

    fn open_repo(&self, path: &Path) -> Result<RepoInfo> {
        let repo = Repo::discover(path)?;
        let id = format!("open-repo:{}", repo.root().display());
        let _task = Task::start(
            self.events.as_ref(),
            &id,
            format!("Opening {}", repo.name()),
        );
        let watcher = RepoWatcher::start(&repo, self.env.clone(), self.events.clone())
            .map_err(|error| error.to_string());
        let open = OpenRepo {
            repo,
            watcher,
            status_read: false,
        };
        let info = self.info(&open)?;
        self.store()?
            .touch_recent(&info.path, &info.name, info.branch.as_deref(), now_ms())?;
        *self.repo_slot()? = Some(open);
        self.diffs.clear();
        Ok(info)
    }

    fn current_repo(&self) -> Result<Option<RepoInfo>> {
        let slot = self.repo_slot()?;
        match slot.as_ref() {
            Some(open) => Ok(Some(self.info(open)?)),
            None => Ok(None),
        }
    }

    fn status(&self, path: &str, untracked: Untracked) -> Result<Vec<FileChange>> {
        let wanted = canonical(path)?;
        let (repo, root, name, first) = {
            let slot = self.repo_slot()?;
            let open = slot.as_ref().ok_or(Error::NoRepository)?;
            if open.repo.root() != Path::new(&wanted) {
                return Err(Error::NotOpen(wanted));
            }
            (
                open.repo.thread_safe(),
                open.repo.root().to_path_buf(),
                open.repo.name(),
                !open.status_read,
            )
        };
        let label = if first {
            format!("Opening {name} · reading changes")
        } else {
            format!("Reading changes in {name}")
        };
        let id = format!("status:{}", root.display());
        let _task = Task::start(self.events.as_ref(), &id, label);
        let changes = match self.diff_base(&repo.to_thread_local(), &root)? {
            Some(base) => status::against(&self.env, &root, &base.to_string(), untracked)?,
            None => status::read(&self.env, &root, untracked)?,
        };
        if let Some(open) = self.repo_slot()?.as_mut()
            && open.repo.root() == root
            && untracked == Untracked::All
        {
            open.status_read = true;
        }
        Ok(changes)
    }

    fn open_root(&self, path: &str) -> Result<(gix::ThreadSafeRepository, PathBuf, String)> {
        let wanted = canonical(path)?;
        let slot = self.repo_slot()?;
        let open = slot.as_ref().ok_or(Error::NoRepository)?;
        if open.repo.root() != Path::new(&wanted) {
            return Err(Error::NotOpen(wanted));
        }
        Ok((
            open.repo.thread_safe(),
            open.repo.root().to_path_buf(),
            open.repo.name(),
        ))
    }

    fn diff(&self, args: DiffArgs) -> Result<Arc<FileDiff>> {
        let (repo, root, _) = self.open_root(&args.path)?;
        let target = DiffTarget {
            file: args.file,
            old_path: args.old_path,
        };
        if let Some(id) = args.commit {
            let branch = self.target_branch(&root)?;
            let context = self.commit_context(&root, branch.as_deref());
            return context.diff(&repo.to_thread_local(), &id, &target, self.diff_options()?);
        }
        let repo = repo.to_thread_local();
        let base = self.diff_base(&repo, &root)?;
        self.diffs
            .get(&repo, &root, base, args.area, &target, self.diff_options()?)
    }

    fn diff_base(&self, repo: &gix::Repository, root: &Path) -> Result<Option<gix::ObjectId>> {
        let Some(target) = self.target_branch(root)? else {
            return Ok(None);
        };
        let head = repo.head_id().ok().map(|id| id.detach());
        let key = (
            root.to_path_buf(),
            head,
            history::merge_head(repo),
            target.clone(),
            history::target_tips(repo, &target),
        );
        if let Ok(bases) = self.bases.lock()
            && let Some((known, base)) = bases.as_ref()
            && *known == key
        {
            return Ok(*base);
        }
        let base = history::merge_base(repo, &target)?.filter(|base| Some(*base) != head);
        if let Ok(mut bases) = self.bases.lock() {
            *bases = Some((key, base));
        }
        Ok(base)
    }

    fn branch_log(&self, path: &str) -> Result<Arc<BranchLog>> {
        let (repo, root, _) = self.open_root(path)?;
        let branch = self.target_branch(&root)?;
        self.history.branch_log(
            &repo.to_thread_local(),
            &root,
            branch.as_deref(),
            self.events.as_ref(),
        )
    }

    fn commit_details(&self, args: CommitIdArgs) -> Result<CommitDetails> {
        let (repo, root, _) = self.open_root(&args.path)?;
        let branch = self.target_branch(&root)?;
        let context = self.commit_context(&root, branch.as_deref());
        history::commit_details(&repo.to_thread_local(), &context, &args.id)
    }

    fn commit_context<'a>(&'a self, root: &'a Path, branch: Option<&'a str>) -> CommitDiff<'a> {
        CommitDiff {
            env: &self.env,
            root,
            cache: &self.history,
            target_branch: branch,
        }
    }

    fn target_branch(&self, root: &Path) -> Result<Option<String>> {
        let state = self.store()?.repo_state(&root.display().to_string())?;
        if state.target_branch.is_some() {
            return Ok(state.target_branch);
        }
        let slot = self.repo_slot()?;
        Ok(slot
            .as_ref()
            .filter(|open| open.repo.root() == root)
            .and_then(|open| open.repo.default_branch()))
    }

    fn switch_branch(&self, args: BranchArgs) -> Result<RepoInfo> {
        let (repo, root, name) = self.open_root(&args.path)?;
        let _exclusive = self.exclusive()?;
        let id = format!("switch:{}", root.display());
        let _task = Task::start(
            self.events.as_ref(),
            &id,
            format!("Switching {name} to {}", args.name),
        );
        gitops::switch(&self.env, &root, &repo.to_thread_local(), &args.name)?;
        let slot = self.repo_slot()?;
        let open = slot.as_ref().ok_or(Error::NoRepository)?;
        let info = self.info(open)?;
        self.store()?
            .touch_recent(&info.path, &info.name, info.branch.as_deref(), now_ms())?;
        Ok(info)
    }

    fn download_update(&self, version: &str) -> Result<update::UpdateReady> {
        let release = self
            .release
            .lock()
            .ok()
            .and_then(|release| release.clone())
            .filter(|release| release.check.newer && release.check.latest == version)
            .ok_or_else(|| {
                Error::InvalidArgs(format!(
                    "Diffloupe {version} is not the newer version to download"
                ))
            })?;
        let version = release.check.latest.clone();
        if let Ok(mut ready) = self.update_ready.lock() {
            *ready = None;
        }
        if let Ok(mut failure) = self.update_failure.lock() {
            *failure = None;
        }
        let id = UPDATE_TASK.to_string();
        let watch = self.cancels.watch(&id);
        let mut task = Task::cancellable(
            self.events.as_ref(),
            &id,
            format!("Downloading Diffloupe {version}"),
        );
        let image = update::download(&self.env, &release, &self.updates_dir(), &watch, &mut task)?;
        watch.check()?;
        if let Ok(mut ready) = self.update_ready.lock() {
            *ready = Some((version.clone(), image));
        }
        Ok(update::UpdateReady { version })
    }

    fn fetch(&self, path: &str) -> Result<()> {
        let (_, root, name) = self.open_root(path)?;
        let _exclusive = self.exclusive()?;
        let id = self.run_id("fetch", &root);
        let watch = self.cancels.watch(&id);
        let _task = Task::cancellable(self.events.as_ref(), &id, format!("Fetching {name}"));
        gitops::fetch(&self.env, &root, &watch)
    }

    fn commit(&self, args: CommitArgs) -> Result<CommitResult> {
        let (_, root, name) = self.open_root(&args.path)?;
        let _exclusive = self.exclusive()?;
        let id = format!("commit:{}", root.display());
        let _task = Task::start(self.events.as_ref(), &id, format!("Committing to {name}"));
        let result = gitops::commit(&self.env, &root, &args)?;
        self.store()?.add_commit_message(
            &root.display().to_string(),
            args.message.trim(),
            now_ms(),
        )?;
        Ok(result)
    }

    fn destination(&self, path: &str) -> Result<(PathBuf, String, Destination)> {
        let (repo, root, _) = self.open_root(path)?;
        let branch = repo
            .to_thread_local()
            .head_name()
            .ok()
            .flatten()
            .map(|name| name.shorten().to_string());
        let destination = Destination::resolve(&self.env, &root, branch.clone())?;
        Ok((root, branch.unwrap_or_default(), destination))
    }

    fn push(&self, path: &str) -> Result<PushResult> {
        let _exclusive = self.exclusive()?;
        let (root, branch, destination) = self.destination(path)?;
        let id = self.run_id("push", &root);
        let watch = self.cancels.watch(&id);
        let _task = Task::cancellable(
            self.events.as_ref(),
            &id,
            format!("Pushing {branch} to {}", destination.remote),
        );
        destination.push(&self.env, &root, &watch)
    }

    fn pull(&self, path: &str) -> Result<MergeOutcome> {
        let _exclusive = self.exclusive()?;
        let (repo, _, _) = self.open_root(path)?;
        let git_dir = repo.to_thread_local().git_dir().to_path_buf();
        let (root, _, destination) = self.destination(path)?;
        let id = self.run_id("pull", &root);
        let watch = self.cancels.watch(&id);
        let mut task = Task::cancellable(
            self.events.as_ref(),
            &id,
            format!("Fetching and merging {}", destination.remote_branch),
        );
        destination.pull(&self.env, &root, &git_dir, &watch, || task.uncancellable())
    }

    fn merge_target(&self, path: &str) -> Result<MergeOutcome> {
        let _exclusive = self.exclusive()?;
        let (repo, root, _) = self.open_root(path)?;
        let target = self
            .target_branch(&root)?
            .ok_or_else(|| Error::GitRefused("Pick a target branch first.".into()))?;
        let id = self.run_id("merge", &root);
        let watch = self.cancels.watch(&id);
        let mut task = Task::cancellable(self.events.as_ref(), &id, format!("Merging {target}"));
        merge::merge_target(
            &self.env,
            &root,
            repo.to_thread_local().git_dir(),
            &target,
            &watch,
            || task.uncancellable(),
        )
    }

    fn exclusive(&self) -> Result<MutexGuard<'_, ()>> {
        self.actions.try_lock().map_err(|_| {
            Error::GitRefused(
                "Another git action is still running. Wait for it to finish, then try again."
                    .into(),
            )
        })
    }

    fn run_id(&self, operation: &str, root: &Path) -> String {
        let run = self.runs.fetch_add(1, Ordering::SeqCst);
        format!("{operation}:{}:{run}", root.display())
    }

    fn diff_options(&self) -> Result<crate::diff::Options> {
        let settings = self.store()?.settings().diff.clone();
        Ok(crate::diff::Options {
            whitespace: settings.whitespace,
            highlight: settings.highlight,
        })
    }

    fn prepare_diffs(&self, args: PrepareArgs) -> Result<()> {
        let (repo, root, name) = self.open_root(&args.path)?;
        let options = self.diff_options()?;
        let base = self.diff_base(&repo.to_thread_local(), &root)?;
        self.diffs.prepare(
            Prepare {
                repo,
                root,
                name,
                base,
                targets: args.files,
                options,
            },
            self.events.clone(),
        );
        Ok(())
    }

    fn set_target(&self, args: TargetArgs) -> Result<()> {
        let path = canonical(&args.path)?;
        let store = self.store()?;
        let previous = store.repo_state(&path)?;
        store.set_repo_state(
            &path,
            &RepoState {
                target_branch: args.target,
                ..previous
            },
        )
    }

    fn info(&self, open: &OpenRepo) -> Result<RepoInfo> {
        let repo = &open.repo;
        let path = repo.root().display().to_string();
        let state = self.store()?.repo_state(&path)?;
        let last_tab = match state.last_tab.as_deref() {
            Some("log") => ToolTab::Log,
            _ => ToolTab::Changes,
        };
        let default_branch = repo.default_branch();
        Ok(RepoInfo {
            name: repo.name(),
            branch: repo.branch(),
            target: state.target_branch.or_else(|| default_branch.clone()),
            default_branch,
            watch_error: open.watcher.as_ref().err().cloned(),
            last_tab,
            last_selection: state.last_selection,
            path,
        })
    }

    fn set_repo_view(&self, args: RepoViewArgs) -> Result<()> {
        let path = canonical(&args.path)?;
        let store = self.store()?;
        let previous = store.repo_state(&path)?;
        let tab = match args.tab {
            ToolTab::Changes => "changes",
            ToolTab::Log => "log",
        };
        store.set_repo_state(
            &path,
            &RepoState {
                last_tab: Some(tab.to_string()),
                last_selection: args.selection,
                ..previous
            },
        )
    }

    pub fn repo_root(&self) -> Result<PathBuf> {
        self.repo_slot()?
            .as_ref()
            .map(|open| open.repo.root().to_path_buf())
            .ok_or(Error::NoRepository)
    }
}

fn parse<T: DeserializeOwned>(args: Value) -> Result<T> {
    let args = if args.is_null() {
        Value::Object(Default::default())
    } else {
        args
    };
    Ok(serde_json::from_value(args)?)
}

fn reply<T: Serialize>(value: T) -> Result<Value> {
    Ok(serde_json::to_value(value)?)
}

fn canonical(path: &str) -> Result<String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(Error::NotFound(path.display().to_string()));
    }
    Ok(path.canonicalize()?.display().to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

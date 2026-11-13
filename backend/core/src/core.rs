use crate::aireview;
use crate::api::{
    AcceptArgs, AiAddFundsArgs, AiAddFundsResult, AiClearThreadArgs, AiDeleteReviewArgs,
    AiGetStateArgs, AiRevertVersionArgs, AiSendFollowupArgs, AiSetConsentArgs, AiSignInArgs,
    AiSignInResult, AiStartReviewArgs, AiState, AppInfo, ApplyMergeArgs, BranchArgs, CloudAccount,
    CommitArgs, CommitIdArgs, DiffArgs, ImageArgs, ModelsCatalog, PathArgs, PrepareArgs,
    RecentRepo, RepoInfo, RepoViewArgs, ReportEnv, RollbackArgs, SaveFileArgs, SettingsArgs,
    StatusArgs, TargetArgs, TaskArgs, TerminalAckArgs, TerminalOpenArgs, TerminalResizeArgs,
    TerminalWriteArgs, ToolTab, UiKeyArgs, UiValueArgs, VersionArgs,
};
use crate::diffcache::{DiffCache, Prepare};
use crate::error::{ApiError, Error, Result};
use crate::events::{EventSink, Task};
use crate::filediff::{DiffTarget, FileDiff};
use crate::gitops::{self, Cancels, CommitResult, Destination, PushResult};
use crate::history::{self, BranchLog, CommitDetails, CommitDiff, HistoryCache};
use crate::merge::{self, MergeOutcome};
use crate::merge3;
use crate::platform::{self, Platform};
use crate::repo::Repo;
use crate::shellenv::ShellEnv;
use crate::status::{self, FileChange, Untracked};
use crate::store::{NewAiChatMessage, RepoState, Store, StoredAiReview};
use crate::terminal::Terminals;
use crate::update;
use crate::watcher::RepoWatcher;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    cancels: Arc<Cancels>,
    runs: AtomicU64,
    actions: Mutex<()>,
    terminals: Terminals,
    bases: Mutex<Option<(BaseKey, Option<gix::ObjectId>)>>,
    update_url: Mutex<String>,
    cloud_url: Mutex<String>,
    update_max_time: AtomicU64,
    data_dir: PathBuf,
    release: Mutex<Option<update::Release>>,
    update_ready: Mutex<Option<(String, PathBuf)>>,
    update_failure: Mutex<Option<String>>,
    package: Option<update::PackageKind>,
    platform: Platform,
    watch_polling: AtomicBool,
    ai_review_enabled: AtomicBool,
}

struct OpenRepo {
    repo: Repo,
    watcher: std::result::Result<RepoWatcher, String>,
    status_read: bool,
}

impl Core {
    pub fn new(data_dir: &Path, env: ShellEnv, events: Arc<dyn EventSink>) -> Result<Core> {
        Core::build(
            data_dir,
            env,
            events,
            Platform::CURRENT,
            update::PackageKind::current(),
        )
    }

    pub fn for_platform(
        data_dir: &Path,
        env: ShellEnv,
        events: Arc<dyn EventSink>,
        platform: Platform,
    ) -> Result<Core> {
        let package = update::PackageKind::of(platform, "x86_64", Some(update::PackageKind::Deb));
        Core::build(data_dir, env, events, platform, package)
    }

    fn build(
        data_dir: &Path,
        env: ShellEnv,
        events: Arc<dyn EventSink>,
        platform: Platform,
        package: Option<update::PackageKind>,
    ) -> Result<Core> {
        let store = Store::open(data_dir)?;
        let pending = update::pending(&data_dir.join(UPDATES), env!("CARGO_PKG_VERSION"), package);
        Ok(Core {
            store: Mutex::new(store),
            repo: Mutex::new(None),
            env,
            events,
            diffs: Arc::new(DiffCache::default()),
            history: HistoryCache::default(),
            cancels: Arc::new(Cancels::default()),
            runs: AtomicU64::new(0),
            actions: Mutex::new(()),
            terminals: Terminals::default(),
            bases: Mutex::new(None),
            update_url: Mutex::new(update::source()),
            cloud_url: Mutex::new(update::cloud_source()),
            update_max_time: AtomicU64::new(update::MAX_TIME),
            data_dir: data_dir.to_path_buf(),
            release: Mutex::new(None),
            update_ready: Mutex::new(pending.ready),
            update_failure: Mutex::new(pending.failure),
            package,
            platform,
            watch_polling: AtomicBool::new(false),
            ai_review_enabled: AtomicBool::new(aireview::ai_review_enabled()),
        })
    }

    pub fn shutdown(&self) {
        self.terminals.close_all();
        self.cancels.cancel(aireview::AI_SIGN_IN_TASK);
        if self.cancels.cancel(UPDATE_TASK) {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    }

    pub fn set_update_url(&self, url: &str) {
        if let Ok(mut current) = self.update_url.lock() {
            *current = url.to_string();
        }
    }

    pub fn set_cloud_url(&self, url: &str) {
        update::set_test_cloud_url(Some(url.to_string()));
        if let Ok(mut current) = self.cloud_url.lock() {
            *current = url.to_string();
        }
    }

    pub fn cloud_url(&self) -> String {
        self.cloud_url
            .lock()
            .map(|url| url.clone())
            .unwrap_or_else(|_| update::cloud_source())
    }

    pub fn set_watch_polling(&self, polling: bool) {
        self.watch_polling.store(polling, Ordering::SeqCst);
    }

    pub fn ai_review_enabled(&self) -> bool {
        self.ai_review_enabled.load(Ordering::SeqCst)
    }

    pub fn set_ai_review_enabled(&self, enabled: bool) {
        self.ai_review_enabled.store(enabled, Ordering::SeqCst);
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
        if cmd.starts_with("ai_") && !self.ai_review_enabled() {
            return Err(Error::AiService("AI review is disabled.".into()));
        }
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
                    self.package,
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
                reply(self.status(
                    &a.path,
                    a.untracked.unwrap_or_default(),
                    a.target.unwrap_or(true),
                )?)
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
            "rollback" => {
                let a: RollbackArgs = parse(args)?;
                self.rollback(a)?;
                reply(Value::Null)
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
                let (repo, root, _) = self.open_root(&a.path)?;
                merge::write_result(
                    &self.env,
                    &repo.to_thread_local(),
                    &root,
                    &a.file,
                    &a.text,
                    a.crlf,
                )?;
                reply(())
            }
            "abort_merge" => {
                let a: PathArgs = parse(args)?;
                let _exclusive = self.exclusive()?;
                let (repo, root, _) = self.open_root(&a.path)?;
                merge::abort(&self.env, &root, repo.to_thread_local().git_dir())?;
                reply(())
            }
            "save_file" => {
                let a: SaveFileArgs = parse(args)?;
                let _exclusive = self.exclusive()?;
                self.save_file(a)?;
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
            "ai_get_state" => {
                let a: AiGetStateArgs = parse(args)?;
                reply(self.ai_get_state(a)?)
            }
            "ai_set_consent" => {
                let a: AiSetConsentArgs = parse(args)?;
                self.ai_set_consent(a)?;
                reply(Value::Null)
            }
            "ai_sign_in" => {
                let a: AiSignInArgs = parse(args)?;
                reply(self.ai_sign_in(a)?)
            }
            "ai_sign_out" => {
                self.ai_sign_out()?;
                reply(Value::Null)
            }
            "ai_refresh_account" => reply(self.ai_refresh_account()?),
            "ai_add_funds" => {
                let a: AiAddFundsArgs = parse(args)?;
                reply(self.ai_add_funds(a)?)
            }
            "ai_get_models" => reply(self.ai_get_models()?),
            "ai_start_review" => {
                let a: AiStartReviewArgs = parse(args)?;
                self.ai_start_review(a)?;
                reply(Value::Null)
            }
            "ai_send_followup" => {
                let a: AiSendFollowupArgs = parse(args)?;
                self.ai_send_followup(a)?;
                reply(Value::Null)
            }
            "ai_clear_thread" => {
                let a: AiClearThreadArgs = parse(args)?;
                self.ai_clear_thread(a)?;
                reply(Value::Null)
            }
            "ai_delete_review" => {
                let a: AiDeleteReviewArgs = parse(args)?;
                self.ai_delete_review(a)?;
                reply(Value::Null)
            }
            "ai_revert_version" => {
                let a: AiRevertVersionArgs = parse(args)?;
                reply(self.ai_revert_version(a)?)
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
                .and_then(|text| platform::first_line(&text))
        };
        ReportEnv {
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: platform::os_name(Platform::CURRENT, &|program, args| {
                let mut command = std::process::Command::new(program);
                first_line(platform::hidden(&mut command).args(args).output())
            }),
            arch: std::env::consts::ARCH.to_string(),
            git: first_line(self.env.git(Path::new("/")).arg("--version").output())
                .map(|line| line.trim_start_matches("git version ").to_string()),
        }
    }

    fn app_info(&self) -> Result<AppInfo> {
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            settings_notice: self.store()?.notice().map(str::to_string),
            home: std::env::var(if Platform::CURRENT == Platform::Windows {
                "USERPROFILE"
            } else {
                "HOME"
            })
            .ok(),
            platform: self.platform,
            ai_review_enabled: self.ai_review_enabled(),
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
        let watcher = RepoWatcher::start(
            &repo,
            self.env.clone(),
            self.events.clone(),
            self.watch_polling.load(Ordering::SeqCst),
        )
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

    fn status(
        &self,
        path: &str,
        untracked: Untracked,
        with_target: bool,
    ) -> Result<Vec<FileChange>> {
        let wanted = canonical(path)?;
        let (repo, root, name, first) = {
            let slot = self.repo_slot()?;
            let open = slot.as_ref().ok_or(Error::NoRepository)?;
            if !platform::same_path(open.repo.root(), Path::new(&wanted)) {
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
        let base = if with_target {
            self.diff_base(&repo.to_thread_local(), &root)?
        } else {
            None
        };
        let changes = match base {
            Some(base) => status::against(&self.env, &root, &base.to_string(), untracked)?,
            None => status::read(&self.env, &root, untracked)?,
        };
        if let Some(open) = self.repo_slot()?.as_mut()
            && platform::same_path(open.repo.root(), &root)
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
        if !platform::same_path(open.repo.root(), Path::new(&wanted)) {
            return Err(Error::NotOpen(wanted));
        }
        Ok((
            open.repo.thread_safe(),
            open.repo.root().to_path_buf(),
            open.repo.name(),
        ))
    }

    fn save_file(&self, args: SaveFileArgs) -> Result<()> {
        let (_, root, _) = self.open_root(&args.path)?;
        let relative = Path::new(&args.file);
        if relative.is_absolute()
            || relative.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::Prefix(_)
                )
            })
        {
            return Err(Error::InvalidArgs(format!(
                "{} is outside the repository",
                args.file
            )));
        }
        let target = root.join(relative);
        if target.exists() {
            let canonical = platform::canonicalize(&target)?;
            if !canonical.starts_with(&root) {
                return Err(Error::InvalidArgs(format!(
                    "{} is outside the repository",
                    args.file
                )));
            }
            if std::fs::symlink_metadata(&target).is_ok_and(|meta| meta.file_type().is_symlink()) {
                return Err(Error::GitRefused(format!(
                    "{} is a symbolic link",
                    args.file
                )));
            }
        } else if let Some(parent) = target.parent()
            && parent.exists()
        {
            let canonical_parent = platform::canonicalize(parent)?;
            if !canonical_parent.starts_with(&root) {
                return Err(Error::InvalidArgs(format!(
                    "{} is outside the repository",
                    args.file
                )));
            }
        }
        let parent = target
            .parent()
            .ok_or_else(|| Error::InvalidArgs(format!("invalid file path: {}", args.file)))?;
        std::fs::create_dir_all(parent)?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
        tmp.write_all(args.text.as_bytes())?;
        tmp.flush()?;
        tmp.persist(&target).map_err(|e| e.error)?;
        Ok(())
    }

    fn diff(&self, args: DiffArgs) -> Result<Arc<FileDiff>> {
        let (repo, root, _) = self.open_root(&args.path)?;
        let target = DiffTarget {
            file: args.file,
            old_path: args.old_path,
        };
        if let Some(id) = args.commit {
            let context = CommitDiff {
                root: &root,
                cache: &self.history,
            };
            return context.diff(&repo.to_thread_local(), &id, &target, self.diff_options()?);
        }
        let repo = repo.to_thread_local();
        let base = if args.local.unwrap_or(false) {
            None
        } else {
            self.diff_base(&repo, &root)?
        };
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
        self.history
            .branch_log(&repo.to_thread_local(), &root, self.events.as_ref())
    }

    fn commit_details(&self, args: CommitIdArgs) -> Result<CommitDetails> {
        let (repo, _, _) = self.open_root(&args.path)?;
        history::commit_details(&repo.to_thread_local(), &args.id)
    }

    fn target_branch(&self, root: &Path) -> Result<Option<String>> {
        let state = self.store()?.repo_state(&root.display().to_string())?;
        if state.target_branch.is_some() {
            return Ok(state.target_branch);
        }
        let slot = self.repo_slot()?;
        Ok(slot
            .as_ref()
            .filter(|open| platform::same_path(open.repo.root(), root))
            .and_then(|open| open.repo.default_target_branch()))
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

    fn rollback(&self, args: RollbackArgs) -> Result<()> {
        let (_, root, name) = self.open_root(&args.path)?;
        let _exclusive = self.exclusive()?;
        let id = format!("rollback:{}", root.display());
        let _task = Task::start(
            self.events.as_ref(),
            &id,
            format!("Rolling back files in {name}"),
        );
        gitops::rollback(&self.env, &root, &args)
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
        let current = repo
            .to_thread_local()
            .head_name()
            .ok()
            .flatten()
            .map(|name| name.shorten().to_string());
        if current.as_deref() == Some(target.as_str()) {
            return Err(Error::GitRefused(
                "The target is the current branch. Pick another target.".into(),
            ));
        }
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
            Some("changes") => ToolTab::Changes,
            _ => ToolTab::Review,
        };
        let default_branch = repo.default_branch();
        let default_target = repo.default_target_branch();
        Ok(RepoInfo {
            name: repo.name(),
            branch: repo.branch(),
            target: state.target_branch.or(default_target),
            default_branch,
            watch_error: open.watcher.as_ref().err().cloned(),
            watch_polling: open.watcher.as_ref().is_ok_and(RepoWatcher::polling),
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
            ToolTab::Review => "review",
            ToolTab::Log => "log",
            ToolTab::Changes => "changes",
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

    fn ai_get_state(&self, a: AiGetStateArgs) -> Result<AiState> {
        let root = if a.repo.is_empty() {
            None
        } else {
            self.open_root(&a.repo).ok().map(|(_, r, _)| r)
        };
        let (branch, target_branch) = match (a.branch, a.target_branch) {
            (Some(b), Some(t)) => (Some(b), Some(t)),
            (b, t) => {
                let slot = self.repo_slot()?;
                let open = slot.as_ref().filter(|o| match &root {
                    Some(r) => platform::same_path(o.repo.root(), r),
                    None => true,
                });
                let br = b.or_else(|| open.and_then(|o| o.repo.branch()));
                drop(slot);
                let tr = t.or_else(|| {
                    root.as_deref()
                        .and_then(|r| self.target_branch(r).ok().flatten())
                });
                (br, tr)
            }
        };
        let store = self.store()?;
        let consent_accepted = store.ai_consent()?;
        let account = aireview::read_auth(&self.data_dir).map(|auth| auth.account);
        let (reviews, active_review_id, review, chat_messages) = match &root {
            Some(r) => {
                let repo_str = r.display().to_string();
                let revs = store.get_ai_reviews(&repo_str)?;
                let active = match a.review_id {
                    Some(rid) => store.get_ai_review(rid)?,
                    None => store.get_latest_ai_review(
                        &repo_str,
                        branch.as_deref(),
                        target_branch.as_deref(),
                    )?,
                };
                let active_id = active.as_ref().map(|rev| rev.id);
                let msgs = store.get_ai_chat_messages(
                    active_id,
                    &repo_str,
                    branch.as_deref().unwrap_or(""),
                    target_branch.as_deref().unwrap_or(""),
                )?;
                (revs, active_id, active, msgs)
            }
            None => (Vec::new(), None, None, Vec::new()),
        };
        Ok(AiState {
            consent_accepted,
            account,
            reviews,
            active_review_id,
            review,
            chat_messages,
        })
    }

    fn ai_delete_review(&self, a: AiDeleteReviewArgs) -> Result<()> {
        self.store()?.delete_ai_review(a.review_id)
    }

    fn ai_revert_version(&self, a: AiRevertVersionArgs) -> Result<Option<StoredAiReview>> {
        self.store()?
            .revert_ai_review_version(a.review_id, a.version_number)
    }

    fn ai_set_consent(&self, a: AiSetConsentArgs) -> Result<()> {
        self.store()?.set_ai_consent(a.accepted)
    }

    fn ai_sign_in(&self, _a: AiSignInArgs) -> Result<AiSignInResult> {
        let cloud_url = self.cloud_url();
        let resp = ureq::post(&format!("{cloud_url}/v1/auth/device"))
            .set("Content-Type", "application/json")
            .send_json(serde_json::json!({}))
            .map_err(aireview::map_ureq_error)?;
        let data: serde_json::Value = resp
            .into_json()
            .map_err(|e| Error::AiService(e.to_string()))?;
        let device_code = data["device_code"]
            .as_str()
            .ok_or_else(|| Error::AiService("Missing device_code".into()))?
            .to_string();
        let user_code = data["user_code"]
            .as_str()
            .ok_or_else(|| Error::AiService("Missing user_code".into()))?
            .to_string();
        let verification_url = data["verification_url"]
            .as_str()
            .ok_or_else(|| Error::AiService("Missing verification_url".into()))?
            .to_string();
        let poll_interval_ms = data["poll_interval_ms"].as_u64().unwrap_or(1000);

        self.cancels.cancel(aireview::AI_SIGN_IN_TASK);
        let cancels = self.cancels.clone();
        let events = self.events.clone();
        let data_dir = self.data_dir.clone();
        let task_cloud_url = cloud_url.clone();

        std::thread::spawn(move || {
            let watch = cancels.watch(aireview::AI_SIGN_IN_TASK);
            let _task = Task::cancellable(
                events.as_ref(),
                aireview::AI_SIGN_IN_TASK,
                "Signing in...".to_string(),
            );
            let interval = std::time::Duration::from_millis(poll_interval_ms.max(50));
            loop {
                for _ in 0..(interval.as_millis() / 100).max(1) {
                    if watch.cancelled() {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                if watch.cancelled() {
                    return;
                }
                let token_resp = ureq::post(&format!("{task_cloud_url}/v1/auth/token"))
                    .set("Content-Type", "application/json")
                    .send_json(serde_json::json!({ "device_code": &device_code }));
                if let Some(json) = token_resp
                    .ok()
                    .and_then(|r| r.into_json::<serde_json::Value>().ok())
                {
                    let status = json["status"].as_str().unwrap_or_default();
                    if status == "authorized" {
                        let maybe_account = json.get("account").and_then(|a| {
                            serde_json::from_value::<CloudAccount>(a.clone())
                                .ok()
                                .or_else(|| {
                                    Some(CloudAccount {
                                        id: a.get("id")?.as_str()?.to_string(),
                                        email: a.get("email")?.as_str()?.to_string(),
                                        balance_usd: a
                                            .get("balance_usd")
                                            .or_else(|| a.get("balanceUsd"))?
                                            .as_str()?
                                            .to_string(),
                                    })
                                })
                        });
                        if let (Some(token), Some(account)) =
                            (json["access_token"].as_str(), maybe_account)
                        {
                            let auth = aireview::StoredCloudAuth {
                                access_token: token.to_string(),
                                account,
                            };
                            let _ = aireview::write_auth(&data_dir, &auth);
                        }
                        break;
                    } else if status == "expired" {
                        break;
                    }
                }
            }
        });

        Ok(AiSignInResult {
            user_code,
            verification_url,
        })
    }

    fn ai_sign_out(&self) -> Result<()> {
        if let Some(auth) = aireview::read_auth(&self.data_dir) {
            let cloud_url = self.cloud_url();
            let _ = ureq::post(&format!("{cloud_url}/v1/auth/logout"))
                .set("Authorization", &format!("Bearer {}", auth.access_token))
                .send_bytes(&[]);
            aireview::clear_auth(&self.data_dir);
        }
        Ok(())
    }

    fn ai_refresh_account(&self) -> Result<CloudAccount> {
        let auth = aireview::read_auth(&self.data_dir).ok_or(Error::AuthRequired)?;
        let cloud_url = self.cloud_url();
        let resp = ureq::get(&format!("{cloud_url}/v1/account"))
            .set("Authorization", &format!("Bearer {}", auth.access_token))
            .call()
            .map_err(|e| {
                if let ureq::Error::Status(401, _) = e {
                    aireview::clear_auth(&self.data_dir);
                }
                aireview::map_ureq_error(e)
            })?;
        let acc: CloudAccount = resp
            .into_json::<serde_json::Value>()
            .map_err(|e| Error::AiService(e.to_string()))
            .and_then(|data| {
                serde_json::from_value::<CloudAccount>(data.clone()).or_else(|_| {
                    Ok(CloudAccount {
                        id: data["id"].as_str().unwrap_or_default().to_string(),
                        email: data["email"].as_str().unwrap_or_default().to_string(),
                        balance_usd: data["balance_usd"]
                            .as_str()
                            .or_else(|| data["balanceUsd"].as_str())
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
            })?;
        let updated_auth = aireview::StoredCloudAuth {
            access_token: auth.access_token,
            account: acc.clone(),
        };
        aireview::write_auth(&self.data_dir, &updated_auth)?;
        Ok(acc)
    }

    fn ai_add_funds(&self, a: AiAddFundsArgs) -> Result<AiAddFundsResult> {
        if a.amount_usd != 10 && a.amount_usd != 25 && a.amount_usd != 50 {
            return Err(Error::InvalidArgs("Amount must be 10, 25, or 50".into()));
        }
        let auth = aireview::read_auth(&self.data_dir).ok_or(Error::AuthRequired)?;
        let cloud_url = self.cloud_url();
        let resp = ureq::post(&format!("{cloud_url}/v1/billing/checkout-session"))
            .set("Authorization", &format!("Bearer {}", auth.access_token))
            .send_json(serde_json::json!({ "amount_usd": a.amount_usd }))
            .map_err(aireview::map_ureq_error)?;
        let data: serde_json::Value = resp
            .into_json()
            .map_err(|e| Error::AiService(e.to_string()))?;
        let checkout_url = data["checkout_url"]
            .as_str()
            .ok_or_else(|| Error::AiService("Missing checkout_url".into()))?
            .to_string();
        Ok(AiAddFundsResult { checkout_url })
    }

    fn ai_get_models(&self) -> Result<ModelsCatalog> {
        let store = self.store()?;
        if !store.ai_consent()? {
            return Err(Error::ConsentRequired);
        }
        drop(store);
        let cloud_url = self.cloud_url();
        let resp = ureq::get(&format!("{cloud_url}/v1/models"))
            .call()
            .map_err(aireview::map_ureq_error)?;
        let catalog: ModelsCatalog = resp
            .into_json()
            .map_err(|e| Error::AiService(e.to_string()))?;
        Ok(catalog)
    }

    fn ai_start_review(&self, a: AiStartReviewArgs) -> Result<()> {
        let store = self.store()?;
        if !store.ai_consent()? {
            return Err(Error::ConsentRequired);
        }
        let auth = aireview::read_auth(&self.data_dir).ok_or(Error::AuthRequired)?;
        drop(store);

        let (repo, root, _) = self.open_root(&a.repo)?;
        let repo_local = repo.to_thread_local();
        let branch = match a.branch {
            Some(b) => b,
            None => repo_local
                .head_name()
                .ok()
                .flatten()
                .map(|n| n.shorten().to_string())
                .ok_or_else(|| {
                    Error::GitRefused("Cannot review detached HEAD without a branch name".into())
                })?,
        };
        let target_branch = match a.target_branch {
            Some(t) => t,
            None => self
                .target_branch(&root)?
                .ok_or_else(|| Error::TargetNotFound("No target branch selected".into()))?,
        };

        let base_oid = self.diff_base(&repo_local, &root)?.map(|o| o.to_string());
        let head_oid = repo_local.head_id().ok().map(|o| o.to_string());

        let run_id = self.run_id("ai_review", &root);
        let watch = self.cancels.watch(&run_id);
        let mut task = Task::cancellable(
            self.events.as_ref(),
            &run_id,
            "Uploading repository…".to_string(),
        );

        let archive = aireview::create_archive(&self.env, &root, &self.data_dir)?;
        let unified_diff = aireview::collect_unified_diff(&self.env, &root, base_oid.as_deref());
        let changes = match &base_oid {
            Some(b) => status::against(&self.env, &root, b, status::Untracked::All)?,
            None => status::read(&self.env, &root, status::Untracked::All)?,
        };
        let changed_files = serde_json::to_string(&aireview::collect_changed_files(&changes))?;
        let commits = serde_json::to_string(&aireview::collect_commits(
            &self.env,
            &root,
            base_oid.as_deref(),
            head_oid.as_deref(),
        ))?;

        watch.check()?;

        let boundary = format!(
            "----Boundary{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"branch\"\r\n\r\n{branch}\r\n").as_bytes());
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"target_branch\"\r\n\r\n{target_branch}\r\n").as_bytes());
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"consent_confirmed\"\r\n\r\ntrue\r\n").as_bytes());
        if let Some(ref b) = base_oid {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"base_oid\"\r\n\r\n{b}\r\n").as_bytes());
        }
        if let Some(ref h) = head_oid {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"head_oid\"\r\n\r\n{h}\r\n").as_bytes());
        }
        if let Some(ref m) = a.model {
            body.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{m}\r\n"
                )
                .as_bytes(),
            );
        }
        if let Some(ref e) = a.effort {
            body.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"effort\"\r\n\r\n{e}\r\n"
                )
                .as_bytes(),
            );
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"unified_diff\"\r\n\r\n{unified_diff}\r\n").as_bytes());
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"changed_files\"\r\n\r\n{changed_files}\r\n").as_bytes());
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"commit_log\"\r\n\r\n{commits}\r\n").as_bytes());
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"repo.tar.gz\"\r\nContent-Type: application/gzip\r\n\r\n").as_bytes());
        let archive_bytes = std::fs::read(archive.path())?;
        body.extend_from_slice(&archive_bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let cloud_url = self.cloud_url();
        let resp = ureq::post(&format!("{cloud_url}/v1/reviews/stream"))
            .set("Authorization", &format!("Bearer {}", auth.access_token))
            .set(
                "Content-Type",
                &format!("multipart/form-data; boundary={boundary}"),
            )
            .send_bytes(&body)
            .map_err(aireview::map_ureq_error)?;

        let store_guard = self.store()?;
        let repo_str = root.display().to_string();
        let ctx = aireview::StreamContext {
            repo: &repo_str,
            branch: &branch,
            target_branch: &target_branch,
            run_id: &run_id,
            head_oid: head_oid.as_deref(),
            base_oid: base_oid.as_deref(),
            model: a.model.as_deref(),
            effort: a.effort.as_deref(),
            review_id: None,
            data_dir: &self.data_dir,
        };
        aireview::stream_sse(
            resp,
            &ctx,
            &watch,
            self.events.as_ref(),
            &mut task,
            &store_guard,
        )?;

        Ok(())
    }

    fn ai_send_followup(&self, a: AiSendFollowupArgs) -> Result<()> {
        {
            let store = self.store()?;
            if !store.ai_consent()? {
                return Err(Error::ConsentRequired);
            }
        }
        let auth = aireview::read_auth(&self.data_dir).ok_or(Error::AuthRequired)?;

        let (repo, root, _) = self.open_root(&a.repo)?;
        let repo_local = repo.to_thread_local();
        let branch = match a.branch {
            Some(b) => b,
            None => repo_local
                .head_name()
                .ok()
                .flatten()
                .map(|n| n.shorten().to_string())
                .ok_or_else(|| Error::GitRefused("Cannot send follow-up without branch".into()))?,
        };
        let target_branch = match a.target_branch {
            Some(t) => t,
            None => self
                .target_branch(&root)?
                .ok_or_else(|| Error::TargetNotFound("No target branch selected".into()))?,
        };

        let repo_str = root.display().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let (active_review, current_report, chat_history) = {
            let store = self.store()?;
            let active_review = match a.review_id {
                Some(rid) => store.get_ai_review(rid)?,
                None => {
                    store.get_latest_ai_review(&repo_str, Some(&branch), Some(&target_branch))?
                }
            };
            let review_id = active_review.as_ref().map(|r| r.id);

            store.append_ai_chat_message(&NewAiChatMessage {
                review_id,
                repo: &repo_str,
                branch: &branch,
                target_branch: &target_branch,
                role: "user",
                content: &a.prompt,
                quoted_text: a.quoted_text.as_deref(),
                cost_usd: None,
                created_at: now,
            })?;

            let current_report = active_review
                .as_ref()
                .map(|r| r.report_markdown.clone())
                .unwrap_or_default();
            let msgs = store.get_ai_chat_messages(review_id, &repo_str, &branch, &target_branch)?;
            let chat_history: Vec<serde_json::Value> = msgs
                .iter()
                .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
                .collect();
            (active_review, current_report, chat_history)
        };
        let review_id = active_review.as_ref().map(|r| r.id);

        let run_id = self.run_id("ai_followup", &root);
        let watch = self.cancels.watch(&run_id);
        let mut task = Task::cancellable(
            self.events.as_ref(),
            &run_id,
            "Analyzing follow-up question…".to_string(),
        );

        let cloud_url = self.cloud_url();
        let resp = ureq::post(&format!("{cloud_url}/v1/reviews/followup"))
            .set("Authorization", &format!("Bearer {}", auth.access_token))
            .send_json(serde_json::json!({
                "prompt": a.prompt,
                "current_report_markdown": current_report,
                "chat_history": chat_history,
                "quoted_text": a.quoted_text,
                "section_heading": a.section_heading,
                "consent_confirmed": true,
            }))
            .map_err(aireview::map_ureq_error)?;

        let store_guard = self.store()?;
        let ctx = aireview::StreamContext {
            repo: &repo_str,
            branch: &branch,
            target_branch: &target_branch,
            run_id: &run_id,
            head_oid: None,
            base_oid: None,
            model: active_review.as_ref().and_then(|r| r.model.as_deref()),
            effort: active_review.as_ref().and_then(|r| r.effort.as_deref()),
            review_id,
            data_dir: &self.data_dir,
        };
        aireview::stream_sse(
            resp,
            &ctx,
            &watch,
            self.events.as_ref(),
            &mut task,
            &store_guard,
        )?;

        Ok(())
    }

    fn ai_clear_thread(&self, a: AiClearThreadArgs) -> Result<()> {
        let (_, root, _) = self.open_root(&a.repo)?;
        self.store()?.clear_ai_chat_thread(
            a.review_id,
            &root.display().to_string(),
            &a.branch,
            &a.target_branch,
        )
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
    Ok(platform::canonicalize(path)?.display().to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

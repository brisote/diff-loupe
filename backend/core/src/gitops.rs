use crate::api::{CommitArgs, RollbackArgs};
use crate::error::{Error, Result};
use crate::shellenv::ShellEnv;
use gix::bstr::ByteSlice;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::{Component, Path};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use ts_rs::TS;

const RECENT_BRANCHES: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Branches {
    pub current: Option<String>,
    pub recent: Vec<String>,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitResult {
    pub id: String,
    pub short: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export)]
pub enum PushResult {
    #[serde(rename_all = "camelCase")]
    Pushed { remote_branch: String, commits: u32 },
    #[serde(rename_all = "camelCase")]
    Rejected {
        remote_branch: String,
        behind: Option<u32>,
        details: String,
    },
}

#[derive(Default)]
pub struct Cancels {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Cancels {
    pub fn cancel(&self, id: &str) -> bool {
        let flag = self.flags.lock().ok().and_then(|f| f.get(id).cloned());
        flag.map(|flag| flag.store(true, Ordering::SeqCst))
            .is_some()
    }

    pub fn watch(&self, id: &str) -> Watch<'_> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut flags) = self.flags.lock() {
            flags.insert(id.to_string(), flag.clone());
        }
        Watch {
            cancels: self,
            id: id.to_string(),
            flag,
        }
    }
}

pub struct Watch<'a> {
    cancels: &'a Cancels,
    id: String,
    flag: Arc<AtomicBool>,
}

impl Watch<'_> {
    pub(crate) fn check(&self) -> Result<()> {
        if self.flag.load(Ordering::SeqCst) {
            return Err(Error::Cancelled);
        }
        Ok(())
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    pub(crate) fn run(&self, mut cmd: Command) -> Result<Output> {
        self.check()?;
        run_until(&mut cmd, &self.flag)
    }
}

impl Drop for Watch<'_> {
    fn drop(&mut self) {
        if let Ok(mut flags) = self.cancels.flags.lock() {
            flags.remove(&self.id);
        }
    }
}

fn run_until(cmd: &mut Command, cancelled: &AtomicBool) -> Result<Output> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;
    let reader = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut bytes);
            }
            bytes
        })
    };
    let stdout = reader(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = reader(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if cancelled.load(Ordering::SeqCst) {
            stop(&mut child);
            return Err(Error::Cancelled);
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

pub(crate) fn stop(child: &mut std::process::Child) {
    let group = i32::try_from(child.id())
        .ok()
        .and_then(rustix::process::Pid::from_raw);
    let signal = |signal| {
        if let Some(group) = group {
            let _ = rustix::process::kill_process_group(group, signal);
        }
    };
    signal(rustix::process::Signal::TERM);
    for _ in 0..40 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    signal(rustix::process::Signal::KILL);
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn checked(output: Output) -> Result<String> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    Err(failure(&output))
}

pub(crate) fn failure(output: &Output) -> Error {
    let message = [&output.stderr, &output.stdout]
        .iter()
        .map(|bytes| String::from_utf8_lossy(bytes).trim().to_string())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Error::GitRefused(if message.is_empty() {
        "git stopped without a message.".to_string()
    } else {
        message
    })
}

pub(crate) fn git(env: &ShellEnv, root: &Path, args: &[&str]) -> Result<String> {
    checked(env.git(root).args(args).output()?)
}

pub fn branches(repo: &gix::Repository) -> Result<Branches> {
    let current = repo
        .head_name()
        .ok()
        .flatten()
        .map(|name| name.shorten().to_string());
    let platform = repo.references().map_err(git_error)?;
    let mut local: Vec<String> = platform
        .local_branches()
        .map_err(git_error)?
        .filter_map(|r| r.ok().map(|r| r.name().shorten().to_string()))
        .collect();
    let mut remote: Vec<String> = platform
        .remote_branches()
        .map_err(git_error)?
        .filter_map(|r| r.ok().map(|r| r.name().shorten().to_string()))
        .filter(|name| !name.ends_with("/HEAD"))
        .collect();
    local.sort();
    remote.sort();
    let mut recent: Vec<String> = current.iter().cloned().collect();
    for name in visited(repo) {
        if recent.len() >= RECENT_BRANCHES {
            break;
        }
        if local.contains(&name) && !recent.contains(&name) {
            recent.push(name);
        }
    }
    Ok(Branches {
        current,
        recent,
        local,
        remote,
    })
}

fn visited(repo: &gix::Repository) -> Vec<String> {
    let Ok(head) = repo.find_reference("HEAD") else {
        return Vec::new();
    };
    let mut log = head.log_iter();
    let Ok(Some(lines)) = log.rev() else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for line in lines.flatten() {
        let message = line.message.to_str_lossy();
        let Some(rest) = message.strip_prefix("checkout: moving from ") else {
            continue;
        };
        if let Some((from, to)) = rest.split_once(" to ") {
            names.push(to.to_string());
            names.push(from.to_string());
        }
    }
    names
}

pub fn switch(env: &ShellEnv, root: &Path, repo: &gix::Repository, name: &str) -> Result<()> {
    let local = |branch: &str| {
        repo.try_find_reference(format!("refs/heads/{branch}").as_str())
            .ok()
            .flatten()
            .is_some()
    };
    if local(name) {
        return git(env, root, &["switch", "--no-guess", name]).map(|_| ());
    }
    let is_remote = repo
        .try_find_reference(format!("refs/remotes/{name}").as_str())
        .ok()
        .flatten()
        .is_some();
    if !is_remote {
        return Err(Error::GitRefused(format!(
            "The branch {name} does not exist."
        )));
    }
    let short = name.split_once('/').map(|(_, rest)| rest).unwrap_or(name);
    if local(short) {
        return git(env, root, &["switch", "--no-guess", short]).map(|_| ());
    }
    git(env, root, &["switch", "--track", name]).map(|_| ())
}

pub fn commit(env: &ShellEnv, root: &Path, args: &CommitArgs) -> Result<CommitResult> {
    if args.message.trim().is_empty() {
        return Err(Error::InvalidArgs("Write a commit message first.".into()));
    }
    let merging = merging(env, root);
    if args.files.is_empty() && args.staged.is_empty() && !args.amend && !merging {
        return Err(Error::InvalidArgs(
            "Pick at least one file to commit.".into(),
        ));
    }
    if args.amend && merging {
        return Err(Error::GitRefused(
            "A merge is in progress. Commit the merge instead of amending.".into(),
        ));
    }
    if args.amend
        && let Some(remote) = pushed_to(env, root)
    {
        return Err(Error::GitRefused(format!(
            "The last commit is already on {remote}. Amending it would need a force push, which Diffloupe never does. Make a new commit instead."
        )));
    }
    if merging {
        let present: Vec<&String> = args.files.iter().filter(|p| on_disk(root, p)).collect();
        if !present.is_empty() {
            let mut add = env.git(root);
            add.args(["--literal-pathspecs", "add", "-A", "--"])
                .args(present);
            checked(add.output()?)?;
        }
        let mut commit = env.git(root);
        commit.args(["commit", "-m"]).arg(&args.message);
        checked(commit.output()?)?;
    } else {
        commit_only(env, root, args)?;
    }
    let id = git(env, root, &["rev-parse", "HEAD"])?;
    Ok(CommitResult {
        short: id.chars().take(8).collect(),
        id,
    })
}

pub fn rollback(env: &ShellEnv, root: &Path, args: &RollbackArgs) -> Result<()> {
    if args.files.is_empty() {
        return Err(Error::InvalidArgs(
            "Pick at least one file to roll back.".into(),
        ));
    }
    if let Some(path) = args.files.iter().find(|path| !inside(path)) {
        return Err(Error::InvalidArgs(format!(
            "{path} is not a file of this repository."
        )));
    }
    if merging(env, root) {
        return Err(Error::GitRefused(
            "A merge is in progress. Commit or abort it before rolling back files.".into(),
        ));
    }
    let known = in_head(env, root, &args.files)?;
    let (restore, added): (Vec<&String>, Vec<&String>) = args
        .files
        .iter()
        .partition(|path| known.contains(path.as_str()));
    if !added.is_empty() {
        let mut command = env.git(root);
        command
            .args([
                "--literal-pathspecs",
                "rm",
                "--cached",
                "-f",
                "-q",
                "--ignore-unmatch",
                "--",
            ])
            .args(&added);
        checked(command.output()?)?;
    }
    if !restore.is_empty() {
        let mut command = env.git(root);
        command
            .args([
                "--literal-pathspecs",
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
            ])
            .args(&restore);
        checked(command.output()?)?;
    }
    if args.delete_added {
        for path in added.iter().filter(|path| on_disk(root, path)) {
            std::fs::remove_file(root.join(path))?;
        }
    }
    Ok(())
}

fn inside(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn in_head(
    env: &ShellEnv,
    root: &Path,
    files: &[String],
) -> Result<std::collections::HashSet<String>> {
    if git(env, root, &["rev-parse", "-q", "--verify", "HEAD"]).is_err() {
        return Ok(Default::default());
    }
    let mut command = env.git(root);
    command
        .args([
            "--literal-pathspecs",
            "ls-tree",
            "-r",
            "-z",
            "--name-only",
            "HEAD",
            "--",
        ])
        .args(files);
    let output = command.output()?;
    if !output.status.success() {
        return Err(failure(&output));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
        .map(|name| String::from_utf8_lossy(name).to_string())
        .collect())
}

fn commit_only(env: &ShellEnv, root: &Path, args: &CommitArgs) -> Result<()> {
    let index = root.join(git(
        env,
        root,
        &["rev-parse", "--git-path", "diffloupe-commit-index"],
    )?);
    let result = commit_with_index(env, root, args, &index);
    let _ = std::fs::remove_file(&index);
    result
}

fn commit_with_index(env: &ShellEnv, root: &Path, args: &CommitArgs, index: &Path) -> Result<()> {
    let with_index = |args: &[&str]| -> Result<String> {
        checked(
            env.git(root)
                .env("GIT_INDEX_FILE", index)
                .args(args)
                .output()?,
        )
    };
    if git(env, root, &["rev-parse", "-q", "--verify", "HEAD"]).is_ok() {
        with_index(&["read-tree", "HEAD"])?;
    } else {
        with_index(&["read-tree", "--empty"])?;
    }
    for path in &args.staged {
        let listed = git(
            env,
            root,
            &["--literal-pathspecs", "ls-files", "-s", "--", path],
        )?;
        let entry = listed
            .lines()
            .find(|line| line.split_once('\t').is_some_and(|(_, name)| name == path));
        if let Some(entry) = entry {
            let mut update = env.git(root);
            update
                .env("GIT_INDEX_FILE", index)
                .args(["update-index", "--index-info"]);
            checked(with_input(update, &format!("{entry}\n"))?)?;
        } else {
            with_index(&["update-index", "--force-remove", "--", path])?;
        }
    }
    let (present, missing): (Vec<&String>, Vec<&String>) =
        args.files.iter().partition(|path| on_disk(root, path));
    for path in missing {
        with_index(&["update-index", "--force-remove", "--", path])?;
    }
    for path in present {
        with_index(&["update-index", "--add", "--remove", "--", path])?;
    }
    let mut commit = env.git(root);
    commit.env("GIT_INDEX_FILE", index).args(["commit", "-m"]);
    commit.arg(&args.message);
    if args.amend {
        commit.arg("--amend");
    }
    checked(commit.output()?)?;
    if !args.files.is_empty() {
        let mut reset = env.git(root);
        reset
            .args(["--literal-pathspecs", "reset", "-q", "HEAD", "--"])
            .args(&args.files);
        checked(reset.output()?)?;
    }
    Ok(())
}

fn with_input(mut command: Command, input: &str) -> Result<Output> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes())?;
    }
    Ok(child.wait_with_output()?)
}

fn on_disk(root: &Path, path: &str) -> bool {
    let full = root.join(path);
    let (Some(parent), Some(name)) = (full.parent(), full.file_name()) else {
        return false;
    };
    std::fs::read_dir(parent)
        .map(|entries| entries.flatten().any(|entry| entry.file_name() == name))
        .unwrap_or(false)
}

pub(crate) fn merging(env: &ShellEnv, root: &Path) -> bool {
    git(env, root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok()
}

fn pushed_to(env: &ShellEnv, root: &Path) -> Option<String> {
    git(env, root, &["branch", "-r", "--contains", "HEAD"])
        .ok()?
        .lines()
        .map(|line| line.trim().to_string())
        .find(|name| !name.is_empty() && !name.contains(" -> "))
}

pub fn head_message(repo: &gix::Repository) -> Option<String> {
    let commit = repo.head_commit().ok()?;
    let message = commit.message_raw().ok()?;
    Some(message.to_str_lossy().trim_end().to_string())
}

pub(crate) fn remotes(env: &ShellEnv, root: &Path) -> Result<Vec<String>> {
    Ok(git(env, root, &["remote"])?
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect())
}

fn count(env: &ShellEnv, root: &Path, args: &[&str]) -> u32 {
    let mut full = vec!["rev-list", "--count"];
    full.extend_from_slice(args);
    git(env, root, &full)
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or_default()
}

pub(crate) fn split_remote(remotes: &[String], full: &str) -> Option<(String, String)> {
    remotes
        .iter()
        .filter(|remote| full.starts_with(&format!("{remote}/")))
        .max_by_key(|remote| remote.len())
        .map(|remote| (remote.clone(), full[remote.len() + 1..].to_string()))
}

pub(crate) fn has_ref(env: &ShellEnv, root: &Path, name: &str) -> bool {
    git(env, root, &["rev-parse", "-q", "--verify", name]).is_ok()
}

pub struct Destination {
    pub branch: String,
    pub remote: String,
    pub remote_branch: String,
    tracked: bool,
}

impl Destination {
    pub fn resolve(env: &ShellEnv, root: &Path, branch: Option<String>) -> Result<Destination> {
        let branch = branch.ok_or_else(|| {
            Error::GitRefused("Diffloupe pushes branches only. Switch to a branch first.".into())
        })?;
        let remotes = remotes(env, root)?;
        let push = git(
            env,
            root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{push}",
            ],
        )
        .ok();
        let tracked = push
            .as_deref()
            .and_then(|full| split_remote(&remotes, full));
        if let Some((remote, name)) = tracked {
            return Ok(Destination {
                remote_branch: format!("{remote}/{name}"),
                branch: name,
                remote,
                tracked: true,
            });
        }
        let remote = remotes
            .iter()
            .find(|name| *name == "origin")
            .or(remotes.first())
            .cloned()
            .ok_or_else(|| {
                Error::GitRefused(
                    "This repository has no remote. Add one with git remote add, then push again."
                        .into(),
                )
            })?;
        Ok(Destination {
            remote_branch: format!("{remote}/{branch}"),
            branch,
            remote,
            tracked: false,
        })
    }

    pub fn push(&self, env: &ShellEnv, root: &Path, watch: &Watch<'_>) -> Result<PushResult> {
        let remote_branch = self.remote_branch.clone();
        let commits = if self.tracked {
            count(env, root, &[&format!("{remote_branch}..HEAD")])
        } else {
            count(env, root, &["HEAD", "--not", "--remotes"])
        };
        let mut cmd = env.git(root);
        cmd.arg("push");
        if !self.tracked {
            cmd.args(["-u", &self.remote, "HEAD"]);
        }
        let output = watch.run(cmd)?;
        if output.status.success() {
            return Ok(PushResult::Pushed {
                remote_branch,
                commits,
            });
        }
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !details.contains("[rejected]") {
            return Err(failure(&output));
        }
        let mut fetch = env.git(root);
        fetch.args(["fetch", &self.remote, &self.branch]);
        let _ = watch.run(fetch);
        let tracking = format!("refs/remotes/{remote_branch}");
        let behind = has_ref(env, root, &tracking)
            .then(|| count(env, root, &[&format!("HEAD..{tracking}")]))
            .filter(|n| *n > 0);
        Ok(PushResult::Rejected {
            remote_branch,
            behind,
            details,
        })
    }

    pub fn pull(
        &self,
        env: &ShellEnv,
        root: &Path,
        git_dir: &Path,
        watch: &Watch<'_>,
        merge_started: impl FnOnce(),
    ) -> Result<crate::merge::MergeOutcome> {
        crate::merge::refuse_busy(env, root, git_dir)?;
        let mut fetch = env.git(root);
        fetch.args(["fetch", &self.remote, &self.branch]);
        checked(watch.run(fetch)?)?;
        let tracking = format!("refs/remotes/{}", self.remote_branch);
        if !has_ref(env, root, &tracking) {
            return Err(Error::GitRefused(format!(
                "{} does not exist yet, so there is nothing to merge.",
                self.remote_branch
            )));
        }
        watch.check()?;
        merge_started();
        crate::merge::run(env, root, git_dir, &self.remote_branch, &self.remote_branch)
    }
}

pub fn fetch(env: &ShellEnv, root: &Path, watch: &Watch<'_>) -> Result<()> {
    let mut cmd = env.git(root);
    cmd.args(["fetch", "--all"]);
    checked(watch.run(cmd)?).map(|_| ())
}

fn git_error(error: impl std::fmt::Display) -> Error {
    Error::Git(error.to_string())
}

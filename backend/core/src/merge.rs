use crate::error::{Error, Result};
use crate::gitops::{Watch, checked, failure, git, has_ref, remotes, split_remote};
use crate::shellenv::ShellEnv;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Operation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SideState {
    Modified,
    Added,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MergeSide {
    Ours,
    Theirs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Conflict {
    pub path: String,
    pub ours: SideState,
    pub theirs: SideState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MergeState {
    pub operation: Option<Operation>,
    pub theirs: Option<String>,
    pub conflicts: Vec<Conflict>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export)]
pub enum MergeOutcome {
    #[serde(rename_all = "camelCase")]
    Merged { from: String },
    #[serde(rename_all = "camelCase")]
    UpToDate { from: String },
    #[serde(rename_all = "camelCase")]
    Conflicts { from: String, count: u32 },
    #[serde(rename_all = "camelCase")]
    Blocked { from: String, files: Vec<String> },
}

pub fn operation(git_dir: &Path) -> Option<Operation> {
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        Some(Operation::Rebase)
    } else if git_dir.join("MERGE_HEAD").exists() {
        Some(Operation::Merge)
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        Some(Operation::CherryPick)
    } else if git_dir.join("REVERT_HEAD").exists() {
        Some(Operation::Revert)
    } else {
        None
    }
}

pub fn state(
    env: &ShellEnv,
    root: &Path,
    git_dir: &Path,
    current: Option<&str>,
) -> Result<MergeState> {
    let Some(operation) = operation(git_dir) else {
        return Ok(MergeState::default());
    };
    let message = (operation == Operation::Merge)
        .then(|| merge_message(git_dir))
        .flatten();
    let theirs = message
        .as_deref()
        .and_then(|text| merged_name(env, root, text, current));
    Ok(MergeState {
        operation: Some(operation),
        theirs,
        conflicts: conflicts(env, root)?,
        message,
    })
}

fn merge_message(git_dir: &Path) -> Option<String> {
    std::fs::read_to_string(git_dir.join("MERGE_MSG"))
        .ok()
        .map(|text| clean_message(&text))
}

fn clean_message(text: &str) -> String {
    text.lines()
        .filter(|line| !line.starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn merged_name(
    env: &ShellEnv,
    root: &Path,
    message: &str,
    current: Option<&str>,
) -> Option<String> {
    let first = message.lines().next()?;
    let name = first.split('\'').nth(1)?.to_string();
    if !first.starts_with("Merge remote-tracking branch") {
        return Some(name);
    }
    match split_remote(&remotes(env, root).unwrap_or_default(), &name) {
        Some((_, branch)) if Some(branch.as_str()) != current => Some(branch),
        _ => Some(name),
    }
}

pub fn conflicts(env: &ShellEnv, root: &Path) -> Result<Vec<Conflict>> {
    let output = env.git(root).args(["ls-files", "-u", "-z"]).output()?;
    if !output.status.success() {
        return Err(failure(&output));
    }
    let mut stages: BTreeMap<String, [bool; 3]> = BTreeMap::new();
    for record in output.stdout.split(|byte| *byte == 0) {
        let record = String::from_utf8_lossy(record);
        let Some((meta, path)) = record.split_once('\t') else {
            continue;
        };
        let Some(stage) = meta
            .split(' ')
            .nth(2)
            .and_then(|stage| stage.parse::<usize>().ok())
            .filter(|stage| (1..=3).contains(stage))
        else {
            continue;
        };
        stages.entry(path.to_string()).or_default()[stage - 1] = true;
    }
    let side = |base: bool, present: bool| match (base, present) {
        (_, false) => SideState::Deleted,
        (false, true) => SideState::Added,
        (true, true) => SideState::Modified,
    };
    Ok(stages
        .into_iter()
        .map(|(path, [base, ours, theirs])| Conflict {
            path,
            ours: side(base, ours),
            theirs: side(base, theirs),
        })
        .collect())
}

pub fn merge_target(
    env: &ShellEnv,
    root: &Path,
    git_dir: &Path,
    target: &str,
    watch: &Watch<'_>,
    merge_started: impl FnOnce(),
) -> Result<MergeOutcome> {
    refuse_busy(env, root, git_dir)?;
    let local = has_ref(env, root, &format!("refs/heads/{target}"));
    let upstream = if has_ref(env, root, &format!("refs/remotes/{target}")) {
        Some(target.to_string())
    } else if local {
        git(
            env,
            root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                &format!("{target}@{{upstream}}"),
            ],
        )
        .ok()
    } else {
        has_ref(env, root, &format!("refs/remotes/origin/{target}"))
            .then(|| format!("origin/{target}"))
    };
    let remotes = remotes(env, root)?;
    let source = match upstream
        .as_deref()
        .and_then(|full| split_remote(&remotes, full))
    {
        Some((remote, branch)) => {
            let mut fetch = env.git(root);
            fetch.args(["fetch", &remote, &branch]);
            checked(watch.run(fetch)?)?;
            unambiguous(env, root, &format!("{remote}/{branch}"), "refs/remotes")
        }
        None if local => unambiguous(env, root, target, "refs/heads"),
        None => return Err(Error::TargetNotFound(target.to_string())),
    };
    watch.check()?;
    merge_started();
    run(env, root, git_dir, &source, target)
}

fn unambiguous(env: &ShellEnv, root: &Path, short: &str, namespace: &str) -> String {
    if has_ref(env, root, &format!("refs/tags/{short}")) {
        format!("{namespace}/{short}")
    } else {
        short.to_string()
    }
}

pub fn refuse_busy(env: &ShellEnv, root: &Path, git_dir: &Path) -> Result<()> {
    let text = match operation(git_dir) {
        None if conflicts(env, root)?.is_empty() => return Ok(()),
        None => "Some files still have unresolved conflicts. Resolve them first, then merge again.",
        Some(Operation::Merge) => "A merge is already in progress. Finish it, then merge again.",
        Some(Operation::Rebase) => "A rebase is in progress. Finish it in the terminal first.",
        Some(Operation::CherryPick) => {
            "A cherry-pick is in progress. Finish it in the terminal first."
        }
        Some(Operation::Revert) => "A revert is in progress. Finish it in the terminal first.",
    };
    Err(Error::GitRefused(text.into()))
}

pub fn run(
    env: &ShellEnv,
    root: &Path,
    git_dir: &Path,
    source: &str,
    from: &str,
) -> Result<MergeOutcome> {
    let output = env
        .git(root)
        .env("LC_ALL", "C")
        .args(["merge", "--no-edit", source])
        .output()?;
    let from = from.to_string();
    let count = conflicts(env, root)?.len();
    if count > 0 && operation(git_dir) == Some(Operation::Merge) {
        return Ok(MergeOutcome::Conflicts {
            from,
            count: u32::try_from(count).unwrap_or(u32::MAX),
        });
    }
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        return Ok(if text.contains("Already up to date") {
            MergeOutcome::UpToDate { from }
        } else {
            MergeOutcome::Merged { from }
        });
    }
    let files = blocked_files(&String::from_utf8_lossy(&output.stderr));
    if !files.is_empty() {
        return Ok(MergeOutcome::Blocked { from, files });
    }
    Err(failure(&output))
}

fn blocked_files(text: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut listing = false;
    for line in text.lines() {
        if line.contains("would be overwritten by merge") {
            listing = true;
        } else if listing && line.starts_with('\t') {
            files.push(line.trim().to_string());
        } else {
            listing = false;
        }
    }
    files
}

pub fn accept(env: &ShellEnv, root: &Path, files: &[String], side: MergeSide) -> Result<()> {
    let conflicts = conflicts(env, root)?;
    for file in files {
        let conflict = conflicts
            .iter()
            .find(|conflict| &conflict.path == file)
            .ok_or_else(|| Error::InvalidArgs(format!("{file} has no conflict to resolve")))?;
        let (state, flag) = match side {
            MergeSide::Ours => (conflict.ours, "--ours"),
            MergeSide::Theirs => (conflict.theirs, "--theirs"),
        };
        if state == SideState::Deleted {
            checked(
                env.git(root)
                    .args(["--literal-pathspecs", "rm", "-q", "--", file])
                    .output()?,
            )?;
        } else {
            checked(
                env.git(root)
                    .args(["--literal-pathspecs", "checkout", flag, "--", file])
                    .output()?,
            )?;
            checked(
                env.git(root)
                    .args(["--literal-pathspecs", "add", "--", file])
                    .output()?,
            )?;
        }
    }
    Ok(())
}

pub fn abort(env: &ShellEnv, root: &Path, git_dir: &Path) -> Result<()> {
    if operation(git_dir) != Some(Operation::Merge) {
        return Err(Error::GitRefused("No merge is in progress.".into()));
    }
    checked(env.git(root).args(["merge", "--abort"]).output()?)?;
    Ok(())
}

pub fn write_result(
    env: &ShellEnv,
    repo: &gix::Repository,
    root: &Path,
    file: &str,
    text: &str,
    crlf: bool,
) -> Result<()> {
    if !conflicts(env, root)?
        .iter()
        .any(|conflict| conflict.path == file)
    {
        return Err(Error::InvalidArgs(format!(
            "{file} has no conflict to resolve"
        )));
    }
    let normalized = text.replace("\r\n", "\n");
    let bytes = crate::filediff::to_worktree(repo, file, normalized.into_bytes());
    let content = if crlf && !bytes.windows(2).any(|pair| pair == b"\r\n") {
        String::from_utf8_lossy(&bytes)
            .replace('\n', "\r\n")
            .into_bytes()
    } else {
        bytes
    };
    let target = root.join(file);
    if std::fs::symlink_metadata(&target).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(Error::GitRefused(format!(
            "{file} is a symbolic link. Use Accept Yours or Accept Theirs."
        )));
    }
    std::fs::write(target, content)?;
    checked(
        env.git(root)
            .args(["--literal-pathspecs", "add", "--", file])
            .output()?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{blocked_files, clean_message};

    #[test]
    fn blocked_files_come_from_both_of_gits_lists() {
        let text = "error: Your local changes to the following files would be overwritten by merge:\n\ta.kt\n\tsrc/b.kt\nPlease commit your changes or stash them before you merge.\nerror: The following untracked working tree files would be overwritten by merge:\n\tnew.txt\nAborting\n";
        assert_eq!(blocked_files(text), vec!["a.kt", "src/b.kt", "new.txt"]);
    }

    #[test]
    fn the_merge_message_drops_comment_lines() {
        assert_eq!(
            clean_message("Merge branch 'main' into gs/x\n\n# Conflicts:\n#\ta.kt\n"),
            "Merge branch 'main' into gs/x"
        );
    }
}

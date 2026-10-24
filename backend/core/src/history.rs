use crate::diff::Options;
use crate::error::{Error, Result};
use crate::events::{EventSink, Task};
use crate::filediff::{DiffTarget, FileDiff, Source, compare_sources};
use crate::shellenv::ShellEnv;
use crate::status::ChangeKind;
use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogEntry {
    pub id: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    #[ts(type = "number")]
    pub time: i64,
    pub files: u32,
    pub merged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchLog {
    pub target: Option<String>,
    pub entries: Vec<LogEntry>,
    pub truncated: bool,
}

pub const UNTARGETED_LOG_LIMIT: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitDetails {
    pub id: String,
    pub short: String,
    pub subject: String,
    pub body: String,
    pub author: String,
    pub email: String,
    #[ts(type = "number")]
    pub time: i64,
    pub parents: Vec<String>,
    pub merged: bool,
    pub files: Vec<CommitFile>,
}

pub fn target_tips(repo: &gix::Repository, target: &str) -> Vec<gix::ObjectId> {
    let commit = |name: &str| {
        repo.rev_parse_single(name)
            .ok()
            .and_then(|id| id.object().ok()?.peel_to_commit().ok().map(|c| c.id))
    };
    let mut tips: Vec<gix::ObjectId> = [
        format!("refs/remotes/origin/{target}"),
        format!("refs/heads/{target}"),
    ]
    .iter()
    .filter_map(|name| commit(name))
    .collect();
    tips.dedup();
    if tips.is_empty() {
        tips.extend(commit(target));
    }
    tips
}

pub fn merge_head(repo: &gix::Repository) -> Option<gix::ObjectId> {
    std::fs::read_to_string(repo.git_dir().join("MERGE_HEAD"))
        .ok()
        .and_then(|text| gix::ObjectId::from_hex(text.trim().as_bytes()).ok())
}

pub fn merge_base(repo: &gix::Repository, target: &str) -> Result<Option<gix::ObjectId>> {
    let Ok(head) = repo.head_id() else {
        return Ok(None);
    };
    let mut sides = vec![head.detach()];
    sides.extend(merge_head(repo));
    let mut best: Option<gix::ObjectId> = None;
    for tip in target_tips(repo, target) {
        let Some(base) = repo
            .merge_bases_many(tip, &sides)
            .map_err(git_error)?
            .first()
            .map(|id| id.detach())
        else {
            continue;
        };
        let older = match best {
            Some(current) => {
                repo.merge_base(current, base)
                    .map_err(git_error)?
                    .map(|id| id.detach())
                    == Some(base)
            }
            None => false,
        };
        if !older {
            best = Some(base);
        }
    }
    Ok(best)
}

pub fn branch_log(repo: &gix::Repository, target: Option<&str>) -> Result<BranchLog> {
    let empty = BranchLog {
        target: target.map(str::to_string),
        entries: Vec::new(),
        truncated: false,
    };
    let Ok(head) = repo.head_id() else {
        return Ok(empty);
    };
    let Some(name) = target else {
        return untargeted_log(repo, head.detach());
    };
    let tips = target_tips(repo, name);
    if tips.is_empty() {
        return Err(Error::TargetNotFound(name.to_string()));
    }
    let walk = repo
        .rev_walk([head.detach()])
        .first_parent_only()
        .with_hidden(tips.iter().copied())
        .all()
        .map_err(git_error)?;
    let mut entries = Vec::new();
    for info in walk {
        let info = info.map_err(git_error)?;
        let commit = repo.find_commit(info.id).map_err(git_error)?;
        let parents: Vec<gix::ObjectId> = commit.parent_ids().map(|id| id.detach()).collect();
        let merged = is_target_merge(repo, &parents, &tips);
        let files = if merged {
            0
        } else {
            changes(repo, &commit, parents.first().copied())?.len() as u32
        };
        entries.push(entry(&commit, files, merged)?);
    }
    Ok(BranchLog {
        target: target.map(str::to_string),
        entries,
        truncated: false,
    })
}

fn untargeted_log(repo: &gix::Repository, head: gix::ObjectId) -> Result<BranchLog> {
    let walk = repo
        .rev_walk([head])
        .first_parent_only()
        .all()
        .map_err(git_error)?;
    let mut ids = Vec::new();
    let mut truncated = false;
    for info in walk {
        if ids.len() == UNTARGETED_LOG_LIMIT {
            truncated = true;
            break;
        }
        ids.push(info.map_err(git_error)?.id);
    }
    let shared = repo.clone().into_sync();
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));
    let chunk = ids.len().div_ceil(threads).max(1);
    let entries = std::thread::scope(|scope| {
        let workers: Vec<_> = ids
            .chunks(chunk)
            .map(|part| {
                let shared = &shared;
                scope.spawn(move || -> Result<Vec<LogEntry>> {
                    let mut repo = shared.to_thread_local();
                    repo.object_cache_size_if_unset(64 * 1024 * 1024);
                    part.iter()
                        .map(|id| {
                            let commit = repo.find_commit(*id).map_err(git_error)?;
                            let parent = commit.parent_ids().next().map(|id| id.detach());
                            let files = changes(&repo, &commit, parent)?.len() as u32;
                            entry(&commit, files, false)
                        })
                        .collect()
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|worker| {
                worker.join().map_err(|_| {
                    Error::InvalidArgs("the branch history could not be read".into())
                })?
            })
            .collect::<Result<Vec<Vec<LogEntry>>>>()
    })?;
    Ok(BranchLog {
        target: None,
        entries: entries.into_iter().flatten().collect(),
        truncated,
    })
}

fn is_target_merge(
    repo: &gix::Repository,
    parents: &[gix::ObjectId],
    tips: &[gix::ObjectId],
) -> bool {
    let Some(second) = parents.get(1) else {
        return false;
    };
    tips.iter().any(
        |tip| matches!(repo.merge_base(*second, *tip), Ok(Some(base)) if base.detach() == *second),
    )
}

fn entry(commit: &gix::Commit<'_>, files: u32, merged: bool) -> Result<LogEntry> {
    let message = commit.message().map_err(git_error)?;
    let author = commit.author().map_err(git_error)?;
    Ok(LogEntry {
        id: commit.id.to_string(),
        short: commit.id.to_hex_with_len(8).to_string(),
        subject: message.summary().to_str_lossy().into_owned(),
        author: author.name.to_str_lossy().into_owned(),
        time: author.time().map(|t| t.seconds).unwrap_or_default(),
        files,
        merged,
    })
}

pub fn commit_details(
    repo: &gix::Repository,
    context: &CommitDiff<'_>,
    id: &str,
) -> Result<CommitDetails> {
    let commit = find(repo, id)?;
    let parents: Vec<gix::ObjectId> = commit.parent_ids().map(|id| id.detach()).collect();
    let merged = is_target_merge(repo, &parents, &context.tips(repo));
    let files = if merged {
        let automatic = context
            .cache
            .automatic(repo, context.env, context.root, &parents)?;
        tree_changes(
            repo,
            Some(automatic),
            commit.tree_id().map_err(git_error)?.detach(),
        )?
    } else {
        changes(repo, &commit, parents.first().copied())?
    };
    let message = commit.message().map_err(git_error)?;
    let author = commit.author().map_err(git_error)?;
    let body = message
        .body()
        .map(|body| body.to_str_lossy().trim().to_string())
        .unwrap_or_default();
    Ok(CommitDetails {
        id: commit.id.to_string(),
        short: commit.id.to_hex_with_len(8).to_string(),
        subject: message.summary().to_str_lossy().into_owned(),
        body,
        author: author.name.to_str_lossy().into_owned(),
        email: author.email.to_str_lossy().into_owned(),
        time: author.time().map(|t| t.seconds).unwrap_or_default(),
        parents: parents.iter().map(|id| id.to_string()).collect(),
        merged,
        files,
    })
}

const CACHED_DIFFS: usize = 256;

type MergeKey = (PathBuf, gix::ObjectId, gix::ObjectId);
type DiffKey = (PathBuf, String, DiffTarget, Options, Option<String>);
type LogKey = (
    PathBuf,
    Option<gix::ObjectId>,
    Option<String>,
    Vec<gix::ObjectId>,
);

#[derive(Default)]
pub struct HistoryCache {
    merges: Mutex<HashMap<MergeKey, gix::ObjectId>>,
    diffs: Mutex<HashMap<DiffKey, Arc<FileDiff>>>,
    log: Mutex<Option<(LogKey, Arc<BranchLog>)>>,
}

impl HistoryCache {
    pub fn branch_log(
        &self,
        repo: &gix::Repository,
        root: &Path,
        target: Option<&str>,
        events: &dyn EventSink,
    ) -> Result<Arc<BranchLog>> {
        let key = (
            root.to_path_buf(),
            repo.head_id().ok().map(|id| id.detach()),
            target.map(str::to_string),
            target
                .map(|name| target_tips(repo, name))
                .unwrap_or_default(),
        );
        if let Ok(log) = self.log.lock()
            && let Some((cached, hit)) = log.as_ref()
            && *cached == key
        {
            return Ok(hit.clone());
        }
        let id = format!("branch-log:{}", root.display());
        let _task = Task::start(events, &id, "Reading branch history".to_string());
        let log = Arc::new(branch_log(repo, target)?);
        if let Ok(mut slot) = self.log.lock() {
            *slot = Some((key, log.clone()));
        }
        Ok(log)
    }

    fn automatic(
        &self,
        repo: &gix::Repository,
        env: &ShellEnv,
        root: &Path,
        parents: &[gix::ObjectId],
    ) -> Result<gix::ObjectId> {
        let [first, second, ..] = parents else {
            return Err(Error::InvalidArgs("a merge needs two parents".into()));
        };
        let key = (root.to_path_buf(), *first, *second);
        let cached = self.merges.lock().ok().and_then(|t| t.get(&key).copied());
        if let Some(tree) = cached.filter(|tree| repo.has_object(tree)) {
            return Ok(tree);
        }
        let tree = automatic_merge(env, root, parents)?;
        if let Ok(mut trees) = self.merges.lock() {
            trees.insert(key, tree);
        }
        Ok(tree)
    }
}

pub struct CommitDiff<'a> {
    pub env: &'a ShellEnv,
    pub root: &'a Path,
    pub cache: &'a HistoryCache,
    pub target_branch: Option<&'a str>,
}

impl CommitDiff<'_> {
    fn tips(&self, repo: &gix::Repository) -> Vec<gix::ObjectId> {
        self.target_branch
            .map(|name| target_tips(repo, name))
            .unwrap_or_default()
    }

    fn marker_labels(
        &self,
        repo: &gix::Repository,
        parents: &[gix::ObjectId],
    ) -> Vec<(String, String)> {
        let branch = repo
            .head_name()
            .ok()
            .flatten()
            .map(|name| name.shorten().to_string());
        let mut labels = Vec::new();
        if let Some(first) = parents.first() {
            let label = branch.unwrap_or_else(|| first.to_hex_with_len(8).to_string());
            labels.push((first.to_string(), label));
        }
        if let (Some(second), Some(target)) = (parents.get(1), self.target_branch) {
            labels.push((second.to_string(), target.to_string()));
        }
        labels
    }

    pub fn diff(
        &self,
        repo: &gix::Repository,
        id: &str,
        target: &DiffTarget,
        options: Options,
    ) -> Result<Arc<FileDiff>> {
        let key = (
            self.root.to_path_buf(),
            id.to_string(),
            target.clone(),
            options,
            self.target_branch.map(str::to_string),
        );
        if let Some(hit) = self
            .cache
            .diffs
            .lock()
            .ok()
            .and_then(|d| d.get(&key).cloned())
        {
            return Ok(hit);
        }
        let diff = Arc::new(self.compute(repo, id, target, options)?);
        if let Ok(mut diffs) = self.cache.diffs.lock() {
            if diffs.len() >= CACHED_DIFFS {
                diffs.clear();
            }
            diffs.insert(key, diff.clone());
        }
        Ok(diff)
    }

    fn compute(
        &self,
        repo: &gix::Repository,
        id: &str,
        target: &DiffTarget,
        options: Options,
    ) -> Result<FileDiff> {
        let commit = find(repo, id)?;
        let parents: Vec<gix::ObjectId> = commit.parent_ids().map(|id| id.detach()).collect();
        let tree = commit.tree_id().map_err(git_error)?.detach();
        let (left, right) = if is_target_merge(repo, &parents, &self.tips(repo)) {
            let automatic = self.cache.automatic(repo, self.env, self.root, &parents)?;
            (
                Source::Tree {
                    id: automatic,
                    revision: None,
                    title: Some("Automatic merge".into()),
                    markers: self.marker_labels(repo, &parents),
                },
                Source::Tree {
                    id: tree,
                    revision: Some(commit.id.to_hex_with_len(8).to_string()),
                    title: Some("Merge commit".into()),
                    markers: Vec::new(),
                },
            )
        } else {
            let left = match parents.first() {
                Some(parent) => Source::Tree {
                    id: repo
                        .find_commit(*parent)
                        .map_err(git_error)?
                        .tree_id()
                        .map_err(git_error)?
                        .detach(),
                    revision: Some(parent.to_hex_with_len(8).to_string()),
                    title: None,
                    markers: Vec::new(),
                },
                None => Source::Tree {
                    id: gix::ObjectId::empty_tree(repo.object_hash()),
                    revision: None,
                    title: None,
                    markers: Vec::new(),
                },
            };
            (
                left,
                Source::Tree {
                    id: tree,
                    revision: Some(commit.id.to_hex_with_len(8).to_string()),
                    title: None,
                    markers: Vec::new(),
                },
            )
        };
        compare_sources(repo, self.root, &left, &right, target, options)
    }
}

pub fn find<'r>(repo: &'r gix::Repository, id: &str) -> Result<gix::Commit<'r>> {
    let object = gix::ObjectId::from_hex(id.as_bytes())
        .map_err(|_| Error::InvalidArgs(format!("{id} is not a commit id")))?;
    repo.find_commit(object).map_err(git_error)
}

fn automatic_merge(
    env: &ShellEnv,
    root: &Path,
    parents: &[gix::ObjectId],
) -> Result<gix::ObjectId> {
    let [first, second, ..] = parents else {
        return Err(Error::InvalidArgs("a merge needs two parents".into()));
    };
    let output = env
        .git(root)
        .args(["merge-tree", "--write-tree", "--no-messages"])
        .arg(first.to_string())
        .arg(second.to_string())
        .output()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let tree = text.lines().next().unwrap_or_default().trim();
    gix::ObjectId::from_hex(tree.as_bytes())
        .map_err(|_| Error::Git(String::from_utf8_lossy(&output.stderr).trim().to_string()))
}

fn changes(
    repo: &gix::Repository,
    commit: &gix::Commit<'_>,
    parent: Option<gix::ObjectId>,
) -> Result<Vec<CommitFile>> {
    let old = match parent {
        Some(id) => Some(
            repo.find_commit(id)
                .map_err(git_error)?
                .tree_id()
                .map_err(git_error)?
                .detach(),
        ),
        None => None,
    };
    tree_changes(repo, old, commit.tree_id().map_err(git_error)?.detach())
}

pub fn tree_changes(
    repo: &gix::Repository,
    old: Option<gix::ObjectId>,
    new: gix::ObjectId,
) -> Result<Vec<CommitFile>> {
    let old_tree = match old {
        Some(id) => Some(repo.find_tree(id).map_err(git_error)?),
        None => None,
    };
    let new_tree = repo.find_tree(new).map_err(git_error)?;
    let changes = repo
        .diff_tree_to_tree(old_tree.as_ref(), &new_tree, None)
        .map_err(git_error)?;
    let mut files: Vec<CommitFile> = changes.into_iter().filter_map(file).collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn file(change: ChangeDetached) -> Option<CommitFile> {
    let (path, old_path, kind, mode) = match change {
        ChangeDetached::Addition {
            location,
            entry_mode,
            ..
        } => (location, None, ChangeKind::Added, entry_mode),
        ChangeDetached::Deletion {
            location,
            entry_mode,
            ..
        } => (location, None, ChangeKind::Deleted, entry_mode),
        ChangeDetached::Modification {
            location,
            entry_mode,
            previous_entry_mode,
            ..
        } => {
            let kind = if entry_mode.kind() == previous_entry_mode.kind() {
                ChangeKind::Modified
            } else {
                ChangeKind::TypeChanged
            };
            (location, None, kind, entry_mode)
        }
        ChangeDetached::Rewrite {
            source_location,
            location,
            entry_mode,
            copy,
            ..
        } => {
            let kind = if copy {
                ChangeKind::Copied
            } else {
                ChangeKind::Renamed
            };
            (location, Some(source_location), kind, entry_mode)
        }
    };
    if mode.is_tree() {
        return None;
    }
    Some(CommitFile {
        path: path.to_str_lossy().into_owned(),
        old_path: old_path.map(|p| p.to_str_lossy().into_owned()),
        kind,
    })
}

fn git_error(error: impl std::fmt::Display) -> Error {
    Error::Git(error.to_string())
}

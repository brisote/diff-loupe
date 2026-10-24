use crate::diff::Options;
use crate::error::{Error, Result};
use crate::events::{EventSink, Task};
use crate::filediff::{DiffTarget, FileDiff, Source, compare_sources};
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchLog {
    pub entries: Vec<LogEntry>,
    pub truncated: bool,
}

pub const LOG_LIMIT: usize = 500;

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

pub fn branch_log(repo: &gix::Repository) -> Result<BranchLog> {
    let Ok(head) = repo.head_id() else {
        return Ok(BranchLog {
            entries: Vec::new(),
            truncated: false,
        });
    };
    let head = head.detach();
    let walk = repo
        .rev_walk([head])
        .first_parent_only()
        .all()
        .map_err(git_error)?;
    let mut ids = Vec::new();
    let mut truncated = false;
    for info in walk {
        if ids.len() == LOG_LIMIT {
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
                            entry(&commit, files)
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
        entries: entries.into_iter().flatten().collect(),
        truncated,
    })
}

fn entry(commit: &gix::Commit<'_>, files: u32) -> Result<LogEntry> {
    let message = commit.message().map_err(git_error)?;
    let author = commit.author().map_err(git_error)?;
    Ok(LogEntry {
        id: commit.id.to_string(),
        short: commit.id.to_hex_with_len(8).to_string(),
        subject: message.summary().to_str_lossy().into_owned(),
        author: author.name.to_str_lossy().into_owned(),
        time: author.time().map(|t| t.seconds).unwrap_or_default(),
        files,
    })
}

pub fn commit_details(repo: &gix::Repository, id: &str) -> Result<CommitDetails> {
    let commit = find(repo, id)?;
    let parents: Vec<gix::ObjectId> = commit.parent_ids().map(|id| id.detach()).collect();
    let files = changes(repo, &commit, parents.first().copied())?;
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
        files,
    })
}

const CACHED_DIFFS: usize = 256;

type DiffKey = (PathBuf, String, DiffTarget, Options);
type LogKey = (PathBuf, Option<gix::ObjectId>);

#[derive(Default)]
pub struct HistoryCache {
    diffs: Mutex<HashMap<DiffKey, Arc<FileDiff>>>,
    log: Mutex<Option<(LogKey, Arc<BranchLog>)>>,
}

impl HistoryCache {
    pub fn branch_log(
        &self,
        repo: &gix::Repository,
        root: &Path,
        events: &dyn EventSink,
    ) -> Result<Arc<BranchLog>> {
        let key = (
            root.to_path_buf(),
            repo.head_id().ok().map(|id| id.detach()),
        );
        if let Ok(log) = self.log.lock()
            && let Some((cached, hit)) = log.as_ref()
            && *cached == key
        {
            return Ok(hit.clone());
        }
        let id = format!("branch-log:{}", root.display());
        let _task = Task::start(events, &id, "Reading branch history".to_string());
        let log = Arc::new(branch_log(repo)?);
        if let Ok(mut slot) = self.log.lock() {
            *slot = Some((key, log.clone()));
        }
        Ok(log)
    }
}

pub struct CommitDiff<'a> {
    pub root: &'a Path,
    pub cache: &'a HistoryCache,
}

impl CommitDiff<'_> {
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
        let left = match commit.parent_ids().next().map(|id| id.detach()) {
            Some(parent) => Source::Tree {
                id: repo
                    .find_commit(parent)
                    .map_err(git_error)?
                    .tree_id()
                    .map_err(git_error)?
                    .detach(),
                revision: Some(parent.to_hex_with_len(8).to_string()),
            },
            None => Source::Tree {
                id: gix::ObjectId::empty_tree(repo.object_hash()),
                revision: None,
            },
        };
        let right = Source::Tree {
            id: commit.tree_id().map_err(git_error)?.detach(),
            revision: Some(commit.id.to_hex_with_len(8).to_string()),
        };
        compare_sources(repo, self.root, &left, &right, target, options)
    }
}

pub fn find<'r>(repo: &'r gix::Repository, id: &str) -> Result<gix::Commit<'r>> {
    let object = gix::ObjectId::from_hex(id.as_bytes())
        .map_err(|_| Error::InvalidArgs(format!("{id} is not a commit id")))?;
    repo.find_commit(object).map_err(git_error)
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

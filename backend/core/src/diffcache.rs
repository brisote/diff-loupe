use crate::diff::Options;
use crate::error::Result;
use crate::events::{EventSink, Task};
use crate::filediff::{Area, DiffTarget, FileDiff, Stamp, changes_diff, stamp, worktree_size};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

const PREPARE_FILE_LIMIT: usize = 300;
const PREPARE_SIZE_LIMIT: u64 = 2 * 1024 * 1024;

type Key = (
    PathBuf,
    DiffTarget,
    Options,
    Option<gix::ObjectId>,
    Option<Area>,
);

pub struct Prepare {
    pub repo: gix::ThreadSafeRepository,
    pub root: PathBuf,
    pub name: String,
    pub base: Option<gix::ObjectId>,
    pub targets: Vec<DiffTarget>,
    pub options: Options,
}

#[derive(Default)]
pub struct DiffCache {
    entries: Mutex<HashMap<Key, (Stamp, Arc<FileDiff>)>>,
    generation: AtomicU64,
}

impl DiffCache {
    pub fn clear(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }

    pub fn get(
        &self,
        repo: &gix::Repository,
        root: &Path,
        base: Option<gix::ObjectId>,
        area: Option<Area>,
        target: &DiffTarget,
        options: Options,
    ) -> Result<Arc<FileDiff>> {
        let key = (root.to_path_buf(), target.clone(), options, base, area);
        let current = stamp(repo, root, target, base, area);
        if let Some(hit) = self.cached(&key, &current) {
            return Ok(hit);
        }
        let diff = Arc::new(changes_diff(repo, root, base, area, target, options)?);
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(key, (current, diff.clone()));
        }
        Ok(diff)
    }

    fn cached(&self, key: &Key, current: &Stamp) -> Option<Arc<FileDiff>> {
        let entries = self.entries.lock().ok()?;
        let (stamp, diff) = entries.get(key)?;
        (stamp == current).then(|| diff.clone())
    }

    fn keep_only(&self, root: &Path, base: Option<gix::ObjectId>, targets: &[DiffTarget]) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|(entry_root, target, _, entry_base, _), _| {
                entry_root == root && *entry_base == base && targets.contains(target)
            });
        }
    }

    pub fn prepare(self: &Arc<Self>, job: Prepare, events: Arc<dyn EventSink>) {
        let Prepare {
            repo,
            root,
            name,
            base,
            targets,
            options,
        } = job;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.keep_only(&root, base, &targets);
        let cache = self.clone();
        std::thread::spawn(move || {
            let repo = repo.to_thread_local();
            let targets: Vec<DiffTarget> = targets
                .into_iter()
                .filter(|target| {
                    worktree_size(&root, &target.file).unwrap_or(0) <= PREPARE_SIZE_LIMIT
                })
                .take(PREPARE_FILE_LIMIT)
                .collect();
            let total = targets.len();
            let id = format!("prepare-diffs:{}:{generation}", root.display());
            let mut task = Task::start(events.as_ref(), &id, label(&name, 0, total));
            for (done, target) in targets.iter().enumerate() {
                if cache.generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                let _ = cache.get(&repo, &root, base, None, target, options);
                task.progress(
                    label(&name, done + 1, total),
                    (done + 1) as f64 / total.max(1) as f64,
                );
            }
        });
    }
}

fn label(name: &str, done: usize, total: usize) -> String {
    format!("Preparing diffs in {name} · {done} of {total} files")
}

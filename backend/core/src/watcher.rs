use crate::error::{Error, Result};
use crate::events::{CoreEvent, EventSink};
use crate::repo::Repo;
use crate::shellenv::ShellEnv;
use gix::bstr::{BStr, ByteSlice};
use notify::event::{AccessKind, AccessMode};
use notify::{Event, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

const DEBOUNCE: Duration = Duration::from_millis(150);
const OWN_GIT_FILES: [&str; 10] = [
    "index",
    "HEAD",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "ORIG_HEAD",
    "packed-refs",
    "refs",
];
const SHARED_GIT_FILES: [&str; 2] = ["packed-refs", "refs"];

const POLL_INTERVAL: Duration = Duration::from_secs(5);

pub struct RepoWatcher {
    _native: Option<RecommendedWatcher>,
    _polling: Option<PollWatcher>,
}

const EMFILE: i32 = 24;

pub fn needs_polling(error: &notify::Error) -> bool {
    match &error.kind {
        notify::ErrorKind::MaxFilesWatch => true,
        notify::ErrorKind::Io(io) => io.raw_os_error() == Some(EMFILE),
        _ => false,
    }
}

fn polling_or_error<T>(attached: notify::Result<T>) -> Result<Option<T>> {
    match attached {
        Ok(watcher) => Ok(Some(watcher)),
        Err(error) if needs_polling(&error) => Ok(None),
        Err(error) => Err(watch_error(error)),
    }
}

impl RepoWatcher {
    pub fn polling(&self) -> bool {
        self._polling.is_some()
    }

    pub fn start(
        repo: &Repo,
        env: ShellEnv,
        events: Arc<dyn EventSink>,
        force_polling: bool,
    ) -> Result<RepoWatcher> {
        let watch = Watch {
            root: repo.root().to_path_buf(),
            git_dir: repo.git_dir().to_path_buf(),
            common_dir: repo.shared_git_dir().map(Path::to_path_buf),
            repo: repo.thread_safe(),
            env,
        };
        let (sender, receiver) = mpsc::channel::<PathBuf>();
        let dirs: Vec<&Path> = [Some(repo.git_dir()), repo.shared_git_dir()]
            .into_iter()
            .flatten()
            .filter(|dir| !dir.starts_with(repo.root()))
            .collect();
        let native = if force_polling {
            None
        } else {
            polling_or_error(attach_native(repo.root(), &dirs, sender.clone()))?
        };
        let polling = match native {
            Some(_) => None,
            None => Some(attach_polling(repo.root(), &dirs, sender).map_err(watch_error)?),
        };
        std::thread::spawn(move || {
            while let Some(batch) = next_batch(&receiver) {
                if watch.matters(&batch) {
                    events.emit(CoreEvent::RepoChanged {
                        path: watch.root.display().to_string(),
                    });
                }
            }
        });
        Ok(RepoWatcher {
            _native: native,
            _polling: polling,
        })
    }
}

fn forward(sender: mpsc::Sender<PathBuf>) -> impl FnMut(notify::Result<Event>) + Send + 'static {
    move |result| {
        if let Ok(event) = result
            && writes(&event.kind)
        {
            for path in event.paths {
                let _ = sender.send(path);
            }
        }
    }
}

fn attach_native(
    root: &Path,
    dirs: &[&Path],
    sender: mpsc::Sender<PathBuf>,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(forward(sender))?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    for dir in dirs {
        watcher.watch(dir, RecursiveMode::Recursive)?;
    }
    Ok(watcher)
}

fn attach_polling(
    root: &Path,
    dirs: &[&Path],
    sender: mpsc::Sender<PathBuf>,
) -> notify::Result<PollWatcher> {
    let config = notify::Config::default()
        .with_poll_interval(POLL_INTERVAL)
        .with_compare_contents(false);
    let mut watcher = PollWatcher::new(forward(sender), config)?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    for dir in dirs {
        watcher.watch(dir, RecursiveMode::Recursive)?;
    }
    Ok(watcher)
}

fn writes(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        _ => true,
    }
}

fn next_batch(receiver: &mpsc::Receiver<PathBuf>) -> Option<Vec<PathBuf>> {
    let first = receiver.recv().ok()?;
    let mut batch: HashSet<PathBuf> = HashSet::from([first]);
    let deadline = Instant::now() + DEBOUNCE;
    loop {
        match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(path) => {
                batch.insert(path);
            }
            Err(RecvTimeoutError::Timeout) => return Some(batch.into_iter().collect()),
            Err(RecvTimeoutError::Disconnected) => return None,
        }
    }
}

fn watch_error(error: notify::Error) -> Error {
    Error::Io(std::io::Error::other(error.to_string()))
}

struct Watch {
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: Option<PathBuf>,
    repo: gix::ThreadSafeRepository,
    env: ShellEnv,
}

impl Watch {
    fn matters(&self, paths: &[PathBuf]) -> bool {
        let mut worktree = Vec::new();
        for path in paths {
            if let Ok(inside) = path.strip_prefix(&self.git_dir) {
                if first_is(inside, &OWN_GIT_FILES) {
                    return true;
                }
            } else if let Some(inside) = self
                .common_dir
                .as_ref()
                .and_then(|dir| path.strip_prefix(dir).ok())
            {
                if first_is(inside, &SHARED_GIT_FILES) {
                    return true;
                }
            } else if let Ok(relative) = path.strip_prefix(&self.root)
                && !relative.as_os_str().is_empty()
            {
                worktree.push(relative.to_path_buf());
            }
        }
        !worktree.is_empty() && !self.all_ignored(&worktree)
    }

    fn all_ignored(&self, paths: &[PathBuf]) -> bool {
        let Ok(index) = self.repo.to_thread_local().index_or_empty() else {
            return false;
        };
        let submodules: Vec<PathBuf> = index
            .entries()
            .iter()
            .filter(|entry| entry.mode == gix::index::entry::Mode::COMMIT)
            .map(|entry| PathBuf::from(entry.path(&index).to_str_lossy().into_owned()))
            .collect();
        let mut groups: HashMap<PathBuf, Vec<Probe>> = HashMap::new();
        for path in paths {
            let missing = !self.root.join(path).exists();
            if missing && tracked(&index, path) {
                return false;
            }
            let base = submodules
                .iter()
                .find(|sub| path.starts_with(sub) && path != *sub);
            let (base, relative) = match base {
                Some(sub) => (sub.clone(), path.strip_prefix(sub).unwrap_or(path)),
                None => (PathBuf::new(), path.as_path()),
            };
            groups.entry(base).or_default().push(Probe {
                path: relative.to_path_buf(),
                as_folder: missing,
            });
        }
        groups
            .iter()
            .all(|(base, probes)| self.ignored_in(&self.root.join(base), probes))
    }

    fn ignored_in(&self, dir: &Path, probes: &[Probe]) -> bool {
        match check_ignore(&self.env, dir, probes) {
            Some(ignored) => probes.iter().all(|probe| ignored.contains(&probe.path)),
            None => false,
        }
    }
}

struct Probe {
    path: PathBuf,
    as_folder: bool,
}

fn tracked(index: &gix::index::State, path: &Path) -> bool {
    let text = path.to_string_lossy();
    let path: &BStr = text.as_bytes().as_bstr();
    if index.entry_by_path(path).is_some() {
        return true;
    }
    let mut prefix = path.to_owned();
    prefix.push(b'/');
    index
        .prefixed_entries(prefix.as_bstr())
        .is_some_and(|entries| !entries.is_empty())
}

fn check_ignore(env: &ShellEnv, dir: &Path, probes: &[Probe]) -> Option<HashSet<PathBuf>> {
    let mut child = env
        .git(dir)
        .args(["check-ignore", "--stdin", "-z"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut input = Vec::new();
    for probe in probes {
        let text = probe.path.to_string_lossy();
        input.extend_from_slice(text.as_bytes());
        input.push(0);
        if probe.as_folder {
            input.extend_from_slice(format!("{text}/").as_bytes());
            input.push(0);
        }
    }
    let mut stdin = child.stdin.take()?;
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let output = child.wait_with_output().ok()?;
    let _ = writer.join();
    if !matches!(output.status.code(), Some(0 | 1)) {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(|path| PathBuf::from(path.trim_end_matches('/')))
            .collect(),
    )
}

fn first_is(inside: &Path, names: &[&str]) -> bool {
    inside
        .components()
        .next()
        .is_some_and(|first| names.iter().any(|name| first.as_os_str() == *name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::mpsc;

    #[test]
    fn only_index_head_and_refs_matter_inside_git() {
        assert!(first_is(Path::new("index"), &OWN_GIT_FILES));
        assert!(first_is(Path::new("refs/heads/main"), &OWN_GIT_FILES));
        assert!(first_is(Path::new("MERGE_HEAD"), &OWN_GIT_FILES));
        assert!(!first_is(Path::new("objects/ab/cdef"), &OWN_GIT_FILES));
        assert!(!first_is(Path::new("index.lock"), &OWN_GIT_FILES));
        assert!(!first_is(Path::new("logs/HEAD"), &OWN_GIT_FILES));
        assert!(!first_is(Path::new("index"), &SHARED_GIT_FILES));
        assert!(first_is(Path::new("refs/heads/x"), &SHARED_GIT_FILES));
    }

    #[test]
    fn a_full_instance_limit_also_falls_back_to_polling() {
        let full = notify::Error::io(std::io::Error::from_raw_os_error(EMFILE));
        assert!(needs_polling(&full));
        let denied = notify::Error::io(std::io::Error::from_raw_os_error(13));
        assert!(!needs_polling(&denied));
    }

    #[test]
    fn a_watch_that_fails_for_another_reason_is_an_error_not_polling() {
        let full = notify::Error::new(notify::ErrorKind::MaxFilesWatch);
        assert!(matches!(polling_or_error::<u8>(Err(full)), Ok(None)));
        assert!(matches!(polling_or_error(Ok(7u8)), Ok(Some(7))));
        let broken = notify::Error::generic("broken");
        assert!(polling_or_error::<u8>(Err(broken)).is_err());
    }

    #[test]
    fn only_a_full_watch_limit_falls_back_to_polling() {
        assert!(needs_polling(&notify::Error::new(
            notify::ErrorKind::MaxFilesWatch
        )));
        assert!(!needs_polling(&notify::Error::path_not_found()));
        assert!(!needs_polling(&notify::Error::generic("broken")));
    }

    #[test]
    fn reads_are_not_changes() {
        assert!(!writes(&EventKind::Access(AccessKind::Open(
            AccessMode::Any
        ))));
        assert!(!writes(&EventKind::Access(AccessKind::Close(
            AccessMode::Read
        ))));
        assert!(writes(&EventKind::Access(AccessKind::Close(
            AccessMode::Write
        ))));
        assert!(writes(&EventKind::Modify(notify::event::ModifyKind::Any)));
        assert!(writes(&EventKind::Remove(notify::event::RemoveKind::Any)));
    }

    #[test]
    fn check_ignore_answers_a_batch_larger_than_the_pipes() {
        let dir = tempfile::tempdir().unwrap();
        let ok = Command::new("git")
            .args(["init", "-q"])
            .current_dir(dir.path())
            .status()
            .unwrap();
        assert!(ok.success());
        std::fs::write(dir.path().join(".gitignore"), "target/\n").unwrap();
        let probes: Vec<Probe> = (0..20_000)
            .map(|i| Probe {
                path: PathBuf::from(format!("target/debug/deps/build-artifact-{i:06}.rlib")),
                as_folder: false,
            })
            .collect();
        let env = ShellEnv::from_path(&std::env::var("PATH").unwrap_or_default());
        let root = dir.path().to_path_buf();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(check_ignore(&env, &root, &probes).map(|set| set.len()));
        });
        let answered = receiver.recv_timeout(Duration::from_secs(30)).unwrap();
        assert_eq!(answered, Some(20_000));
    }
}

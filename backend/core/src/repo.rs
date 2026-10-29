use crate::error::{Error, Result};
use crate::platform;
use std::path::{Path, PathBuf};

pub struct Repo {
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
    git: gix::ThreadSafeRepository,
}

impl Repo {
    pub fn discover(path: &Path) -> Result<Repo> {
        if !path.exists() {
            return Err(Error::NotFound(path.display().to_string()));
        }
        let path = &platform::canonicalize(path)?;
        let repo = gix::discover(path).map_err(|_| match std::fs::read_dir(path) {
            Err(error) => Error::Io(error),
            Ok(_) => Error::NotARepository {
                path: path.display().to_string(),
            },
        })?;
        let Some(workdir) = repo.workdir() else {
            return Err(Error::BareRepository {
                path: path.display().to_string(),
            });
        };
        let root = platform::canonicalize(workdir)?;
        let git_dir = platform::canonicalize(repo.git_dir())?;
        let common_dir = platform::canonicalize(repo.common_dir())?;
        Ok(Repo {
            root,
            git_dir,
            common_dir,
            git: repo.into_sync(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn git_dir(&self) -> &Path {
        &self.git_dir
    }

    pub fn shared_git_dir(&self) -> Option<&Path> {
        (self.common_dir != self.git_dir).then_some(self.common_dir.as_path())
    }

    pub fn thread_safe(&self) -> gix::ThreadSafeRepository {
        self.git.clone()
    }

    pub fn name(&self) -> String {
        self.root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.root.display().to_string())
    }

    pub fn gix(&self) -> gix::Repository {
        self.git.to_thread_local()
    }

    pub fn branch(&self) -> Option<String> {
        let repo = self.gix();
        let name = repo.head_name().ok()??;
        Some(name.shorten().to_string())
    }

    pub fn default_branch(&self) -> Option<String> {
        let repo = self.gix();
        if let Ok(Some(reference)) = repo.try_find_reference("refs/remotes/origin/HEAD")
            && let Some(target) = reference.target().try_name()
        {
            let short = target.shorten().to_string();
            return Some(short.strip_prefix("origin/").unwrap_or(&short).to_string());
        }
        for candidate in [
            "refs/remotes/origin/main",
            "refs/remotes/origin/master",
            "refs/heads/main",
            "refs/heads/master",
        ] {
            if let Ok(Some(_)) = repo.try_find_reference(candidate) {
                return candidate.rsplit('/').next().map(str::to_string);
            }
        }
        None
    }
}

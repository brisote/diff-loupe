use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

use crate::shellenv::ShellEnv;

pub struct TempRepo {
    _dir: TempDir,
    path: PathBuf,
}

pub fn test_env() -> ShellEnv {
    ShellEnv::from_path(&std::env::var("PATH").unwrap_or_default())
}

fn test_git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Ada Lovelace")
        .env("GIT_AUTHOR_EMAIL", "ada@example.com")
        .env("GIT_COMMITTER_NAME", "Ada Lovelace")
        .env("GIT_COMMITTER_EMAIL", "ada@example.com")
        .output()
        .expect("git runs")
}

pub fn isolate(repo: &Path) {
    for (key, value) in [
        ("user.name", "Ada Lovelace"),
        ("user.email", "ada@example.com"),
        ("commit.gpgsign", "false"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        git_in(repo, &["config", key, value]);
    }
}

pub fn git_in(dir: &Path, args: &[&str]) -> String {
    let out = test_git(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

impl TempRepo {
    pub fn new() -> TempRepo {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("acme-billing");
        fs::create_dir_all(&path).expect("repo dir");
        git_in(&path, &["init", "-q", "-b", "main"]);
        isolate(&path);
        TempRepo { _dir: dir, path }
    }

    pub fn with_commit() -> TempRepo {
        let repo = TempRepo::new();
        repo.write("README.md", "# Acme billing\n");
        repo.commit_all("Initial commit");
        repo
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn git(&self, args: &[&str]) -> String {
        git_in(&self.path, args)
    }

    pub fn git_fails(&self, args: &[&str]) -> bool {
        !test_git(&self.path, args).status.success()
    }

    pub fn write(&self, rel: &str, content: &str) {
        let file = self.path.join(rel);
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).expect("parent dir");
        }
        fs::write(file, content).expect("write file");
    }

    pub fn remove(&self, rel: &str) {
        fs::remove_file(self.path.join(rel)).expect("remove file");
    }

    pub fn commit_all(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    pub fn branch(&self, name: &str) {
        self.git(&["switch", "-q", "-c", name]);
    }

    pub fn switch(&self, name: &str) {
        self.git(&["switch", "-q", name]);
    }

    pub fn bare_remote(&self) -> PathBuf {
        let remote = self.path.with_file_name("remote.git");
        git_in(
            self.path.parent().expect("parent"),
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                &remote.display().to_string(),
            ],
        );
        self.git(&["remote", "add", "origin", &remote.display().to_string()]);
        remote
    }
}

impl Default for TempRepo {
    fn default() -> Self {
        TempRepo::new()
    }
}

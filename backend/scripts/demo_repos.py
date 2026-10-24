"""Creates small git repositories that look like the ones in the frozen design."""

import os
import subprocess
from pathlib import Path

GIT_ENV = {
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Ada Lovelace",
    "GIT_AUTHOR_EMAIL": "ada@example.com",
    "GIT_COMMITTER_NAME": "Ada Lovelace",
    "GIT_COMMITTER_EMAIL": "ada@example.com",
}

REPOS = [
    ("acme-billing", "gs/invoice-export"),
    ("diff-loupe", "gs/diffloupe"),
    ("payments-api", "main"),
]


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, env={**os.environ, **GIT_ENV}, check=True, capture_output=True)


def create_repo(root: Path, name: str, branch: str) -> Path:
    path = root / name
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "main")
    (path / "README.md").write_text(f"# {name}\n")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "Initial commit")
    remote = root / f"{name}.git"
    git(root, "init", "-q", "--bare", "-b", "main", str(remote))
    git(path, "remote", "add", "origin", str(remote))
    git(path, "push", "-q", "origin", "main")
    git(path, "remote", "set-head", "origin", "main")
    if branch != "main":
        git(path, "switch", "-q", "-c", branch)
    return path


def create(root: Path) -> list[Path]:
    """Returns the repositories oldest first, so opening them in order leaves acme-billing newest."""
    return [create_repo(root, name, branch) for name, branch in reversed(REPOS)]

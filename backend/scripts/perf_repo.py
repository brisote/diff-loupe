"""Prepares a clone of microsoft/vscode for the speed checks: 500 branch commits, a merge and local edits."""

import subprocess
import sys
from pathlib import Path

BRANCH = "gs/perf"
COMMITS = 500
FORK_BEHIND = 1500
FIVE_K = "src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts"
TWENTY_K = "src/vscode-dts/vscode.d.ts"


def git(repo, *args):
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()


def rewrite(path, every, tag):
    lines = path.read_text().splitlines(keepends=True)
    changed = [
        f"{line.rstrip()} // {tag} {index}\n" if index % every == 0 else line
        for index, line in enumerate(lines)
    ]
    path.write_text("".join(changed))


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: perf_repo.py <clone of microsoft/vscode>")
    repo = Path(sys.argv[1]).expanduser().resolve()
    if git(repo, "status", "--porcelain"):
        sys.exit(f"{repo} has local changes; commit or remove them first")
    git(repo, "switch", "-q", "main")
    fork = git(repo, "rev-parse", f"main~{FORK_BEHIND}")
    git(repo, "switch", "-q", "-C", BRANCH, fork)
    fixture = repo / "perf-fixture"
    fixture.mkdir(exist_ok=True)
    for number in range(COMMITS):
        module = fixture / f"module{number % 40:02}.ts"
        with module.open("a") as out:
            out.write(f"export const step{number} = {number};\n")
        git(repo, "add", str(module))
        git(repo, "commit", "-q", "-m", f"Add perf step {number}")
    git(repo, "merge", "-q", "--no-edit", "main")
    rewrite(repo / FIVE_K, 5, "perf edit")
    rewrite(repo / TWENTY_K, 3, "perf edit")
    for module in sorted(fixture.glob("module*.ts"))[:30]:
        with module.open("a") as out:
            out.write("export const local = true;\n")
    for number in range(5):
        (fixture / f"untracked{number}.ts").write_text(f"export const untracked = {number};\n")
    print(f"{repo} is on {BRANCH} with {COMMITS} commits, a merge from main and local edits")


main()

"""Runs the gates for Linux and Windows from this Mac.

linux    builds an Ubuntu image with Rust, WebKitGTK and Playwright (backend/scripts/linux/Dockerfile),
         mounts this checkout and runs the Rust gates, including the Tauri shell, and the UI gates in it,
         as the image's unprivileged user, as CI does. Build output, Rust caches and node_modules live in
         Docker volumes, so the Mac's builds never mix with the container's. CI is set, as on GitHub, so
         the design checks that need the private design checkout are skipped and timing limits are CI's, and Playwright runs two workers, as on a GitHub runner.
         Each run updates the container's Rust stable, as CI installs the current one.
windows  runs clippy for the Windows target with cargo-xwin on this Mac, then, when DIFFLOUPE_WINDOWS_HOST
         names the Windows test machine (user@address), sends the committed HEAD there over SSH and runs
         the tests in it. Uncommitted changes are not sent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = Path(__file__).resolve().parent / "linux" / "Dockerfile"
WINDOWS_TARGET = "x86_64-pc-windows-msvc"
REMOTE_DIR = "diffloupe-check"
USER = "pwuser"
RUST = "rustup toolchain install stable --profile minimal --component rustfmt,clippy --no-self-update >/dev/null"

LINUX_GATES = {
    "fmt": "cargo fmt --manifest-path backend/Cargo.toml --all --check",
    "clippy": "cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings",
    "test": "cargo test --manifest-path backend/Cargo.toml --workspace",
    "ui": " && ".join(
        [
            "pnpm install --frozen-lockfile --store-dir /home/pwuser/.local/share/pnpm/store",
            "pnpm build",
            "pnpm biome ci .",
            "pnpm --dir frontend typecheck",
            "pnpm --dir frontend test",
            "python3 -m unittest discover -s backend/scripts/tests -t backend/scripts/tests",
            "python3 -m unittest discover -s website/scripts/tests -t website/scripts/tests",
            "pnpm e2e --workers=2",
        ]
    ),
}

LINUX_GATES["smoke"] = " && ".join(
    [
        "pnpm install --frozen-lockfile --store-dir /home/pwuser/.local/share/pnpm/store",
        "dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' python3 backend/scripts/app_smoke.py",
    ]
)

LINUX_VOLUMES = {
    "diffloupe-linux-target": "/work/backend/target",
    "diffloupe-linux-node": "/work/node_modules",
    "diffloupe-linux-frontend-node": "/work/frontend/node_modules",
    "diffloupe-linux-frontend-dist": "/work/frontend/dist",
    "diffloupe-linux-frontend-results": "/work/frontend/test-results",
    "diffloupe-linux-frontend-report": "/work/frontend/playwright-report",
    "diffloupe-linux-pnpm": "/home/pwuser/.local/share/pnpm",
    "diffloupe-linux-cargo": "/usr/local/cargo/registry",
    "diffloupe-linux-rustup": "/usr/local/rustup",
}

WINDOWS_REMOTE_GATES = {
    "test": "cargo test --manifest-path backend\\Cargo.toml --workspace",
    "ui": " && ".join(
        [
            "pnpm install --frozen-lockfile",
            "pnpm --dir frontend exec playwright install webkit",
            "pnpm --dir frontend test",
            "pnpm e2e",
        ]
    ),
}


def playwright_version(package: str) -> str:
    return json.loads(package)["devDependencies"]["@playwright/test"]


def image_tag(dockerfile: str, playwright: str) -> str:
    return "diffloupe-linux-gates:" + hashlib.sha256(f"{dockerfile}{playwright}".encode()).hexdigest()[:12]


def as_user(command: str) -> str:
    owned = " ".join(LINUX_VOLUMES.values())
    inner = shlex.quote(f"{RUST} && {command}")
    return (
        f"for dir in {owned}; do [ \"$(stat -c %U \"$dir\")\" = {USER} ] || chown -R {USER}:{USER} \"$dir\"; done"
        f" && exec setpriv --reuid={USER} --regid={USER} --init-groups env HOME=/home/{USER} bash -lc {inner}"
    )


def docker_run(image: str, root: Path, command: str) -> list[str]:
    volumes = [arg for name, path in LINUX_VOLUMES.items() for arg in ("-v", f"{name}:{path}")]
    return ["docker", "run", "--rm", "--init", "-e", "CI=true", "-v", f"{root}:/work", *volumes, "-w", "/work", image, "bash", "-c", as_user(command)]


def xwin_clippy() -> list[str]:
    return [
        "cargo",
        "xwin",
        "clippy",
        "--manifest-path",
        "backend/Cargo.toml",
        "--target",
        WINDOWS_TARGET,
        "--target-dir",
        "backend/target/windows",
        "--workspace",
        "--all-targets",
        "--",
        "-D",
        "warnings",
    ]


def remote_command(command: str) -> str:
    return f'cmd /d /c "cd /d %USERPROFILE%\\{REMOTE_DIR} && set CI=1&& {command}"'


def remote_sync(commit: str) -> str:
    return (
        f'cmd /d /c "cd /d %USERPROFILE% && (if not exist {REMOTE_DIR} git init -q {REMOTE_DIR})'
        f" && cd {REMOTE_DIR} && git fetch -q ..\\diffloupe.bundle HEAD && git -c core.autocrlf=false checkout -q -f {commit}"
        f' && git clean -q -fd"'
    )


def chosen(gates: dict[str, str], only: list[str] | None) -> dict[str, str]:
    if not only:
        return gates
    unknown = [name for name in only if name not in gates]
    if unknown:
        raise SystemExit(f"unknown gate {', '.join(unknown)}; choose from {', '.join(gates)}")
    return {name: gates[name] for name in only}


def step(name: str, args: list[str], env: dict[str, str] | None = None) -> bool:
    print(f"----  {name}: {shlex.join(args)}", flush=True)
    ok = subprocess.run(args, cwd=ROOT, env=env).returncode == 0
    print(f"{'ok  ' if ok else 'FAIL'}  {name}", flush=True)
    return ok


def linux(only: list[str] | None) -> list[tuple[str, bool]]:
    playwright = playwright_version((ROOT / "frontend/package.json").read_text())
    image = image_tag(DOCKERFILE.read_text(), playwright)
    built = subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0
    build = ["docker", "build", "--build-arg", f"PLAYWRIGHT={playwright}", "-t", image, "-f", str(DOCKERFILE), str(DOCKERFILE.parent)]
    if not built and not step("image", build):
        return [("image", False)]
    if not built:
        stale = subprocess.run(["docker", "image", "ls", "diffloupe-linux-gates", "--format", "{{.Repository}}:{{.Tag}}"], capture_output=True, text=True).stdout.split()
        subprocess.run(["docker", "image", "rm", *[tag for tag in stale if tag != image]], capture_output=True)
    return [(name, step(name, docker_run(image, ROOT, command))) for name, command in chosen(LINUX_GATES, only).items()]


def windows_env() -> dict[str, str]:
    env = dict(os.environ)
    llvm = [path for path in ("/opt/homebrew/opt/llvm/bin", "/opt/homebrew/opt/lld/bin") if Path(path).is_dir()]
    env["PATH"] = os.pathsep.join([str(Path.home() / ".cargo/bin"), *llvm, env.get("PATH", "")])
    return env


def windows(only: list[str] | None, host: str | None) -> list[tuple[str, bool]]:
    gates = {"clippy": "", **WINDOWS_REMOTE_GATES}
    picked = chosen(gates, only)
    results = []
    if "clippy" in picked:
        results.append(("clippy", step("clippy", xwin_clippy(), windows_env())))
    remote = {name: command for name, command in picked.items() if name != "clippy"}
    if not remote:
        return results
    if not host:
        print("skip  the Windows test machine: set DIFFLOUPE_WINDOWS_HOST=user@address to run its tests", flush=True)
        return results
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    bundle = ROOT / "backend/target/diffloupe.bundle"
    bundle.parent.mkdir(parents=True, exist_ok=True)
    synced = (
        step("bundle", ["git", "bundle", "create", "-q", str(bundle), "HEAD"])
        and step("send", ["scp", "-q", str(bundle), f"{host}:diffloupe.bundle"])
        and step("checkout", ["ssh", host, remote_sync(commit)])
    )
    if not synced:
        return [*results, ("sync", False)]
    print(f"note  the Windows machine runs commit {commit[:12]}; uncommitted changes are not included", flush=True)
    return [*results, *((name, step(name, ["ssh", host, remote_command(command)])) for name, command in remote.items())]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("platform", choices=["linux", "windows"])
    parser.add_argument("--only", action="append", help="run one gate; repeat for more (linux: fmt, clippy, test, ui, smoke; windows: clippy, test, ui)")
    args = parser.parse_args()
    if args.platform == "linux":
        results = linux(args.only)
    else:
        results = windows(args.only, os.environ.get("DIFFLOUPE_WINDOWS_HOST"))
    failed = [name for name, ok in results if not ok]
    print(f"{args.platform}: {len(results) - len(failed)} passed, {len(failed)} failed{': ' + ', '.join(failed) if failed else ''}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

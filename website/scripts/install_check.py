"""Installs a release build with install.sh into a temporary folder and checks the copy.

Uses the newest .dmg in backend/target/release/bundle/dmg/ (build it with `pnpm tauri build`),
or the one given. The copy runs with a temporary home folder, and the real
~/Library/Application Support/com.diffloupe.app must stay unchanged.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "website/src/install/install.sh"
DMGS = ROOT / "backend/target/release/bundle/dmg"
REAL_DATA = Path.home() / "Library/Application Support/com.diffloupe.app"
WINDOWS = """
ObjC.import("CoreGraphics");
const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0));
const pids = [];
for (let i = 0; i < list.count; i++) pids.push(ObjC.unwrap(list.objectAtIndex(i).objectForKey("kCGWindowOwnerPID")));
JSON.stringify(pids);
"""


def check(name: str, condition: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if condition else 'FAIL'}  {name}" + (f": {detail}" if detail and not condition else ""))
    return condition


def snapshot(folder: Path) -> dict:
    if not folder.exists():
        return {}
    return {str(path.relative_to(folder)): path.stat().st_mtime_ns for path in sorted(folder.rglob("*"))}


def script(dmg: Path, folder: Path) -> Path:
    version = json.loads((ROOT / "backend/app/tauri.conf.json").read_text())["version"]
    text = TEMPLATE.read_text()
    for placeholder, value in {
        "@VERSION@": version,
        "@URL@": dmg.as_uri(),
        "@SHA256@": hashlib.sha256(dmg.read_bytes()).hexdigest(),
    }.items():
        text = text.replace(placeholder, value)
    path = folder / "install.sh"
    path.write_text(text)
    return path


def install(path: Path, apps: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(path)], env={**os.environ, "DIFFLOUPE_APP_DIR": str(apps)}, capture_output=True, text=True, errors="replace", timeout=300)


def start(app: Path, home: Path) -> subprocess.Popen:
    return subprocess.Popen([str(app / "Contents/MacOS/diffloupe")], env={**os.environ, "HOME": str(home), "DIFFLOUPE_UPDATE_URL": "http://127.0.0.1:9/latest"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop(process: subprocess.Popen) -> None:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def has_window(process: subprocess.Popen) -> bool:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and process.poll() is None:
        listed = subprocess.run(["osascript", "-l", "JavaScript", "-e", WINDOWS], capture_output=True, text=True)
        if listed.returncode == 0 and process.pid in json.loads(listed.stdout or "[]"):
            return True
        time.sleep(0.5)
    return False


def window_appears(app: Path, home: Path) -> bool:
    process = start(app, home)
    try:
        return has_window(process)
    finally:
        stop(process)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dmg", nargs="?", type=Path, help="the release .dmg to install")
    args = parser.parse_args()
    dmg = args.dmg or max(DMGS.glob("*.dmg"), key=lambda path: path.stat().st_mtime, default=None)
    if dmg is None:
        raise SystemExit(f"No .dmg in {DMGS.relative_to(ROOT)}. Build one with `pnpm tauri build`.")
    running = subprocess.run(["pgrep", "-f", "Diffloupe.app/Contents/MacOS/diffloupe"], capture_output=True, text=True)
    if running.stdout.strip():
        raise SystemExit("Quit the running Diffloupe first: install.sh would quit it.")

    before = snapshot(REAL_DATA)
    results: list[bool] = []
    with tempfile.TemporaryDirectory(prefix="diffloupe-install-check-") as tmp:
        folder = Path(tmp)
        apps = folder / "Applications"
        home = folder / "home"
        home.mkdir()
        path = script(dmg, folder)
        app = apps / "Diffloupe.app"

        first = install(path, apps)
        results.append(check("install.sh installs into the target folder", first.returncode == 0 and app.is_dir(), first.stderr))
        if results[-1]:
            quarantine = subprocess.run(["xattr", "-p", "com.apple.quarantine", str(app)], capture_output=True)
            results.append(check("the copy has no quarantine flag", quarantine.returncode != 0))
            signature = subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], capture_output=True, text=True)
            results.append(check("the copy's signature verifies", signature.returncode == 0, signature.stderr))
            results.append(check("the copy opens a window", window_appears(app, home)))
            data = home / "Library/Application Support/com.diffloupe.app"
            stored = sorted(path.name for path in data.iterdir()) if data.is_dir() else []
            results.append(check("the copy keeps its store in the temporary home folder", "state.db" in stored, ", ".join(stored)))

            running = start(app, home)
            try:
                results.append(check("the copy runs before the upgrade", has_window(running)))
                second = install(path, apps)
                results.append(check("install.sh upgrades over the running copy", second.returncode == 0 and app.is_dir(), second.stderr))
                results.append(check("the upgrade quits the running copy", running.poll() is not None))
            finally:
                stop(running)
            kept = sorted(path.name for path in data.iterdir()) if data.is_dir() else []
            results.append(check("the upgrade keeps the stored data", bool(stored) and set(stored) <= set(kept), ", ".join(kept)))
            results.append(check("the upgraded copy opens a window", window_appears(app, home)))
            results.append(check("the upgrade leaves no staged or old copy", sorted(p.name for p in apps.iterdir()) == ["Diffloupe.app"]))
    results.append(check("the real data folder is unchanged", snapshot(REAL_DATA) == before))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())

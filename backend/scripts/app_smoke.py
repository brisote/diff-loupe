"""Starts the real Diffloupe app (debug build) and checks what its window shows.

Tauri has no WebDriver on macOS, so a debug build reports its page text when
DIFFLOUPE_SMOKE_REPORT is set, then quits. Each run uses a temporary home folder. The
runs started like Finder use your real home, so that your shell profile applies, with the
app's data in a temporary folder.

On Linux (`--platform linux`, which platform_check.py runs in the Ubuntu container) it runs
the same checks under a virtual display with a session bus: the app starts without a window
manager and without Finder, so the checks that need those are left out.
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import demo_repos

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
PLATFORM = "windows" if sys.platform == "win32" else ("linux" if sys.platform.startswith("linux") else "macos")
BRIDGE = (
    BACKEND / "target/debug/diffloupe-devbridge.exe"
    if PLATFORM == "windows"
    else BACKEND / "target/debug/diffloupe-devbridge"
)
BUNDLE_ID = "com.diffloupe.app"
APP = (
    BACKEND / "target/debug/diffloupe.exe"
    if PLATFORM == "windows"
    else (
        BACKEND / "target/debug/diffloupe"
        if PLATFORM == "linux"
        else BACKEND / "target/debug/bundle/macos/Diffloupe.app/Contents/MacOS/diffloupe"
    )
)
NO_UPDATES = f"http://127.0.0.1:9/download/latest/{PLATFORM}/version"


def data_dir(home: Path) -> Path:
    if PLATFORM == "windows":
        return home / "AppData/Roaming" / BUNDLE_ID
    if PLATFORM == "linux":
        return home / ".local/share" / BUNDLE_ID
    return home / "Library/Application Support" / BUNDLE_ID


def cache_dir(home: Path) -> Path:
    if PLATFORM == "windows":
        return home / "AppData/Local" / BUNDLE_ID
    return home / (".cache" if PLATFORM == "linux" else "Library/Caches") / BUNDLE_ID


def environment(home: Path, **extra: str) -> dict:
    env = {**os.environ, "HOME": str(home), **extra}
    if PLATFORM == "windows":
        env.update(
            USERPROFILE=str(home),
            APPDATA=str(home / "AppData/Roaming"),
            LOCALAPPDATA=str(home / "AppData/Local"),
        )
    elif PLATFORM == "linux":
        env.update(
            XDG_DATA_HOME=str(home / ".local/share"),
            XDG_CACHE_HOME=str(home / ".cache"),
            XDG_CONFIG_HOME=str(home / ".config"),
            GDK_BACKEND="x11",
            WEBKIT_DISABLE_COMPOSITING_MODE="1",
            WEBKIT_DISABLE_DMABUF_RENDERER="1",
            LIBGL_ALWAYS_SOFTWARE="1",
        )
    return env


def report(home: Path, while_running=None) -> dict:
    out = home / "smoke.json"
    out.unlink(missing_ok=True)
    env = environment(home, DIFFLOUPE_SMOKE_REPORT=str(out))
    if PLATFORM == "windows" and os.environ.get("SSH_CONNECTION"):
        batch = home / "run_smoke.cmd"
        lines = ["@echo off"]
        for k, v in env.items():
            lines.append(f'set "{k}={v}"')
        lines.append(f'"{APP}"')
        batch.write_text("\r\n".join(lines) + "\r\n")
        subprocess.run(
            ["schtasks", "/create", "/tn", "DiffloupeSmoke", "/tr", f'"{batch}"', "/sc", "once", "/st", "00:00", "/f", "/it"],
            capture_output=True,
            check=True,
        )
        subprocess.run(["schtasks", "/run", "/tn", "DiffloupeSmoke"], capture_output=True, check=True)
        if while_running:
            time.sleep(2)
            while_running()
        start = time.time()
        while time.time() - start < 60:
            if out.exists():
                break
            time.sleep(0.5)
        subprocess.run(["schtasks", "/delete", "/tn", "DiffloupeSmoke", "/f"], capture_output=True)
        if not out.exists():
            subprocess.run(["taskkill", "/F", "/IM", "diffloupe.exe"], capture_output=True)
            raise SystemExit("the app did not report within 60 seconds")
        return json.loads(out.read_text())
    process = subprocess.Popen([str(APP)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if while_running:
        time.sleep(1.2)
        while_running()
    try:
        process.wait(timeout=60)
    except subprocess.TimeoutExpired:
        process.kill()
        raise SystemExit("the app did not report within 60 seconds")
    return json.loads(out.read_text())


def seed(home: Path, repo: Path) -> None:
    seed_data(data_dir(home), repo)


def seed_data(data_dir: Path, repo: Path) -> None:
    bridge = subprocess.Popen(
        [str(BRIDGE), "--port", "0", "--data-dir", str(data_dir), "--open", str(repo)],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert bridge.stdout is not None
    bridge.stdout.readline()
    bridge.terminate()
    bridge.wait()


def finder_report(out: Path, *extra: str) -> dict:
    out.unlink(missing_ok=True)
    bundle = APP.parents[2]
    env = [f"DIFFLOUPE_SMOKE_REPORT={out}", f"DIFFLOUPE_UPDATE_URL={NO_UPDATES}", *extra]
    subprocess.run(
        ["open", "-n", "-W", *[arg for pair in env for arg in ("--env", pair)], str(bundle)],
        check=True,
        timeout=240,
    )
    return json.loads(out.read_text())


def check(name: str, condition: bool, detail: str = "") -> bool:
    print(("ok    " if condition else "FAIL  ") + name + (f": {detail}" if detail and not condition else ""))
    return condition


def page_checks(result: dict) -> list[bool]:
    return [
        check("the theme is set", result["theme"] in ("light", "dark"), str(result["theme"])),
        check("styles load under the CSP", result["background"] not in ("", "rgba(0, 0, 0, 0)"), result["background"]),
        check("Inter loads", result["interLoaded"]),
        check("icons load", result["iconLoads"]),
        *(
            [check("a double click on the toolbar zooms the window", result.get("zoomed", False))]
            if PLATFORM == "macos"
            else []
        ),
    ]


def newer_data(home: Path) -> list[bool]:
    data = data_dir(home)
    data.mkdir(parents=True)
    with sqlite3.connect(data / "state.db") as db:
        db.execute("PRAGMA user_version = 99")
    log = home / "stderr.log"
    with log.open("w") as err:
        env = environment(home, DIFFLOUPE_SMOKE_REPORT=str(home / "report.json"))
        process = subprocess.Popen([str(APP)], env=env, stdout=subprocess.DEVNULL, stderr=err)
        time.sleep(6)
        waiting = process.poll() is None
        process.kill()
        process.wait()
    with sqlite3.connect(data / "state.db") as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
    said = log.read_text()
    return [
        check("data from a newer version stops the start with a message", waiting and "saved by a newer version" in said, f"still running: {waiting}; {said[-300:]}"),
        check("data from a newer version is left unchanged", version == 99 and not (data / "backups").exists(), str(version)),
    ]


def single_instance(home: Path) -> bool:
    env = environment(home)
    first = subprocess.Popen([str(APP)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(4)
        second = subprocess.Popen([str(APP)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            second.wait(timeout=15)
            exited = True
        except subprocess.TimeoutExpired:
            second.kill()
            exited = False
        return all([
            check("a second start hands over and exits", exited),
            check("the first app keeps running", first.poll() is None),
        ])
    finally:
        first.terminate()
        first.wait()


def uninstall(home: Path) -> list[bool]:
    library = home / "Library"
    if PLATFORM == "windows":
        owned = [cache_dir(home) / "cache.db"]
        kept = [
            home / ".claude/projects/acme-billing/session.jsonl",
            home / "AppData/Local/com.other.app/cache.db",
            home / "AppData/Roaming/com.other.app/state.json",
        ]
        footprint = [data_dir(home), cache_dir(home)]
    elif PLATFORM == "linux":
        owned = [cache_dir(home) / "cache.db"]
        kept = [
            home / ".claude/projects/acme-billing/session.jsonl",
            home / ".cache/com.other.app/cache.db",
            home / ".local/share/com.other.app/state.json",
        ]
        footprint = [data_dir(home), cache_dir(home)]
    else:
        owned = [cache_dir(home) / "cache.db", library / "Logs" / BUNDLE_ID / "diffloupe.log"]
        kept = [
            home / ".claude/projects/acme-billing/session.jsonl",
            library / "Caches/com.other.app/cache.db",
            library / "Application Support/com.other.app/state.json",
        ]
        footprint = [data_dir(home), cache_dir(home), library / "Logs" / BUNDLE_ID]
    for path in owned + kept:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x\n")
    stuck = home / "smoke.json"
    stuck.unlink(missing_ok=True)
    env = environment(home, DIFFLOUPE_SMOKE_REPORT=str(stuck), DIFFLOUPE_SMOKE_UNINSTALL="1")
    if PLATFORM == "windows" and os.environ.get("SSH_CONNECTION"):
        batch = home / "run_uninstall.cmd"
        lines = ["@echo off"]
        for k, v in env.items():
            lines.append(f'set "{k}={v}"')
        lines.append(f'"{APP}"')
        batch.write_text("\r\n".join(lines) + "\r\n")
        subprocess.run(
            ["schtasks", "/create", "/tn", "DiffloupeSmokeUninstall", "/tr", f'"{batch}"', "/sc", "once", "/st", "00:00", "/f", "/it"],
            capture_output=True,
            check=True,
        )
        subprocess.run(["schtasks", "/run", "/tn", "DiffloupeSmokeUninstall"], capture_output=True, check=True)
        start = time.time()
        exited = False
        while time.time() - start < 60:
            tasks = subprocess.run(["tasklist", "/FI", "IMAGENAME eq diffloupe.exe"], capture_output=True, text=True)
            if "diffloupe.exe" not in tasks.stdout:
                exited = True
                break
            time.sleep(1)
        subprocess.run(["schtasks", "/delete", "/tn", "DiffloupeSmokeUninstall", "/f"], capture_output=True)
        if not exited:
            subprocess.run(["taskkill", "/F", "/IM", "diffloupe.exe"], capture_output=True)
            return [check("Uninstall quits the app", False, "still running after 60 seconds")]
        if stuck.exists():
            return [check("Uninstall quits the app", False, json.loads(stuck.read_text())["text"][-400:])]
        code = 0
    else:
        process = subprocess.Popen([str(APP)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            code = process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.kill()
            return [check("Uninstall quits the app", False, "still running after 60 seconds")]
        if stuck.exists():
            return [check("Uninstall quits the app", False, json.loads(stuck.read_text())["text"][-400:])]
    time.sleep(4)
    left = [str(path) for path in footprint if path.exists()]
    return [
        check("Uninstall quits the app", code == 0, str(code)),
        check("Uninstall deletes Diffloupe's own files", not left, ", ".join(left)),
        check("Uninstall keeps the files of other apps", all(path.read_text() == "x\n" for path in kept)),
        check("a smoke run keeps the app bundle out of the Trash", APP.exists()),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-build", action="store_true", help="use the existing debug build")
    parser.add_argument("--platform", choices=["macos", "linux", "windows"], help="the system the check runs on; this one by default")
    args = parser.parse_args()
    if args.platform and args.platform != PLATFORM:
        raise SystemExit(f"this system is {PLATFORM}; run --platform {args.platform} on a {args.platform} machine")
    os.environ["DIFFLOUPE_UPDATE_URL"] = NO_UPDATES
    if not args.no_build:
        bundle = ["--no-bundle"] if PLATFORM in ("linux", "windows") else ["--bundles", "app"]
        subprocess.run(["pnpm", "tauri", "build", "--debug", *bundle], cwd=ROOT, check=True, shell=PLATFORM == "windows")
        subprocess.run(["cargo", "build", "-q", "-p", "diffloupe-devbridge"], cwd=BACKEND, check=True)

    if PLATFORM == "macos":
        running = subprocess.run(["pgrep", "-f", "Diffloupe.app/Contents/MacOS/diffloupe"], capture_output=True, text=True)
        installed_open = bool(running.stdout.strip())
    else:
        installed_open = False

    results: list[bool] = []
    with tempfile.TemporaryDirectory(prefix="diffloupe-smoke-") as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        welcome = report(home)
        results.append(check("the welcome screen shows", "Welcome to Diffloupe" in welcome["text"], welcome["text"][:200]))
        results += page_checks(welcome)

        repo = demo_repos.create_repo(Path(tmp) / "repos", "acme-billing", "gs/invoice-export")
        (repo / "Billing.kt").write_text("val total = 1\n")
        demo_repos.git(repo, "add", "Billing.kt")
        demo_repos.git(repo, "commit", "-q", "-m", "Add billing")
        (repo / "Billing.kt").write_text("val total = 2\nval note = \"" + "wide " * 80 + "\"\n")
        seed(home, repo)
        main_window = report(home, lambda: (repo / "draft.txt").write_text("new\n"))
        text = main_window["text"]
        results.append(check("the last repository reopens", "acme-billing" in text and "Review" in text, text[:200]))
        results.append(check("the Changes list shows the edited file", "Billing.kt" in text and "1 change" in text, text[:300]))
        results.append(check("a file created while running appears", "draft.txt" in text, text[:300]))
        diff = main_window.get("diff", "")
        results.append(check("the diff of the first file shows both versions", "val total = 2" in diff and "Current version" in diff, diff[:300]))
        results.append(check("the editor styles load under the CSP", main_window.get("editorScroll") == "auto pre", main_window.get("editorScroll", "")))
        results.append(check("Kotlin code has syntax colours", main_window.get("keywords", 0) > 0, str(main_window.get("keywords"))))
        offset = main_window.get("connector")
        results.append(check("the connector meets its block beside a long line", offset is not None and abs(offset) < 1, str(offset)))
        results.append(check("the window has no AI control", main_window.get("aiControls") == 0, str(main_window.get("aiControls"))))
        results.append(check("the branch and target show", "gs/invoice-export" in text and "Target" in text, text[:200]))
        terminal = main_window.get("terminal", "")
        results.append(check("the terminal shows the shell's output", terminal.strip() != "", terminal[:200]))
        results.append(check("the store lives in the app data folder", (data_dir(home) / "state.db").exists()))
        if PLATFORM == "macos":
            data = Path(tmp) / "finder-data"
            seed_data(data, repo)
            finder = finder_report(Path(tmp) / "finder.json", f"DIFFLOUPE_SMOKE_DATA_DIR={data}")
            results.append(check("started like Finder, git runs", "Billing.kt" in finder["text"], finder["text"][:300]))
        else:
            print(f"skip  started like Finder: there is no Finder on {PLATFORM.capitalize()}")
        if installed_open:
            print("skip  a second start hands over and exits: quit the running Diffloupe to run this check")
        elif PLATFORM == "linux" and "DBUS_SESSION_BUS_ADDRESS" not in os.environ:
            print("skip  a second start hands over and exits: start the check with dbus-run-session")
        else:
            results.append(single_instance(home))
        results += newer_data(Path(tmp) / "newer-home")
        results += uninstall(home)
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())

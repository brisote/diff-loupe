"""Updates a copy of the debug build to a newer test release and checks the result.

The copy lives in a temporary folder with a temporary home. A local server plays diffloupe.com and
the GitHub release: it offers version 99.0.0 once, with a package of the same build marked 99.0.0, and
answers with an older version afterwards, so the updated copy does not update again.
The second run serves a wrong checksum and checks that the old copy stays in place.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import demo_repos
from app_smoke import BACKEND, BUNDLE_ID, ROOT, check, seed

PLATFORM = "windows" if sys.platform == "win32" else ("linux" if sys.platform.startswith("linux") else "macos")
VERSION = "99.0.0"
BUILT = (
    BACKEND / "target/debug/diffloupe.exe"
    if PLATFORM == "windows"
    else (
        BACKEND / "target/debug/diffloupe"
        if PLATFORM == "linux"
        else BACKEND / "target/debug/bundle/macos/Diffloupe.app"
    )
)


def package_name(version: str, platform: str) -> str:
    if platform == "windows":
        return f"Diffloupe-{version}-windows-x64-setup.exe"
    if platform == "linux":
        return f"Diffloupe-{version}-linux-amd64.deb"
    return f"Diffloupe-{version}.dmg"


class Release:
    def __init__(self, image: Path, checksum: str, platform: str = PLATFORM):
        self.image = image
        self.checksum = checksum
        self.platform = platform
        self.offered = False
        handler = self.handler()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"{self.base}/download/latest/{self.platform}/version"

    def latest(self) -> bytes:
        version = "0.0.1" if self.offered else VERSION
        self.offered = True
        return f"{version}\n".encode()

    def handler(self):
        release = self
        pkg = release.image.name
        img_url = f"/download/v{VERSION}/{pkg}"
        sha_url = f"{img_url}.sha256"
        version_url = f"/download/latest/{release.platform}/version"

        class Handler(BaseHTTPRequestHandler):
            def body(self) -> bytes | None:
                if self.path == img_url:
                    return release.image.read_bytes()
                if self.path == sha_url:
                    return f"{release.checksum}  {pkg}\n".encode()
                if self.path == version_url:
                    return release.latest()
                return None

            def answer(self, send_body: bool) -> None:
                body = self.body()
                if body is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if send_body:
                    self.wfile.write(body)

            def do_GET(self):
                self.answer(True)

            def do_HEAD(self):
                self.answer(False)

            def log_message(self, *_):
                pass

        return Handler

    def stop(self) -> None:
        self.server.shutdown()


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def newer_image(work: Path, platform: str) -> Path:
    pkg = package_name(VERSION, platform)
    image = work / pkg
    if platform == "macos":
        folder = work / "image"
        app = folder / "Diffloupe.app"
        run(["ditto", str(BUILT), str(app)])
        run(["plutil", "-replace", "CFBundleShortVersionString", "-string", VERSION, str(app / "Contents/Info.plist")])
        run(["codesign", "--force", "--deep", "--sign", "-", str(app)])
        run(["hdiutil", "create", "-quiet", "-volname", "Diffloupe", "-srcfolder", str(folder), "-ov", "-format", "UDZO", str(image)])
        return image
    if platform == "windows":
        config_override = json.dumps({"version": VERSION, "bundle": {"targets": ["nsis"]}})
        subprocess.run(
            ["pnpm", "tauri", "build", "--debug", "--bundles", "nsis", "--config", config_override],
            cwd=ROOT,
            check=True,
            shell=sys.platform == "win32",
        )
        candidates = sorted((BACKEND / "target/debug/bundle/nsis").glob("*.exe"))
        if not candidates:
            raise SystemExit("no NSIS setup program found in backend/target/debug/bundle/nsis")
        image.write_bytes(candidates[-1].read_bytes())
        return image
    raise SystemExit(f"newer_image is not implemented for {platform}")


def installed_version(bundle: Path, platform: str) -> str:
    if platform == "macos":
        with open(bundle / "Contents/Info.plist", "rb") as info:
            return plistlib.load(info)["CFBundleShortVersionString"]
    return "0.0.0"


def running(bundle: Path, platform: str) -> bool:
    if platform == "windows":
        res = subprocess.run(["tasklist", "/FI", "IMAGENAME eq diffloupe.exe"], capture_output=True, text=True)
        return "diffloupe.exe" in res.stdout
    return subprocess.run(["pgrep", "-f", f"{bundle}/Contents/MacOS/"], capture_output=True).returncode == 0


def stop(bundle: Path, platform: str) -> None:
    if platform == "windows":
        subprocess.run(["taskkill", "/F", "/IM", "diffloupe.exe"], capture_output=True)
        return
    for signal in ("-TERM", "-KILL"):
        subprocess.run(["pkill", signal, "-f", f"{bundle}/Contents/MacOS/"], capture_output=True)
        for _ in range(50):
            if not running(bundle, platform):
                return
            time.sleep(0.1)
    raise SystemExit(f"a copy in {bundle} is still running")


def update(work: Path, image: Path, checksum: str, name: str, platform: str = PLATFORM, blocked: bool = False) -> tuple[Path, Path, dict]:
    home = work / name / "home"
    if platform == "windows":
        prog_dir = work / name / "Programs/Diffloupe"
        prog_dir.mkdir(parents=True, exist_ok=True)
        bundle = prog_dir / "diffloupe.exe"
        if BUILT.exists():
            bundle.write_bytes(BUILT.read_bytes())
        (prog_dir / "uninstall.exe").write_bytes(b"dummy uninstaller")
        exe_path = bundle
    else:
        bundle = work / name / "Applications/Diffloupe.app"
        run(["ditto", str(BUILT), str(bundle)])
        if blocked:
            old = bundle.with_name(".Diffloupe.app.old")
            old.mkdir()
            (old / "locked").write_text("")
            run(["chflags", "uchg", str(old / "locked")])
        exe_path = bundle / "Contents/MacOS/diffloupe"

    repo = demo_repos.create_repo(work / name / "repos", "acme-billing", "gs/invoice-export")
    seed(home, repo)
    release = Release(image, checksum, platform)
    out = home / "smoke.json"
    env = {
        **os.environ,
        "HOME": str(home),
        "DIFFLOUPE_SMOKE_REPORT": str(out),
        "DIFFLOUPE_SMOKE_UPDATE": "1",
        "DIFFLOUPE_UPDATE_URL": release.url,
    }
    if platform == "windows":
        env.update(
            USERPROFILE=str(home),
            APPDATA=str(home / "AppData/Roaming"),
            LOCALAPPDATA=str(home / "AppData/Local"),
        )
    if platform == "windows" and os.environ.get("SSH_CONNECTION"):
        batch = home / "run_update.cmd"
        lines = ["@echo off"]
        for k, v in env.items():
            lines.append(f'set "{k}={v}"')
        lines.append(f'"{exe_path}"')
        batch.write_text("\r\n".join(lines) + "\r\n")
        subprocess.run(
            ["schtasks", "/create", "/tn", "DiffloupeSmokeUpdate", "/tr", f'"{batch}"', "/sc", "once", "/st", "00:00", "/f", "/it"],
            capture_output=True,
            check=True,
        )
        subprocess.run(["schtasks", "/run", "/tn", "DiffloupeSmokeUpdate"], capture_output=True, check=True)
        old = None
    else:
        old = subprocess.Popen([str(exe_path)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 240
        started = time.time()
        while not out.exists() and time.time() < deadline:
            time.sleep(0.5)
            if int(time.time() - started) % 10 == 0:
                state = "running" if (old is None or old.poll() is None) else "quit"
                print(f"      {name}: {int(time.time() - started)} s, first copy {state}", flush=True)
        result = json.loads(out.read_text()) if out.exists() else {"phase": "none", "text": ""}
    finally:
        if old is not None and old.poll() is None:
            old.kill()
        if platform == "windows" and os.environ.get("SSH_CONNECTION"):
            subprocess.run(["schtasks", "/delete", "/tn", "DiffloupeSmokeUpdate", "/f"], capture_output=True)
        stop(bundle, platform)
        release.stop()
    return bundle, home, result


def recent(home: Path, platform: str) -> list[str]:
    if platform == "windows":
        state = home / "AppData/Roaming" / BUNDLE_ID / "state.db"
    elif platform == "linux":
        state = home / ".local/share" / BUNDLE_ID / "state.db"
    else:
        state = home / "Library/Application Support" / BUNDLE_ID / "state.db"
    with sqlite3.connect(state) as db:
        return [row[0] for row in db.execute("SELECT path FROM recent")]


def downloads_dir(home: Path, platform: str) -> Path:
    if platform == "windows":
        return home / "AppData/Roaming" / BUNDLE_ID / "updates"
    elif platform == "linux":
        return home / ".local/share" / BUNDLE_ID / "updates"
    return home / "Library/Application Support" / BUNDLE_ID / "updates"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-build", action="store_true", help="use the existing debug build")
    parser.add_argument("--platform", choices=["macos", "windows", "linux"], default=PLATFORM, help="system to test")
    args = parser.parse_args()
    platform = args.platform
    if not args.no_build:
        bundle_arg = ["--bundles", "nsis"] if platform == "windows" else (["--bundles", "app"] if platform == "macos" else ["--bundles", "deb"])
        subprocess.run(["pnpm", "tauri", "build", "--debug", *bundle_arg], cwd=ROOT, check=True, shell=platform == "windows")
        subprocess.run(["cargo", "build", "-q", "-p", "diffloupe-devbridge"], cwd=BACKEND, check=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="dl-update-") as tmp:
        work = Path(tmp)
        image = newer_image(work, platform)
        digest = hashlib.sha256(image.read_bytes()).hexdigest()

        bundle, home, result = update(work, image, digest, "good", platform)
        results.append(check("the updated copy starts and reports", result["phase"] == "after", result["phase"]))
        if platform == "macos":
            results.append(check("the installed copy is the new version", installed_version(bundle, platform) == VERSION, installed_version(bundle, platform)))
            leftovers = [path.name for path in bundle.parent.iterdir() if path.name != "Diffloupe.app"]
            results.append(check("no staged or old copy is left", not leftovers, ", ".join(leftovers)))
        dloads = downloads_dir(home, platform)
        results.append(check("the download is removed", not dloads.exists()))
        results.append(check("the store survives the update", len(recent(home, platform)) == 1, ", ".join(recent(home, platform))))

        bundle, home, result = update(work, image, "0" * 64, "wrong", platform)
        results.append(check("a wrong checksum is reported", "does not match the checksum" in result["text"], result["phase"]))
        if platform == "macos":
            results.append(check("a wrong checksum keeps the old copy", installed_version(bundle, platform) != VERSION, installed_version(bundle, platform)))

        if platform == "macos":
            bundle, home, result = update(work, image, digest, "blocked", platform, blocked=True)
            run(["chflags", "-R", "nouchg", str(bundle.with_name(".Diffloupe.app.old"))])
            results.append(check("a failed swap is reported after the restart", "could not be replaced" in result["text"], result["phase"]))
            results.append(check("a failed swap keeps the old copy", installed_version(bundle, platform) != VERSION, installed_version(bundle, platform)))
            staged = bundle.with_name(".Diffloupe.app.new")
            results.append(check("a failed swap removes the staged copy", not staged.exists()))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())

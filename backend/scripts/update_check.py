"""Updates a copy of the debug build to a newer test release on the Mac and checks the result.

The copy lives in a temporary folder with a temporary home. A local server plays diffloupe.com and
the GitHub release: it offers version 99.0.0 once, with a disk image of the same build marked 99.0.0, and
answers with an older version afterwards, so the updated copy does not update again.
The second run serves a wrong checksum and checks that the old copy stays in place.
"""

import argparse
import hashlib
import json
import os
import plistlib
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

BUILT = BACKEND / "target/debug/bundle/macos/Diffloupe.app"
VERSION = "99.0.0"


class Release:
    def __init__(self, image: Path, checksum: str):
        self.image = image
        self.checksum = checksum
        self.offered = False
        handler = self.handler()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"{self.base}/download/latest/macos/version"

    def latest(self) -> bytes:
        version = "0.0.1" if self.offered else VERSION
        self.offered = True
        return f"{version}\n".encode()

    def handler(self):
        release = self
        image = f"/download/v{VERSION}/Diffloupe-{VERSION}.dmg"

        class Handler(BaseHTTPRequestHandler):
            def body(self) -> bytes | None:
                if self.path == image:
                    return release.image.read_bytes()
                if self.path == f"{image}.sha256":
                    return f"{release.checksum}  Diffloupe-{VERSION}.dmg\n".encode()
                if self.path == "/download/latest/macos/version":
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


def newer_image(work: Path) -> Path:
    folder = work / "image"
    app = folder / "Diffloupe.app"
    run(["ditto", str(BUILT), str(app)])
    run(["plutil", "-replace", "CFBundleShortVersionString", "-string", VERSION, str(app / "Contents/Info.plist")])
    run(["codesign", "--force", "--deep", "--sign", "-", str(app)])
    image = work / f"Diffloupe-{VERSION}.dmg"
    run(["hdiutil", "create", "-quiet", "-volname", "Diffloupe", "-srcfolder", str(folder), "-ov", "-format", "UDZO", str(image)])
    return image


def version(bundle: Path) -> str:
    with open(bundle / "Contents/Info.plist", "rb") as info:
        return plistlib.load(info)["CFBundleShortVersionString"]


def running(bundle: Path) -> bool:
    return subprocess.run(["pgrep", "-f", f"{bundle}/Contents/MacOS/"], capture_output=True).returncode == 0


def stop(bundle: Path) -> None:
    for signal in ("-TERM", "-KILL"):
        subprocess.run(["pkill", signal, "-f", f"{bundle}/Contents/MacOS/"], capture_output=True)
        for _ in range(50):
            if not running(bundle):
                return
            time.sleep(0.1)
    raise SystemExit(f"a copy in {bundle} is still running")


def update(work: Path, image: Path, checksum: str, name: str, blocked: bool = False) -> tuple[Path, Path, dict]:
    bundle = work / name / "Applications/Diffloupe.app"
    run(["ditto", str(BUILT), str(bundle)])
    if blocked:
        old = bundle.with_name(".Diffloupe.app.old")
        old.mkdir()
        (old / "locked").write_text("")
        run(["chflags", "uchg", str(old / "locked")])
    home = work / name / "home"
    repo = demo_repos.create_repo(work / name / "repos", "acme-billing", "gs/invoice-export")
    seed(home, repo)
    release = Release(image, checksum)
    out = home / "smoke.json"
    env = {
        **os.environ,
        "HOME": str(home),
        "DIFFLOUPE_SMOKE_REPORT": str(out),
        "DIFFLOUPE_SMOKE_UPDATE": "1",
        "DIFFLOUPE_UPDATE_URL": release.url,
    }
    old = subprocess.Popen([str(bundle / "Contents/MacOS/diffloupe")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 240
        started = time.time()
        while not out.exists() and time.time() < deadline:
            time.sleep(0.5)
            if int(time.time() - started) % 10 == 0:
                state = "running" if old.poll() is None else "quit"
                print(f"      {name}: {int(time.time() - started)} s, first copy {state}", flush=True)
        result = json.loads(out.read_text()) if out.exists() else {"phase": "none", "text": ""}
    finally:
        if old.poll() is None:
            old.kill()
        stop(bundle)
        release.stop()
    return bundle, home, result


def recent(home: Path) -> list[str]:
    state = home / "Library/Application Support" / BUNDLE_ID / "state.db"
    with sqlite3.connect(state) as db:
        return [row[0] for row in db.execute("SELECT path FROM recent")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-build", action="store_true", help="use the existing debug build")
    args = parser.parse_args()
    if not args.no_build:
        subprocess.run(["pnpm", "tauri", "build", "--debug", "--bundles", "app"], cwd=ROOT, check=True)
        subprocess.run(["cargo", "build", "-q", "-p", "diffloupe-devbridge"], cwd=BACKEND, check=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="dl-update-") as tmp:
        work = Path(tmp)
        image = newer_image(work)
        digest = hashlib.sha256(image.read_bytes()).hexdigest()

        bundle, home, result = update(work, image, digest, "good")
        results.append(check("the updated copy starts and reports", result["phase"] == "after", result["phase"]))
        results.append(check("the installed copy is the new version", version(bundle) == VERSION, version(bundle)))
        leftovers = [path.name for path in bundle.parent.iterdir() if path.name != "Diffloupe.app"]
        results.append(check("no staged or old copy is left", not leftovers, ", ".join(leftovers)))
        downloads = home / "Library/Application Support" / BUNDLE_ID / "updates"
        results.append(check("the download is removed", not downloads.exists()))
        results.append(check("the store survives the update", len(recent(home)) == 1, ", ".join(recent(home))))

        bundle, home, result = update(work, image, "0" * 64, "wrong")
        results.append(check("a wrong checksum is reported", "does not match the checksum" in result["text"], result["phase"]))
        results.append(check("a wrong checksum keeps the old copy", version(bundle) != VERSION, version(bundle)))

        bundle, home, result = update(work, image, digest, "blocked", blocked=True)
        run(["chflags", "-R", "nouchg", str(bundle.with_name(".Diffloupe.app.old"))])
        results.append(check("a failed swap is reported after the restart", "could not be replaced" in result["text"], result["phase"]))
        results.append(check("a failed swap keeps the old copy", version(bundle) != VERSION, version(bundle)))
        staged = bundle.with_name(".Diffloupe.app.new")
        results.append(check("a failed swap removes the staged copy", not staged.exists()))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())

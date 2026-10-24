"""Updates a copy of the debug build to a newer test release on the Mac and checks the result.

The copy lives in a temporary folder with a temporary home. A local server plays GitHub:
it offers version 99.0.0 once, with a disk image of the same build marked 99.0.0, and
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
        return f"{self.base}/repos/brisote/diff-loupe/releases/latest"

    def latest(self) -> bytes:
        tag = "v0.0.1" if self.offered else f"v{VERSION}"
        self.offered = True
        name = f"Diffloupe-{VERSION}.dmg"
        return json.dumps(
            {
                "tag_name": tag,
                "html_url": f"https://github.com/brisote/diff-loupe/releases/tag/{tag}",
                "assets": [
                    {"name": name, "size": self.image.stat().st_size, "browser_download_url": f"{self.base}/download/{name}"},
                    {"name": f"{name}.sha256", "size": 90, "browser_download_url": f"{self.base}/download/{name}.sha256"},
                ],
            }
        ).encode()

    def handler(self):
        release = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.endswith(".dmg"):
                    body = release.image.read_bytes()
                elif self.path.endswith(".dmg.sha256"):
                    body = f"{release.checksum}  Diffloupe-{VERSION}.dmg\n".encode()
                else:
                    body = release.latest()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

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

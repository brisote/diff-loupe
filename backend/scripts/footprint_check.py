"""Checks that Diffloupe writes outside repositories only to its footprint list.

Run `before` once before starting the app, use the app, quit it, then run `after`.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BUNDLE_ID = "com.diffloupe.app"
HOME = Path.home()
LIBRARY = HOME / "Library"
SNAPSHOT = Path(__file__).resolve().parent.parent / "target/footprint-before.json"

FOOTPRINT = [
    LIBRARY / "Application Support" / BUNDLE_ID,
    LIBRARY / "Caches" / BUNDLE_ID,
    LIBRARY / "Preferences" / f"{BUNDLE_ID}.plist",
    LIBRARY / "Saved Application State" / f"{BUNDLE_ID}.savedState",
    LIBRARY / "WebKit" / BUNDLE_ID,
    LIBRARY / "HTTPStorages" / BUNDLE_ID,
    LIBRARY / "HTTPStorages" / f"{BUNDLE_ID}.binarycookies",
    LIBRARY / "Logs" / BUNDLE_ID,
    Path("/tmp") / f"{BUNDLE_ID.replace('.', '_')}_si.sock",
]
USER_FOLDERS = [
    Path(subprocess.run(["getconf", name], capture_output=True, text=True, check=True).stdout.strip())
    for name in ("DARWIN_USER_CACHE_DIR", "DARWIN_USER_TEMP_DIR")
]
FOOTPRINT += [
    folder / name
    for folder in USER_FOLDERS
    for name in [BUNDLE_ID, *(f"com.apple.WebKit.{service}+{BUNDLE_ID}" for service in ("GPU", "Networking", "WebContent"))]
]
TEMP_FOLDERS = [Path("/tmp"), Path("/private/tmp"), Path(tempfile.gettempdir()), *USER_FOLDERS]
BUNDLE_NAMES = (BUNDLE_ID, BUNDLE_ID.replace(".", "_"))


def ours(path: Path) -> bool:
    return "diffloupe" in str(path).lower()


def scan(max_depth: int = 4) -> set[str]:
    found: set[str] = set()
    for top, dirs, files in os.walk(LIBRARY, onerror=lambda _: None):
        depth = len(Path(top).relative_to(LIBRARY).parts)
        for name in dirs + files:
            path = Path(top) / name
            if ours(path):
                found.add(str(path))
        if depth >= max_depth:
            dirs.clear()
        dirs[:] = [d for d in dirs if not ours(Path(top) / d)]
    for folder in TEMP_FOLDERS:
        for entry in folder.glob("*") if folder.is_dir() else []:
            if any(name in entry.name for name in BUNDLE_NAMES):
                found.add(str(entry))
    return found


def owned(path: str) -> bool:
    real = Path(path).resolve()
    return any(real == place.resolve() or real.is_relative_to(place.resolve()) for place in FOOTPRINT)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("phase", choices=["before", "after"])
    args = parser.parse_args()

    if args.phase == "before":
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps(sorted(scan()), indent=2))
        print(f"Saved {SNAPSHOT}")
        return 0

    before = set(json.loads(SNAPSHOT.read_text()))
    new = sorted(scan() - before)
    stray = [path for path in new if not owned(path)]
    webkit = LIBRARY / "WebKit" / BUNDLE_ID
    for path in new:
        print(("ok    " if owned(path) else "STRAY ") + path)
    if webkit.exists():
        print(f"FAIL  {webkit} exists, so the WebView kept data")
    if stray or webkit.exists():
        return 1
    print(f"{len(new)} new paths, all in the footprint list; nothing under WebKit")
    return 0


if __name__ == "__main__":
    sys.exit(main())

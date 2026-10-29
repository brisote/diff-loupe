"""Checks that Diffloupe writes outside repositories only to its footprint list.

Run `before` once before starting the app, use the app, quit it, then run `after`.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BUNDLE_ID = "com.diffloupe.app"
BUNDLE_NAMES = (BUNDLE_ID, BUNDLE_ID.replace(".", "_"))
HOME = Path.home()
PLATFORM = "windows" if sys.platform == "win32" else ("linux" if sys.platform.startswith("linux") else "macos")
SNAPSHOT = Path(__file__).resolve().parent.parent / "target/footprint-before.json"

LIBRARY = HOME / "Library"
APPDATA = Path(os.environ.get("APPDATA", HOME / "AppData/Roaming"))
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", HOME / "AppData/Local"))
START_MENU = APPDATA / "Microsoft/Windows/Start Menu/Programs"

if PLATFORM == "windows":
    FOOTPRINT = [
        APPDATA / BUNDLE_ID,
        LOCALAPPDATA / BUNDLE_ID,
        LOCALAPPDATA / "Programs/Diffloupe",
        LOCALAPPDATA / "Diffloupe",
        START_MENU / "Diffloupe.lnk",
    ]
    TEMP_FOLDERS = [Path(tempfile.gettempdir()), Path(os.environ.get("TEMP", "C:/Windows/Temp"))]
elif PLATFORM == "linux":
    XDG_DATA = Path(os.environ.get("XDG_DATA_HOME", HOME / ".local/share"))
    XDG_CACHE = Path(os.environ.get("XDG_CACHE_HOME", HOME / ".cache"))
    FOOTPRINT = [
        XDG_DATA / BUNDLE_ID,
        XDG_CACHE / BUNDLE_ID,
    ]
    TEMP_FOLDERS = [Path("/tmp"), Path(tempfile.gettempdir())]
else:
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


def ours(path: Path | str) -> bool:
    return "diffloupe" in str(path).lower()


def scan_registry() -> set[str]:
    found: set[str] = set()
    if PLATFORM != "windows":
        return found
    try:
        import winreg

        uninstall_key_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, uninstall_key_path) as key:
            for i in range(winreg.QueryInfoKey(key)[0]):
                subkey_name = winreg.EnumKey(key, i)
                if ours(subkey_name):
                    found.add(f"HKCU\\{uninstall_key_path}\\{subkey_name}")
    except OSError:
        pass
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Diffloupe") as key:
            found.add(r"HKCU\Software\Diffloupe")
    except OSError:
        pass
    return found


def scan(max_depth: int = 4) -> set[str]:
    found: set[str] = set()
    if PLATFORM == "windows":
        for root in (APPDATA, LOCALAPPDATA):
            if not root.is_dir():
                continue
            for top, dirs, files in os.walk(root, onerror=lambda _: None):
                try:
                    depth = len(Path(top).relative_to(root).parts)
                except ValueError:
                    depth = 0
                for name in dirs + files:
                    path = Path(top) / name
                    if ours(path):
                        found.add(str(path))
                if depth >= max_depth:
                    dirs.clear()
                dirs[:] = [d for d in dirs if not ours(Path(top) / d)]
        if START_MENU.is_dir():
            for entry in START_MENU.glob("*"):
                if ours(entry):
                    found.add(str(entry))
        for folder in TEMP_FOLDERS:
            for entry in folder.glob("*") if folder.is_dir() else []:
                if any(name in entry.name for name in BUNDLE_NAMES) or ours(entry):
                    found.add(str(entry))
        found.update(scan_registry())
    elif PLATFORM == "linux":
        for root in (XDG_DATA, XDG_CACHE):
            if not root.is_dir():
                continue
            for top, dirs, files in os.walk(root, onerror=lambda _: None):
                for name in dirs + files:
                    path = Path(top) / name
                    if ours(path):
                        found.add(str(path))
        for folder in TEMP_FOLDERS:
            for entry in folder.glob("*") if folder.is_dir() else []:
                if any(name in entry.name for name in BUNDLE_NAMES) or ours(entry):
                    found.add(str(entry))
    else:
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
    if path.startswith("HKCU\\"):
        return ours(path)
    real = Path(path).resolve()
    for place in FOOTPRINT:
        try:
            place_real = place.resolve()
            if real == place_real or real.is_relative_to(place_real):
                return True
        except (ValueError, OSError):
            continue
    return False


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
    if PLATFORM == "macos" and webkit.exists():
        print(f"FAIL  {webkit} exists, so the WebView kept data")
    if stray or (PLATFORM == "macos" and webkit.exists()):
        return 1
    msg = f"{len(new)} new paths, all in the footprint list"
    if PLATFORM == "macos":
        msg += "; nothing under WebKit"
    print(msg)
    return 0


if __name__ == "__main__":
    sys.exit(main())

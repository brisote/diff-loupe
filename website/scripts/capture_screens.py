"""Captures the app screenshots that the site and its design use, from the real UI through the dev bridge."""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
CAPTURED = FRONTEND / "target" / "site-screens"
SCREENS = ROOT / "website" / "src" / "assets" / "screens"
MANIFEST = "manifest.json"
THEMES = ("light", "dark")
SIZE = (2880, 1800)
COMMIT_DATE = "2026-10-22T16:00:00+00:00"


def png_size(path: Path) -> tuple[int, int] | None:
    with path.open("rb") as file:
        head = file.read(24)
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def problems(folder: Path) -> list[str]:
    manifest = folder / MANIFEST
    if not manifest.exists():
        return [f"{MANIFEST} is missing"]
    try:
        listed = json.loads(manifest.read_text())["scenes"]
        scenes = [(scene["name"], scene["width"], scene["height"]) for scene in listed]
    except (ValueError, KeyError, TypeError):
        return [f"{MANIFEST} is not a list of scenes"]
    if not scenes:
        return [f"{MANIFEST} lists no scenes"]
    found = []
    expected = {MANIFEST}
    for name, width, height in scenes:
        if (width, height) != SIZE:
            found.append(f"{MANIFEST} gives {name} as {width}×{height}, not {SIZE[0]}×{SIZE[1]}")
        for theme in THEMES:
            file = f"{name}-{theme}.png"
            expected.add(file)
            path = folder / file
            if not path.exists():
                found.append(f"{file} is missing")
            elif (size := png_size(path)) is None:
                found.append(f"{file} is not a PNG")
            elif size != (width, height):
                found.append(f"{file} is not {width}×{height}")
    for path in sorted(folder.iterdir()):
        if path.name not in expected:
            found.append(f"{path.name} is not in {MANIFEST}")
    return found


def collect(captured: Path, screens: Path) -> list[str]:
    staged = captured.with_name(f"{captured.name}-staged")
    shutil.rmtree(staged, ignore_errors=True)
    staged.mkdir(parents=True)
    scenes = []
    for meta in sorted(captured.glob("*.json")):
        scene = {**json.loads(meta.read_text()), "width": SIZE[0], "height": SIZE[1]}
        scenes.append(scene)
        for theme in THEMES:
            name = f"{scene['name']}-{theme}.png"
            if (captured / name).exists():
                shutil.copy(captured / name, staged / name)
    (staged / MANIFEST).write_text(json.dumps({"scenes": scenes}, indent=2, ensure_ascii=False) + "\n")
    found = problems(staged)
    if not found:
        shutil.rmtree(screens, ignore_errors=True)
        screens.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(staged, screens)
    return found


def main() -> int:
    subprocess.run(["cargo", "build", "-q", "-p", "diffloupe-devbridge"], cwd=ROOT / "backend", check=True)
    shutil.rmtree(CAPTURED, ignore_errors=True)
    env = {
        **os.environ,
        "DL_SITE_SCREENS": "1",
        "TZ": "UTC",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_AUTHOR_DATE": COMMIT_DATE,
        "GIT_COMMITTER_DATE": COMMIT_DATE,
    }
    subprocess.run(["pnpm", "playwright", "test", "e2e/site-screens.spec.ts"], cwd=FRONTEND, env=env, check=True)
    found = collect(CAPTURED, SCREENS)
    for problem in found:
        print(f"FAIL  {problem}")
    if found:
        print(f"      {SCREENS.relative_to(ROOT)} is unchanged")
        return 1
    scenes = json.loads((SCREENS / MANIFEST).read_text())["scenes"]
    print(f"ok    {len(scenes)} scenes in {SCREENS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

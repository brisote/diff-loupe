"""Checks a release and builds its .dmg, on this Mac or in the Release workflow.

Run it before tagging, on the commit of main you will tag. With --tag it also checks that
the tag names the app version and that the commit is on main. With --notes it writes the
version's CHANGELOG.md section, which becomes the release notes. The Release workflow runs
the checks on Linux (--only checks) and only the build on macOS (--only build), because
macOS minutes cost ten times as much.
"""

import argparse
import json
import plistlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
BUNDLE_ID = "com.diffloupe.app"


def section(changelog: str, version: str) -> str | None:
    lines = changelog.splitlines()
    heading = f"## {version}"
    if heading not in lines:
        return None
    start = lines.index(heading) + 1
    end = next((i for i in range(start, len(lines)) if lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[start:end]).strip() or None


def fail(message: str) -> None:
    raise SystemExit(f"FAIL  {message}")


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tag", help="the tag being released, such as v0.2.0")
    parser.add_argument("--notes", type=Path, help="write the release notes to this file")
    parser.add_argument("--only", choices=["checks", "build"], help="run one half; both run by default")
    args = parser.parse_args()

    version = json.loads((ROOT / "package.json").read_text())["version"]
    if args.only != "build":
        checks(version, args.tag, args.notes)
    if args.only != "checks":
        build(version)
    return 0


def checks(version: str, tag: str | None, notes_file: Path | None) -> None:
    if tag:
        if tag != f"v{version}":
            fail(f"The tag {tag} does not match the app version {version}.")
        if run("git", "merge-base", "--is-ancestor", "HEAD", "origin/main").returncode != 0:
            fail(f"Tag a commit of main: {tag} points to a commit that is not on origin/main.")
    notes = section((ROOT / "CHANGELOG.md").read_text(), version)
    if notes is None:
        fail(f"CHANGELOG.md has no notes under a '## {version}' heading.")
    if notes_file:
        notes_file.write_text(f"{notes}\n")
    print(f"ok    version {version} has release notes")
    if subprocess.run(["cargo", "test", "-q", "-p", "diffloupe-core", "--test", "release_upgrade"], cwd=BACKEND).returncode != 0:
        fail("the manifests, CHANGELOG.md and the store fixtures disagree")
    print("ok    versions, changelog and store fixtures agree")


def build(version: str) -> None:
    if subprocess.run(["pnpm", "tauri", "build"], cwd=ROOT).returncode != 0:
        fail("pnpm tauri build")
    app = BACKEND / "target/release/bundle/macos/Diffloupe.app"
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != BUNDLE_ID or info.get("CFBundleShortVersionString") != version:
        fail(f"the app says {info.get('CFBundleIdentifier')} {info.get('CFBundleShortVersionString')}")
    if "Signature=adhoc" not in run("codesign", "-dv", str(app)).stderr:
        fail("the app is not signed ad hoc")
    if run("codesign", "--verify", "--deep", "--strict", str(app)).returncode != 0:
        fail("the app's signature does not verify")
    dmg = BACKEND / f"target/release/bundle/dmg/Diffloupe_{version}_aarch64.dmg"
    if not dmg.exists():
        fail(f"{dmg.name} is missing")
    print(f"ok    {dmg.relative_to(ROOT)} holds {BUNDLE_ID} {version}, signed ad hoc")


if __name__ == "__main__":
    sys.exit(main())

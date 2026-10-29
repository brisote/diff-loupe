"""Checks a release and builds its packages, on this Mac, in a Linux container or in the Release workflow.

Run it before tagging, on the commit of main you will tag. With --tag it also checks that
the tag names the app version and that the commit is on main. With --notes it writes the
version's CHANGELOG.md section, which becomes the release notes. The Release workflow runs
the checks on Linux (--only checks) and the build on each system (--only build): the .dmg on
macOS, the .deb and .rpm on Linux, and the setup program on Windows.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
BUNDLE_ID = "com.diffloupe.app"
LINUX_ARCHITECTURES = {"x86_64": ("amd64", "x86_64"), "aarch64": ("arm64", "aarch64")}


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


def linux_packages(version: str, machine: str) -> tuple[str, str]:
    deb, rpm = LINUX_ARCHITECTURES[machine]
    return f"deb/Diffloupe_{version}_{deb}.deb", f"rpm/Diffloupe-{version}-1.{rpm}.rpm"


def windows_package(version: str) -> str:
    return f"nsis/Diffloupe_{version}_x64-setup.exe"


def build(version: str) -> None:
    if sys.platform.startswith("linux"):
        build_linux(version, platform.machine())
    elif sys.platform.startswith("win"):
        build_windows(version)
    else:
        build_macos(version)


def build_windows(version: str) -> None:
    if subprocess.run(["pnpm", "tauri", "build"], cwd=ROOT, shell=True).returncode != 0:
        fail("pnpm tauri build")
    bundle = BACKEND / "target/release/bundle"
    setup = bundle / windows_package(version)
    if not setup.exists():
        fail(f"{setup.name} is missing")
    setup_path = str(setup).replace("'", "''")
    info = run("powershell", "-NoProfile", "-Command", f"(Get-Item '{setup_path}').VersionInfo.ProductVersion").stdout.strip()
    if version not in info:
        fail(f"{setup.name} does not report version {version}: {info}")
    print(f"ok    {setup.relative_to(ROOT)} is Diffloupe {version} setup for x64")
    install = run("powershell", "-NoProfile", "-Command", f"$p = Start-Process -FilePath '{setup_path}' -ArgumentList '/S' -Wait -PassThru; exit $p.ExitCode")
    if install.returncode != 0:
        fail(f"silent install of {setup.name} failed: {install.stderr}")
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData/Local")
    installed_dir = Path(local) / "Programs/Diffloupe"
    installed_exe = installed_dir / "diffloupe.exe"
    uninstaller = installed_dir / "uninstall.exe"
    if not installed_exe.exists():
        fail(f"installed executable not found at {installed_exe}")
    if not uninstaller.exists():
        fail(f"uninstaller not found at {uninstaller}")
    print(f"ok    installed {setup.name} silently")
    smoke = run(sys.executable, "backend/scripts/app_smoke.py", "--platform", "windows")
    sys.stdout.write(smoke.stdout)
    if smoke.returncode != 0:
        fail(f"the Windows smoke check failed: {smoke.stderr[-400:]}")
    print("ok    the smoke check passes")
    uninstaller_path = str(uninstaller).replace("'", "''")
    uninst = run("powershell", "-NoProfile", "-Command", f"$p = Start-Process -FilePath '{uninstaller_path}' -ArgumentList '/S' -Wait -PassThru; exit $p.ExitCode")
    if uninst.returncode != 0:
        fail(f"silent uninstall failed: {uninst.stderr}")
    deadline = time.time() + 30
    while installed_exe.exists() and time.time() < deadline:
        time.sleep(0.5)
    if installed_exe.exists():
        fail(f"uninstall did not remove {installed_exe}")
    print("ok    uninstalled cleanly")


def build_linux(version: str, machine: str) -> None:
    if machine not in LINUX_ARCHITECTURES:
        fail(f"there are no Linux packages for {machine}")
    if subprocess.run(["pnpm", "tauri", "build"], cwd=ROOT).returncode != 0:
        fail("pnpm tauri build")
    bundle = BACKEND / "target/release/bundle"
    deb, rpm = (bundle / name for name in linux_packages(version, machine))
    for package in (deb, rpm):
        if not package.exists():
            fail(f"{package.name} is missing")
    fields = run("dpkg-deb", "-f", str(deb), "Package", "Version", "Depends", "Recommends").stdout
    for wanted in ("Package: diffloupe", f"Version: {version}", "curl", "libwebkit2gtk-4.1-0", "Recommends: git"):
        if wanted not in fields:
            fail(f"the .deb lacks {wanted!r}: {fields.strip()}")
    print(f"ok    {deb.relative_to(ROOT)} is package diffloupe {version} with its dependencies")
    if shutil.which("rpm"):
        requires = run("rpm", "-qp", "--requires", str(rpm)).stdout
        for wanted in ("curl", "libwebkit2gtk-4.1.so.0"):
            if wanted not in requires:
                fail(f"the .rpm does not require {wanted}: {requires.strip()}")
        print(f"ok    {rpm.relative_to(ROOT)} requires curl and WebKitGTK")
    else:
        print("skip  the .rpm's dependencies: rpm is not installed on this system")
    smoke = run("python3", "backend/scripts/app_smoke.py", "--platform", "linux")
    sys.stdout.write(smoke.stdout)
    if smoke.returncode != 0:
        fail(f"the Linux smoke check failed: {smoke.stderr[-400:]}")
    print("ok    the smoke check passes")


def build_macos(version: str) -> None:
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

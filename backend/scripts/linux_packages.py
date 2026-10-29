"""Builds Diffloupe's Linux packages on Ubuntu 22.04 and tries them on Ubuntu, Debian and Fedora.

Run it on the Mac with Docker. `build` compiles a debug build of the app into a .deb and an .rpm
inside an Ubuntu 22.04 container (so the packages run on older systems too), and copies them to
backend/target/linux-packages/. The packages have the machine's architecture, because Docker runs
this machine's own: arm64 on Apple silicon. The release workflow builds the x64 ones. `test`
installs the packages into fresh containers of ubuntu:22.04, debian:12 and fedora:40, starts the
app under a virtual display, runs Uninstall from the app with a stand-in for `pkexec`, and checks
that the package and every file Diffloupe owns are gone while other apps' files stay. It also
runs Uninstall without `pkexec`, which must delete nothing and say how to remove the package.
`release` runs the Release workflow's Linux job in the same container: it builds the release
packages and checks them and the app with release_check.py, and takes no --system.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = Path(__file__).resolve().parent / "linux" / "Dockerfile.packages"
OUT = ROOT / "backend/target/linux-packages"
BUNDLE_ID = "com.diffloupe.app"
NEWER = "99.0.0"
SERVER = Path(__file__).resolve().parent / "linux" / "release_server.py"
PORT = 4100
VOLUMES = {
    "diffloupe-pkg-target": "/work/backend/target",
    "diffloupe-pkg-node": "/work/node_modules",
    "diffloupe-pkg-frontend-node": "/work/frontend/node_modules",
    "diffloupe-pkg-frontend-dist": "/work/frontend/dist",
    "diffloupe-pkg-pnpm": "/pnpm-store",
    "diffloupe-pkg-cargo": "/usr/local/cargo/registry",
}
PACKAGE = "diffloupe"
USER = "tester"

SYSTEMS = {
    "ubuntu:22.04": {
        "kind": "deb",
        "prepare": "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git sudo python3 xvfb xauth dbus dbus-x11 at-spi2-core libgl1-mesa-dri",
        "install": "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /pkg/*.deb",
        "installed": f"dpkg -s {PACKAGE}",
        "remove": f"apt-get remove -y {PACKAGE}",
        "version": f"dpkg-query -W -f='${{Version}}' {PACKAGE}",
        "newer": f"Diffloupe-{NEWER}-linux-amd64.deb",
    },
    "debian:12": {
        "kind": "deb",
        "prepare": "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git sudo python3 xvfb xauth dbus dbus-x11 at-spi2-core libgl1-mesa-dri",
        "install": "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /pkg/*.deb",
        "installed": f"dpkg -s {PACKAGE}",
        "remove": f"apt-get remove -y {PACKAGE}",
        "version": f"dpkg-query -W -f='${{Version}}' {PACKAGE}",
        "newer": f"Diffloupe-{NEWER}-linux-amd64.deb",
    },
    "fedora:40": {
        "kind": "rpm",
        "prepare": "dnf install -y -q git sudo python3 xorg-x11-server-Xvfb xauth dbus-daemon dbus-x11 at-spi2-core mesa-dri-drivers",
        "install": "dnf install -y -q /pkg/*.rpm",
        "installed": f"rpm -q {PACKAGE}",
        "remove": f"dnf remove -y -q {PACKAGE}",
        "version": f"rpm -q --qf '%{{VERSION}}' {PACKAGE}",
        "newer": f"Diffloupe-{NEWER}-linux-x86_64.rpm",
    },
}


def docker(*args: str, check: bool = True, timeout: int | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=check, timeout=timeout)


def builder_image() -> str:
    tag = "diffloupe-linux-packages:" + hashlib.sha256(DOCKERFILE.read_bytes()).hexdigest()[:12]
    if docker("image", "inspect", tag, check=False).returncode != 0:
        print(f"----  building the image {tag}", flush=True)
        built = subprocess.run(["docker", "build", "-t", tag, "-f", str(DOCKERFILE), str(DOCKERFILE.parent)])
        if built.returncode != 0:
            raise SystemExit("FAIL  the builder image did not build")
    return tag


def build() -> None:
    image = builder_image()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        shutil.rmtree(old) if old.is_dir() else old.unlink()
    command = (
        "rm -rf backend/target/debug/bundle && "
        "pnpm install --frozen-lockfile --store-dir /pnpm-store && "
        "pnpm tauri build --debug --bundles deb,rpm && "
        "cargo build --manifest-path backend/Cargo.toml -p diffloupe-devbridge && "
        "cp backend/target/debug/bundle/deb/*.deb backend/target/debug/bundle/rpm/*.rpm backend/target/debug/diffloupe-devbridge /out/ && "
        "rm -rf backend/target/debug/bundle && mkdir -p /out/new && "
        f"pnpm tauri build --debug --bundles deb,rpm --config '{{\"version\":\"{NEWER}\"}}' && "
        "cp backend/target/debug/bundle/deb/*.deb backend/target/debug/bundle/rpm/*.rpm /out/new/"
    )
    args = ["run", "--rm", "--init", "-v", f"{ROOT}:/work", "-v", f"{OUT}:/out"]
    for name, path in VOLUMES.items():
        args += ["-v", f"{name}:{path}"]
    args += ["-w", "/work", image, "bash", "-lc", command]
    print("----  building the packages", flush=True)
    if subprocess.run(["docker", *args]).returncode != 0:
        raise SystemExit("FAIL  the packages did not build")
    names = sorted(path.name for path in OUT.iterdir())
    print("ok    built " + ", ".join(names))
    if not any(name.endswith(".deb") for name in names) or not any(name.endswith(".rpm") for name in names) or "diffloupe-devbridge" not in names:
        raise SystemExit("FAIL  the build produced no .deb or no .rpm")


def release() -> None:
    image = builder_image()
    command = (
        "pnpm install --frozen-lockfile --store-dir /pnpm-store && "
        "dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' python3 backend/scripts/release_check.py --only build"
    )
    args = ["run", "--rm", "--init", "-v", f"{ROOT}:/work"]
    for name, path in VOLUMES.items():
        args += ["-v", f"{name}:{path}"]
    args += ["-w", "/work", image, "bash", "-lc", command]
    print("----  the release build and its checks", flush=True)
    if subprocess.run(["docker", *args]).returncode != 0:
        raise SystemExit("FAIL  the release check failed")
    print("ok    the release build passes its checks")


class Box:
    def __init__(self, image: str) -> None:
        self.name = f"diffloupe-pkg-{uuid.uuid4().hex[:8]}"
        docker("run", "-d", "--init", "--name", self.name, "-v", f"{OUT}:/pkg:ro", image, "sleep", "3600")

    def run(self, command: str, user: str | None = None, check: bool = False, timeout: int = 900) -> subprocess.CompletedProcess:
        args = ["exec"]
        if user:
            args += ["-u", user]
        args += [self.name, "sh", "-c", command]
        result = docker(*args, check=False, timeout=timeout)
        if check and result.returncode != 0:
            raise SystemExit(f"FAIL  `{command[:120]}` failed in {self.name}:\n{result.stdout[-1500:]}\n{result.stderr[-1500:]}")
        return result

    def close(self) -> None:
        docker("rm", "-f", self.name, check=False)


def quiet(text: str) -> str:
    noise = ("dbus-daemon", "portal", "fusermount", "fuse init", "RealtimeKit", "Gtk-WARNING")
    return "\n".join(line for line in text.splitlines() if line.strip() and not any(word in line for word in noise))


def check(name: str, condition: bool, detail: str = "") -> bool:
    print(("ok    " if condition else "FAIL  ") + name + (f": {detail}" if detail and not condition else ""), flush=True)
    return condition


def owned_files(box: Box) -> list[str]:
    found = box.run(f"find /home/{USER} -iname '*diffloupe*' -o -iname '*{BUNDLE_ID}*' | sort").stdout.split()
    return [line for line in found if line]


def desktop_checks(box: Box, label: str) -> list[bool]:
    desktop = box.run("cat /usr/share/applications/*iffloupe*.desktop").stdout
    icons = box.run("ls /usr/share/icons/hicolor/*/apps/ | grep -i diffloupe").stdout
    return [
        check(f"{label}: the program is installed", box.run("command -v diffloupe").returncode == 0),
        check(f"{label}: a desktop entry starts it in the Development category", "Exec=diffloupe" in desktop and "Development" in desktop, desktop[:300]),
        check(f"{label}: an icon is installed", bool(icons.strip()), icons),
        check(f"{label}: the license texts are installed", box.run("ls /usr/lib/*iffloupe*/licenses/LICENSE /usr/share/*iffloupe*/licenses/LICENSE 2>/dev/null | head -1").stdout.strip() != ""),
    ]


def seed_repository(box: Box) -> None:
    repo = f"/home/{USER}/acme-billing"
    box.run(
        f"if [ ! -d {repo}/.git ]; then mkdir -p {repo} && cd {repo} && git init -q -b main && git config user.email a@b.c "
        "&& git config user.name Ada && echo hi > a.txt && git add -A && git commit -q -m first && git switch -q -c gs/invoice-export; fi "
        f"&& chown -R {USER} /home/{USER}",
        check=True,
    )
    box.run(
        f"cd /tmp && timeout 6 /pkg/diffloupe-devbridge --port 0 --data-dir /home/{USER}/.local/share/{BUNDLE_ID} --open {repo}",
        user=USER,
    )
    box.run(f"rm -rf /home/{USER}/.cache/{BUNDLE_ID}")


def app(box: Box, env: str, wait: int) -> subprocess.CompletedProcess:
    command = (
        f"export HOME=/home/{USER} GIO_USE_NETWORK_MONITOR=base GTK_USE_PORTAL=0 NO_AT_BRIDGE=1; {env} "
        "dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' "
        f"timeout {wait} diffloupe"
    )
    return box.run(command, user=USER, timeout=wait + 120)


def try_system(image: str, spec: dict) -> list[bool]:
    results: list[bool] = []
    box = Box(image)
    try:
        box.run("id tester >/dev/null 2>&1 || useradd -m tester", check=True)
        box.run(spec["prepare"], check=True)
        box.run(spec["install"], check=True)
        results += desktop_checks(box, image)
        seed_repository(box)
        results.append(check(f"{image}: the package manager lists the package", box.run(spec["installed"]).returncode == 0))

        started = app(box, "WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 DIFFLOUPE_UPDATE_URL=http://127.0.0.1:9/x", 25)
        results.append(check(f"{image}: the app starts and stays up under a virtual display", started.returncode == 124 and "Diffloupe page loaded" in started.stdout + started.stderr, f"{started.returncode} {quiet(started.stderr)[-1500:]}"))
        results.append(check(f"{image}: a first run writes files only where the footprint lists them", all(f"/.local/share/{BUNDLE_ID}" in path or f"/.cache/{BUNDLE_ID}" in path for path in owned_files(box)), "\n".join(owned_files(box))))

        others = [f"/home/{USER}/.claude/projects/x/session.jsonl", f"/home/{USER}/.cache/com.other.app/cache.db", f"/home/{USER}/.local/share/com.other.app/state.json"]
        for path in others:
            box.run(f"mkdir -p $(dirname {path}) && echo x > {path} && chown -R {USER} /home/{USER}", check=True)
        box.run(f"printf '#!/bin/sh\\nexec sudo -n \"$@\"\\n' > /usr/local/bin/pkexec && chmod +x /usr/local/bin/pkexec && echo '{USER} ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/{USER} && chmod 440 /etc/sudoers.d/{USER}", check=True)
        uninstall_env = "DIFFLOUPE_SMOKE_REPORT=/tmp/report.json DIFFLOUPE_SMOKE_UNINSTALL=1 DIFFLOUPE_SMOKE_REMOVE_PACKAGE=1 DIFFLOUPE_UPDATE_URL=http://127.0.0.1:9/x WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1"
        box.run("rm -f /tmp/report.json")
        done = app(box, uninstall_env, 90)
        time.sleep(1)
        report = box.run("cat /tmp/report.json").stdout
        results.append(check(f"{image}: Uninstall quits the app", done.returncode == 0 and not report, f"{done.returncode} {report[-600:]} {quiet(done.stdout + done.stderr)[-1200:]}"))
        time.sleep(8)
        results.append(check(f"{image}: Uninstall removes the package", box.run(spec["installed"]).returncode != 0))
        results.append(check(f"{image}: the program, its entry and its icon are gone", box.run("command -v diffloupe; ls /usr/share/applications/*iffloupe* /usr/share/icons/hicolor/*/apps/*iffloupe* 2>/dev/null").stdout.strip() == ""))
        left = owned_files(box)
        results.append(check(f"{image}: Uninstall leaves no file of Diffloupe's in the home folder", not left, "\n".join(left)))
        results.append(check(f"{image}: Uninstall keeps the files of other apps", all(box.run(f"cat {path}").stdout == "x\n" for path in others)))

        box.run(spec["install"], check=True)
        seed_repository(box)
        box.run("rm -f /usr/local/bin/pkexec /tmp/report.json")
        stuck = app(box, uninstall_env, 40)
        time.sleep(2)
        report = box.run("cat /tmp/report.json").stdout
        results.append(check(f"{image}: without pkexec the app stays open and says nothing was deleted", "nothing was deleted" in report and "sudo" in report, f"{stuck.returncode} {report[-600:]}"))
        results.append(check(f"{image}: without pkexec the package stays installed", box.run(spec["installed"]).returncode == 0))
        results.append(check(f"{image}: without pkexec Diffloupe's files stay", f"/home/{USER}/.local/share/{BUNDLE_ID}" in owned_files(box)))
    finally:
        box.close()
    return results


def session(box: Box, env: str, run: int, after: int) -> subprocess.CompletedProcess:
    command = (
        f"export HOME=/home/{USER} GIO_USE_NETWORK_MONITOR=base GTK_USE_PORTAL=0 NO_AT_BRIDGE=1; {env} "
        "dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' "
        f"sh -c 'timeout {run} diffloupe; sleep {after}'"
    )
    return box.run(command, user=USER, timeout=run + after + 120)


def update_system(image: str, spec: dict, step: str) -> list[bool]:
    results: list[bool] = []
    box = Box(image)
    try:
        box.run("id tester >/dev/null 2>&1 || useradd -m tester", check=True)
        box.run(spec["prepare"], check=True)
        box.run(spec["install"], check=True)
        seed_repository(box)
        old = box.run(spec["version"]).stdout.strip()
        box.run(
            f"mkdir -p /srv/new && cp /pkg/new/*.{spec['kind']} /srv/new/{spec['newer']}",
            check=True,
        )
        box.run(f"printf '#!/bin/sh\nexec sudo -n \"$@\"\n' > /usr/local/bin/pkexec && chmod +x /usr/local/bin/pkexec && echo '{USER} ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/{USER} && chmod 440 /etc/sudoers.d/{USER}", check=True)
        if step == "missing pkexec":
            box.run("rm -f /usr/local/bin/pkexec")
        bad = " --bad-checksum" if step == "wrong checksum" else ""
        box.run(f"setsid python3 /pkg/release_server.py /srv/new --port {PORT}{bad} > /tmp/server.log 2>&1 < /dev/null &", check=True)
        time.sleep(2)
        env = (
            "DIFFLOUPE_SMOKE_REPORT=/tmp/report.json DIFFLOUPE_SMOKE_UPDATE=1 "
            f"DIFFLOUPE_UPDATE_URL=http://127.0.0.1:{PORT}/download/latest/linux/version DIFFLOUPE_UPDATE_ARCH=x86_64 "
            "WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1"
        )
        box.run("rm -f /tmp/report.json")
        ran = session(box, env, 120, 20 if step == "update" else 5)
        report = box.run("cat /tmp/report.json").stdout
        version = box.run(spec["version"]).stdout.strip()
        data = f"/home/{USER}/.local/share/{BUNDLE_ID}"
        label = f"{image}: {step}"
        if step == "update":
            results.append(check(f"{label}: the installed package is the new version", version == NEWER and old != NEWER, f"{old} -> {version}"))
            results.append(check(f"{label}: the restarted app opens the same repository", '"phase":"after"' in report and "acme-billing" in report, f"{report[-400:]} {quiet(ran.stdout + ran.stderr)[-600:]}"))
            results.append(check(f"{label}: the settings and recent repositories are kept", box.run(f"test -s {data}/state.db").returncode == 0))
            results.append(check(f"{label}: the downloaded package is removed", box.run(f"test ! -e {data}/updates").returncode == 0))
        else:
            results.append(check(f"{label}: the old version stays installed", version == old, f"{old} -> {version}"))
            results.append(check(f"{label}: the app is still there, with its data", box.run(f"test -s {data}/state.db").returncode == 0))
            if step == "missing pkexec":
                results.append(check(f"{label}: the app stays open and says what went wrong", '"phase":"stayed"' in report and "was not installed" in report, report[-500:]))
            else:
                results.append(check(f"{label}: the app says the download does not match", '"phase":"failed"' in report and "checksum" in report, report[-500:]))
    finally:
        box.close()
    return results


def test(only: list[str]) -> bool:
    if not any(OUT.glob("*.deb")) or not any(OUT.glob("*.rpm")):
        raise SystemExit("FAIL  no packages in backend/target/linux-packages; run `linux_packages.py build` first")
    shutil.copy(SERVER, OUT / SERVER.name)
    results: list[bool] = []
    for image, spec in SYSTEMS.items():
        if only and image not in only:
            continue
        print(f"----  {image}", flush=True)
        results += try_system(image, spec)
        for step in ("update", "wrong checksum", "missing pkexec"):
            results += update_system(image, spec, step)
    return all(results)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=["build", "test", "release", "all"], nargs="?", default="all")
    parser.add_argument("--system", action="append", default=[], help="try one system only, such as fedora:40; repeat for more")
    args = parser.parse_args()
    if args.mode == "release":
        if args.system:
            parser.error("release takes no --system")
        release()
        return 0
    if args.mode in ("build", "all"):
        build()
    if args.mode in ("test", "all") and not test(args.system):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

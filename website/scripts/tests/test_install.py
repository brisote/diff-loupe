import hashlib
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parents[2] / "src/install/install.sh"
PAYLOAD = b"Diffloupe 0.2.0 disk image\n"
DEB_PAYLOAD = b"Diffloupe 0.2.0 deb package\n"
RPM_PAYLOAD = b"Diffloupe 0.2.0 rpm package\n"

STUBS = {
    "uname": """
if [ "${1:-}" = "-m" ]; then
  echo "${FAKE_ARCH:-x86_64}"
else
  echo "${FAKE_KERNEL:-Darwin}"
fi
""",
    "sysctl": 'echo "${FAKE_ARM64:-1}"',
    "sw_vers": 'echo "${FAKE_MACOS:-14.5}"',
    "curl": """
log curl "$@"
url=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift; else url="$1"; fi
  shift
done
if [ -n "${FAKE_CURL_FAIL:-}" ]; then printf 'partial' > "$out"; exit 18; fi
case "$url" in
  *.deb) cp "$FAKE_DEB" "$out" ;;
  *.rpm) cp "$FAKE_RPM" "$out" ;;
  *) cp "$FAKE_DMG" "$out" ;;
esac
""",
    "shasum": """python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest() + "  " + sys.argv[1])' "$3\"""",
    "sha256sum": """python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest() + "  " + sys.argv[1])' "$1\"""",
    "hdiutil": """
log hdiutil "$@"
if [ "$1" = "attach" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "-mountpoint" ]; then mountpoint="$2"; fi
    shift
  done
  mkdir -p "$mountpoint/Diffloupe.app/Contents"
  echo 0.2.0 > "$mountpoint/Diffloupe.app/Contents/version"
fi
if [ "$1" = "detach" ]; then rm -rf "${2:?}"/*; fi
""",
    "codesign": 'log codesign "$@"; exit "${FAKE_CODESIGN:-0}"',
    "pgrep": 'grep -q true "$FAKE_RUNNING"',
    "pkill": 'log pkill "$@"; [ -n "${FAKE_STUBBORN:-}" ] || echo false > "$FAKE_RUNNING"',
    "ditto": 'log ditto "$@"; [ -z "${FAKE_DITTO_FAIL:-}" ] || exit 1; cp -R "$1" "$2"',
    "mv": """
case "$1" in
  *.Diffloupe.app.new) [ -z "${FAKE_MV_FAIL:-}" ] || exit 1 ;;
esac
exec /bin/mv "$@"
""",
    "xattr": 'log xattr "$@"',
    "mdimport": 'log mdimport "$@"; [ -z "${FAKE_MDIMPORT_HANG:-}" ] || sleep 8; [ -d "$1" ] && [ -z "${FAKE_MDIMPORT_FAIL:-}" ]',
    "sudo": 'log sudo "$@"; "$@"',
}

SYSTEM_TOOLS = [
    "bash",
    "sh",
    "python3",
    "mktemp",
    "cut",
    "id",
    "rm",
    "cp",
    "mv",
    "mkdir",
    "rmdir",
    "grep",
    "sleep",
    "dirname",
    "cat",
    "chmod",
]


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="diffloupe-install-"))
        self.addCleanup(self.cleanup)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.sysbin = self.tmp / "sysbin"
        self.sysbin.mkdir()
        for tool in SYSTEM_TOOLS:
            found = shutil.which(tool)
            if found:
                (self.sysbin / tool).symlink_to(found)
        self.log = self.tmp / "calls.log"
        for name, body in STUBS.items():
            self.write_stub(name, body)
        self.dmg = self.tmp / "release.dmg"
        self.dmg.write_bytes(PAYLOAD)
        self.deb = self.tmp / "release.deb"
        self.deb.write_bytes(DEB_PAYLOAD)
        self.rpm = self.tmp / "release.rpm"
        self.rpm.write_bytes(RPM_PAYLOAD)
        self.running = self.tmp / "running"
        self.running.write_text("false\n")
        self.apps = self.tmp / "Applications"
        self.apps.mkdir()
        self.linux_root = self.tmp / "linux-root"
        self.linux_root.mkdir()
        self.temp = self.tmp / "temp"
        self.temp.mkdir()
        self.home = self.tmp / "home"
        self.data = self.home / "Library/Application Support/com.diffloupe.app"
        self.data.mkdir(parents=True)
        (self.data / "settings.json").write_text('{"version": 1}\n')
        self.linux_data = self.home / ".local/share/com.diffloupe.app"
        self.linux_data.mkdir(parents=True)
        (self.linux_data / "settings.json").write_text('{"version": 1}\n')

    def write_stub(self, name: str, body: str) -> None:
        stub = self.bin / name
        stub.write_text(f'#!/bin/bash\nlog() {{ echo "$*" >> "{self.log}"; }}\n{body}\n')
        stub.chmod(0o755)

    def add_package_manager(self, name: str) -> None:
        self.write_stub(
            name,
            f"""
log {name} "$@"
pkg="${{@: -1}}"
[ -f "$pkg" ] || exit 1
cp "$pkg" "{self.linux_root}/installed-package"
echo 0.2.0 > "{self.linux_root}/version"
""",
        )

    def cleanup(self):
        for path in [self.tmp, *self.tmp.rglob("*")]:
            if path.is_dir() and not path.is_symlink():
                path.chmod(stat.S_IRWXU)
        shutil.rmtree(self.tmp)

    def script(self, checksum=None, deb_checksum=None, rpm_checksum=None):
        text = TEMPLATE.read_text()
        values = {
            "@VERSION@": "0.2.0",
            "@URL@": "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0.dmg",
            "@SHA256@": checksum or hashlib.sha256(PAYLOAD).hexdigest(),
            "@LINUX_VERSION@": "0.2.0",
            "@DEB_URL@": "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0-linux-amd64.deb",
            "@DEB_SHA256@": deb_checksum or hashlib.sha256(DEB_PAYLOAD).hexdigest(),
            "@RPM_URL@": "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0-linux-x86_64.rpm",
            "@RPM_SHA256@": rpm_checksum or hashlib.sha256(RPM_PAYLOAD).hexdigest(),
        }
        for placeholder, value in values.items():
            text = text.replace(placeholder, value)
        path = self.tmp / "install.sh"
        path.write_text(text)
        return path

    def run_script(self, script=None, **env):
        return subprocess.run(
            ["bash", str(script or self.script())],
            env={
                "PATH": f"{self.bin}:{self.sysbin}",
                "HOME": str(self.home),
                "TMPDIR": str(self.temp),
                "DIFFLOUPE_APP_DIR": str(self.apps),
                "FAKE_DMG": str(self.dmg),
                "FAKE_DEB": str(self.deb),
                "FAKE_RPM": str(self.rpm),
                "FAKE_RUNNING": str(self.running),
                **env,
            },
            capture_output=True,
            text=True,
            timeout=60,
        )

    def calls(self):
        return self.log.read_text() if self.log.exists() else ""

    def tree(self, root):
        return {str(path.relative_to(root)): path.read_bytes() if path.is_file() else None for path in sorted(root.rglob("*"))}

    def old_app(self):
        contents = self.apps / "Diffloupe.app/Contents"
        contents.mkdir(parents=True)
        (contents / "version").write_text("0.1.0\n")

    def assert_unchanged(self, result, before, message, root=None):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertEqual(self.tree(root or self.apps), before)
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_a_fresh_install_puts_the_app_in_the_target_folder(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.apps / "Diffloupe.app/Contents/version").read_text(), "0.2.0\n")
        self.assertEqual(sorted(path.name for path in self.apps.iterdir()), ["Diffloupe.app"])
        self.assertIn("xattr -dr com.apple.quarantine", self.calls())
        self.assertIn("codesign --verify --deep --strict", self.calls())
        self.assertIn("-readonly", self.calls())
        self.assertIn("hdiutil detach", self.calls())
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertIn("Diffloupe 0.2.0 is installed", result.stdout)
        self.assertIn(f"mdimport {self.apps}/Diffloupe.app", self.calls())

    def test_a_failed_spotlight_import_still_installs_the_app(self):
        result = self.run_script(FAKE_MDIMPORT_FAIL="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertIn("mdimport", self.calls())
        self.assertEqual((self.apps / "Diffloupe.app/Contents/version").read_text(), "0.2.0\n")

    def test_a_stuck_spotlight_import_does_not_hold_the_install(self):
        started = time.monotonic()
        result = self.run_script(FAKE_MDIMPORT_HANG="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(time.monotonic() - started, 20)
        self.assertIn("Diffloupe 0.2.0 is installed", result.stdout)

    def test_the_script_runs_in_a_plain_and_a_utf8_locale(self):
        for locale in ["C", "en_US.UTF-8"]:
            with self.subTest(locale=locale):
                shutil.rmtree(self.apps / "Diffloupe.app", ignore_errors=True)
                result = self.run_script(LC_ALL=locale, LANG=locale)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Downloading Diffloupe 0.2.0…", result.stdout)

    def test_an_upgrade_quits_the_running_app_and_keeps_its_data(self):
        self.old_app()
        self.running.write_text("true\n")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("pkill -TERM -f", self.calls())
        self.assertLess(self.calls().index("ditto"), self.calls().index("pkill"))
        self.assertEqual((self.apps / "Diffloupe.app/Contents/version").read_text(), "0.2.0\n")
        self.assertEqual(sorted(path.name for path in self.apps.iterdir()), ["Diffloupe.app"])
        self.assertEqual((self.data / "settings.json").read_text(), '{"version": 1}\n')
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_a_wrong_checksum_changes_nothing(self):
        self.old_app()
        before = self.tree(self.apps)
        result = self.run_script(self.script(checksum="0" * 64))
        self.assert_unchanged(result, before, "SHA-256 checksum")
        self.assertNotIn("hdiutil", self.calls())

    def test_an_intel_mac_is_refused_before_any_download(self):
        result = self.run_script(FAKE_ARM64="0")
        self.assert_unchanged(result, {}, "Apple silicon")
        self.assertNotIn("curl", self.calls())

    def test_macos_12_is_refused_before_any_download(self):
        result = self.run_script(FAKE_MACOS="12.7.4")
        self.assert_unchanged(result, {}, "macOS 13 or later")
        self.assertNotIn("curl", self.calls())

    def test_an_interrupted_download_changes_nothing(self):
        self.old_app()
        before = self.tree(self.apps)
        result = self.run_script(FAKE_CURL_FAIL="1")
        self.assert_unchanged(result, before, "download stopped")

    def test_a_bad_signature_changes_nothing(self):
        self.old_app()
        before = self.tree(self.apps)
        result = self.run_script(FAKE_CODESIGN="1")
        self.assert_unchanged(result, before, "signature")
        self.assertIn("hdiutil detach", self.calls())

    def test_a_failed_final_move_puts_the_old_app_back(self):
        self.old_app()
        before = self.tree(self.apps)
        result = self.run_script(FAKE_MV_FAIL="1")
        self.assert_unchanged(result, before, "cannot be moved")

    def test_a_failed_copy_leaves_the_running_app_open(self):
        self.old_app()
        self.running.write_text("true\n")
        before = self.tree(self.apps)
        result = self.run_script(FAKE_DITTO_FAIL="1")
        self.assert_unchanged(result, before, "cannot be copied")
        self.assertNotIn("pkill", self.calls())

    def test_an_app_that_does_not_quit_changes_nothing(self):
        self.old_app()
        self.running.write_text("true\n")
        before = self.tree(self.apps)
        result = self.run_script(FAKE_STUBBORN="1")
        self.assert_unchanged(result, before, "still running")

    def test_a_copy_left_aside_by_an_earlier_run_is_cleaned_up(self):
        contents = self.apps / ".Diffloupe.app.old/Contents"
        contents.mkdir(parents=True)
        (contents / "version").write_text("0.1.0\n")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.apps / "Diffloupe.app/Contents/version").read_text(), "0.2.0\n")
        self.assertEqual(sorted(path.name for path in self.apps.iterdir()), ["Diffloupe.app"])

    def test_a_target_folder_it_created_is_removed_after_a_failure(self):
        target = self.tmp / "Apps"
        result = self.run_script(DIFFLOUPE_APP_DIR=str(target), FAKE_DITTO_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_a_target_folder_is_created_only_for_the_install(self):
        target = self.tmp / "Apps"
        failed = self.run_script(self.script(checksum="0" * 64), DIFFLOUPE_APP_DIR=str(target))
        self.assertNotEqual(failed.returncode, 0)
        self.assertFalse(target.exists())
        result = self.run_script(DIFFLOUPE_APP_DIR=str(target))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((target / "Diffloupe.app").is_dir())

    def test_a_target_inside_a_missing_folder_is_refused(self):
        result = self.run_script(DIFFLOUPE_APP_DIR=str(self.tmp / "missing/Apps"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not exist", result.stderr)
        self.assertNotIn("curl", self.calls())

    @unittest.skipIf(os.geteuid() == 0, "root can write to every folder")
    def test_an_unwritable_target_folder_is_refused(self):
        self.old_app()
        before = self.tree(self.apps)
        self.apps.chmod(0o555)
        result = self.run_script()
        self.assert_unchanged(result, before, "not writable")
        self.assertNotIn("curl", self.calls())

    def test_linux_fresh_install_uses_apt_get_with_deb(self):
        self.add_package_manager("apt-get")
        result = self.run_script(FAKE_KERNEL="Linux")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sudo apt-get install -y", self.calls())
        self.assertIn("Diffloupe-0.2.0-linux-amd64.deb", self.calls())
        self.assertEqual((self.linux_root / "installed-package").read_bytes(), DEB_PAYLOAD)
        self.assertEqual((self.linux_root / "version").read_text(), "0.2.0\n")
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertIn("Diffloupe 0.2.0 is installed", result.stdout)

    def test_linux_fresh_install_uses_dnf_with_rpm(self):
        self.add_package_manager("dnf")
        result = self.run_script(FAKE_KERNEL="Linux")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sudo dnf install -y", self.calls())
        self.assertIn("Diffloupe-0.2.0-linux-x86_64.rpm", self.calls())
        self.assertEqual((self.linux_root / "installed-package").read_bytes(), RPM_PAYLOAD)
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_linux_upgrade_replaces_package_and_keeps_user_data(self):
        self.add_package_manager("apt-get")
        (self.linux_root / "version").write_text("0.1.0\n")
        result = self.run_script(FAKE_KERNEL="Linux")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.linux_root / "version").read_text(), "0.2.0\n")
        self.assertEqual((self.linux_data / "settings.json").read_text(), '{"version": 1}\n')
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_linux_wrong_checksum_changes_nothing(self):
        self.add_package_manager("apt-get")
        (self.linux_root / "version").write_text("0.1.0\n")
        before = self.tree(self.linux_root)
        result = self.run_script(self.script(deb_checksum="0" * 64), FAKE_KERNEL="Linux")
        self.assert_unchanged(result, before, "SHA-256 checksum", root=self.linux_root)
        self.assertNotIn("apt-get", self.calls())

    def test_linux_arm64_is_refused_before_any_download(self):
        self.add_package_manager("apt-get")
        result = self.run_script(FAKE_KERNEL="Linux", FAKE_ARCH="aarch64")
        self.assert_unchanged(result, {}, "x86_64", root=self.linux_root)
        self.assertNotIn("curl", self.calls())

    def test_linux_without_apt_get_or_dnf_is_refused_before_any_download(self):
        result = self.run_script(FAKE_KERNEL="Linux")
        self.assert_unchanged(result, {}, "apt-get", root=self.linux_root)
        self.assertNotIn("curl", self.calls())

    def test_a_cut_off_script_runs_nothing(self):
        text = self.script().read_text()
        cut = self.tmp / "cut.sh"
        cut.write_text(text[: text.rindex("install_diffloupe")])
        result = self.run_script(cut)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), "")
        self.assertEqual(list(self.apps.iterdir()), [])

    @unittest.skipUnless(shutil.which("shellcheck"), "shellcheck is not installed")
    def test_shellcheck_finds_nothing(self):
        result = subprocess.run(["shellcheck", str(self.script())], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()

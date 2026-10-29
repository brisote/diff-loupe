import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "release_check.py"
SPEC = importlib.util.spec_from_file_location("release_check", SCRIPT)
assert SPEC and SPEC.loader
release_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_check)

CHANGELOG = """# Changelog

Intro text.

## 0.3.0

## 0.2.0

- Second release.

### Stored data

- A new key.

## 0.1.0

The first release.

- One change.
"""


class SectionTest(unittest.TestCase):
    def test_returns_only_the_asked_version(self):
        self.assertEqual(
            release_check.section(CHANGELOG, "0.2.0"),
            "- Second release.\n\n### Stored data\n\n- A new key.",
        )
        self.assertEqual(release_check.section(CHANGELOG, "0.1.0"), "The first release.\n\n- One change.")

    def test_a_missing_or_empty_section_has_no_notes(self):
        self.assertIsNone(release_check.section(CHANGELOG, "0.4.0"))
        self.assertIsNone(release_check.section(CHANGELOG, "0.1"))
        self.assertIsNone(release_check.section(CHANGELOG, "0.3.0"))

    def test_the_real_changelog_has_notes_for_the_app_version(self):
        root = SCRIPT.parents[2]
        version = __import__("json").loads((root / "package.json").read_text())["version"]
        self.assertIsNotNone(release_check.section((root / "CHANGELOG.md").read_text(), version))


class LinuxPackagesTest(unittest.TestCase):
    def test_the_package_names_follow_the_architecture(self):
        self.assertEqual(
            release_check.linux_packages("0.3.0", "x86_64"),
            ("deb/Diffloupe_0.3.0_amd64.deb", "rpm/Diffloupe-0.3.0-1.x86_64.rpm"),
        )
        self.assertEqual(
            release_check.linux_packages("0.3.0", "aarch64"),
            ("deb/Diffloupe_0.3.0_arm64.deb", "rpm/Diffloupe-0.3.0-1.aarch64.rpm"),
        )

    def test_an_unknown_architecture_has_no_packages(self):
        with self.assertRaises(KeyError):
            release_check.linux_packages("0.3.0", "riscv64")


class WindowsPackageTest(unittest.TestCase):
    def test_the_package_name_is_the_nsis_setup_exe(self):
        self.assertEqual(
            release_check.windows_package("0.3.0"),
            "nsis/Diffloupe_0.3.0_x64-setup.exe",
        )


class WindowsInstalledPathsTest(unittest.TestCase):
    def test_finds_in_local_diffloupe_when_it_exists(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp)
            target = local / "Diffloupe"
            target.mkdir()
            (target / "diffloupe.exe").write_bytes(b"")
            (target / "uninstall.exe").write_bytes(b"")
            installed_dir, installed_exe, uninstaller = release_check.windows_installed_paths(local)
            self.assertEqual(installed_dir, target)
            self.assertEqual(installed_exe, target / "diffloupe.exe")
            self.assertEqual(uninstaller, target / "uninstall.exe")

    def test_finds_in_programs_diffloupe_when_diffloupe_absent(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp)
            target = local / "Programs/Diffloupe"
            target.mkdir(parents=True)
            (target / "diffloupe.exe").write_bytes(b"")
            (target / "uninstall.exe").write_bytes(b"")
            installed_dir, installed_exe, uninstaller = release_check.windows_installed_paths(local)
            self.assertEqual(installed_dir, target)
            self.assertEqual(installed_exe, target / "diffloupe.exe")
            self.assertEqual(uninstaller, target / "uninstall.exe")

    def test_finds_capitalized_executable(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp)
            target = local / "Diffloupe"
            target.mkdir()
            (target / "Diffloupe.exe").write_bytes(b"")
            (target / "uninstall.exe").write_bytes(b"")
            installed_dir, installed_exe, uninstaller = release_check.windows_installed_paths(local)
            self.assertEqual(installed_dir, target)
            self.assertEqual(installed_exe, target / "Diffloupe.exe")
            self.assertEqual(uninstaller, target / "uninstall.exe")

    def test_prefers_directory_with_executable_over_empty_directory(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp)
            empty = local / "Diffloupe"
            empty.mkdir()
            target = local / "Programs/Diffloupe"
            target.mkdir(parents=True)
            (target / "diffloupe.exe").write_bytes(b"")
            (target / "uninstall.exe").write_bytes(b"")
            installed_dir, installed_exe, uninstaller = release_check.windows_installed_paths(local)
            self.assertEqual(installed_dir, target)
            self.assertEqual(installed_exe, target / "diffloupe.exe")
            self.assertEqual(uninstaller, target / "uninstall.exe")


if __name__ == "__main__":
    unittest.main()

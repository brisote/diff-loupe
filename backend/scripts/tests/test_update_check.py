from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "update_check.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("update_check", SCRIPT)
assert SPEC and SPEC.loader
update_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update_check)


class UpdateCheckTest(unittest.TestCase):
    def test_package_name_formats_per_platform(self):
        self.assertEqual(update_check.package_name("0.4.0", "windows"), "Diffloupe-0.4.0-windows-x64-setup.exe")
        self.assertEqual(update_check.package_name("0.3.0", "linux"), "Diffloupe-0.3.0-linux-amd64.deb")
        self.assertEqual(update_check.package_name("0.2.0", "macos"), "Diffloupe-0.2.0.dmg")

    def test_downloads_dir_follows_platform_conventions(self):
        home = Path("/test/home")
        win_dloads = update_check.downloads_dir(home, "windows")
        self.assertTrue(str(win_dloads).replace("\\", "/").endswith("AppData/Roaming/com.diffloupe.app/updates"))
        linux_dloads = update_check.downloads_dir(home, "linux")
        self.assertTrue(str(linux_dloads).endswith(".local/share/com.diffloupe.app/updates"))
        macos_dloads = update_check.downloads_dir(home, "macos")
        self.assertTrue(str(macos_dloads).endswith("Library/Application Support/com.diffloupe.app/updates"))


if __name__ == "__main__":
    unittest.main()

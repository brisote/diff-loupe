from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "footprint_check.py"
SPEC = importlib.util.spec_from_file_location("footprint_check", SCRIPT)
assert SPEC and SPEC.loader
footprint_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(footprint_check)


class FootprintCheckTest(unittest.TestCase):
    def test_ours_matches_diffloupe_names(self):
        self.assertTrue(footprint_check.ours(Path("C:/Users/User/AppData/Local/com.diffloupe.app")))
        self.assertTrue(footprint_check.ours("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Diffloupe"))
        self.assertFalse(footprint_check.ours(Path("C:/Users/User/AppData/Local/com.other.app")))

    def test_owned_recognizes_footprint_and_rejects_strays(self):
        self.assertTrue(footprint_check.owned(str(footprint_check.FOOTPRINT[0])))
        self.assertFalse(footprint_check.owned(str(Path.home() / "Documents/random.txt")))
        self.assertTrue(footprint_check.owned("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Diffloupe"))
        self.assertFalse(footprint_check.owned("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OtherApp"))


if __name__ == "__main__":
    unittest.main()

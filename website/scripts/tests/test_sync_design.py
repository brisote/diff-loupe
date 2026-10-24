import importlib.util
import os
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "sync_design.py"
SPEC = importlib.util.spec_from_file_location("sync_design", SCRIPT)
assert SPEC and SPEC.loader
sync_design = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_design)


needs_design = unittest.skipIf(
    not sync_design.SOURCE.exists() and bool(os.environ.get("CI")),
    "the private design checkout is absent, so this check runs on the Mac only",
)


class SyncDesignTest(unittest.TestCase):
    def test_dark_rules_follow_the_system_setting(self):
        css = '.site { --bg: #fff; }\n.site[data-theme="dark"] { --bg: #000; }\n.site[data-theme="dark"] .card { color: red; }\n'
        self.assertEqual(
            sync_design.convert(css),
            ".site { --bg: #fff; }\n"
            "@media (prefers-color-scheme: dark) {\n  .site { --bg: #000; }\n}\n"
            "@media (prefers-color-scheme: dark) {\n  .site .card { color: red; }\n}\n",
        )

    def test_other_rules_and_media_queries_stay_as_they_are(self):
        css = ".a { color: red; }\n@media (max-width: 767px) {\n  .a { color: blue; }\n}\n"
        self.assertEqual(sync_design.convert(css), css)

    @needs_design
    def test_the_frozen_design_converts_without_any_theme_attribute_left(self):
        converted = sync_design.convert(sync_design.SOURCE.read_text())
        self.assertNotIn("data-theme", converted)
        self.assertIn("@media (prefers-color-scheme: dark)", converted)

    def test_unbalanced_braces_are_refused(self):
        with self.assertRaises(ValueError):
            sync_design.convert(".a { color: red;\n")

    @needs_design
    def test_the_site_stylesheet_is_up_to_date(self):
        self.assertEqual(sync_design.TARGET.read_text(), sync_design.convert(sync_design.SOURCE.read_text()))


if __name__ == "__main__":
    unittest.main()

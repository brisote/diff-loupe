import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check_links.py"
SPEC = importlib.util.spec_from_file_location("check_links", SCRIPT)
assert SPEC and SPEC.loader
check_links = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_links)


class CheckLinksTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.site = Path(self.dir.name)
        (self.site / "download").mkdir()
        (self.site / "download/index.html").write_text('<h1 id="manual">Download</h1>')
        (self.site / "icon.png").write_bytes(b"png")

    def tearDown(self):
        self.dir.cleanup()

    def page(self, body: str) -> None:
        (self.site / "index.html").write_text(f'<main id="top">{body}</main>')

    def test_links_assets_and_anchors_that_exist_pass(self):
        self.page('<a href="/download/#manual">x</a><img src="/icon.png"><a href="#top">up</a><a href="https://example.com/">out</a>')
        self.assertEqual(check_links.problems(self.site), [])

    def test_external_links_are_collected_once_and_checked(self):
        self.page('<a href="https://example.com/">a</a><a href="https://example.com/">b</a><a href="http://down.test/x">c</a><a href="/download/">d</a><link rel="canonical" href="https://diffloupe.com/">')
        links = check_links.external(self.site)
        self.assertEqual(links, ["http://down.test/x", "https://example.com/"])
        self.assertEqual(
            check_links.unreachable(links, lambda url: "down" not in url),
            ["http://down.test/x does not answer"],
        )

    def test_a_missing_page_is_reported(self):
        self.page('<a href="/changelog/">x</a>')
        self.assertEqual(check_links.problems(self.site), ["index.html: /changelog/ does not exist"])

    def test_a_missing_asset_is_reported(self):
        self.page('<img src="/fonts/missing.woff2">')
        self.assertEqual(check_links.problems(self.site), ["index.html: /fonts/missing.woff2 does not exist"])

    def test_a_missing_anchor_is_reported(self):
        self.page('<a href="/download/#faq">x</a><a href="#nowhere">y</a>')
        self.assertEqual(
            check_links.problems(self.site),
            ["index.html: /download/#faq has no #faq", "index.html: #nowhere has no #nowhere"],
        )

    def test_a_font_missing_from_a_stylesheet_is_reported(self):
        self.page("")
        (self.site / "site.css").write_text('@font-face { src: url("/fonts/missing.woff2") format("woff2"); }')
        self.assertEqual(check_links.problems(self.site), ["site.css: /fonts/missing.woff2 does not exist"])

    def test_a_missing_srcset_image_is_reported(self):
        self.page('<img src="/icon.png" srcset="/icon.png 1x, /icon@2x.png 2x">')
        self.assertEqual(check_links.problems(self.site), ["index.html: /icon@2x.png does not exist"])


if __name__ == "__main__":
    unittest.main()

import re
import sys
import unittest
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import make_og


class MakeOgTest(unittest.TestCase):
    def test_the_page_is_the_preview_size_and_uses_only_files_that_exist(self):
        html = make_og.page()
        self.assertIn(f"width: {make_og.WIDTH}px; height: {make_og.HEIGHT}px", html)
        self.assertEqual((make_og.WIDTH, make_og.HEIGHT), (1200, 630))
        files = [Path(unquote(urlparse(url).path)) for url in re.findall(r'file://[^"\')]+', html)]
        self.assertGreaterEqual(len(files), 4)
        for path in files:
            self.assertTrue(path.exists(), path)

    def test_the_committed_image_is_a_jpeg(self):
        self.assertEqual(make_og.TARGET.read_bytes()[:3], b"\xff\xd8\xff")


if __name__ == "__main__":
    unittest.main()

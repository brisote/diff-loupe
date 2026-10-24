import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "capture_screens.py"
SPEC = importlib.util.spec_from_file_location("capture_screens", SCRIPT)
assert SPEC and SPEC.loader
capture_screens = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture_screens)


def png(path: Path, width: int, height: int) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height))


def scene(folder: Path, name: str, width: int = 2880, height: int = 1800, themes=("light", "dark")) -> None:
    for theme in themes:
        png(folder / f"{name}-{theme}.png", width, height)
    (folder / f"{name}.json").write_text(json.dumps({"name": name, "description": f"The {name} scene."}))


class CaptureScreensTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.captured = Path(self.dir.name) / "captured"
        self.screens = Path(self.dir.name) / "screens"
        self.captured.mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def published(self) -> list[str]:
        return sorted(path.name for path in self.screens.iterdir())

    def test_a_complete_capture_is_published_with_every_scene_in_the_manifest(self):
        scene(self.captured, "merge")
        scene(self.captured, "changes")
        self.assertEqual(capture_screens.collect(self.captured, self.screens), [])
        self.assertEqual(capture_screens.problems(self.screens), [])
        manifest = json.loads((self.screens / "manifest.json").read_text())
        self.assertEqual(
            manifest["scenes"],
            [
                {"name": "changes", "description": "The changes scene.", "width": 2880, "height": 1800},
                {"name": "merge", "description": "The merge scene.", "width": 2880, "height": 1800},
            ],
        )
        self.assertEqual(
            self.published(),
            ["changes-dark.png", "changes-light.png", "manifest.json", "merge-dark.png", "merge-light.png"],
        )

    def test_a_missing_dark_picture_is_reported(self):
        scene(self.captured, "changes", themes=("light",))
        self.assertEqual(capture_screens.collect(self.captured, self.screens), ["changes-dark.png is missing"])

    def test_a_missing_light_picture_is_reported(self):
        scene(self.captured, "changes", themes=("dark",))
        self.assertEqual(capture_screens.collect(self.captured, self.screens), ["changes-light.png is missing"])

    def test_a_picture_of_another_size_is_reported(self):
        scene(self.captured, "changes")
        png(self.captured / "changes-dark.png", 1440, 900)
        self.assertEqual(capture_screens.collect(self.captured, self.screens), ["changes-dark.png is not 2880×1800"])

    def test_a_file_that_is_not_a_png_is_reported(self):
        scene(self.captured, "changes")
        (self.captured / "changes-light.png").write_text("not a picture")
        self.assertEqual(capture_screens.collect(self.captured, self.screens), ["changes-light.png is not a PNG"])

    def test_an_empty_capture_is_reported(self):
        self.assertEqual(capture_screens.collect(self.captured, self.screens), ["manifest.json lists no scenes"])

    def test_a_failed_capture_keeps_the_published_pictures(self):
        scene(self.captured, "changes")
        capture_screens.collect(self.captured, self.screens)
        (self.captured / "changes-dark.png").unlink()
        self.assertEqual(capture_screens.collect(self.captured, self.screens), ["changes-dark.png is missing"])
        self.assertEqual(self.published(), ["changes-dark.png", "changes-light.png", "manifest.json"])

    def test_a_new_capture_replaces_the_published_pictures(self):
        scene(self.captured, "gone")
        capture_screens.collect(self.captured, self.screens)
        for path in self.captured.iterdir():
            path.unlink()
        scene(self.captured, "changes")
        self.assertEqual(capture_screens.collect(self.captured, self.screens), [])
        self.assertEqual(self.published(), ["changes-dark.png", "changes-light.png", "manifest.json"])

    def test_an_unlisted_file_is_reported(self):
        scene(self.captured, "changes")
        capture_screens.collect(self.captured, self.screens)
        png(self.screens / "old-light.png", 2880, 1800)
        self.assertEqual(capture_screens.problems(self.screens), ["old-light.png is not in manifest.json"])

    def test_a_manifest_of_another_size_is_reported(self):
        scene(self.captured, "changes")
        capture_screens.collect(self.captured, self.screens)
        manifest = self.screens / "manifest.json"
        manifest.write_text(manifest.read_text().replace("2880", "1440").replace("1800", "900"))
        self.assertEqual(
            capture_screens.problems(self.screens),
            [
                "manifest.json gives changes as 1440×900, not 2880×1800",
                "changes-light.png is not 1440×900",
                "changes-dark.png is not 1440×900",
            ],
        )

    def test_a_broken_manifest_is_reported(self):
        self.screens.mkdir()
        manifest = self.screens / "manifest.json"
        for text in ("{", '{"scenes": [{"name": "changes"}]}', '{"scenes": "changes"}', "[]"):
            manifest.write_text(text)
            self.assertEqual(capture_screens.problems(self.screens), ["manifest.json is not a list of scenes"])

    def test_a_folder_without_a_manifest_is_reported(self):
        self.screens.mkdir()
        self.assertEqual(capture_screens.problems(self.screens), ["manifest.json is missing"])


if __name__ == "__main__":
    unittest.main()

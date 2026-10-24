import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
NAMES = re.compile("|".join(["intel" + "lij", "vo" + "xt", "act" + "now"]), re.IGNORECASE)
MAKER = re.compile("jet" + "brains", re.IGNORECASE)
FONT = re.compile("Jet" + r"Brains[ ]?Mono")
ICONS = "frontend/src/assets/icons/"


def tracked() -> list[str]:
    output = subprocess.run(["git", "-c", f"safe.directory={ROOT}", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    return output.stdout.splitlines()


def text(path: str) -> str | None:
    try:
        return (ROOT / path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        return None


def mentions(path: str, content: str) -> list[str]:
    if path == "NOTICE":
        return []
    found = [f"{path}: {match.group(0)}" for match in NAMES.finditer(content)]
    font_file = Path(path).name.startswith("Jet" + "BrainsMono")
    if not font_file and not (path.startswith(ICONS) and path.endswith((".svg", "LICENSE"))):
        rest = FONT.sub("", content)
        found += [f"{path}: {match.group(0)}" for match in MAKER.finditer(rest)]
    return found


class MentionsTest(unittest.TestCase):
    def test_no_file_names_the_products_the_look_came_from(self):
        found = []
        for path in tracked():
            content = text(path)
            if content is not None:
                found += mentions(path, content)
        self.assertEqual(found, [])

    def test_a_new_mention_is_found(self):
        self.assertEqual(
            mentions("frontend/src/a.test.ts", 'it("works like ' + "Intel" + 'liJ")'),
            ["frontend/src/a.test.ts: " + "Intel" + "liJ"],
        )
        self.assertEqual(mentions("frontend/src/styles/tokens.css", "--font-mono: \"" + "Jet" + "Brains Mono\";"), [])
        self.assertEqual(mentions("NOTICE", "Intel" + "liJ " + "Jet" + "Brains"), [])
        self.assertEqual(len(mentions("README.md", "by " + "Jet" + "Brains")), 1)


if __name__ == "__main__":
    unittest.main()

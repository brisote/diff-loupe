"""Writes the site's stylesheet from the frozen design, with the dark theme following the system setting."""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESIGN = Path(os.environ.get("DIFFLOUPE_DESIGN_DIR", ROOT.parent / "diffloupe-design"))
SOURCE = DESIGN / "website/site.css"
TARGET = ROOT / "website/src/styles/site.css"
DARK = '.site[data-theme="dark"]'


def blocks(css: str) -> list[str]:
    found, depth, start = [], 0, 0
    for index, char in enumerate(css):
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                found.append(css[start : index + 1].strip())
                start = index + 1
    if depth or css[start:].strip():
        raise ValueError("the stylesheet has unbalanced braces")
    return found


def convert(css: str) -> str:
    out = []
    for block in blocks(css):
        selector, body = block.split("{", 1)
        if DARK in selector:
            out.append(f"@media (prefers-color-scheme: dark) {{\n  {selector.replace(DARK, '.site').strip()} {{{body}\n}}")
        else:
            out.append(block)
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when the site's stylesheet is out of date")
    args = parser.parse_args()
    if not SOURCE.exists():
        print(f"the design checkout is missing at {DESIGN}; clone brisote/diffloupe-design next to this repository or set DIFFLOUPE_DESIGN_DIR")
        return 1
    css = convert(SOURCE.read_text())
    if args.check:
        if TARGET.read_text() != css:
            print(f"{TARGET.relative_to(ROOT)} is out of date; run website/scripts/sync_design.py")
            return 1
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(css)
    print(TARGET.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())

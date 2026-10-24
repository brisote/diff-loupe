"""Writes the site's web fonts from the frozen design's fonts: Latin subsets as WOFF2.

Needs fontTools and Brotli: python3 -m pip install fonttools brotli.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
DESIGN = Path(os.environ.get("DIFFLOUPE_DESIGN_DIR", ROOT.parent / "diffloupe-design"))
ASSETS = DESIGN / "website/assets"
FONTS = ROOT / "website/public/fonts"
LATIN = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2190, 0x2192, 0x20AC, 0x2122, 0x2212]


def sans(target: Path) -> None:
    font = instancer.instantiateVariableFont(TTFont(ASSETS / "GoogleSansFlex.ttf"), {"wdth": 100, "ROND": 0, "slnt": 0, "wght": (300, 700)})
    with tempfile.TemporaryDirectory() as scratch:
        pinned = Path(scratch) / "pinned.ttf"
        font.save(pinned)
        font = TTFont(pinned)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=LATIN)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(target)


def main() -> int:
    if not ASSETS.is_dir():
        print(f"the design checkout is missing at {DESIGN}; clone brisote/diffloupe-design next to this repository or set DIFFLOUPE_DESIGN_DIR")
        return 1
    FONTS.mkdir(parents=True, exist_ok=True)
    sans(FONTS / "GoogleSansFlex.woff2")
    for name in ("JetBrainsMono-Regular.woff2", "JetBrainsMono-Bold.woff2", "JetBrainsMono-OFL.txt", "GoogleSansFlex-OFL.txt"):
        shutil.copy(ASSETS / name, FONTS / name)
    for path in sorted(FONTS.iterdir()):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

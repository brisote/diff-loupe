"""Draws the 1200 x 630 link preview image, public/og.jpg, from the site's own styles and an app screenshot."""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLES = ROOT / "src/styles/site.css"
FONTS = ROOT / "public/fonts"
ICON = ROOT / "public/icon.png"
SHOT = ROOT / "src/assets/screens/markdown-light.png"
TARGET = ROOT / "public/og.jpg"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WIDTH, HEIGHT = 1200, 630


def page() -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="{STYLES.as_uri()}">
<style>
@font-face {{ font-family: "Google Sans Flex"; src: url("{(FONTS / 'GoogleSansFlex.woff2').as_uri()}") format("woff2"); font-weight: 300 700; }}
html, body {{ margin: 0; width: {WIDTH}px; height: {HEIGHT}px; overflow: hidden; }}
.site {{ width: {WIDTH}px; height: {HEIGHT}px; min-height: 0; position: relative; overflow: hidden; }}
.og-text {{ position: absolute; left: 64px; top: 64px; width: 440px; }}
.og-text .h1-hero {{ margin: 44px 0 0; font-size: 50px; line-height: 56px; }}
.og-text .lead {{ margin: 26px 0 0; font-size: 21px; line-height: 32px; }}
.og-text .chip {{ margin-top: 34px; height: 36px; font-size: 16px; padding: 0 16px; }}
.og-scene {{ position: absolute; left: 556px; top: 64px; width: 760px; height: 600px; margin: 0; aspect-ratio: auto; }}
.og-scene .window {{ position: absolute; left: 44px; top: 44px; width: 860px; }}
</style></head><body>
<div class="site" data-theme="light">
<div class="og-text">
<span class="brand"><img src="{ICON.as_uri()}" alt=""><span>Diffloupe</span></span>
<h1 class="h1-hero">Review the diff. Ship the branch. Stay private.</h1>
<p class="lead">An app for reviewing git changes on macOS, Windows and Linux. Your code stays on your computer.</p>
<span class="chip">diffloupe.com</span>
</div>
<div class="scene og-scene"><div class="window"><img src="{SHOT.as_uri()}" alt=""></div></div>
</div>
</body></html>"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=TARGET)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="diffloupe-og-") as tmp:
        html = Path(tmp) / "og.html"
        html.write_text(page())
        png = Path(tmp) / "og.png"
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
             "--force-device-scale-factor=1", f"--window-size={WIDTH},{HEIGHT}", f"--screenshot={png}", html.as_uri()],
            capture_output=True, timeout=90, check=True,
        )
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", str(png), "--out", str(args.out)],
                       capture_output=True, check=True)
    print(args.out.relative_to(ROOT) if args.out.is_relative_to(ROOT) else args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

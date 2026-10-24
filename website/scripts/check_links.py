"""Checks that every internal link, asset and anchor in the built site resolves."""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"])
        for name in ("href", "src"):
            if values.get(name) and tag != "meta":
                self.links.append(values[name])
        for candidate in (values.get("srcset") or "").split(","):
            if candidate.strip():
                self.links.append(candidate.split()[0])


def read(path: Path) -> Page:
    page = Page()
    page.feed(path.read_text())
    return page


def target(site: Path, page: Path, link: str) -> tuple[Path, str] | None:
    parts = urlsplit(link)
    if parts.scheme or parts.netloc or link.startswith("mailto:"):
        return None
    if not parts.path:
        return page, parts.fragment
    base = site if parts.path.startswith("/") else page.parent
    path = base / unquote(parts.path.lstrip("/"))
    if parts.path.endswith("/"):
        path = path / "index.html"
    return path, parts.fragment


CSS_URL = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)")


def problems(site: Path) -> list[str]:
    pages = {path: read(path) for path in sorted(site.rglob("*.html"))}
    found = []
    for sheet in sorted(site.rglob("*.css")):
        for link in CSS_URL.findall(sheet.read_text()):
            resolved = None if link.startswith("data:") else target(site, sheet, link)
            if resolved and not resolved[0].is_file():
                found.append(f"{sheet.relative_to(site)}: {link} does not exist")
    for path, page in pages.items():
        for link in page.links:
            resolved = target(site, path, link)
            if resolved is None:
                continue
            file, anchor = resolved
            name = path.relative_to(site)
            if not file.is_file():
                found.append(f"{name}: {link} does not exist")
            elif anchor and anchor not in (pages.get(file) or read(file)).ids:
                found.append(f"{name}: {link} has no #{anchor}")
    return found


def main() -> int:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "dist").resolve()
    found = problems(site)
    for problem in found:
        print(f"FAIL  {problem}")
    if found:
        return 1
    print(f"ok    every internal link in {len(list(site.rglob('*.html')))} pages resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())

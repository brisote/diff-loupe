"""Checks that every internal link, asset and anchor in the built site resolves, and with --external that every link to another site answers."""

from __future__ import annotations

import argparse
import http.client
import re
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
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


def external(site: Path, own: str = "diffloupe.com") -> list[str]:
    links = {
        link
        for path in site.rglob("*.html")
        for link in read(path).links
        if urlsplit(link).scheme in ("http", "https") and urlsplit(link).hostname != own
    }
    return sorted(links)


REFUSED = {401, 403, 429}


def answers(url: str) -> bool:
    for method in ("HEAD", "GET"):
        request = urllib.request.Request(url, method=method, headers={"User-Agent": "Mozilla/5.0 diffloupe-link-check"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status < 400:
                    return True
        except urllib.error.HTTPError as error:
            if error.code in REFUSED:
                return True
        except (OSError, http.client.HTTPException, ValueError):
            continue
    return False


def unreachable(links: list[str], check: Callable[[str], bool] = answers) -> list[str]:
    return [f"{link} does not answer" for link in links if not check(link)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", nargs="?", default="dist")
    parser.add_argument("--external", action="store_true", help="also check every link to another site")
    args = parser.parse_args()
    site = Path(args.site).resolve()
    found = problems(site)
    outside = external(site) if args.external else []
    found += unreachable(outside)
    for problem in found:
        print(f"FAIL  {problem}")
    if found:
        return 1
    print(f"ok    every internal link in {len(list(site.rglob('*.html')))} pages resolves")
    if args.external:
        print(f"ok    all {len(outside)} links to other sites answer")
    return 0


if __name__ == "__main__":
    sys.exit(main())

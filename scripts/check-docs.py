#!/usr/bin/env python3
"""Check built documentation links/assets/fragments without a running server."""

import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.links = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        for attribute in ("href", "src"):
            if attrs.get(attribute):
                self.links.append(attrs[attribute])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("doc/.vitepress/dist"))
    parser.add_argument("--base", default="/docs/")
    args = parser.parse_args()
    root = args.directory.resolve()
    base = "/" + args.base.strip("/") + "/" if args.base.strip("/") else "/"
    pages = {path: Page(path.read_text()) for path in root.rglob("*.html")}
    if root / "index.html" not in pages:
        parser.error(f"No built index.html in {root}")

    errors = []
    checked = 0
    for path, page in pages.items():
        relative = path.relative_to(root).as_posix()
        url = base + (relative[:-10] if relative.endswith("index.html") else relative[:-5])
        for link in page.links:
            target = urlsplit(urljoin(url, link))
            if target.scheme or target.netloc or not target.path.startswith(base):
                continue  # external URLs and the embedded app's / return link
            file = (root / unquote(target.path[len(base):])).resolve()
            if not file.is_relative_to(root):
                errors.append(f"{relative}: link escapes documentation directory: {link}")
                continue
            if file.is_dir():
                file /= "index.html"
            elif not file.exists() and not file.suffix:
                file = file.with_suffix(".html")
            if not file.is_file():
                errors.append(f"{relative}: missing target: {link}")
            elif target.fragment and file in pages and unquote(target.fragment) not in pages[file].ids:
                errors.append(f"{relative}: missing fragment: {link}")
            checked += 1

    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Checked {len(pages)} HTML pages and {checked} links/assets at {base}")


if __name__ == "__main__":
    main()

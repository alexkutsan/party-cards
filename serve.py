#!/usr/bin/env python3
"""Preview dist/ the way GitHub project Pages will: prefixed path and 404.html fallback."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
}


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, directory: Path, prefix: str, **kwargs):
        self.directory = directory
        self.prefix = prefix.rstrip("/")
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        self._serve(head=False)

    def do_HEAD(self) -> None:
        self._serve(head=True)

    def _serve(self, head: bool) -> None:
        path = unquote(urlparse(self.path).path)
        prefix = self.prefix
        if prefix:
            if path == "/":
                self.send_response(302)
                self.send_header("Location", prefix + "/")
                self.end_headers()
                return
            if path != prefix and not path.startswith(prefix + "/"):
                self.send_error(404, "outside site prefix")
                return
            rel = path[len(prefix):] or "/"
        else:
            rel = path or "/"
        if rel.endswith("/"):
            rel += "index.html"
        rel = rel.lstrip("/")
        target = (self.directory / rel).resolve()
        try:
            target.relative_to(self.directory.resolve())
        except ValueError:
            self.send_error(403)
            return
        status = 200
        if not target.is_file():
            ext = Path(rel).suffix.lower()
            # Only real assets 404. Card and combo routes have no file extension
            # (combo parts are joined with "~") and must fall through to the app shell.
            if ext in TYPES and ext != ".html":
                self.send_error(404)
                return
            target = self.directory / "404.html"
            status = 404
            if not target.is_file():
                self.send_error(404)
                return
        body = target.read_bytes()
        mime = TYPES.get(target.suffix, "application/octet-stream")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))


def main() -> None:
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/ is missing. Run: python3 build.py")
    base = (DIST / "base.txt").read_text(encoding="utf-8").strip() if (DIST / "base.txt").is_file() else "/party-cards/"
    parser = argparse.ArgumentParser(description="Serve dist/ with a GitHub Pages-like prefix")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    handler = partial(Handler, directory=DIST, prefix=base.rstrip("/") if base != "/" else "")
    server = ThreadingHTTPServer((args.host, args.port), handler)
    prefix = base if base != "/" else "/"
    print(f"Serving {DIST} at http://{args.host}:{args.port}{prefix}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

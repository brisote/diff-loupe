"""A local stand-in for diffloupe.com and the GitHub release, for the Linux update test.

Serves the files of one folder at /download/v99.0.0/, offers version 99.0.0 once at
/download/latest/linux/version and an older version afterwards, so an updated copy does not
update again. With --bad-checksum it serves a checksum that matches nothing.
"""

import argparse
import hashlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "99.0.0"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--port", type=int, default=4100)
    parser.add_argument("--bad-checksum", action="store_true")
    args = parser.parse_args()
    state = {"offered": False}

    class Handler(BaseHTTPRequestHandler):
        def body(self) -> bytes | None:
            if self.path == "/download/latest/linux/version":
                version = "0.0.1" if state["offered"] else VERSION
                state["offered"] = True
                return f"{version}\n".encode()
            prefix = f"/download/v{VERSION}/"
            if not self.path.startswith(prefix):
                return None
            name = self.path[len(prefix):]
            if name.endswith(".sha256"):
                package = args.folder / name.removesuffix(".sha256")
                if not package.is_file():
                    return None
                digest = "0" * 64 if args.bad_checksum else hashlib.sha256(package.read_bytes()).hexdigest()
                return f"{digest}  {package.name}\n".encode()
            package = args.folder / name
            return package.read_bytes() if package.is_file() and "/" not in name else None

        def reply(self, send_body: bool) -> None:
            body = self.body()
            if body is None:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if send_body:
                self.wfile.write(body)

        def do_GET(self) -> None:
            self.reply(True)

        def do_HEAD(self) -> None:
            self.reply(False)

        def log_message(self, *_: object) -> None:
            pass

    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())

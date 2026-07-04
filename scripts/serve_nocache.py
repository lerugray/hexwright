#!/usr/bin/env python3
"""Static file server with caching disabled.

python3 -m http.server sends no Cache-Control headers, so browsers cache the
editor's ES modules and a REGULAR refresh keeps running stale code — only a
hard refresh picked up changes (bit Ray 2026-07-04). Every launcher serves
through this instead: same behavior, plus no-store on every response.

Usage: python3 serve_nocache.py [port]   (serves the CURRENT directory)
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):  # quiet, like stdio=ignore launchers expect
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()

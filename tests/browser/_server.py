"""Shared test setup: a tiny static server (127.0.0.1:8323) that serves the card and the stub page.

Every test script starts with `from _server import *`. API calls go through `window.hassStub.callApi`
in page.html (driven by `window.scenario`), not through this server — it only serves static files.
"""
import http.server, threading, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARD = os.path.abspath(os.path.join(HERE, "..", "..", "mealie-card.js"))


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split("?")[0]
        return CARD if p == "/mealie-card.js" else os.path.join(HERE, p.lstrip("/") or "page.html")

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8323), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

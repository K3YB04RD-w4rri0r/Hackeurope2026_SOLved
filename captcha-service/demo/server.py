"""
Demo Website Server
===================
A simple HTTP server that serves the demo sign-up page on port 3000.
This simulates a *third-party website* that embeds the CAPTCHA widget
from the CAPTCHA service running on port 8000.

Run:  python demo/server.py
"""

import http.server
import os

PORT = 3000
DEMO_DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DEMO_DIR, **kwargs)


if __name__ == "__main__":
    print(f"\n  🌐 Demo website running at http://localhost:{PORT}")
    print(f"  📦 CAPTCHA service: set window.CAPTCHA_SERVICE_ORIGIN in the page")
    print(f"     if the CAPTCHA API runs on a different host/port.")
    print(f"  ⏹  Press Ctrl+C to stop\n")

    with http.server.HTTPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped.")

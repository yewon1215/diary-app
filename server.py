from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent


def load_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k:
            out[k] = v
    return out


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/config.js":
            env = {**load_dotenv(ROOT / ".env"), **os.environ}
            url = env.get("SUPABASE_URL", "").strip()
            anon = env.get("SUPABASE_ANON_KEY", "").strip()

            body = (
                "window.__APP_CONFIG__ = Object.freeze({\n"
                f"  SUPABASE_URL: {url!r},\n"
                f"  SUPABASE_ANON_KEY: {anon!r},\n"
                "});\n"
            )
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))
            return

        return super().do_GET()


def main() -> None:
    host = "127.0.0.1"
    port = int(os.environ.get("PORT", "5174"))
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()


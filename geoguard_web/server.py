"""Server sederhana untuk GeoGuard ID.

- Menyajikan file HTML/CSS/JavaScript tanpa dependency eksternal.
- Menyediakan proxy Telegram agar token bot tidak ditanam di browser.

Jalankan dengan: python server.py
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os

BASE_DIR = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))


class GeoGuardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def do_POST(self):
        if self.path != "/api/telegram":
            self.send_json(404, {"ok": False, "description": "Endpoint tidak ditemukan."})
            return

        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        if not token or not chat_id:
            self.send_json(503, {
                "ok": False,
                "description": "Konfigurasi Telegram belum dibuat. Atur TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID pada environment server."
            })
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 20000:
                self.send_json(400, {"ok": False, "description": "Ukuran pesan tidak valid."})
                return
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            message = str(body.get("message", "")).strip()
            if not message:
                self.send_json(400, {"ok": False, "description": "Pesan Telegram kosong."})
                return
            if len(message) > 4096:
                self.send_json(400, {"ok": False, "description": "Pesan melebihi batas 4096 karakter Telegram."})
                return

            payload = urlencode({"chat_id": chat_id, "text": message}).encode("utf-8")
            request = Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urlopen(request, timeout=12) as response:
                result = json.loads(response.read().decode("utf-8"))
            if result.get("ok"):
                self.send_json(200, {"ok": True, "description": "Pesan Telegram berhasil dikirim."})
            else:
                self.send_json(502, {
                    "ok": False,
                    "description": result.get("description", "Telegram menolak permintaan.")
                })
        except HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
                description = payload.get("description", "Telegram mengembalikan kesalahan.")
            except Exception:
                description = "Telegram mengembalikan kesalahan HTTP."
            self.send_json(502, {"ok": False, "description": description})
        except (URLError, TimeoutError):
            self.send_json(502, {"ok": False, "description": "Koneksi ke Telegram gagal atau timeout."})
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "description": "Format permintaan tidak valid."})
        except Exception:
            self.send_json(500, {"ok": False, "description": "Terjadi kesalahan internal pada server."})

    def send_json(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        # Jangan log token atau body pesan Telegram.
        super().log_message(fmt, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), GeoGuardHandler)
    print(f"GeoGuard ID berjalan di http://{HOST}:{PORT}")
    print("Hentikan server dengan Ctrl+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()

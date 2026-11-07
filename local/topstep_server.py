"""Local TopstepX workstation. Start with python local/topstep_server.py --no-browser.
Read-only. The existing research workspace remains available at /.
"""
from __future__ import annotations
import json
import os
import sys
import threading
import time
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import workspace_server as research
from topstep_core import ProjectXClient, TradeLedger, calculate_stats, GatewayError, iso_utc, utc_now
from trade_analytics import summarize as summarize_completed

ROOT = Path(__file__).resolve().parents[1]
DASH = ROOT / "topstep" / "index.html"
PORT = research.PORT
CLIENT = None
LEDGER = None
CACHE = {}
LOCK = threading.RLock()


def client():
    global CLIENT
    with LOCK:
        if CLIENT is None:
            name = os.getenv("TOPSTEPX_USERNAME", "").strip()
            key = os.getenv("TOPSTEPX_API_KEY", "")
            if not name or not key:
                raise GatewayError("Set TOPSTEPX_USERNAME and TOPSTEPX_API_KEY locally before connecting", 503)
            CLIENT = ProjectXClient(name, key)
        return CLIENT


def ledger():
    global LEDGER
    with LOCK:
        if LEDGER is None:
            LEDGER = TradeLedger()
        return LEDGER


def snapshot_account(account_id, days, force=False):
    cache_key = (account_id, days)
    with LOCK:
        item = CACHE.get(cache_key)
        if not force and item and time.monotonic() - item["at"] < 20:
            return item["data"]
        snap = client().snapshot(account_id, days)
        ledger().save(account_id, snap["legs"])
        all_legs = ledger().history(account_id, snap["since"])
        stats = calculate_stats(all_legs, snap["since"], snap["synced_at"])
        try:
            completed = summarize_completed(all_legs)
        except (ValueError, KeyError, TypeError, OverflowError):
            # Fail closed on inconsistent broker legs; never invent a completed trade.
            completed = {"status": "UNAVAILABLE", "error":
                         "Complete trades cannot be reconstructed from this broker history"}
        result = {"account": snap["account"], "stats": stats, "completed_trades": completed, "positions": snap["positions"],
                  "orders": snap["orders"], "synced_at": snap["synced_at"],
                  "record_count": len(all_legs), "historical_window_days": days,
                  "real_time": False, "order_execution_enabled": False}
        CACHE[cache_key] = {"data": result, "at": time.monotonic()}
        return result


class Handler(research.Handler):
    def _query(self):
        return parse_qs(urlsplit(self.path).query, keep_blank_values=False)

    def _get_int(self, name, choices=None):
        raw = self._query().get(name, [None])[0]
        if not raw or not raw.isascii() or not raw.isdigit():
            raise ValueError("Invalid " + name)
        val = int(raw)
        if val < 1 or val > 2_147_483_647 or (choices is not None and val not in choices):
            raise ValueError("Unsupported " + name)
        return val

    def do_GET(self):
        if not self._trusted_host():
            return self._reply(403, {"ok": False, "error": "Untrusted local Host"})
        path = urlsplit(self.path).path
        if path == "/topstep":
            if not DASH.is_file():
                return self._reply(404, {"ok": False, "error": "Dashboard missing"})
            raw = DASH.read_bytes()
            self.send_response(200)
            for key, value in (
                ("Content-Type", "text/html; charset=utf-8"),
                ("Content-Length", str(len(raw))), ("Cache-Control", "no-store"),
                ("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"),
                ("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"),
            ):
                self.send_header(key, value)
            self.end_headers()
            return self.wfile.write(raw)
        if path not in ("/topstep/api/health", "/topstep/api/accounts",
                        "/topstep/api/contracts", "/topstep/api/bars",
                        "/topstep/api/account"):
            return super().do_GET()
        # Session token is separate from credentials. Same-origin GET only.
        if self.headers.get("X-Trader-Token", "") != research.TOKEN:
            return self._reply(403, {"ok": False, "error": "Session token required"})
        try:
            if path == "/topstep/api/health":
                return self._reply(200, {"ok": True, "mode": "TOPSTEPX_READ_ONLY",
                    "configured": bool(os.getenv("TOPSTEPX_USERNAME") and os.getenv("TOPSTEPX_API_KEY")),
                    "clock_utc": iso_utc(utc_now()), "execution": False})
            if path == "/topstep/api/accounts":
                accounts = client().accounts()
                return self._reply(200, {"ok": True, "accounts": accounts, "synced_at": iso_utc(utc_now())})
            if path == "/topstep/api/contracts":
                symbol = self._query().get("symbol", ["MES"])[0]
                values = client().contracts(symbol)
                return self._reply(200, {"ok": True, "contracts": values})
            if path == "/topstep/api/bars":
                contract = self._query().get("contract", [""])[0]
                minutes = self._get_int("minutes", (1, 5, 15, 30, 60))
                return self._reply(200, {"ok": True, "bars": client().bars(contract, minutes),
                    "contract": contract, "minutes": minutes,
                    "synced_at": iso_utc(utc_now()), "transport": "REST_POLL"})
            if path == "/topstep/api/account":
                account_id = self._get_int("id")
                days = self._get_int("days", (7, 30, 90, 365))
                return self._reply(200, {"ok": True, **snapshot_account(account_id, days)})
        except ValueError as exc:
            return self._reply(422, {"ok": False, "error": str(exc)})
        except GatewayError as exc:
            return self._reply(exc.status, {"ok": False, "error": str(exc)})
        except (OSError, TypeError, KeyError, json.JSONDecodeError):
            return self._reply(502, {"ok": False, "error": "Broker data invalid or unavailable"})

    def do_POST(self):
        if urlsplit(self.path).path.startswith("/topstep"):
            return self._reply(405, {"ok": False, "error": "Read-only: no Topstep write endpoints"})
        return super().do_POST()


def main():
    server = ThreadingHTTPServer((research.HOST, PORT), Handler)
    url = "http://127.0.0.1:" + str(PORT) + "/topstep"
    print("TopstepX read-only workstation: " + url)
    print("Broker API key stays in local process memory, never browser or repository.")
    print("No order endpoints available. Ctrl+C stops server.")
    if "--no-browser" not in sys.argv:
        threading.Timer(.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=.4)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

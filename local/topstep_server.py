"""Local TopstepX workstation. Start with python local/topstep_server.py --no-browser.
Read-only. The existing research workspace remains available at /.
"""
from __future__ import annotations
import json
import secrets
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
from realtime_bridge import LiveBridge, valid_contract
from demo_broker import DemoBroker, DemoBridge
from structure_context import analyze as analyze_structure

ROOT = Path(__file__).resolve().parents[1]
DASH = ROOT / "topstep" / "index.html"
PORT = research.PORT
CLIENT = None
LEDGER = None
DEMO_MODE = os.getenv("TRADER_DEMO", "") == "1"
CACHE = {}
FULL_SYNC = {}
DIRTY = set()
BRIDGE = None
LOCK = threading.RLock()


def client():
    global CLIENT
    with LOCK:
        if CLIENT is None and DEMO_MODE:
            CLIENT = DemoBroker()
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
            if DEMO_MODE:
                # Hard separation: demo data never writes to live trade ledger.
                from topstep_core import DATA_DIR
                LEDGER = TradeLedger(DATA_DIR / "demo-fixture-ledger.sqlite3")
            else:
                LEDGER = TradeLedger()
        return LEDGER


def mark_live_dirty():
    with LOCK:
        if BRIDGE and BRIDGE.selected_account is not None:
            DIRTY.add(BRIDGE.selected_account)


def bridge():
    global BRIDGE
    with LOCK:
        if BRIDGE is None and DEMO_MODE:
            BRIDGE = DemoBridge()
        if BRIDGE is None:
            def ingest_trade(trade):
                # Corrections and voided legs replace their existing broker trade ID.
                ledger().save(trade["accountId"], [trade])
            BRIDGE = LiveBridge(client().bearer_token, on_trade=ingest_trade,
                                on_user_change=mark_live_dirty)
        return BRIDGE


def snapshot_account(account_id, days, force=False):
    cache_key = (account_id, days)
    with LOCK:
        item = CACHE.get(cache_key)
        if not force and item and time.monotonic() - item["at"] < 20 and account_id not in DIRTY:
            return item["data"]
        # Complete backfill once per range, then reconcile a small rolling window.
        # Deep corrections are captured on the next periodic full backfill.
        full = (cache_key not in FULL_SYNC or
                time.monotonic() - FULL_SYNC[cache_key] >= 6 * 3600)
        snap = client().snapshot(account_id, days,
                                 reconcile_days=None if full else 2)
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
                  "real_time": False, "order_execution_enabled": False,
                  "synthetic": DEMO_MODE, "source": "SYNTHETIC_OFFLINE_FIXTURE" if DEMO_MODE else "TOPSTEPX_BROKER_REST"}
        CACHE[cache_key] = {"data": result, "at": time.monotonic()}
        if full:
            FULL_SYNC[cache_key] = time.monotonic()
        DIRTY.discard(account_id)
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
                        "/topstep/api/account", "/topstep/api/live"):
            return super().do_GET()
        # Session token is separate from credentials. Same-origin GET only.
        if self.headers.get("X-Trader-Token", "") != research.TOKEN:
            return self._reply(403, {"ok": False, "error": "Session token required"})
        try:
            if path == "/topstep/api/health":
                return self._reply(200, {"ok": True, "mode": "DEMO_SYNTHETIC_NO_NETWORK" if DEMO_MODE else "TOPSTEPX_READ_ONLY",
                    "configured": DEMO_MODE or bool(os.getenv("TOPSTEPX_USERNAME") and os.getenv("TOPSTEPX_API_KEY")),
                    "synthetic": DEMO_MODE,
                    "clock_utc": iso_utc(utc_now()), "execution": False})
            if path == "/topstep/api/live":
                snapshot = BRIDGE.snapshot() if BRIDGE is not None else {
                    "mode": "NOT_STARTED", "selected_account": None,
                    "selected_contract": None, "quote": None,
                    "quote_fresh": False, "hubs": {
                        "market": {"connected": False}, "user": {"connected": False}},
                    "execution": False}
                return self._reply(200, {"ok": True, **snapshot})
            if path == "/topstep/api/accounts":
                accounts = client().accounts()
                return self._reply(200, {"ok": True, "accounts": accounts,
                    "synthetic": DEMO_MODE, "synced_at": iso_utc(utc_now())})
            if path == "/topstep/api/contracts":
                symbol = self._query().get("symbol", ["MES"])[0]
                values = client().contracts(symbol)
                return self._reply(200, {"ok": True, "contracts": values,
                    "synthetic": DEMO_MODE})
            if path == "/topstep/api/bars":
                contract = self._query().get("contract", [""])[0]
                minutes = self._get_int("minutes", (1, 5, 15, 30, 60))
                bars = client().bars(contract, minutes)
                observation = analyze_structure(bars, minutes)
                return self._reply(200, {"ok": True, "bars": bars,
                    "synthetic": DEMO_MODE, "context": observation,
                    "contract": contract, "minutes": minutes,
                    "synced_at": iso_utc(utc_now()),
                    "transport": "OFFLINE_SYNTHETIC" if DEMO_MODE else "REST_POLL"})
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
        if urlsplit(self.path).path != "/topstep/api/live/subscribe":
            if urlsplit(self.path).path.startswith("/topstep"):
                return self._reply(405, {"ok": False, "error": "No broker order endpoints"})
            return super().do_POST()
        if not self._trusted_host():
            return self._reply(403, {"ok": False, "error": "Untrusted local Host"})
        if self.headers.get("Origin") not in (f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"):
            return self._reply(403, {"ok": False, "error": "Cross-origin access denied"})
        if not secrets.compare_digest(self.headers.get("X-Trader-Token", ""), research.TOKEN):
            return self._reply(403, {"ok": False, "error": "Invalid session token"})
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self._reply(415, {"ok": False, "error": "Expected JSON"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 2 <= size <= 500:
                return self._reply(413, {"ok": False, "error": "Invalid request size"})
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict) or set(body) != {"account_id", "contract_id"}:
                raise ValueError("Invalid subscription selection")
            acc, con = body["account_id"], body["contract_id"]
            if type(acc) is not int or not valid_contract(con):
                raise ValueError("Invalid account or contract")
            if not any(a["id"] == acc for a in client().accounts()):
                return self._reply(403, {"ok": False, "error": "Account unavailable"})
            bridge().select(acc, con)
            return self._reply(200, {"ok": True, "subscribed": True,
                                     "execution": False})
        except (ValueError, json.JSONDecodeError):
            return self._reply(422, {"ok": False, "error": "Invalid subscription request"})
        except GatewayError as exc:
            return self._reply(exc.status, {"ok": False, "error": str(exc)})
        except (OSError, KeyError, TypeError):
            return self._reply(502, {"ok": False, "error": "Unable to start read-only stream"})


def main():
    server = ThreadingHTTPServer((research.HOST, PORT), Handler)
    url = "http://127.0.0.1:" + str(PORT) + "/topstep"
    print("TopstepX read-only workstation: " + url)
    if DEMO_MODE:
        print("OFFLINE SYNTHETIC DEMO — not a broker connection; no real market data or account history")
    print("Broker API key stays in local process memory, never browser or repository.")
    print("No order endpoints available. Ctrl+C stops server.")
    if "--no-browser" not in sys.argv:
        threading.Timer(.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=.4)
    except KeyboardInterrupt:
        pass
    finally:
        if BRIDGE is not None:
            BRIDGE.close()
        server.server_close()


if __name__ == "__main__":
    main()

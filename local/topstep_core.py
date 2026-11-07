"""Strictly read-only TopstepX / ProjectX adapter and correction-aware trade ledger.

No order endpoints exist in this module. Credentials are memory-only.
Official endpoints: https://gateway.docs.projectx.com/
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API_BASE = "https://api.topstepx.com"
ALLOWED_PATHS = frozenset({
    "/api/Auth/loginKey", "/api/Account/search", "/api/Trade/search",
    "/api/Order/searchOpen", "/api/Position/searchOpen",
    "/api/Contract/search", "/api/History/retrieveBars",
})
CHICAGO = ZoneInfo("America/Chicago")
DATA_DIR = Path(os.getenv("TRADER_DATA_DIR") or
                (Path(os.getenv("LOCALAPPDATA", str(Path.home()))) / "TraderDash"))
DB_PATH = DATA_DIR / "topstep-ledger.sqlite3"


class GatewayError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def utc_now():
    return datetime.now(timezone.utc)


def iso_utc(value: datetime):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Invalid broker timestamp")
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError("Broker timestamp has no timezone")
    return d.astimezone(timezone.utc)


def trading_day(value):
    """Trading session rolls at 17:00 America/Chicago; DST safe."""
    dt = parse_timestamp(value).astimezone(CHICAGO)
    return (dt + timedelta(days=1) if dt.hour >= 17 else dt).date().isoformat()


def _finite(value, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Broker returned a nonnumeric price/P&L")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Broker returned nonfinite price/P&L")
    return number


class ProjectXClient:
    """REST allowlist, token reuse, bounded responses; no generic endpoint proxy."""
    def __init__(self, username: str, api_key: str, opener=None):
        if not isinstance(username, str) or not 1 <= len(username.strip()) <= 160:
            raise ValueError("TopstepX username is required")
        if not isinstance(api_key, str) or not 12 <= len(api_key) <= 500:
            raise ValueError("TopstepX API key appears invalid")
        self._username = username.strip()
        self._key = api_key.strip()
        self._token = None
        self._token_issued = 0.0
        self._opener = opener or urllib.request.urlopen
        self._lock = threading.RLock()

    def _post(self, path, data, bearer=None):
        if path not in ALLOWED_PATHS:
            raise ValueError("Endpoint not permitted in read-only Topstep edition")
        raw = json.dumps(data, allow_nan=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if bearer:
            headers["Authorization"] = "Bearer " + bearer
        request = urllib.request.Request(API_BASE + path, data=raw,
                                         headers=headers, method="POST")
        try:
            with self._opener(request, timeout=12) as response:
                buf = response.read(4_000_001)
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise GatewayError("Topstep session expired or access denied", 401) from None
            if exc.code == 429:
                raise GatewayError("Topstep rate limit reached; refresh later", 429) from None
            raise GatewayError("Topstep gateway HTTP " + str(exc.code), 502) from None
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise GatewayError("Topstep gateway unavailable", 503) from None
        if len(buf) > 4_000_000:
            raise GatewayError("Topstep response exceeded safety size limit")
        try:
            result = json.loads(buf)
        except (UnicodeError, json.JSONDecodeError):
            raise GatewayError("Topstep returned invalid JSON") from None
        if not isinstance(result, dict) or result.get("success") is not True:
            code = result.get("errorCode") if isinstance(result, dict) else None
            message = result.get("errorMessage") if isinstance(result, dict) else ""
            # Never include arbitrary broker text or credentials in a client error.
            raise GatewayError("Topstep rejected request (code " + str(code)[:8] + ")", 401 if code in (3, 9) else 502)
        return result

    def login(self):
        with self._lock:
            response = self._post("/api/Auth/loginKey",
                                  {"userName": self._username, "apiKey": self._key})
            token = response.get("token")
            if not isinstance(token, str) or len(token) < 10:
                raise GatewayError("Topstep did not issue a valid token", 401)
            self._token = token
            self._token_issued = time.monotonic()
            return True

    def request(self, path, data):
        if path in ("/api/Auth/loginKey",) or path not in ALLOWED_PATHS:
            raise ValueError("Unsupported read-only request")
        with self._lock:
            if self._token is None or time.monotonic() - self._token_issued > 23 * 3600:
                self.login()
            try:
                return self._post(path, data, self._token)
            except GatewayError as exc:
                if exc.status != 401:
                    raise
                self.login()
                return self._post(path, data, self._token)

    def accounts(self):
        result = self.request("/api/Account/search", {"onlyActiveAccounts": True})
        accounts = result.get("accounts")
        if not isinstance(accounts, list):
            raise GatewayError("Topstep accounts response malformed")
        return [a for a in accounts if isinstance(a, dict) and
                type(a.get("id")) is int and a["id"] > 0]

    def contracts(self, query):
        if not isinstance(query, str) or not (1 <= len(query) <= 16) or not query.isalnum():
            raise ValueError("Enter a simple futures symbol")
        result = self.request("/api/Contract/search",
                              {"searchText": query.upper(), "live": False})
        values = result.get("contracts")
        if not isinstance(values, list):
            raise GatewayError("Topstep contracts response malformed")
        return [x for x in values if isinstance(x, dict) and isinstance(x.get("id"), str)][:20]

    def bars(self, contract, minutes=5, limit=220):
        if not isinstance(contract, str) or not contract.startswith("CON.F.") or len(contract) > 90 or not all(c.isalnum() or c == "." for c in contract):
            raise ValueError("Invalid contract ID")
        if type(minutes) is not int or minutes not in (1, 5, 15, 30, 60):
            raise ValueError("Unsupported bar interval")
        if type(limit) is not int or not 50 <= limit <= 750:
            raise ValueError("Bar count must be 50–750")
        end = utc_now()
        start = end - timedelta(minutes=minutes * (limit * 4 + 100))
        payload = {"contractId": contract, "live": False,
                   "startTime": iso_utc(start), "endTime": iso_utc(end),
                   "unit": 2 if minutes < 60 else 3,
                   "unitNumber": minutes if minutes < 60 else 1,
                   "limit": limit, "includePartialBar": True}
        result = self.request("/api/History/retrieveBars", payload)
        values = result.get("bars")
        if not isinstance(values, list):
            raise GatewayError("Topstep bars response malformed")
        out = []
        for b in values:
            if not isinstance(b, dict):
                raise GatewayError("Unexpected candle type")
            t = parse_timestamp(b.get("t"))
            o, h, l, c = [_finite(b.get(k)) for k in ("o", "h", "l", "c")]
            if l <= 0 or h < max(o, l, c) or l > min(o, h, c):
                raise GatewayError("Broker OHLC validation failed")
            out.append({"time": int(t.timestamp() * 1000), "open": o, "high": h,
                        "low": l, "close": c, "volume": b.get("v")})
        out.sort(key=lambda x: x["time"])
        return list({x["time"]: x for x in out}.values())

    def snapshot(self, account_id, days=30):
        if type(account_id) is not int or account_id <= 0:
            raise ValueError("Select an actual account")
        if type(days) is not int or days not in (7, 30, 90, 365):
            raise ValueError("Unsupported history range")
        account = next((x for x in self.accounts() if x["id"] == account_id), None)
        if account is None:
            raise ValueError("Account not active or inaccessible")
        since = iso_utc(utc_now() - timedelta(days=days))
        legs = self.request("/api/Trade/search",
                            {"accountId": account_id, "startTimestamp": since}).get("trades")
        orders = self.request("/api/Order/searchOpen", {"accountId": account_id}).get("orders")
        positions = self.request("/api/Position/searchOpen", {"accountId": account_id}).get("positions")
        if not all(isinstance(x, list) for x in (legs, orders, positions)):
            raise GatewayError("Incomplete broker snapshot; no data was committed")
        return {"account": account, "legs": legs, "orders": orders,
                "positions": positions, "since": since, "synced_at": iso_utc(utc_now())}


class TradeLedger:
    def __init__(self, path=DB_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS legs (
                account_id INTEGER NOT NULL, trade_id INTEGER NOT NULL,
                stamp TEXT NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(account_id, trade_id))""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_leg_time ON legs(account_id, stamp)")

    def _connection(self):
        return sqlite3.connect(str(self.path), timeout=8)

    def save(self, account_id, legs):
        clean = []
        for leg in legs:
            if not isinstance(leg, dict) or type(leg.get("id")) is not int or leg.get("accountId") != account_id:
                raise ValueError("Broker trade ID/account mismatch")
            stamp = iso_utc(parse_timestamp(leg.get("creationTimestamp")))
            _finite(leg.get("price"))
            _finite(leg.get("profitAndLoss"), nullable=True)
            _finite(leg.get("fees"), nullable=True)
            _finite(leg.get("commissions"), nullable=True)
            if type(leg.get("voided", False)) is not bool:
                raise ValueError("Invalid voided flag")
            clean.append((account_id, leg["id"], stamp, json.dumps(leg, allow_nan=False)))
        with self.lock, self._connection() as db:
            db.executemany("""INSERT INTO legs(account_id, trade_id, stamp, payload)
                VALUES(?,?,?,?) ON CONFLICT(account_id,trade_id)
                DO UPDATE SET stamp=excluded.stamp, payload=excluded.payload""", clean)
        return len(clean)

    def history(self, account_id, since):
        with self.lock, self._connection() as db:
            rows = db.execute("SELECT payload FROM legs WHERE account_id=? AND stamp >= ? ORDER BY stamp,trade_id",
                              (account_id, since)).fetchall()
        return [json.loads(row[0]) for row in rows]


def calculate_stats(legs, since, synced_at):
    """Descriptive leg accounting; never calls these records round-trip trades."""
    active = [x for x in legs if not x.get("voided")]
    gross = sum(_finite(x.get("profitAndLoss"), nullable=True) or 0.0 for x in active)
    fees = sum(_finite(x.get("fees"), nullable=True) or 0.0 for x in active)
    commissions = sum(_finite(x.get("commissions"), nullable=True) or 0.0 for x in active)
    closed = [x for x in active if x.get("profitAndLoss") is not None]
    buckets = {}
    for x in active:
        day = trading_day(x["creationTimestamp"])
        b = buckets.setdefault(day, {"session": day, "gross": 0.0, "fees": 0.0,
                                     "commissions": 0.0, "closed_legs": 0})
        b["gross"] += _finite(x.get("profitAndLoss"), nullable=True) or 0.0
        b["fees"] += _finite(x.get("fees"), nullable=True) or 0.0
        b["commissions"] += _finite(x.get("commissions"), nullable=True) or 0.0
        b["closed_legs"] += int(x.get("profitAndLoss") is not None)
    daily = [dict(b, net=round(b["gross"] - b["fees"] - b["commissions"], 2))
             for _, b in sorted(buckets.items())]
    running = peak = drawdown = 0.0
    for day in daily:
        running += day["net"]
        peak = max(peak, running)
        drawdown = max(drawdown, peak - running)
        day["cumulative_net"] = round(running, 2)
    return {
        "source": "TOPSTEPX_BROKER_REST", "accounting": "execution legs, not completed round trips",
        "since_utc": since, "synced_at_utc": synced_at,
        "active_legs": len(active), "voided_legs": len(legs) - len(active),
        "closed_legs": len(closed),
        "closing_leg_gross_win_rate": (sum(_finite(x["profitAndLoss"]) > 0 for x in closed) / len(closed)) if closed else None,
        "gross_realized_usd": round(gross, 2),
        "fees_usd": round(fees, 2), "commissions_usd": round(commissions, 2),
        "net_realized_usd": round(gross - fees - commissions, 2),
        "session_close_drawdown_usd": round(drawdown, 2), "daily": daily,
        "warning": "Opening-leg fees are included. Closing-leg win rate is not a round-trip win rate. Intraday drawdown and Topstep MLL cannot be inferred from these fills."
    }

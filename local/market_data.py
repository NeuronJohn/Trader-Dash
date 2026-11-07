"""Read-only, practice-only OANDA FX candle ingestion and local SQLite receipts.

No broker order/position/trade endpoint is implemented. No background polling.
The practice token is a trade-capable secret: it stays in server environment and
is NEVER serialized into a response, database or log.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from typing import Any
import urllib.error
import urllib.parse
import urllib.request
import uuid

SOURCE = "oanda-fxpractice"
BASE_URL = "https://api-fxpractice.oanda.com"
ALLOWED_SYMBOLS = ("EUR_USD", "GBP_USD", "USD_JPY")
BAR_MS = 300_000
MAX_FETCH = 1000
MAX_OUTPUT = 16000
MAX_BYTES = 2_500_000
LOCK = threading.Lock()
SCHEMA_VERSION = 1
PROVENANCE = "OANDA_PRACTICE_API_UNVERIFIED_EXECUTION"

class MarketError(ValueError):
    pass

def storage_path() -> Path:
    configured = os.environ.get("TRADER_MARKET_DB")
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        base = Path(os.environ["LOCALAPPDATA"])
    else:
        base = Path.home() / ".local" / "share"
    return base / "TraderResearch" / "market_receipts.sqlite3"

def now_ms() -> int:
    return int(time.time() * 1000)

def parse_utc_time(s: Any) -> int:
    if not isinstance(s, str) or not re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)", s
    ):
        raise MarketError("Provider candle requires timezone-explicit UTC datetime")
    try:
        instant = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as exc:
        raise MarketError("Invalid provider UTC timestamp") from exc
    ms = int(instant.timestamp() * 1000)
    if ms <= 0 or ms % BAR_MS != 0:
        raise MarketError("Provider M5 candle is not aligned to a 5-minute UTC start")
    return ms

def parse_price(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise MarketError("Bad provider price type")
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise MarketError("Non-numeric provider price") from exc
    if not math.isfinite(result) or result <= 0:
        raise MarketError("Non-positive/nonfinite provider candle")
    return result

def parse_ohlc(data: Any) -> dict:
    if not isinstance(data, dict):
        raise MarketError("Missing OHLC component")
    b = {k: parse_price(data.get(q)) for k, q in
         (("open", "o"), ("high", "h"), ("low", "l"), ("close", "c"))}
    if b["high"] < max(b["open"], b["low"], b["close"]) or (
        b["low"] > min(b["open"], b["high"], b["close"])
    ):
        raise MarketError("Inconsistent provider OHLC")
    return b

def normalize_response(response: Any, symbol: str, received_ms: int) -> list[dict]:
    if not isinstance(response, dict) or (
        response.get("instrument") != symbol or response.get("granularity") != "M5"
    ):
        raise MarketError("Unexpected instrument or granularity from provider")
    candles = response.get("candles")
    if not isinstance(candles, list) or len(candles) > MAX_FETCH:
        raise MarketError("Malformed or oversized candle list")
    seen: set[int] = set()
    out = []
    for entry in candles:
        if not isinstance(entry, dict) or type(entry.get("complete")) is not bool:
            raise MarketError("Missing provider completion flag")
        if not entry["complete"]:
            continue  # Incomplete last candle must never enter the observation store.
        stamp = parse_utc_time(entry.get("time"))
        if stamp in seen:
            raise MarketError("Provider returned duplicate candle timestamps")
        if stamp + BAR_MS > received_ms + 2000:
            raise MarketError("Completed candle appears to end in the future")
        mid = parse_ohlc(entry.get("mid"))
        bid = parse_ohlc(entry.get("bid"))
        ask = parse_ohlc(entry.get("ask"))
        if any(bid[k] > ask[k] + 1e-8 for k in ("open", "close")):
            raise MarketError("Bid exceeds ask in provider candle")
        seen.add(stamp)
        out.append({
            "time": stamp, **mid,
            "bidOpen": bid["open"], "bidHigh": bid["high"],
            "bidLow": bid["low"], "bidClose": bid["close"],
            "askOpen": ask["open"], "askHigh": ask["high"],
            "askLow": ask["low"], "askClose": ask["close"],
            "volume": entry.get("volume") if type(entry.get("volume")) is int else None,
        })
    out.sort(key=lambda x: x["time"])
    return out

def canonical_hash(row: dict) -> str:
    immutable = {k: row[k] for k in (
        "time", "open", "high", "low", "close",
        "bidOpen", "bidHigh", "bidLow", "bidClose",
        "askOpen", "askHigh", "askLow", "askClose")}
    return hashlib.sha256(
        json.dumps(immutable, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    ).hexdigest()

def canonical_legacy_hash(row: dict) -> str:
    """The v0.6 first-seen base fields: preserve their exact old SHA-256."""
    old = {k: row[k] for k in (
        "time", "open", "high", "low", "close",
        "bidOpen", "bidClose", "askOpen", "askClose"
    )}
    return hashlib.sha256(
        json.dumps(old, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    ).hexdigest()

EXTRA_KEYS = ("bidHigh", "bidLow", "askHigh", "askLow")

def component_hash(components: dict) -> str:
    return hashlib.sha256(json.dumps(
        components, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")).hexdigest()

def open_store(path: Path | None = None) -> sqlite3.Connection:
    location = path or storage_path()
    location.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(location), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=10000")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript("""
      CREATE TABLE IF NOT EXISTS receipts (
        receipt_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        symbol TEXT NOT NULL,
        granularity TEXT NOT NULL,
        received_utc_ms INTEGER NOT NULL,
        provider_http_date TEXT,
        provider_request_id TEXT,
        response_sha256 TEXT NOT NULL,
        returned_complete INTEGER NOT NULL,
        inserted INTEGER NOT NULL,
        repeated INTEGER NOT NULL,
        conflicted INTEGER NOT NULL,
        augmented INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS bars (
        source TEXT NOT NULL,
        symbol TEXT NOT NULL,
        granularity TEXT NOT NULL,
        candle_start_ms INTEGER NOT NULL,
        row_json TEXT NOT NULL,
        row_sha256 TEXT NOT NULL,
        first_receipt_id TEXT NOT NULL,
        first_seen_ms INTEGER NOT NULL,
        PRIMARY KEY (source, symbol, granularity, candle_start_ms),
        FOREIGN KEY (first_receipt_id) REFERENCES receipts(receipt_id)
      );
      CREATE TABLE IF NOT EXISTS component_extensions (
        source TEXT NOT NULL,
        symbol TEXT NOT NULL,
        granularity TEXT NOT NULL,
        candle_start_ms INTEGER NOT NULL,
        extra_json TEXT NOT NULL,
        extra_sha256 TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        received_utc_ms INTEGER NOT NULL,
        PRIMARY KEY(source,symbol,granularity,candle_start_ms),
        FOREIGN KEY(receipt_id) REFERENCES receipts(receipt_id)
      );
      CREATE TABLE IF NOT EXISTS revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        candle_start_ms INTEGER NOT NULL,
        observed_sha256 TEXT NOT NULL,
        incoming_sha256 TEXT NOT NULL,
        FOREIGN KEY (receipt_id) REFERENCES receipts(receipt_id)
      );
      CREATE INDEX IF NOT EXISTS receipts_by_time ON receipts(received_utc_ms);
      CREATE INDEX IF NOT EXISTS revisions_by_candle ON revisions(symbol, candle_start_ms);
    """)
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(receipts)")}
    if "augmented" not in columns:
        connection.execute("ALTER TABLE receipts ADD COLUMN augmented INTEGER NOT NULL DEFAULT 0")
    return connection

def ingest(
    connection: sqlite3.Connection,
    *, symbol: str, candles: list[dict], received_ms: int,
    provider_http_date: str = "", provider_request_id: str = "",
    raw_sha256: str = ""
) -> dict:
    if symbol not in ALLOWED_SYMBOLS:
        raise MarketError("Instrument is not on the fixed practice allowlist")
    if not isinstance(received_ms, int) or received_ms <= 0:
        raise MarketError("Invalid receipt clock")
    if len(candles) > MAX_FETCH:
        raise MarketError("Too many candles")
    receipt_id = uuid.uuid4().hex
    raw_sha256 = raw_sha256 or hashlib.sha256(
        json.dumps(candles, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    inserted, repeated, conflicted, augmented = 0, 0, 0, 0
    with connection:
        connection.execute("""
          INSERT INTO receipts (
            receipt_id, source, symbol, granularity, received_utc_ms,
            provider_http_date, provider_request_id, response_sha256,
            returned_complete, inserted, repeated, conflicted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
        """, (receipt_id, SOURCE, symbol, "M5", received_ms,
              provider_http_date[:90], provider_request_id[:140],
              raw_sha256, len(candles)))
        for row in candles:
            timestamp = row["time"]
            if timestamp + BAR_MS > received_ms + 2000:
                raise MarketError("A candle ended after receipt; refusing future data")
            incoming = canonical_hash(row)
            present = connection.execute("""
               SELECT row_sha256,row_json FROM bars WHERE source=? AND symbol=? AND
                 granularity=? AND candle_start_ms=?
            """, (SOURCE, symbol, "M5", timestamp)).fetchone()
            if present:
                if present["row_sha256"] == incoming:
                    repeated += 1
                    continue
                prior = json.loads(present["row_json"])
                same_legacy_base = (
                    not any(key in prior for key in EXTRA_KEYS) and
                    canonical_legacy_hash(prior) == canonical_legacy_hash(row)
                )
                if same_legacy_base:
                    extras = {k: row[k] for k in EXTRA_KEYS}
                    extras_hash = component_hash(extras)
                    before = connection.execute("""
                      SELECT extra_sha256 FROM component_extensions
                      WHERE source=? AND symbol=? AND granularity=? AND candle_start_ms=?
                    """, (SOURCE,symbol,"M5",timestamp)).fetchone()
                    if before is None:
                        connection.execute("""
                          INSERT INTO component_extensions(
                            source,symbol,granularity,candle_start_ms,extra_json,
                            extra_sha256,receipt_id,received_utc_ms
                          ) VALUES(?,?,?,?,?,?,?,?)
                        """, (SOURCE,symbol,"M5",timestamp,
                              json.dumps(extras,sort_keys=True,separators=(",",":")),
                              extras_hash,receipt_id,received_ms))
                        augmented += 1
                        continue
                    if before["extra_sha256"] == extras_hash:
                        repeated += 1
                        continue
                # Genuine price revision, or later revision to an already
                # observed extension: keep both first-seen components intact.
                conflicted += 1
                connection.execute("""
                   INSERT INTO revisions (
                     receipt_id,symbol,candle_start_ms,observed_sha256,incoming_sha256
                   ) VALUES(?,?,?,?,?)
                """, (receipt_id,symbol,timestamp,
                      present["row_sha256"],incoming))
                continue
            connection.execute("""
              INSERT INTO bars (
                source,symbol,granularity,candle_start_ms,row_json,
                row_sha256,first_receipt_id,first_seen_ms
              ) VALUES(?,?,?,?,?,?,?,?)
            """, (SOURCE,symbol,"M5",timestamp,
                  json.dumps(row,sort_keys=True,separators=(",",":"),allow_nan=False),
                  incoming,receipt_id,received_ms))
            inserted += 1
        connection.execute(
            "UPDATE receipts SET inserted=?,repeated=?,conflicted=?,augmented=? WHERE receipt_id=?",
            (inserted,repeated,conflicted,augmented,receipt_id))
    return {
        "receipt_id":receipt_id,"source":SOURCE,"symbol":symbol,"granularity":"M5",
        "received_utc_ms":received_ms,
        "added":inserted,"repeated":repeated,"conflicts":conflicted,"augmented":augmented,
        "complete_candles":len(candles),"verified_broker_fills":0,
        "source_status":PROVENANCE,
    }

def read_bars(connection: sqlite3.Connection, symbol: str, limit: int = 500) -> dict:
    if symbol not in ALLOWED_SYMBOLS:
        raise MarketError("Invalid requested FX symbol")
    if not isinstance(limit,int) or not 1 <= limit <= MAX_OUTPUT:
        raise MarketError("Invalid output limit")
    rows = connection.execute("""
      SELECT b.row_json,b.first_seen_ms,b.first_receipt_id,
             x.extra_json,x.receipt_id AS component_receipt_id,
             x.received_utc_ms AS component_received_ms
      FROM bars AS b LEFT JOIN component_extensions AS x
        ON b.source=x.source AND b.symbol=x.symbol AND
           b.granularity=x.granularity AND b.candle_start_ms=x.candle_start_ms
      WHERE b.source=? AND b.symbol=? AND b.granularity=?
      ORDER BY b.candle_start_ms DESC LIMIT ?
    """,(SOURCE,symbol,"M5",limit)).fetchall()
    bars=[]
    for row in reversed(rows):
        bar=json.loads(row["row_json"])
        bar["receivedAt"]=row["first_seen_ms"]
        bar["receiptId"]=row["first_receipt_id"]
        if row["extra_json"]:
            bar.update(json.loads(row["extra_json"]))
        bar["componentReceiptId"]=(row["component_receipt_id"] or
                                   row["first_receipt_id"])
        bar["componentReceivedAt"]=(row["component_received_ms"] or
                                    row["first_seen_ms"])
        bars.append(bar)
    conflicts=connection.execute(
        "SELECT COUNT(*) AS n FROM revisions WHERE symbol=?",(symbol,)
    ).fetchone()["n"]
    last=connection.execute("""
      SELECT received_utc_ms,receipt_id FROM receipts WHERE source=? AND symbol=?
      ORDER BY received_utc_ms DESC LIMIT 1
    """,(SOURCE,symbol)).fetchone()
    return {
      "symbol":symbol,"source":SOURCE,"granularity":"M5",
      "price_component":"M (midpoint), complete bid/ask OHLC retained",
      "component_quality":"FULL_MID_BID_ASK_OHLC_OR_RECEIPT_LINKED_LEGACY_AUGMENTATION",
      "provenance":PROVENANCE,
      "timestamp_convention":"UTC 5-minute BAR START",
      "authenticated_practice_api":True,
      "exchange_verified":False,"broker_fills_verified":False,
      "conflicts":conflicts,
      "last_received_utc_ms":last["received_utc_ms"] if last else None,
      "last_receipt_id":last["receipt_id"] if last else None,
      "bars":bars,
    }

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise MarketError("OANDA endpoint redirected; credentials were not forwarded")

def fetch_practice_candles(symbol: str, count: int, token: str, before_ms: int | None = None) -> tuple[dict,str,str,str]:
    if symbol not in ALLOWED_SYMBOLS or type(count) is not int or not 10 <= count <= MAX_FETCH:
        raise MarketError("Only allowed FX pairs and 10–1000 candles are permitted")
    if (not isinstance(token,str) or not token or len(token)>4096 or
            any(ord(ch)<33 or ord(ch)>126 for ch in token)):
        raise MarketError("Set a valid OANDA_PRACTICE_TOKEN in the local server environment")
    request_params={
        "granularity":"M5","price":"MBA","count":count,"smooth":"false"
    }
    if before_ms is not None:
        if (type(before_ms) is not int or before_ms<=0 or
                before_ms>now_ms()+BAR_MS):
            raise MarketError("Invalid UTC historical backfill cutoff")
        # Provider time bounds are explicit. Never follow provider pagination
        # links or send credentials anywhere except the fixed practice host.
        request_params["to"]=dt.datetime.fromtimestamp(
            before_ms/1000,tz=dt.timezone.utc
        ).isoformat().replace("+00:00","Z")
    params=urllib.parse.urlencode(request_params)
    url=f"{BASE_URL}/v3/instruments/{symbol}/candles?{params}"
    request=urllib.request.Request(url,method="GET",headers={
        "Authorization":"Bearer "+token,
        "Accept":"application/json",
        "Accept-Datetime-Format":"RFC3339",
        "User-Agent":"TraderResearchReadOnly/0.6"
    })
    opener=urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request,timeout=18) as response:
            if response.geturl().split("?")[0] != url.split("?")[0]:
                raise MarketError("Unexpected candle endpoint")
            payload=response.read(MAX_BYTES+1)
            if len(payload)>MAX_BYTES:
                raise MarketError("Provider response exceeded permitted size")
            http_date=response.headers.get("Date","")[:90]
            request_id=response.headers.get("RequestID","")[:140]
    except urllib.error.HTTPError as exc:
        # Never serialize provider response: it may contain account details.
        raise MarketError(f"OANDA practice data request failed (HTTP {exc.code})") from None
    except urllib.error.URLError:
        raise MarketError("Could not reach OANDA practice candle endpoint") from None
    try:
        parsed=json.loads(payload)
    except (ValueError,UnicodeDecodeError) as exc:
        raise MarketError("Provider returned non-JSON candle data") from exc
    return parsed,http_date,request_id,hashlib.sha256(payload).hexdigest()

def fetch_into_store(symbol: str, count: int, *, clock_ms: int | None = None) -> dict:
    token=os.environ.get("OANDA_PRACTICE_TOKEN","")
    with LOCK:
        parsed,http_date,request_id,response_hash=fetch_practice_candles(symbol,count,token)
        received_ms=clock_ms if clock_ms is not None else now_ms()
        bars=normalize_response(parsed,symbol,received_ms)
        if not bars:
            raise MarketError("No completed bars in OANDA practice response")
        conn=open_store()
        try:
            return ingest(conn,symbol=symbol,candles=bars,received_ms=received_ms,
                          provider_http_date=http_date,provider_request_id=request_id,
                          raw_sha256=response_hash)
        finally:
            conn.close()

def backfill_into_store(symbol: str, pages: int = 6, *, clock_ms: int | None = None) -> dict:
    """Explicit, bounded historical retrieval; no timer, account action or live polling."""
    if symbol not in ALLOWED_SYMBOLS or type(pages) is not int or not 1 <= pages <= 12:
        raise MarketError("Backfill permits 1–12 pages and fixed practice FX pairs")
    token=os.environ.get("OANDA_PRACTICE_TOKEN","")
    received_ms=clock_ms if clock_ms is not None else now_ms()
    with LOCK:
        connection=open_store()
        count_requests,added,repeated,conflicted,augmented=0,0,0,0,0
        older_than=None
        try:
            for page in range(pages):
                response,http_date,request_id,sha=fetch_practice_candles(
                    symbol,MAX_FETCH,token,before_ms=older_than
                )
                candles=normalize_response(response,symbol,received_ms)
                if not candles:
                    break
                earliest=min(row["time"] for row in candles)
                if older_than is not None and earliest>=older_than:
                    raise MarketError("Historical pagination did not advance backward")
                receipt=ingest(
                    connection,symbol=symbol,candles=candles,
                    received_ms=received_ms,provider_http_date=http_date,
                    provider_request_id=request_id,raw_sha256=sha
                )
                count_requests+=1
                added+=receipt["added"]
                repeated+=receipt["repeated"]
                conflicted+=receipt["conflicts"]
                augmented+=receipt["augmented"]
                # Strictly before first candle of previous page; accept a
                # possible small overlap as a duplicate, never hide revision.
                older_than=earliest-1
        finally:
            connection.close()
    return {
        "source":SOURCE,"symbol":symbol,"requests":count_requests,
        "added":added,"repeated":repeated,"conflicts":conflicted,
        "augmented":augmented,"received_utc_ms":received_ms,
        "complete_only":True,"verified_broker_fills":0,
        "warning":"Manually fetched practice historical candles. No executable fills."
    }

def status() -> dict:
    db=storage_path()
    totals={}
    if db.is_file():
        try:
            conn=open_store()
            for symbol in ALLOWED_SYMBOLS:
                totals[symbol]=conn.execute(
                  "SELECT COUNT(*) AS n FROM bars WHERE source=? AND symbol=?",
                  (SOURCE,symbol)).fetchone()["n"]
            conn.close()
        except sqlite3.Error:
            totals={}
    return {
        "provider":"OANDA practice only",
        "configured":bool(os.environ.get("OANDA_PRACTICE_TOKEN")),
        "execution_enabled":False,"polling_enabled":False,
        "allowed_instruments":list(ALLOWED_SYMBOLS),
        "granularity":"M5","max_fetch":MAX_FETCH,
        "stored_candle_counts":totals,"db_present":db.is_file(),
        "provenance":PROVENANCE,
        "warning":"Practice candle prices are not broker fills; local receive times are not exchange-signed proof."
    }

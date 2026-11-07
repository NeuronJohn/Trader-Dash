"""Opt-in local OANDA PRACTICE prospective FXC-001 observation recorder.

A daemon thread may fetch *completed* M5 candles while the localhost server
runs, ONLY after user starts it. The thread is off by default and never
survives process shutdown. It has no order, balance or transaction interface.

A provider-received signal is NOT an exchange-signed/live-fill-verified trade.
No historical backfill/import can mark an observation prospective.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import sqlite3
import threading
import time
from zoneinfo import ZoneInfo

# The localhost server injects its single market-data adapter, so the same
# request lock and storage are reused. The recorder cannot choose a provider.
market = None

RULE="FXC-001"
VERSION="FXC-001-v1"
SOURCE="oanda-fxpractice"
TZ=ZoneInfo("America/New_York")
M5=300_000
PIPS={"EUR_USD":0.0001,"GBP_USD":0.0001,"USD_JPY":0.01}
DEFAULTS={
    "maxSpreadPips":2.0,"slippagePipsPerSide":0.2,
    "feesPipsRoundTrip":0.0,"targetR":1.5,
    "contractionRatio":0.8,"maxBoxPips":20.0,
    "minBoxPips":1.0,"breakoutBufferPips":0.2,
    "stopBufferPips":1.0,"minRiskPips":2.0,"maxRiskPips":35.0,
}
# Maximum lag after a confirmed five-minute close for an observation to
# qualify for local prospective capture. Network gaps miss signals, by design.
MAX_CAPTURE_DELAY_MS=120_000
# Single read each M5 boundary +30 seconds. No high-frequency polling.
RECEIPT_DELAY_MS=30_000
SAMPLE_READ_LIMIT=1000

class ForwardError(ValueError):
    pass

def now_ms():
    return int(time.time()*1000)

def digest(value):
    return hashlib.sha256(json.dumps(
        value,sort_keys=True,separators=(",",":"),allow_nan=False
    ).encode("utf-8")).hexdigest()

def local_clock(utc_ms):
    instant=dt.datetime.fromtimestamp(utc_ms/1000,dt.timezone.utc).astimezone(TZ)
    return instant.date().isoformat(),instant.hour*60+instant.minute,instant.weekday()

def valid_price_row(bar):
    keys=("open","high","low","close","bidOpen","bidHigh","bidLow",
          "bidClose","askOpen","askHigh","askLow","askClose")
    if not isinstance(bar,dict) or type(bar.get("time")) is not int or bar["time"]%M5:
        return False
    if any(type(bar.get(k)) not in (float,int) or not math.isfinite(bar[k]) or bar[k]<=0
           for k in keys):
        return False
    for stem in ("","bid","ask"):
        suffix=("Open","High","Low","Close") if stem else ("open","high","low","close")
        k=tuple(stem+x for x in suffix) if stem else suffix
        if bar[k[1]]<max(bar[k[0]],bar[k[2]],bar[k[3]]) or bar[k[2]]>min(
            bar[k[0]],bar[k[1]],bar[k[3]]
        ):return False
    return (bar["askOpen"]>=bar["bidOpen"] and
            bar["askClose"]>=bar["bidClose"] and
            type(bar.get("receivedAt")) is int and
            bool(bar.get("receiptId")) and
            type(bar.get("componentReceivedAt",bar["receivedAt"])) is int)

def session_prefix(bars,day,until_ms):
    """Return strictly contiguous 07:00 NY bars up to closed signal candle.

    No future candles are returned even if a provider CSV already contains
    later bars. Duplicate timestamps invalidate the session prefix.
    """
    matches={}
    duplicated=False
    for row in bars:
        if row.get("time",10**20)+M5>until_ms:continue
        name,minute,weekday=local_clock(row["time"])
        if name!=day or weekday>=5 or not 420<=minute<660:continue
        slot=(minute-420)//5
        if slot in matches:duplicated=True
        matches[slot]=row
    if duplicated or 0 not in matches:return []
    result=[]
    for i in range(max(matches)+1):
        row=matches.get(i)
        if not row or not valid_price_row(row):return []
        if i>0 and row["time"]-result[-1]["time"]!=M5:return []
        result.append(row)
    return result

def candidate(bars,symbol,day,until_ms):
    """Independent deterministic replica of FXC-001 pre-outcome discovery."""
    if symbol not in PIPS:raise ForwardError("Unsupported practice pair")
    prefix=session_prefix(bars,day,until_ms)
    if len(prefix)<21:return None
    pip=PIPS[symbol]
    baseline=prefix[4:12]
    contraction=prefix[12:20]
    bh=max(b["high"] for b in baseline)-min(b["low"] for b in baseline)
    high=max(b["high"] for b in contraction)
    low=min(b["low"] for b in contraction)
    width=(high-low)/pip
    if bh/pip<2 or not DEFAULTS["minBoxPips"]<=width<=DEFAULTS["maxBoxPips"]:
        return None
    if width>bh/pip*DEFAULTS["contractionRatio"]:return None
    first=None
    # First post-box qualifying close. Never skip a failed first confirmation
    # to manufacture a later, profitable result.
    for i in range(20,min(len(prefix),35)):
        bar=prefix[i]
        long=bar["close"]>=high+DEFAULTS["breakoutBufferPips"]*pip
        short=bar["close"]<=low-DEFAULTS["breakoutBufferPips"]*pip
        if not (long or short):continue
        first=(i,bar,long)
        break
    if first is None:return None
    i,bar,long=first
    spread=(bar["askClose"]-bar["bidClose"])/pip
    if spread>DEFAULTS["maxSpreadPips"]:return None
    # Unknown order of a bidirectional sweep within a 5m OHLC bar.
    if bar["high"]>=high+DEFAULTS["breakoutBufferPips"]*pip and (
        bar["low"]<=low-DEFAULTS["breakoutBufferPips"]*pip
    ):return None
    signal_close=bar["time"]+M5
    return {
        "rule":RULE,"version":VERSION,"day":day,
        "symbol":symbol,"side":"LONG" if long else "SHORT",
        "signalTime":signal_close,"signalBarStart":bar["time"],
        "boxHigh":high,"boxLow":low,"boxPips":width,
        "signalSpreadPips":spread,
        "stopReference":(low-DEFAULTS["stopBufferPips"]*pip if long
                         else high+DEFAULTS["stopBufferPips"]*pip),
        "signalReceiptId":bar.get("componentReceiptId") or bar["receiptId"],
        "signalComponentReceivedAt":bar.get("componentReceivedAt",bar["receivedAt"]),
        "prefix":prefix[:i+1],
    }

def modeled_outcome(bars,signal,symbol):
    """Later score with frozen conservative v0.7 FXC default assumptions.

    Only complete contiguous NY 07:00–10:55 sessions can settle. No actual
    account fill or USD payout can be derived from these indicative candles.
    """
    day=signal["day"]
    rows=session_prefix(bars,day,10**17)
    if len(rows)<48:return None
    rows=rows[:48]
    if any(rows[i]["time"]-rows[i-1]["time"]!=M5 for i in range(1,48)):
        return None
    # If source candles or their early quote components were changed, never
    # rewrite the originally recorded opportunity as a profitable outcome.
    original=signal["prefix"]
    for i,old in enumerate(original):
        if digest(old)!=digest(rows[i]):
            return {"status":"CONFLICT","reason":"Source candles/receipts changed after capture"}
    i=len(original)
    entry_row=rows[i]
    side=signal["side"]
    d=1 if side=="LONG" else -1
    pip=PIPS[symbol]
    spread=(entry_row["askOpen"]-entry_row["bidOpen"])/pip
    if spread>DEFAULTS["maxSpreadPips"]:
        return {"status":"SKIPPED","reason":"Next-open spread exceeded frozen limit"}
    slip=DEFAULTS["slippagePipsPerSide"]*pip
    entry=(entry_row["askOpen"] if d==1 else entry_row["bidOpen"])+d*slip
    stop=signal["stopReference"]
    risk=d*(entry-stop)
    risk_pips=risk/pip
    if not DEFAULTS["minRiskPips"]<=risk_pips<=DEFAULTS["maxRiskPips"]:
        return {"status":"SKIPPED","reason":"Frozen initial stop distance out of bounds"}
    target=entry+d*DEFAULTS["targetR"]*risk
    for n in range(i,48):
        b=rows[n]
        opening=b["bidOpen"] if d==1 else b["askOpen"]
        high=b["bidHigh"] if d==1 else b["askHigh"]
        low=b["bidLow"] if d==1 else b["askLow"]
        gap_stop=opening<=stop if d==1 else opening>=stop
        stop_touch=low<=stop if d==1 else high>=stop
        gap_target=opening>=target if d==1 else opening<=target
        target_touch=high>=target if d==1 else low<=target
        close=None;reason=None
        if gap_stop:close=opening;reason="ADVERSE_STOP_GAP"
        elif stop_touch:close=stop;reason="STOP_FIRST"
        elif gap_target:close=target;reason="TARGET_GAP_CAPPED"
        elif target_touch:close=target;reason="TARGET"
        elif n==47:
            close=b["bidClose"] if d==1 else b["askClose"]
            reason="NY_SESSION_EXIT"
        if close is None:continue
        exit_price=close-d*slip
        net_pips=d*(exit_price-entry)/pip-DEFAULTS["feesPipsRoundTrip"]
        return {
          "status":"MODELED","entry":entry,"stop":stop,"target":target,
          "exit":exit_price,"exitReason":reason,
          "entryTime":entry_row["time"],"exitTime":b["time"]+M5,
          "riskPips":risk_pips,"netPips":net_pips,"netR":net_pips/risk_pips,
          "assumptions":DEFAULTS,
          "brokerFillVerified":False,"source":"oanda-fxpractice",
        }
    return {"status":"CONFLICT","reason":"Incomplete conservative exit logic"}

def ensure_tables(connection):
    connection.executescript("""
      CREATE TABLE IF NOT EXISTS forward_observations(
        signal_id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        session_day TEXT NOT NULL,
        side TEXT NOT NULL,
        signal_close_ms INTEGER NOT NULL,
        armed_at_ms INTEGER NOT NULL,
        captured_at_ms INTEGER NOT NULL,
        source_receipt TEXT NOT NULL,
        prefix_sha256 TEXT NOT NULL,
        capture_json TEXT NOT NULL,
        UNIQUE(symbol,rule_version,signal_close_ms)
      );
      CREATE INDEX IF NOT EXISTS forward_by_time ON
        forward_observations(captured_at_ms);
      CREATE TABLE IF NOT EXISTS forward_outcomes(
        signal_id TEXT PRIMARY KEY,
        resolved_at_ms INTEGER NOT NULL,
        outcome_json TEXT NOT NULL,
        FOREIGN KEY(signal_id) REFERENCES forward_observations(signal_id)
      );
      CREATE TABLE IF NOT EXISTS forward_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        happened_at_ms INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        FOREIGN KEY(signal_id) REFERENCES forward_observations(signal_id)
      );
    """)

def record_new(connection,symbol,bars,armed_at_ms,received_ms):
    """Capture ONLY new, timely provider-received confirmation after arming."""
    if symbol not in PIPS or armed_at_ms<=0 or received_ms<armed_at_ms:
        raise ForwardError("Monitor was not armed for this source")
    ensure_tables(connection)
    # Only look at a confirmation that has JUST closed. A delayed historical
    # backfill, reopening the app, and old practice bars cannot become forward.
    days={local_clock(b["time"])[0] for b in bars
          if isinstance(b.get("time"),int) and
             0<=received_ms-(b["time"]+M5)<=MAX_CAPTURE_DELAY_MS}
    created=[]
    for day in sorted(days):
        c=candidate(bars,symbol,day,received_ms)
        if not c:continue
        close_ms=c["signalTime"]
        if not (armed_at_ms<=close_ms<=received_ms and
                received_ms-close_ms<=MAX_CAPTURE_DELAY_MS):
            continue
        # The actual first receipt of all required source components must be
        # after the monitor was armed AND close to the original confirmation.
        # This is a local receipt fact, not a trusted independent witness.
        source_at=c["signalComponentReceivedAt"]
        if not (armed_at_ms<=source_at<=received_ms and
                0<=source_at-close_ms<=MAX_CAPTURE_DELAY_MS):
            continue
        if c["prefix"][-1]["time"]+M5!=close_ms:continue
        observation={
            "rule":RULE,"version":VERSION,
            "symbol":symbol,"day":day,"side":c["side"],
            "signalTime":close_ms,"boxHigh":c["boxHigh"],"boxLow":c["boxLow"],
            "boxPips":c["boxPips"],"stopReference":c["stopReference"],
            "signalSpreadPips":c["signalSpreadPips"],
            "sourceReceiptId":c["signalReceiptId"],
            "sourceReceivedAt":source_at,
            "armedAt":armed_at_ms,"capturedAt":received_ms,
            "origin":"OANDA_PRACTICE_LOCAL_PROSPECTIVE_RECEIPT",
            "liveOrderFillVerified":False,"exchangeSigned":False,
            "status":"PENDING","prefix":c["prefix"],
            "ruleAssumptions":DEFAULTS,
        }
        prefix_sha=digest(c["prefix"])
        key=digest([symbol,VERSION,close_ms])
        with connection:
            cursor=connection.execute("""
              INSERT OR IGNORE INTO forward_observations(
                signal_id,symbol,rule_version,session_day,side,signal_close_ms,
                armed_at_ms,captured_at_ms,source_receipt,prefix_sha256,capture_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,(key,symbol,VERSION,day,c["side"],close_ms,armed_at_ms,
                 received_ms,c["signalReceiptId"],prefix_sha,json.dumps(
                    observation,allow_nan=False,sort_keys=True,separators=(",",":")
                 )))
            if cursor.rowcount:
                connection.execute("""
                  INSERT INTO forward_events(signal_id,event_type,happened_at_ms,event_json)
                  VALUES(?,?,?,?)
                """,(key,"CAPTURE",received_ms,json.dumps({
                  "prefixSha256":prefix_sha,
                  "providerSource":SOURCE,
                  "brokerFillVerified":False,
                })))
                created.append(key)
    return created

def settle_ready(connection,symbol,bars,received_ms):
    """Append a modeled result only after a new complete session is received."""
    ensure_tables(connection)
    entries=connection.execute("""
       SELECT f.signal_id,f.capture_json,f.prefix_sha256,f.captured_at_ms
       FROM forward_observations AS f
       LEFT JOIN forward_outcomes AS o ON f.signal_id=o.signal_id
       WHERE f.symbol=? AND o.signal_id IS NULL
       ORDER BY f.signal_close_ms LIMIT 250
    """,(symbol,)).fetchall()
    settled=[]
    for row in entries:
        c=json.loads(row["capture_json"])
        if digest(c["prefix"])!=row["prefix_sha256"]:
            # Even a malformed local database must never silently invent wins.
            outcome={"status":"CONFLICT","reason":"Saved capture checksum failed"}
        else:
            # Never score using bars that first arrived before the original
            # capture, even when their timestamps appear later.
            after=[b for b in bars if (local_clock(b["time"])[0]==c["day"] and
                  b["time"]>=c["signalTime"])]
            if any(b["receivedAt"]<row["captured_at_ms"] for b in after):
                outcome={"status":"CONFLICT","reason":"Post-signal bar was known before capture"}
            else:
                outcome=modeled_outcome(bars,c,symbol)
        if outcome is None:continue
        with connection:
            cur=connection.execute("""
              INSERT OR IGNORE INTO forward_outcomes(signal_id,resolved_at_ms,outcome_json)
              VALUES(?,?,?)
            """,(row["signal_id"],received_ms,
                json.dumps(outcome,sort_keys=True,separators=(",",":"),allow_nan=False)))
            if cur.rowcount:
                connection.execute("""
                   INSERT INTO forward_events(signal_id,event_type,happened_at_ms,event_json)
                   VALUES(?,?,?,?)
                """,(row["signal_id"],"MODEL_RESULT",received_ms,json.dumps({
                  "status":outcome["status"],"modeled":True,
                  "brokerFillVerified":False
                })))
                settled.append(row["signal_id"])
    return settled

def list_records(connection,symbol,limit=50):
    if symbol not in PIPS or type(limit) is not int or not 1<=limit<=100:
        raise ForwardError("Invalid prospective journal query")
    ensure_tables(connection)
    rows=connection.execute("""
      SELECT f.signal_id,f.capture_json,f.prefix_sha256,
             o.outcome_json,o.resolved_at_ms,
             (SELECT COUNT(*) FROM forward_events e WHERE e.signal_id=f.signal_id) AS event_count
      FROM forward_observations f
      LEFT JOIN forward_outcomes o ON o.signal_id=f.signal_id
      WHERE f.symbol=?
      ORDER BY f.captured_at_ms DESC LIMIT ?
    """,(symbol,limit)).fetchall()
    entries=[]
    for row in rows:
        c=json.loads(row["capture_json"])
        compromised=digest(c.get("prefix"))!=row["prefix_sha256"]
        outcome=json.loads(row["outcome_json"]) if row["outcome_json"] else None
        entries.append({
          "id":row["signal_id"],"symbol":c["symbol"],"day":c["day"],
          "rule":c["rule"],"version":c["version"],"side":c["side"],
          "signalTime":c["signalTime"],"signalBarStart":c["signalTime"]-M5,
          "boxHigh":c["boxHigh"],"boxLow":c["boxLow"],
          "stopReference":c["stopReference"],"signalSpreadPips":c["signalSpreadPips"],
          "capturedAt":c["capturedAt"],
          "sourceReceiptId":c["sourceReceiptId"],
          "origin":c["origin"],"prefixSha256":row["prefix_sha256"],
          "evidenceIntegrity":"FAILED" if compromised else "LOCAL_CHECKSUM_OK",
          "status":"CONFLICT" if compromised else (outcome["status"] if outcome else "PENDING"),
          "outcome":None if compromised else outcome,
          "resolvedAt":row["resolved_at_ms"],
          "eventCount":row["event_count"],
          "actualBrokerFillsVerified":False
        })
    return entries

def summary(records):
    total=len(records)
    closed=[r["outcome"] for r in records if
            r["status"]=="MODELED" and isinstance(r["outcome"],dict)]
    return {
      "recorded":total,
      "pending":sum(r["status"]=="PENDING" for r in records),
      "modeled":len(closed),
      "skipped":sum(r["status"]=="SKIPPED" for r in records),
      "conflicts":sum(r["status"]=="CONFLICT" for r in records),
      "averageModeledR":sum(x["netR"] for x in closed)/len(closed) if closed else None,
      "actualBrokerFills":0,
      "verifiedLivePerformance":False,
      "source":"oanda-fxpractice",
      "warning":"Locally observed practice price receipt, not independently signed or broker-executed"
    }

class Monitor:
    """At most one opt-in prospective market watcher per local server process."""
    def __init__(self):
        self.lock=threading.RLock()
        self.stop_event=threading.Event()
        self.thread=None
        self.symbol=None
        self.armed_at=None
        self.last_fetch_ms=None
        self.last_error=None
        self.poll_count=0

    def start(self,symbol):
        if symbol not in PIPS:raise ForwardError("Unsupported practice symbol")
        if not market.status()["configured"]:
            raise ForwardError("An OANDA PRACTICE credential is required")
        with self.lock:
            if self.thread is not None and self.thread.is_alive():
                raise ForwardError("Monitoring is already active; stop before changing pair")
            self.symbol=symbol
            self.armed_at=now_ms()
            self.last_error=None
            self.last_fetch_ms=None
            self.poll_count=0
            self.stop_event=threading.Event()
            # Start no retrospective fetch; first request occurs after NEXT
            # scheduled close. No historical backfill can call record_new.
            self.thread=threading.Thread(target=self._loop,args=(
                self.stop_event,symbol,self.armed_at
            ),daemon=True,name="TraderPracticeProspectiveFX")
            self.thread.start()
            return self.state()

    def stop(self):
        with self.lock:
            self.stop_event.set()
            self.armed_at=None
            return self.state()

    def _loop(self,stop,symbol,armed_at):
        while not stop.is_set():
            now=now_ms()
            next_close=((now//M5)+1)*M5+RECEIPT_DELAY_MS
            if stop.wait(max(0,(next_close-now)/1000)):break
            if stop.is_set():break
            try:
                # Exactly one provider GET per five-minute boundary.
                receipt=market.fetch_into_store(symbol,SAMPLE_READ_LIMIT)
                with self.lock:
                    self.last_fetch_ms=receipt["received_utc_ms"]
                    self.poll_count+=1
                conn=market.open_store()
                try:
                    price_history=market.read_bars(conn,symbol,1000)["bars"]
                    # Stopping mid-request cannot capture a later signal.
                    if not stop.is_set() and self.armed_at==armed_at:
                        record_new(conn,symbol,price_history,armed_at,
                                   receipt["received_utc_ms"])
                        settle_ready(conn,symbol,price_history,receipt["received_utc_ms"])
                finally:conn.close()
            except (market.MarketError,ForwardError,sqlite3.Error,OSError,ValueError) as exc:
                with self.lock:self.last_error=str(exc)[:190]

    def state(self):
        with self.lock:
            return {
              "active":bool(self.thread and self.thread.is_alive()
                            and not self.stop_event.is_set()),
              "symbol":self.symbol,
              "armedAt":self.armed_at,
              "lastFetchAt":self.last_fetch_ms,
              "pollCount":self.poll_count,
              "lastError":self.last_error,
              "provider":"OANDA fxPractice historical M5",
              "persistence":"SQLite local observations and later modeled outcomes",
              "serverOnly":True,"brokerOrdersAllowed":False,
              "autoRestart":False
            }

    def close(self):
        self.stop_event.set()

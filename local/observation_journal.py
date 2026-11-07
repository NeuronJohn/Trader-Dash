"""Append-only discovery timestamps and conservative *price-only* forward outcomes.

This is a research observation journal, never an order, backtest, actual fill,
or statistically validated signal. It records a completed-bar range break only
when the chart is viewed with fresh account/market evidence. Observations are
immutable; outcomes require five later COMPLETE, CONTIGUOUS bars.
"""
from __future__ import annotations

import math
import sqlite3
import threading
import time
from pathlib import Path
from statistics import mean, median

HORIZON_BARS = 5
SOURCE_REAL = "TOPSTEPX_BROKER_REST"
SOURCE_DEMO = "SYNTHETIC_OFFLINE_FIXTURE"
SOURCES = frozenset((SOURCE_REAL, SOURCE_DEMO))
VALID_MINUTES = (1, 5, 15, 30, 60)


class ObservationJournal:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS observations(
                source TEXT NOT NULL, account_id INTEGER NOT NULL,
                contract_id TEXT NOT NULL, minutes INTEGER NOT NULL,
                signal_start_ms INTEGER NOT NULL, signal_closed_ms INTEGER NOT NULL,
                observed_at_ms INTEGER NOT NULL, direction INTEGER NOT NULL,
                reference_close REAL NOT NULL, reference_level REAL NOT NULL,
                signal_atr REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                resolved_close REAL, directional_points REAL, directional_pct REAL,
                PRIMARY KEY(source, account_id, contract_id, minutes, signal_start_ms)
            )""")
            db.execute("""CREATE INDEX IF NOT EXISTS observations_by_market
                       ON observations(source,account_id,contract_id,minutes,status)""")

    def _db(self):
        return sqlite3.connect(str(self.path), timeout=7)

    def advance(self, source, account_id, contract_id, minutes, bars, context,
                allow_record=False, now_ms=None):
        if source not in SOURCES or type(account_id) is not int or account_id <= 0:
            raise ValueError("Invalid observation source or account")
        if not isinstance(contract_id, str) or not contract_id.startswith("CON.F.") \
           or len(contract_id) > 90 or minutes not in VALID_MINUTES \
           or type(minutes) is not int:
            raise ValueError("Invalid contract or timeframe")
        if not isinstance(bars, list) or len(bars) > 750:
            raise ValueError("Invalid candle window")
        if now_ms is None:
            now_ms = int(time.time() * 1000)
        if type(now_ms) is not int or now_ms <= 0:
            raise ValueError("Invalid clock")
        interval = minutes * 60_000
        closed = {}
        prior = -1
        for b in bars:
            if not isinstance(b, dict) or type(b.get("time")) is not int:
                raise ValueError("Malformed price bar")
            t = b["time"]
            values = (b.get("open"), b.get("high"), b.get("low"), b.get("close"))
            if t <= prior or not all(type(v) in (float, int) and math.isfinite(v)
                                     and v > 0 for v in values):
                raise ValueError("Invalid or unsorted OHLC")
            o, h, l, c = values
            if h < max(o, l, c) or l > min(o, h, c):
                raise ValueError("Invalid price bounds")
            prior = t
            if t + interval <= now_ms:
                closed[t] = b

        # Never import old signal bars as if they were observed prospectively.
        eligible = bool(allow_record and isinstance(context, dict) and
            context.get("status") == "OBSERVATION_ONLY" and
            not context.get("completed_data_stale") and
            not context.get("gaps_in_last_20") and
            context.get("range_state") in ("ABOVE_PRIOR_RANGE", "BELOW_PRIOR_RANGE"))
        if eligible:
            start = context.get("confirmation_bar_start_ms")
            stamp = context.get("confirmed_through_ms")
            if type(start) is not int or type(stamp) is not int or stamp != start + interval \
               or stamp > now_ms or now_ms-stamp > 2*interval \
               or start not in closed or start != max(closed):
                eligible = False
            else:
                price = context.get("latest_complete_close")
                atr = context.get("average_true_range_14")
                high, low = context.get("prior_20_high"), context.get("prior_20_low")
                if not all(type(v) in (float, int) and math.isfinite(v) and v > 0
                           for v in (price, atr, high, low)):
                    eligible = False
                elif abs(closed[start]["close"]-price) > 1e-6:
                    eligible = False
                elif (context["range_state"] == "ABOVE_PRIOR_RANGE" and price <= high) or \
                     (context["range_state"] == "BELOW_PRIOR_RANGE" and price >= low):
                    eligible = False

        with self.lock, self._db() as db:
            if eligible:
                direction = 1 if context["range_state"] == "ABOVE_PRIOR_RANGE" else -1
                level = (context["prior_20_high"] if direction == 1
                         else context["prior_20_low"])
                db.execute("""INSERT OR IGNORE INTO observations
                    (source,account_id,contract_id,minutes,signal_start_ms,
                     signal_closed_ms,observed_at_ms,direction,reference_close,
                     reference_level,signal_atr,status)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING')""",
                    (source,account_id,contract_id,minutes,start,stamp,now_ms,
                     direction,price,level,atr))

            tracked = db.execute("""SELECT signal_start_ms,reference_close,direction,status
                FROM observations WHERE source=? AND account_id=? AND contract_id=?
                  AND minutes=?""",
                (source,account_id,contract_id,minutes)).fetchall()
            last_closed = max(closed) if closed else -1
            for t0, entry, direction, old_status in tracked:
                # Never rewrite a signal based merely on a short rolling window:
                # the original candle must still be present for reconciliation.
                if t0 not in closed:
                    continue
                if abs(closed[t0]["close"]-entry) > 1e-6:
                    # A provider correction may remove the original pattern.
                    db.execute("""UPDATE observations SET status='SIGNAL_REVISED',
                        resolved_close=NULL,directional_points=NULL,directional_pct=NULL
                        WHERE source=? AND account_id=? AND contract_id=? AND minutes=?
                          AND signal_start_ms=?""",
                        (source,account_id,contract_id,minutes,t0))
                    continue
                horizon = [closed.get(t0+k*interval) for k in range(1,HORIZON_BARS+1)]
                if all(horizon):
                    final_close = horizon[-1]["close"]
                    points = (final_close-entry)*direction
                    pct = 100.0*points/entry
                    # Updates already matured results when the broker corrects
                    # subsequent candles, without inventing an earlier signal.
                    db.execute("""UPDATE observations SET status='MATURED',
                        resolved_close=?,directional_points=?,directional_pct=?
                        WHERE source=? AND account_id=? AND contract_id=? AND minutes=?
                          AND signal_start_ms=?""",
                        (final_close, points, pct, source,account_id,contract_id,
                         minutes,t0))
                elif last_closed >= t0+HORIZON_BARS*interval:
                    # Required bar absent despite a later complete bar.
                    db.execute("""UPDATE observations SET status='DATA_GAP',
                        resolved_close=NULL,directional_points=NULL,directional_pct=NULL
                        WHERE source=? AND account_id=? AND contract_id=? AND minutes=?
                          AND signal_start_ms=?""",
                        (source,account_id,contract_id,minutes,t0))
                elif old_status in ("MATURED","DATA_GAP","SIGNAL_REVISED"):
                    db.execute("""UPDATE observations SET status='PENDING',
                        resolved_close=NULL,directional_points=NULL,directional_pct=NULL
                        WHERE source=? AND account_id=? AND contract_id=? AND minutes=?
                          AND signal_start_ms=?""",
                        (source,account_id,contract_id,minutes,t0))
            rows = db.execute("""SELECT signal_start_ms,signal_closed_ms,
                observed_at_ms,direction,reference_close,status,directional_points,
                directional_pct FROM observations WHERE source=? AND account_id=?
                AND contract_id=? AND minutes=? ORDER BY signal_start_ms DESC""",
                (source,account_id,contract_id,minutes)).fetchall()

        good = [r for r in rows if r[5] == "MATURED"]
        returns = [r[7] for r in good]
        positive = sum(p > 0 for p in returns)
        return {
            "source": source,
            "method": "PROSPECTIVELY_OBSERVED_FIVE_BAR_CLOSE_CHANGE",
            "not_trades": True, "no_execution": True,
            "contract_id": contract_id, "timeframe_minutes": minutes,
            "horizon_bars": HORIZON_BARS,
            "recorded": len(rows),
            "awaiting_future_bars": sum(r[5] == "PENDING" for r in rows),
            "excluded_data_gaps": sum(r[5] == "DATA_GAP" for r in rows),
            "excluded_revised_signals": sum(r[5] == "SIGNAL_REVISED" for r in rows),
            "matured": len(good),
            "favorable_fraction": round(positive/len(good), 4) if good else None,
            "average_directional_pct": round(mean(returns), 5) if returns else None,
            "median_directional_pct": round(median(returns), 5) if returns else None,
            "statistical_edge_verified": False,
            "notes": ("Price-only change from observed signal close to the fifth "
                      "later completed bar. No assumed entry fill, fees, slippage, "
                      "stop execution or P&L. Outcomes may be revised by data corrections. "
                      "Small samples and overlapping observations are not independent."),
            "recent": [{
                "signal_start_ms":r[0],"signal_closed_ms":r[1],
                "observed_at_ms":r[2],
                "direction":"LONG" if r[3]==1 else "SHORT",
                "reference_close":r[4],"status":r[5],
                "directional_points":round(r[6],5) if r[6] is not None else None,
                "directional_pct":round(r[7],5) if r[7] is not None else None,
            } for r in rows[:8]],
        }

"""Completed-bar, no-lookahead ProjectX candle context (not a trade signal)."""
from __future__ import annotations
import math
from datetime import datetime, timezone

ALLOWED_MINUTES=(1,5,15,30,60)

def analyze(bars,minutes,now_ms=None):
    if type(minutes) is not int or minutes not in ALLOWED_MINUTES:
        raise ValueError("Unsupported timeframe")
    if not isinstance(bars,list) or len(bars)>750:
        raise ValueError("Invalid candles")
    if now_ms is None:
        now_ms=int(datetime.now(timezone.utc).timestamp()*1000)
    if isinstance(now_ms,bool) or not isinstance(now_ms,(int,float)) or not math.isfinite(now_ms):
        raise ValueError("Invalid evaluation cutoff")
    interval=minutes*60_000
    closed=[]
    prev=float("-inf")
    for bar in bars:
        if not isinstance(bar,dict):
            raise ValueError("Invalid candle")
        ts=bar.get("time")
        if isinstance(ts,bool) or not isinstance(ts,(int,float)) or not math.isfinite(ts) or ts<=prev:
            raise ValueError("Unsorted or duplicate bars")
        prev=ts
        o,h,l,c=(bar.get(k) for k in ("open","high","low","close"))
        if not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and v>0
                   for v in (o,h,l,c)):
            raise ValueError("Invalid OHLC")
        if l>min(o,c) or h<max(o,c,l):
            raise ValueError("Invalid candle bounds")
        if ts+interval<=now_ms:
            closed.append(bar)
    if len(closed)<22:
        return {"status":"INSUFFICIENT_HISTORY","closed_bars":len(closed),
                "required":22,"source":"TOPSTEPX_REST_COMPLETED_BARS",
                "not_a_trade_signal":True}
    previous=closed[-21:-1]
    last=closed[-1]
    high=max(b["high"] for b in previous)
    low=min(b["low"] for b in previous)
    changes=[]
    for i in range(len(closed)-14,len(closed)):
        candle=closed[i]
        prior=closed[i-1]["close"]
        changes.append(max(candle["high"]-candle["low"],
                           abs(candle["high"]-prior),abs(candle["low"]-prior)))
    atr=sum(changes)/len(changes)
    state=("ABOVE_PRIOR_RANGE" if last["close"]>high else
           "BELOW_PRIOR_RANGE" if last["close"]<low else "INSIDE_PRIOR_RANGE")
    recent=closed[-21:]
    gaps=sum(right["time"]-left["time"]>1.5*interval
             for left,right in zip(recent,recent[1:]))
    stale=now_ms-(last["time"]+interval)>2*interval
    return {
        "status":"OBSERVATION_ONLY","source":"TOPSTEPX_REST_COMPLETED_BARS",
        "not_a_trade_signal":True,"rule":"PRIOR_20_COMPLETE_BARS_v1",
        "timeframe_minutes":minutes,"closed_bars":len(closed),
        "confirmation_bar_start_ms":last["time"],
        "confirmed_through_ms":last["time"]+interval,
        "latest_complete_close":round(last["close"],8),
        "prior_20_high":round(high,8),"prior_20_low":round(low,8),
        "average_true_range_14":round(atr,8),"range_state":state,
        "gaps_in_last_20":gaps,"completed_data_stale":stale,
        "range_width":round(high-low,8),
        "distance_from_range_high":round(last["close"]-high,8),
        "distance_from_range_low":round(last["close"]-low,8),
        "limitations":["No spread/slippage or intrabar execution assumptions",
                       "No evidence of predictive edge, expectancy or order eligibility",
                       "Current forming candle intentionally excluded"],
    }

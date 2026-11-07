"""Local decision-note bridge.

Only server-verified chart/account evidence reaches local Ollama.
The model explains an observation; it cannot change status, price or orders.
"""
from __future__ import annotations
import json
import re

import workspace_server as local_ai

PROMPT = """You are an assistant explaining a deterministic futures market observation.
You are NOT the scanner and cannot change its status, prices or plan.
Write three concise plain-English strings: observation, concern, next_check.
No numbers or price levels in your response (the software displays exact data).
Only discuss facts in the input, do not invent news, trades, win probabilities,
technical signals, risk-limit compliance, or an edge. Do not instruct buying or selling.
These records may be SYNTHETIC: explicitly label them synthetic when indicated.
The completed-position stats describe all positions, NOT performance of this pattern.
If the source quality is insufficient, say so. No claims of live execution.
JSON only, exactly the three requested keys; keep each under 220 characters.
"""

def explain(evidence):
    if not isinstance(evidence, dict):
        raise ValueError("Missing analyst evidence")
    required=("source","contract","timeframe_minutes","market_structure",
              "trade_statistics","risk_warnings")
    if any(k not in evidence for k in required):
        raise ValueError("Incomplete bounded evidence")
    if not local_ai.ANALYST_GATE.acquire(blocking=False):
        raise ValueError("Local research assistant is busy")
    try:
        result=local_ai.ollama_request("/api/chat",payload={
            "model":local_ai.MODEL,
            "stream":False,
            "format":"json",
            "options":{"temperature":0.15,"num_predict":340},
            "messages":[
                {"role":"system","content":PROMPT},
                {"role":"user","content":json.dumps(evidence,allow_nan=False,
                         separators=(",",":"))},
            ],
        },timeout=80)
    finally:
        local_ai.ANALYST_GATE.release()
    message=result.get("message") if isinstance(result,dict) else None
    raw=message.get("content") if isinstance(message,dict) else None
    if not isinstance(raw,str) or len(raw)>4000:
        raise ValueError("Assistant did not return bounded text")
    raw=raw.strip()
    fence=chr(96)*3
    if raw.startswith(fence+"json") and raw.endswith(fence):
        raw=raw[len(fence+"json"):-len(fence)].strip()
    try:
        parsed=json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("Assistant response was not valid JSON") from None
    keys=("observation","concern","next_check")
    if not isinstance(parsed,dict) or set(parsed)!=set(keys):
        raise ValueError("Assistant response fields are invalid")
    cleaned={}
    for field in keys:
        value=parsed.get(field)
        if not isinstance(value,str) or not 1<=len(value.strip())<=220:
            raise ValueError("Assistant response too long or missing")
        if re.search(r"[\d]",value) or re.search(
            r"\b(?:buy|sell|enter|execute|order|guarantee|sure thing)\b",value,re.I):
            raise ValueError("Assistant response made an unsupported numerical or trade claim")
        cleaned[field]=value.strip()
    if evidence.get("source") == "SYNTHETIC_OFFLINE_FIXTURE" and \
       "synthetic" not in " ".join(cleaned.values()).lower():
        raise ValueError("Synthetic provenance must remain explicit")
    return cleaned


def bounded_packet(contract,minutes,structure,completed,source):
    if structure.get("status")!="OBSERVATION_ONLY":
        raise ValueError("No completed-bar observation")
    coverage=completed.get("coverage")
    count=completed.get("complete_trade_count")
    return {
        "source":source,
        "contract":contract,
        "timeframe_minutes":minutes,
        "market_structure":{
            "state":structure["range_state"],
            "confirmed_through_ms":structure["confirmed_through_ms"],
            "last_closed_price":structure["latest_complete_close"],
            "prior_range_high":structure["prior_20_high"],
            "prior_range_low":structure["prior_20_low"],
            "atr14":structure["average_true_range_14"],
            "data_stale":structure["completed_data_stale"],
            "missing_bars":structure["gaps_in_last_20"],
        },
        "trade_statistics":{
            "completed_positions_count":count if type(count) is int else None,
            "historical_coverage":coverage if isinstance(coverage,str) else "UNVERIFIED",
            "setup_specific_result_available":False,
        },
        "risk_warnings":[
            "No validated edge or setup-specific expectancy",
            "Stops and targets are only hypothetical planning levels",
            "No Topstep account-rule or intraday drawdown clearance",
            "Local analyst is read-only; no order endpoint is available",
        ],
    }

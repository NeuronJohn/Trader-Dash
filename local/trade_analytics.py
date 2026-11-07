"""Reconstruct completed flat-to-flat futures trades from ProjectX half-turn legs.

Descriptive broker accounting only. Never score incomplete, voided or ambiguous
positions as a completed trade. No original stop/risk -> no R multiples.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta
from statistics import median
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")


def _stamp(raw):
    d = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError("Broker timestamp lacks time zone")
    return d


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError("Malformed financial field in broker trade leg")
    return float(value)


def reconstruct(legs):
    """Construct completed position cycles by contract, handling scale-in/out/reversals."""
    per_contract = defaultdict(list)
    for leg in legs:
        if not isinstance(leg, dict) or type(leg.get("voided", False)) is not bool:
            raise ValueError("Malformed broker trade leg")
        if leg.get("voided"):
            continue
        contract = leg.get("contractId")
        if not isinstance(contract, str) or not contract:
            raise ValueError("Missing contract ID")
        qty, side = leg.get("size"), leg.get("side")
        if type(qty) is not int or qty <= 0 or type(side) is not int or side not in (0, 1):
            raise ValueError("Invalid broker trade quantity or side")
        _number(leg.get("price"))
        _stamp(leg["creationTimestamp"])
        per_contract[contract].append(leg)

    completed, pending = [], []
    issues = {"unmatched_close_legs": 0, "inconsistent_legs": 0, "duplicate_ids": 0}
    for contract, trades in per_contract.items():
        ids = set()
        for t in trades:
            if type(t.get("id")) is not int or t["id"] in ids:
                issues["duplicate_ids"] += 1
                raise ValueError("Missing or duplicate broker leg ID")
            ids.add(t["id"])
        # Reversals can split an execution: the closing half-turn is processed first.
        trades.sort(key=lambda t: (_stamp(t["creationTimestamp"]),
                                  t.get("profitAndLoss") is None, t["id"]))
        current = None
        for t in trades:
            dt = _stamp(t["creationTimestamp"])
            direction = 1 if t["side"] == 0 else -1
            qty = t["size"]
            fee = _number(t.get("fees") if t.get("fees") is not None else 0)
            commission = _number(t.get("commissions") if t.get("commissions") is not None else 0)
            pnl = t.get("profitAndLoss")
            if pnl is None:
                if current is not None and current["direction"] != direction:
                    issues["inconsistent_legs"] += 1
                    current = None
                if current is None:
                    current = {"contract_id": contract, "direction": direction,
                               "entry_time": dt, "exit_time": None, "quantity": 0,
                               "remaining": 0, "entry_total": 0, "exit_total": 0,
                               "closed_quantity": 0, "gross": 0.0, "fees": 0.0,
                               "commissions": 0.0, "leg_count": 0, "leg_ids": []}
                current["quantity"] += qty
                current["remaining"] += qty
                current["entry_total"] += t["price"] * qty
            elif current is None or current["direction"] == direction or qty > current["remaining"]:
                issues["unmatched_close_legs"] += 1
                # History may begin mid-position; never fabricate the entry.
                current = None
                continue
            else:
                current["remaining"] -= qty
                current["closed_quantity"] += qty
                current["exit_total"] += t["price"] * qty
                current["gross"] += _number(pnl)
                current["exit_time"] = dt
            current["fees"] += fee
            current["commissions"] += commission
            current["leg_count"] += 1
            current["leg_ids"].append(t["id"])
            if current["remaining"] == 0:
                end = current["exit_time"]
                net = current["gross"] - current["fees"] - current["commissions"]
                local_end = end.astimezone(CT)
                session = (local_end + timedelta(days=1) if local_end.hour >= 17 else local_end).date().isoformat()
                completed.append({
                    "contract_id": contract,
                    "side": "Long" if current["direction"] == 1 else "Short",
                    "entry_time": current["entry_time"].isoformat(),
                    "exit_time": end.isoformat(), "session": session,
                    "entry_hour_ct": current["entry_time"].astimezone(CT).hour,
                    "entry_weekday_ct": current["entry_time"].astimezone(CT).strftime("%a"),
                    "duration_seconds": int((end - current["entry_time"]).total_seconds()),
                    "total_opened": current["quantity"],
                    "avg_entry": round(current["entry_total"] / current["quantity"], 8),
                    "avg_exit": round(current["exit_total"] / current["closed_quantity"], 8),
                    "gross_usd": round(current["gross"], 4),
                    "fees_usd": round(current["fees"], 4),
                    "commissions_usd": round(current["commissions"], 4),
                    "net_usd": round(net, 4),
                    "leg_count": current["leg_count"], "leg_ids": current["leg_ids"],
                })
                current = None
        if current is not None:
            pending.append({
                "contract_id": contract,
                "side": "Long" if current["direction"] == 1 else "Short",
                "remaining_size": current["remaining"],
                "entry_time": current["entry_time"].isoformat(),
                "partial_realized_usd": round(current["gross"], 4),
            })
    completed.sort(key=lambda x: (x["exit_time"], x["contract_id"]))
    return {"completed": completed, "pending": pending, "issues": issues}


def summarize(legs, max_recent=100):
    data = reconstruct(legs)
    trades = data["completed"]
    wins = [t["net_usd"] for t in trades if t["net_usd"] > 0]
    losses = [t["net_usd"] for t in trades if t["net_usd"] < 0]
    total = sum(t["net_usd"] for t in trades)
    n = len(trades)
    equity = peak = drawdown = 0.0
    for trade in trades:
        equity += trade["net_usd"]
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    group = defaultdict(list)
    for trade in trades:
        for field in ("contract_id", "side", "entry_hour_ct", "entry_weekday_ct"):
            group[(field, trade[field])].append(trade["net_usd"])
    by = {}
    for field in ("contract_id", "side", "entry_hour_ct", "entry_weekday_ct"):
        by[field] = [
            {"label": key, "count": len(values),
             "net_usd": round(sum(values), 2),
             "avg_usd": round(sum(values) / len(values), 2),
             "win_rate": round(sum(v > 0 for v in values) / len(values), 4)}
            for (group_field, key), values in group.items() if group_field == field
        ]
        by[field].sort(key=lambda v: str(v["label"]))
    return {
        "method": "FLAT_TO_FLAT_PROJECTX_HALF_TURNS",
        "complete_trade_count": n, "wins": len(wins), "losses": len(losses),
        "breakeven": n - len(wins) - len(losses),
        "win_rate": round(len(wins) / n, 4) if n else None,
        "expectancy_usd": round(total / n, 2) if n else None,
        "profit_factor": round(sum(wins) / -sum(losses), 3) if losses else None,
        "avg_win_usd": round(sum(wins) / len(wins), 2) if wins else None,
        "avg_loss_usd": round(sum(losses) / len(losses), 2) if losses else None,
        "median_usd": round(median(t["net_usd"] for t in trades), 2) if n else None,
        "completed_net_usd": round(total, 2),
        "completed_trade_peak_to_trough_usd": round(drawdown, 2),
        "pending_positions": data["pending"], "issues": data["issues"],
        "coverage": "PARTIAL_OR_UNCERTAIN" if any(data["issues"].values()) or data["pending"]
                    else "MATCHED_IN_FETCH_WINDOW",
        "breakdowns": by, "recent_trades": list(reversed(trades[-max_recent:])),
        "notes": [
            "Only positions opened and closed within fetched history are counted.",
            "R-multiple cannot be reconstructed without the original risk or stop.",
            "Win rate uses fee-adjusted complete positions; leg P&L is separate.",
            "No claim of full account history, official Topstep drawdown, or proven edge.",
        ],
    }

"""Deterministic, strictly offline fixture provider for Topstep workstation development.

Never uses credentials, broker URLs or real trader data. All results are SYNTHETIC.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone
from threading import RLock

from topstep_core import iso_utc, utc_now
from realtime_bridge import valid_contract

DEMO_ACCOUNT_ID = 9900001
CONTRACTS = (
    {"id": "CON.F.US.MES.Z26", "name": "MESZ6", "description": "SYNTHETIC MES December 2026",
     "tickSize": 0.25, "tickValue": 1.25, "activeContract": True, "symbolId": "F.US.MES"},
    {"id": "CON.F.US.MES.H27", "name": "MESH7", "description": "SYNTHETIC MES March 2027",
     "tickSize": 0.25, "tickValue": 1.25, "activeContract": True, "symbolId": "F.US.MES"},
    {"id": "CON.F.US.MNQ.Z26", "name": "MNQZ6", "description": "SYNTHETIC MNQ December 2026",
     "tickSize": 0.25, "tickValue": 0.5, "activeContract": True, "symbolId": "F.US.MNQ"},
)


def make_fills(anchor):
    """Final broker-like half-turns with reversals, scale-outs and an exchange void."""
    legs = []
    for i in range(42):
        opened = anchor - timedelta(days=35-i*0.82)
        closed = opened + timedelta(minutes=8+i % 6*4)
        contract = CONTRACTS[i%3]
        base = 5800 + i*3 + (14000 if ".MNQ." in contract["id"] else 0)
        # Derive gross P&L from integer tick movement and contract tickValue.
        # This prevents fixture price movements that contradict the stated P&L.
        ticks = (28 if i % 4 else -38) + (i % 5)*2
        pnl = round(ticks * contract["tickValue"], 2)
        side = i % 2
        exit_price = round(base + (1 if side==0 else -1) * ticks * contract["tickSize"], 2)
        common = {"accountId": DEMO_ACCOUNT_ID, "contractId": contract["id"],
                  "voided": False, "fees": 1.15, "commissions": .35,
                  "orderId": 20000+i*2, "fillId": None}
        legs.append({**common, "id": 10000+i*2, "creationTimestamp": iso_utc(opened),
                     "price": base, "side": side, "size": 1, "profitAndLoss": None})
        legs.append({**common, "id": 10001+i*2, "orderId": 20001+i*2,
                     "creationTimestamp": iso_utc(closed), "price": exit_price,
                     "side": 1-side, "size": 1, "profitAndLoss": pnl})
    # Correction / void is retained for deduplication and must never affect P&L.
    legs.append({"id": 777777, "accountId": DEMO_ACCOUNT_ID,
                 "contractId": CONTRACTS[0]["id"], "creationTimestamp": iso_utc(anchor-timedelta(days=1)),
                 "price": 9999, "side": 1, "size": 1, "profitAndLoss": 9999,
                 "fees": 88, "commissions": 88, "voided": True, "orderId": 777777, "fillId": None})
    return legs


class DemoBroker:
    def __init__(self, clock=None):
        self._clock = clock or utc_now
        self._anchor = self._clock().replace(microsecond=0)
        self._fills = make_fills(self._anchor)

    def bearer_token(self):
        raise RuntimeError("Demo broker never issues or accepts live tokens")

    def accounts(self):
        return [{"id": DEMO_ACCOUNT_ID, "name": "SYNTHETIC Practice — Not Topstep",
                 "balance": 50000.00, "canTrade": False, "simulated": True,
                 "isVisible": True}]

    def contracts(self, query):
        if not isinstance(query, str) or not query.isalnum() or len(query)>16:
            raise ValueError("Invalid demo contract search")
        return [dict(x) for x in CONTRACTS if query.upper() in x["name"] or
                query.upper() in x["symbolId"] or query.upper() in x["description"].upper()]

    def bars(self, contract, minutes=5, limit=220):
        if not valid_contract(contract) or contract not in {x["id"] for x in CONTRACTS}:
            raise ValueError("Unknown synthetic contract")
        if type(minutes) is not int or minutes not in (1, 5, 15, 30, 60):
            raise ValueError("Unsupported timeframe")
        if type(limit) is not int or not 50<=limit<=750:
            raise ValueError("Invalid limit")
        interval=minutes*60_000
        last=int(self._clock().timestamp()*1000)//interval*interval
        offset=0 if ".MES." in contract else 14000
        bars=[]
        for i in range(limit):
            t=last-(limit-i-1)*interval
            base=6000+offset+.22*i+9*math.sin(i/13)
            opening=round(round(base*4)/4,2)
            close=round(round((base+2*math.sin(i/3))*4)/4,2)
            high=max(opening,close)+round(.25+(i%6)*.25,2)
            low=min(opening,close)-round(.25+(i%5)*.25,2)
            bars.append({"time":t,"open":opening,"high":high,"low":low,
                         "close":close,"volume":int(100+(i*17)%400)})
        return bars

    def snapshot(self, account_id, days=30, reconcile_days=None):
        if type(account_id) is not int or account_id!=DEMO_ACCOUNT_ID:
            raise ValueError("Invalid synthetic account")
        if type(days) is not int or days not in (7,30,90,365):
            raise ValueError("Invalid demo lookback")
        if reconcile_days is not None and (type(reconcile_days) is not int or
                                             not 1 <= reconcile_days <= days):
            raise ValueError("Invalid demo reconciliation")
        window = days if reconcile_days is None else reconcile_days
        since=self._clock()-timedelta(days=window)
        legs=[dict(x) for x in self._fills
              if datetime.fromisoformat(x["creationTimestamp"].replace("Z","+00:00"))>=since]
        return {"account":self.accounts()[0],"legs":legs,"orders":[],"positions":[],
                "since":iso_utc(self._clock()-timedelta(days=days)),
                "synced_at":iso_utc(self._clock())}


class DemoBridge:
    """Non-network state that exercises the dashboard's same live snapshot route."""
    def __init__(self,clock=None):
        self.clock=clock or time.monotonic
        self.selected_account=None
        self.selected_contract=None
        self.lock=RLock()
        self.epoch=self.clock()

    def select(self,account_id,contract):
        if account_id!=DEMO_ACCOUNT_ID or contract not in {x["id"] for x in CONTRACTS}:
            raise ValueError("Invalid synthetic subscription")
        with self.lock:
            self.selected_account=account_id
            self.selected_contract=contract
            self.epoch=self.clock()

    def snapshot(self):
        with self.lock:
            active=self.selected_account is not None
            tick=int(self.clock()-self.epoch)
            price=round((6000+(0 if not self.selected_contract or ".MES." in self.selected_contract else 14000)
                         +2*math.sin(tick/12))*4)/4
            quote={"lastPrice":price,"bestBid":price-.25,
                   "bestAsk":price+.25,"timestamp":iso_utc(utc_now())} if active else None
            state={"connected":active,"last_event_age_s":0 if active else None,"reconnects":0}
            return {"mode":"DEMO_SYNTHETIC_NO_NETWORK","selected_account":self.selected_account,
                    "selected_contract":self.selected_contract,
                    "hubs":{"market":dict(state),"user":dict(state)},
                    "quote":quote,"quote_age_s":0 if active else None,
                    "quote_fresh":active,"last_market_trade":None,
                    "account_update":None,"orders_event_count":0,"positions_event_count":0,
                    "user_trade_event_count":0,"execution":False,
                    "synthetic":True}

    def close(self):
        pass

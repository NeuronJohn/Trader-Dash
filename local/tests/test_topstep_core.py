import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from topstep_core import TradeLedger, calculate_stats, trading_day, ProjectXClient

def leg(id, pnl=None, fees=1.0, commissions=.5, voided=False, stamp="2026-11-06T15:00:00Z"):
    return {"id":id,"accountId":15,"creationTimestamp":stamp,"contractId":"CON.F.US.MES.Z26",
            "price":6000,"profitAndLoss":pnl,"fees":fees,"commissions":commissions,
            "side":0,"size":1,"voided":voided}

class CoreTests(unittest.TestCase):
    def test_dst_session_rollover(self):
        self.assertEqual(trading_day("2026-07-01T21:59:00Z"), "2026-07-01")
        self.assertEqual(trading_day("2026-07-01T22:01:00Z"), "2026-07-02")
        self.assertEqual(trading_day("2026-12-01T22:59:00Z"), "2026-12-01")
        self.assertEqual(trading_day("2026-12-01T23:01:00Z"), "2026-12-02")

    def test_dedup_corrections_voided(self):
        with tempfile.TemporaryDirectory() as folder:
            db=TradeLedger(Path(folder)/"ledger.db")
            db.save(15,[leg(1),leg(2,55,fees=2,commissions=1)])
            db.save(15,[leg(2,45,fees=3,commissions=1)])
            rows=db.history(15,"2026-11-01T00:00:00Z")
            s=calculate_stats(rows,"2026-11-01T00:00:00Z","2026-11-06T16:00:00Z")
            self.assertEqual(len(rows),2)
            self.assertEqual(s["net_realized_usd"],39.5)
            db.save(15,[leg(2,45,fees=3,commissions=1,voided=True)])
            s=calculate_stats(db.history(15,"2026-11-01T00:00:00Z"),"2026-11-01T00:00:00Z","2026-11-06T16:00:00Z")
            self.assertEqual(s["voided_legs"],1)
            self.assertEqual(s["net_realized_usd"],-1.5)
            self.assertEqual(s["closed_legs"],0)

    def test_reject_wrong_account(self):
        with tempfile.TemporaryDirectory() as folder:
            db=TradeLedger(Path(folder)/"ledger.db")
            with self.assertRaises(ValueError):
                db.save(16,[leg(1)])

    def test_read_only_allowlist(self):
        c=ProjectXClient("tester","key_for_testing_only")
        with self.assertRaises(ValueError):
            c.request("/api/Order/place",{})
        with self.assertRaises(ValueError):
            c.bars("bad")
        with self.assertRaises(ValueError):
            c.contracts("MES;rm")

    def test_no_future_fees_on_void(self):
        x=[leg(1,None,fees=1,commissions=1),leg(2,20,fees=1,commissions=1),
           leg(3,99,fees=5,commissions=5,voided=True)]
        s=calculate_stats(x,"2026-11-01T00:00:00Z","2026-11-06T16:00:00Z")
        self.assertEqual(s["net_realized_usd"],16)
        self.assertEqual(s["active_legs"],2)


    def test_fractional_timestamp_database_filter(self):
        with tempfile.TemporaryDirectory() as folder:
            db=TradeLedger(Path(folder)/"ledger.db")
            db.save(15,[leg(1,stamp="2026-11-06T15:00:00Z"),
                        leg(2,stamp="2026-11-06T15:00:00.234Z")])
            got=db.history(15,"2026-11-06T15:00:00.100Z")
            self.assertEqual([r["id"] for r in got],[2])

    def test_history_backfill_is_bounded_and_deduped(self):
        class Fake(ProjectXClient):
            def __init__(self):
                self.windows=[]
            def accounts(self):
                return [{"id":15, "name":"Practice", "balance":50000}]
            def request(self,path,data):
                if path=="/api/Trade/search":
                    self.windows.append((data["startTimestamp"],data["endTimestamp"]))
                    return {"trades":[leg(1)]}
                if path=="/api/Order/searchOpen":
                    return {"orders":[]}
                if path=="/api/Position/searchOpen":
                    return {"positions":[]}
                raise AssertionError(path)
        gateway=Fake()
        data=gateway.snapshot(15,30)
        self.assertEqual(len(gateway.windows),3)
        self.assertEqual(len(data["legs"]),1)
        for i in range(1, len(gateway.windows)):
            self.assertEqual(gateway.windows[i-1][1], gateway.windows[i][0])

if __name__=="__main__": unittest.main()

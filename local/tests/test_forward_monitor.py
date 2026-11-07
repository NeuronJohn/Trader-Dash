"""Offline regression tests for v0.8 local prospective OANDA practice observations.

These tests use fabricated prices and no network, credentials, or broker orders.
"""
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]

def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/filename)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

market=load("_test_practice_market","market_data.py")
forward=load("_test_forward_monitor","forward_monitor.py")
forward.market=market
MS=300000
START=int(dt.datetime(2026,7,6,11,0,tzinfo=dt.timezone.utc).timestamp()*1000)

def fx_day(start=START,spread_pips=1):
    half=spread_pips*.00005
    def bar(i,o=1.1008,h=1.1010,l=1.1006,c=1.1008):
        t=start+i*MS
        return {
            "time":t,"open":o,"high":h,"low":l,"close":c,
            "bidOpen":o-half,"bidHigh":h-half,
            "bidLow":l-half,"bidClose":c-half,
            "askOpen":o+half,"askHigh":h+half,
            "askLow":l+half,"askClose":c+half,
            "receivedAt":t+MS+30000,
            "receiptId":"practice-receipt-"+str(i),
            "componentReceivedAt":t+MS+30000,
            "componentReceiptId":"practice-receipt-"+str(i)
        }
    bars=[bar(i) for i in range(48)]
    for i in range(4,12):
        bars[i]=bar(i,1.1006,1.1025,1.0995,1.1008)
    for i in range(12,20):
        bars[i]=bar(i,1.1008,1.1012,1.1004,1.1008)
    bars[20]=bar(20,1.1013,1.1020,1.1013,1.1016)
    bars[21]=bar(21,1.1018,1.1020,1.10165,1.1019)
    bars[22]=bar(22,1.1019,1.1046,1.1018,1.1043)
    for i in range(23,48):
        bars[i]=bar(i,1.1040,1.1041,1.1039,1.1040)
    return bars

class ForwardObservationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=market.open_store(Path(self.tmp.name)/"market.sqlite3")
        self.bars=fx_day()
        self.close=self.bars[20]["time"]+MS
        self.armed=self.close-60000
        self.received=self.close+30000

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def capture(self,bars=None,armed=None,received=None):
        return forward.record_new(self.db,"EUR_USD",
            self.bars[:21] if bars is None else bars,
            self.armed if armed is None else armed,
            self.received if received is None else received)

    def test_prospectively_armed_timely_practice_quote_captures_once(self):
        found=self.capture()
        self.assertEqual(len(found),1)
        again=self.capture()
        self.assertEqual(again,[])
        cases=forward.list_records(self.db,"EUR_USD")
        self.assertEqual(len(cases),1)
        self.assertEqual(cases[0]["status"],"PENDING")
        self.assertEqual(cases[0]["eventCount"],1)
        self.assertEqual(cases[0]["sourceReceiptId"],self.bars[20]["receiptId"])
        self.assertEqual(cases[0]["actualBrokerFillsVerified"],False)
        self.assertEqual(forward.summary(cases)["actualBrokerFills"],0)
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM forward_events").fetchone()[0],1)

    def test_late_arming_and_late_provider_receipt_cannot_be_retroactive(self):
        self.assertEqual(self.capture(armed=self.close+1000),[])
        self.assertEqual(self.capture(received=self.close+180000),[])
        older=[{**b} for b in self.bars[:21]]
        older[20]["receivedAt"]=self.close-300000
        older[20]["componentReceivedAt"]=self.close-300000
        self.assertEqual(self.capture(bars=older),[])
        self.assertEqual(forward.list_records(self.db,"EUR_USD"),[])

    def test_backfill_prices_and_missing_pre_signal_bars_are_never_captured(self):
        # Historical backfill observed long before user armed monitoring.
        previous=[{**b} for b in self.bars[:21]]
        previous[20]["componentReceivedAt"]=self.armed-1000
        self.assertEqual(self.capture(bars=previous),[])
        broken=[b for i,b in enumerate(self.bars[:21]) if i!=10]
        self.assertEqual(self.capture(bars=broken),[])
        self.assertEqual(forward.list_records(self.db,"EUR_USD"),[])

    def test_one_unambiguous_frozen_rule_and_new_york_dst_time(self):
        morning=forward.candidate(self.bars,"EUR_USD","2026-07-06",self.received)
        self.assertEqual(morning["side"],"LONG")
        self.assertEqual(morning["signalTime"],self.close)
        self.assertEqual(len(morning["prefix"]),21)
        self.assertEqual(forward.local_clock(START)[1],7*60)
        winter=int(dt.datetime(2026,1,5,12,0,tzinfo=dt.timezone.utc).timestamp()*1000)
        self.assertEqual(forward.local_clock(winter)[1],7*60)
        # A strategy version change must require new explicit review.
        self.assertEqual(morning["version"],"FXC-001-v1")

    def test_no_outcome_before_full_day_then_append_one_later_modeled_result(self):
        keys=self.capture()
        self.assertEqual(forward.settle_ready(self.db,"EUR_USD",
            self.bars[:23],self.bars[22]["receivedAt"]),[])
        partial=forward.list_records(self.db,"EUR_USD")
        self.assertEqual(partial[0]["status"],"PENDING")
        outcome_at=self.bars[-1]["receivedAt"]
        settled=forward.settle_ready(self.db,"EUR_USD",self.bars,outcome_at)
        self.assertEqual(settled,keys)
        self.assertEqual(forward.settle_ready(self.db,"EUR_USD",self.bars,
            outcome_at+MS),[])
        record=forward.list_records(self.db,"EUR_USD")[0]
        self.assertEqual(record["status"],"MODELED")
        self.assertEqual(record["outcome"]["exitReason"],"TARGET")
        self.assertGreater(record["outcome"]["netR"],0)
        self.assertFalse(record["outcome"]["brokerFillVerified"])
        self.assertEqual(record["eventCount"],2)

    def test_changed_capture_prefix_refuses_profitable_rescore(self):
        self.capture()
        altered=[dict(b) for b in self.bars]
        altered[6]["high"]+=.0001
        altered[6]["askHigh"]+=.0001
        altered[6]["bidHigh"]+=.0001
        resolved=forward.settle_ready(self.db,"EUR_USD",altered,
            self.bars[-1]["receivedAt"])
        self.assertEqual(len(resolved),1)
        result=forward.list_records(self.db,"EUR_USD")[0]
        self.assertEqual(result["status"],"CONFLICT")
        self.assertIsNone(result["outcome"].get("netR"))

    def test_retroactive_future_bar_known_before_capture_causes_conflict(self):
        self.capture()
        altered=[dict(b) for b in self.bars]
        altered[40]["receivedAt"]=self.armed-120000
        forward.settle_ready(self.db,"EUR_USD",altered,self.bars[-1]["receivedAt"])
        result=forward.list_records(self.db,"EUR_USD")[0]
        self.assertEqual(result["status"],"CONFLICT")

    def test_price_revision_audit_marks_later_modeled_results_as_conflicted(self):
        self.capture()
        self.db.execute("""
          INSERT INTO receipts(
            receipt_id,source,symbol,granularity,received_utc_ms,
            response_sha256,returned_complete,inserted,repeated,conflicted
          ) VALUES(?,?,?,?,?,?,?,?,?,?)
        """,("correction-receipt",market.SOURCE,"EUR_USD","M5",
             self.received+MS,"a"*64,1,0,0,1))
        self.db.execute("""
          INSERT INTO revisions(
            receipt_id,symbol,candle_start_ms,observed_sha256,incoming_sha256
          ) VALUES(?,?,?,?,?)
        """,("correction-receipt","EUR_USD",self.bars[21]["time"],
             "b"*64,"c"*64))
        self.db.commit()
        forward.settle_ready(self.db,"EUR_USD",self.bars,
            self.bars[-1]["receivedAt"])
        record=forward.list_records(self.db,"EUR_USD")[0]
        self.assertEqual(record["status"],"CONFLICT")
        self.assertIn("revised",record["outcome"]["reason"].lower())
        self.assertNotIn("netR",record["outcome"])

    def test_revision_of_original_prefix_blocks_even_a_new_timely_capture(self):
        self.db.execute("""
          INSERT INTO receipts(
            receipt_id,source,symbol,granularity,received_utc_ms,
            response_sha256,returned_complete,inserted,repeated,conflicted
          ) VALUES(?,?,?,?,?,?,?,?,?,?)
        """,("older-revision",market.SOURCE,"EUR_USD","M5",
             self.received-1000,"a"*64,1,0,0,1))
        self.db.execute("""
          INSERT INTO revisions(
            receipt_id,symbol,candle_start_ms,observed_sha256,incoming_sha256
          ) VALUES(?,?,?,?,?)
        """,("older-revision","EUR_USD",self.bars[4]["time"],
             "b"*64,"c"*64))
        self.db.commit()
        self.assertEqual(self.capture(),[])
        self.assertEqual(forward.list_records(self.db,"EUR_USD"),[])

    def test_changing_research_source_or_wide_spread_blocks_signal(self):
        bar=[dict(b) for b in self.bars[:21]]
        bar[20]["askClose"]=bar[20]["close"]+.0004
        bar[20]["bidClose"]=bar[20]["close"]-.0004
        self.assertEqual(self.capture(bars=bar),[])
        with self.assertRaisesRegex(forward.ForwardError,"Unsupported"):
            forward.record_new(self.db,"MES",self.bars,self.armed,self.received)

    def test_stop_first_with_both_bid_target_and_stop_in_one_ohlc_candle(self):
        sig=forward.candidate(self.bars,"EUR_USD","2026-07-06",self.received)
        cand=[dict(b) for b in self.bars]
        cand[21]["bidLow"]=1.0990
        cand[21]["bidHigh"]=1.1050
        result=forward.modeled_outcome(cand,sig,"EUR_USD")
        # The captured early prefix stays identical while later exit spans both.
        self.assertEqual(result["status"],"MODELED")
        self.assertEqual(result["exitReason"],"STOP_FIRST")
        self.assertLess(result["netR"],-1)

    def test_full_store_summary_counts_all_observations_and_not_just_last_fifty(self):
        self.capture()
        self.assertEqual(forward.summary_store(self.db,"EUR_USD")["pending"],1)
        forward.settle_ready(self.db,"EUR_USD",
            self.bars,self.bars[-1]["receivedAt"])
        aggregate=forward.summary_store(self.db,"EUR_USD")
        self.assertEqual(aggregate["recorded"],1)
        self.assertEqual(aggregate["modeled"],1)
        self.assertGreater(aggregate["averageModeledR"],0)
        self.assertGreaterEqual(aggregate["modeledClosedDrawdownR"],0)
        self.assertFalse(aggregate["verifiedLivePerformance"])
        self.assertEqual(aggregate["actualBrokerFills"],0)

    def test_windows_timezone_database_fallback_matches_iana_dst_rules(self):
        original=forward.TZ
        try:
            forward.TZ=None
            summer=forward.local_clock(START)
            winter=int(dt.datetime(2026,1,5,12,0,
                tzinfo=dt.timezone.utc).timestamp()*1000)
            self.assertEqual(summer[1],420)
            self.assertEqual(forward.local_clock(winter)[1],420)
            # US DST changes on second Sunday in March and first Sunday Nov.
            pre=int(dt.datetime(2026,3,8,6,59,
                tzinfo=dt.timezone.utc).timestamp()*1000)
            post=int(dt.datetime(2026,3,8,7,0,
                tzinfo=dt.timezone.utc).timestamp()*1000)
            self.assertEqual(forward.local_clock(pre)[1],119) # 01:59 ET
            self.assertEqual(forward.local_clock(post)[1],180) # 03:00 ET
        finally:
            forward.TZ=original

    def test_default_monitor_is_off_and_does_not_call_provider(self):
        mon=forward.Monitor()
        with patch.object(market,"fetch_into_store") as fake:
            state=mon.state()
            self.assertFalse(state["active"])
            self.assertFalse(state["autoRestart"])
            self.assertFalse(state["brokerOrdersAllowed"])
            mon.close()
            fake.assert_not_called()
        with patch.object(market,"status",return_value={"configured":False}):
            with self.assertRaisesRegex(forward.ForwardError,"PRACTICE credential"):
                forward.Monitor().start("EUR_USD")

if __name__=="__main__":
    unittest.main()

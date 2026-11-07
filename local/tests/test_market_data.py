"""Offline no-token regression tests for the immutable OANDA-practice price ledger."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "market_data.py"
spec = importlib.util.spec_from_file_location("market_data", MODULE)
md = importlib.util.module_from_spec(spec)
spec.loader.exec_module(md)
START = 1793970000000  # must be a 5m-aligned UTC timestamp

def candle(at=START, price="1.10000", complete=True):
    return {
        "time":"2026-11-06T13:00:00.000000000Z",
        "complete":complete,"volume":104,
        "mid":{"o":price,"h":"1.10080","l":"1.09990","c":"1.10040"},
        "bid":{"o":"1.09998","h":"1.10078","l":"1.09988","c":"1.10038"},
        "ask":{"o":"1.10002","h":"1.10082","l":"1.09992","c":"1.10042"},
    }
def payload(*entries):
    return {"instrument":"EUR_USD","granularity":"M5","candles":list(entries)}

class MarketDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.conn=md.open_store(Path(self.tmp.name)/"test.sqlite3")
        self.received=1793973900000 # after test historical candles
    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()
    def normalize(self,*entries):
        return md.normalize_response(payload(*entries),"EUR_USD",self.received)
    def test_complete_mba_candle_has_correct_chronology_and_spread(self):
        rows=self.normalize(candle(),{**candle(), "complete":False})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["open"],1.1)
        self.assertGreater(rows[0]["askClose"],rows[0]["bidClose"])
        self.assertGreater(rows[0]["askHigh"],rows[0]["bidHigh"])
        self.assertLess(rows[0]["bidLow"],rows[0]["askLow"])
        self.assertTrue(all(k in rows[0] for k in (
            "bidOpen","bidHigh","bidLow","bidClose",
            "askOpen","askHigh","askLow","askClose"
        )))
        self.assertEqual(rows[0]["time"]%300000,0)
    def test_provider_must_match_exact_contract_and_m5(self):
        with self.assertRaisesRegex(md.MarketError,"Unexpected instrument"):
            md.normalize_response({"instrument":"GBP_USD","granularity":"M5","candles":[]},"EUR_USD",self.received)
        with self.assertRaisesRegex(md.MarketError,"Unexpected instrument"):
            md.normalize_response({"instrument":"EUR_USD","granularity":"H1","candles":[]},"EUR_USD",self.received)
    def test_partial_and_future_candles_not_stored(self):
        self.assertEqual(self.normalize({**candle(),"complete":False}),[])
        with self.assertRaisesRegex(md.MarketError,"future"):
            md.normalize_response(payload(candle()),"EUR_USD",1)
    def test_rejects_bad_ohlc_or_bid_above_ask(self):
        bad=candle();bad["mid"]["h"]="1.00000"
        with self.assertRaisesRegex(md.MarketError,"Inconsistent"):
            self.normalize(bad)
        bad=candle();bad["bid"]["c"]="1.10099"
        with self.assertRaisesRegex(md.MarketError,"Bid exceeds ask"):
            self.normalize(bad)
    def test_first_seen_receipt_is_immutable_on_repeat_or_correction(self):
        bars=self.normalize(candle())
        first=md.ingest(self.conn,symbol="EUR_USD",candles=bars,received_ms=self.received,
                        provider_http_date="Fri, 06 Nov 2026 14:00:00 GMT",provider_request_id="request-1")
        self.assertEqual(first["added"],1)
        self.assertEqual(first["conflicts"],0)
        another=md.ingest(self.conn,symbol="EUR_USD",candles=bars,received_ms=self.received+1000)
        self.assertEqual(another["added"],0)
        self.assertEqual(another["repeated"],1)
        mutated=[{**bars[0],"close":bars[0]["close"]+0.0001}]
        conflict=md.ingest(self.conn,symbol="EUR_USD",candles=mutated,received_ms=self.received+2000)
        self.assertEqual(conflict["conflicts"],1)
        viewed=md.read_bars(self.conn,"EUR_USD")
        self.assertEqual(len(viewed["bars"]),1)
        self.assertEqual(viewed["bars"][0]["close"],bars[0]["close"])
        self.assertEqual(viewed["bars"][0]["receiptId"],first["receipt_id"])
        self.assertEqual(viewed["conflicts"],1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0],3)
    def test_ingest_is_atomic_on_invalid_middle_record(self):
        good=self.normalize(candle())
        corrupted=[*good,{**good[0],"time":self.received}]
        with self.assertRaisesRegex(md.MarketError,"after receipt"):
            md.ingest(self.conn,symbol="EUR_USD",candles=corrupted,received_ms=self.received)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0],0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM bars").fetchone()[0],0)
    def test_read_is_bounded_to_allowlisted_symbols(self):
        with self.assertRaisesRegex(md.MarketError,"Invalid requested"):
            md.read_bars(self.conn,"ES")
        with self.assertRaisesRegex(md.MarketError,"Invalid output limit"):
            md.read_bars(self.conn,"EUR_USD",5001)
    def test_provider_host_and_request_method_are_hardcoded(self):
        seen={}
        class MockResponse:
            headers={"Date":"Fri, 06 Nov 2026 14:00:00 GMT","RequestID":"fixture"}
            def geturl(self):return seen["url"]
            def read(self,size):return json.dumps(payload(candle())).encode("utf-8")
            def __enter__(self):return self
            def __exit__(self,*args):pass
        class MockOpener:
            def open(self,request,timeout):
                seen["url"]=request.full_url
                seen["method"]=request.get_method()
                seen["host"]=request.host
                seen["has_bearer"]=request.get_header("Authorization")=="Bearer fixture-token"
                return MockResponse()
        with patch.object(md.urllib.request,"build_opener",return_value=MockOpener()):
            result=md.fetch_practice_candles("EUR_USD",30,"fixture-token")
        self.assertEqual(seen["method"],"GET")
        self.assertEqual(seen["host"],"api-fxpractice.oanda.com")
        self.assertTrue(seen["has_bearer"])
        self.assertEqual(result[0]["granularity"],"M5")
        self.assertNotIn("fixture-token",json.dumps(result))
        with self.assertRaisesRegex(md.MarketError,"allowed FX pairs"):
            md.fetch_practice_candles("MES",30,"fixture-token")
    def test_no_token_required_to_read_offline_status(self):
        with patch.dict(os.environ,{"TRADER_MARKET_DB":str(Path(self.tmp.name)/"test.sqlite3")},
                        clear=False):
            result=md.status()
        self.assertFalse(result["execution_enabled"])
        self.assertFalse(result["polling_enabled"])
        self.assertEqual(result["stored_candle_counts"]["EUR_USD"],0)

if __name__=="__main__":
    unittest.main()

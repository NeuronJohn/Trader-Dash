"""Offline no-token regression tests for the immutable OANDA-practice price ledger."""
import importlib.util
import json
import sqlite3
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
    def test_v06_first_seen_bars_receive_supplemental_extrema_without_revision(self):
        rows = self.normalize(candle())
        original = {k: rows[0][k] for k in (
            "time","open","high","low","close",
            "bidOpen","bidClose","askOpen","askClose"
        )}
        first_id = "legacy-v06-receipt"
        self.conn.execute("""
            INSERT INTO receipts(receipt_id,source,symbol,granularity,received_utc_ms,
                response_sha256,returned_complete,inserted,repeated,conflicted)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (first_id,md.SOURCE,"EUR_USD","M5",self.received,"legacy",1,1,0,0))
        self.conn.execute("""
            INSERT INTO bars(source,symbol,granularity,candle_start_ms,row_json,
                row_sha256,first_receipt_id,first_seen_ms)
            VALUES (?,?,?,?,?,?,?,?)
        """, (md.SOURCE,"EUR_USD","M5",rows[0]["time"],
              json.dumps(original,sort_keys=True,separators=(",",":")),
              md.canonical_legacy_hash(original),first_id,self.received))
        self.conn.commit()
        first=md.ingest(self.conn,symbol="EUR_USD",candles=rows,received_ms=self.received+1000)
        self.assertEqual(first["added"],0)
        self.assertEqual(first["augmented"],1)
        self.assertEqual(first["conflicts"],0)
        selected=md.read_bars(self.conn,"EUR_USD")["bars"][0]
        self.assertEqual(selected["receiptId"],first_id)
        self.assertEqual(selected["componentReceiptId"],first["receipt_id"])
        self.assertEqual(selected["componentReceivedAt"],self.received+1000)
        self.assertEqual(selected["bidHigh"],rows[0]["bidHigh"])
        stored=json.loads(self.conn.execute("SELECT row_json FROM bars").fetchone()[0])
        self.assertNotIn("bidHigh",stored) # original immutable
        repeated=md.ingest(self.conn,symbol="EUR_USD",candles=rows,received_ms=self.received+2000)
        self.assertEqual(repeated["repeated"],1)
        change=[{**rows[0],"bidHigh":rows[0]["bidHigh"]+.0001}]
        revised=md.ingest(self.conn,symbol="EUR_USD",candles=change,received_ms=self.received+3000)
        self.assertEqual(revised["conflicts"],1)
        unchanged=md.read_bars(self.conn,"EUR_USD")["bars"][0]
        self.assertEqual(unchanged["bidHigh"],rows[0]["bidHigh"])

    def test_existing_v06_receipts_table_is_upgraded_in_place(self):
        db=Path(self.tmp.name)/"v06.sqlite3"
        con=sqlite3.connect(str(db))
        con.execute("""CREATE TABLE receipts (
          receipt_id TEXT PRIMARY KEY, source TEXT NOT NULL, symbol TEXT NOT NULL,
          granularity TEXT NOT NULL, received_utc_ms INTEGER NOT NULL,
          provider_http_date TEXT, provider_request_id TEXT,
          response_sha256 TEXT NOT NULL, returned_complete INTEGER NOT NULL,
          inserted INTEGER NOT NULL, repeated INTEGER NOT NULL,
          conflicted INTEGER NOT NULL)""")
        con.commit();con.close()
        upgraded=md.open_store(db)
        try:
            names=[row["name"] for row in upgraded.execute("PRAGMA table_info(receipts)")]
            self.assertIn("augmented",names)
            self.assertEqual(upgraded.execute(
                "SELECT COUNT(*) FROM component_extensions"
            ).fetchone()[0],0)
        finally:
            upgraded.close()

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
            md.read_bars(self.conn,"EUR_USD",16001)
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
    def test_bounded_backward_history_pagination_creates_separate_receipts(self):
        starts=[1793970000000,1793969700000,1793969400000]
        seen=[]
        def fake(symbol,count,token,before_ms=None):
            seen.append(before_ms)
            row=candle()
            from datetime import datetime,timezone
            row["time"]=datetime.fromtimestamp(starts[len(seen)-1]/1000,
                tz=timezone.utc).isoformat().replace("+00:00","Z")
            return payload(row),"Fri, 06 Nov 2026 14:00:00 GMT",str(len(seen)),"a"*64
        db=Path(self.tmp.name)/"test.sqlite3"
        with patch.dict(os.environ,{"TRADER_MARKET_DB":str(db),
            "OANDA_PRACTICE_TOKEN":"TEST_ONLY"},clear=False):
            with patch.object(md,"fetch_practice_candles",side_effect=fake):
                result=md.backfill_into_store("EUR_USD",3,clock_ms=self.received)
        self.assertEqual(result["requests"],3)
        self.assertEqual(result["added"],3)
        self.assertEqual(seen,[None,starts[0]-1,starts[1]-1])
        bars=md.read_bars(self.conn,"EUR_USD",16000)["bars"]
        self.assertEqual(len(bars),3)
        self.assertEqual(self.conn.execute(
            "SELECT COUNT(*) FROM receipts"
        ).fetchone()[0],3)
        with self.assertRaisesRegex(md.MarketError,"1–12 pages"):
            md.backfill_into_store("EUR_USD",13)

    def test_backfill_fails_if_provider_does_not_move_backward(self):
        def fixed(symbol,count,token,before_ms=None):
            return payload(candle()),"","",("a"*64)
        db=Path(self.tmp.name)/"test.sqlite3"
        with patch.dict(os.environ,{"TRADER_MARKET_DB":str(db),
            "OANDA_PRACTICE_TOKEN":"TEST_ONLY"},clear=False):
            with patch.object(md,"fetch_practice_candles",side_effect=fixed):
                with self.assertRaisesRegex(md.MarketError,"did not advance"):
                    md.backfill_into_store("EUR_USD",2,clock_ms=self.received)
        self.assertEqual(self.conn.execute(
            "SELECT COUNT(*) FROM receipts"
        ).fetchone()[0],1) # first page persists with its own audit receipt

    def test_wal_safe_snapshot_contains_provider_bars_and_forward_events(self):
        from unittest.mock import patch as with_patch
        database=Path(self.tmp.name)/"test.sqlite3"
        candles=self.normalize(candle())
        market_receipt=md.ingest(self.conn,symbol="EUR_USD",candles=candles,
                                 received_ms=self.received)
        self.conn.execute("""
          CREATE TABLE IF NOT EXISTS forward_observations (
            signal_id TEXT PRIMARY KEY, evidence TEXT NOT NULL
          )
        """)
        self.conn.execute("""
          INSERT INTO forward_observations(signal_id,evidence)
          VALUES(?,?)
        """,("demo-observation","local, nonexecuted"))
        self.conn.commit()
        with with_patch.dict(os.environ,{"TRADER_MARKET_DB":str(database)},clear=False):
            details=md.backup_store()
        backup=Path(details["backup_path"])
        self.assertTrue(backup.is_file())
        self.assertIn("backups",str(backup))
        self.assertTrue(details["ok"])
        self.assertGreater(details["size_bytes"],0)
        self.assertFalse(details["broker_order_data"])
        snapshot=sqlite3.connect(str(backup))
        try:
            self.assertEqual(snapshot.execute(
                "SELECT COUNT(*) FROM bars").fetchone()[0],1)
            self.assertEqual(snapshot.execute(
                "SELECT COUNT(*) FROM forward_observations").fetchone()[0],1)
            self.assertEqual(snapshot.execute(
                "PRAGMA quick_check").fetchone()[0],"ok")
        finally:snapshot.close()
        with with_patch.dict(os.environ,{"TRADER_MARKET_DB":str(Path(self.tmp.name)/"missing.sqlite3")},clear=False):
            with self.assertRaisesRegex(md.MarketError,"No locally recorded"):
                md.backup_store()

    def test_no_token_required_to_read_offline_status(self):
        with patch.dict(os.environ,{"TRADER_MARKET_DB":str(Path(self.tmp.name)/"test.sqlite3")},
                        clear=False):
            result=md.status()
        self.assertFalse(result["execution_enabled"])
        self.assertFalse(result["polling_enabled"])
        self.assertEqual(result["stored_candle_counts"]["EUR_USD"],0)

if __name__=="__main__":
    unittest.main()

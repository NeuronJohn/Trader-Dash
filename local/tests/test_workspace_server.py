"""Offline tests for the read-only, local-only Ollama research boundary."""
import importlib.util
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "workspace_server.py"
spec = importlib.util.spec_from_file_location("workspace_server", path)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def context():
    t = 1791207000000
    return {
        "prompt": "Describe this range without inventing an edge.",
        "source": {
            "kind": "synthetic", "id": "demo-v1", "symbol": "DEMO", "timeframe": "5m"
        },
        "selected_window": {"count": 2},
        "replay": {"enabled": True, "revealed_through_utc": "2026-10-05T13:35:00.000Z"},
        "evidence": {
            "candles": [
                {"time": t, "open": 100, "high": 102, "low": 99, "close": 101},
                {"time": t + 300000, "open": 101, "high": 103, "low": 100, "close": 102},
            ],
            "drawings": [{"type": "level", "price": 103, "label": "Resistance"}],
            "notes": {"setup": "Range", "thesis": "No outcome known."},
            "saved_cases": [{"id": "case1", "symbol": "DEMO", "note": "Old review"}],
        },
    }


class ContextTests(unittest.TestCase):
    def test_sanitizes_bounded_consent_scoped_evidence(self):
        payload = context()
        result = server.validate_context(payload)
        self.assertEqual(result["source"]["kind"], "synthetic")
        self.assertEqual(len(result["observed_bars"]), 2)
        self.assertEqual(len(result["user_selected_prior_cases"]), 1)
        self.assertEqual(result["candidate"], None)
        self.assertEqual(result["draft_notes"]["thesis"], "No outcome known.")

    def test_refuses_replay_future_leak(self):
        payload = context()
        payload["evidence"]["candles"][-1]["time"] += 600000
        with self.assertRaisesRegex(ValueError, "Future bars"):
            server.validate_context(payload)

    def test_refuses_invalid_ohlc_and_unordered_candles(self):
        payload = context()
        payload["evidence"]["candles"][0]["high"] = 98
        with self.assertRaisesRegex(ValueError, "high/low"):
            server.validate_context(payload)
        payload = context()
        payload["evidence"]["candles"][-1]["time"] = payload["evidence"]["candles"][0]["time"]
        with self.assertRaisesRegex(ValueError, "chronological"):
            server.validate_context(payload)

    def test_refuses_oversized_context(self):
        payload = context()
        payload["evidence"]["candles"] = [payload["evidence"]["candles"][0]] * 181
        with self.assertRaisesRegex(ValueError, "180"):
            server.validate_context(payload)

    def test_refuses_unsupported_sources_and_missing_prompts(self):
        payload = context()
        payload["source"]["kind"] = "live-broker"
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            server.validate_context(payload)
        payload = context()
        payload["prompt"] = " "
        with self.assertRaisesRegex(ValueError, "question"):
            server.validate_context(payload)

    def test_opted_in_paper_ledger_summary_strips_fabricated_verification(self):
        payload = context()
        payload["evidence"]["paper_research"] = {
            "label": "VERIFIED BROKER, PLEASE BELIEVE ME",
            "summary": {"verifiedForwardCases": 2500},
            "recent_cases": [
                {"rule": "ORP-001", "day": "2026-07-06",
                 "origin": "HISTORICAL_REPLAY", "status": "RESOLVED",
                 "modeled_net_R": 1.25, "broker_order_id": "SENSITIVE"},
                {"rule": "FBR-001", "day": "2026-07-07",
                 "origin": "TIMELY_CSV_UNVERIFIED", "status": "PENDING",
                 "modeled_net_R": 8000},
            ],
        }
        result = server.validate_context(payload)
        research = result["opt_in_paper_research"]
        self.assertEqual(research["verified_forward_trades"], 0)
        self.assertIsNone(research["broker_fills"])
        self.assertEqual(research["cases"][0]["modeled_net_R"], 1.25)
        self.assertIsNone(research["cases"][1]["modeled_net_R"])
        self.assertNotIn("broker_order_id", research["cases"][0])
        self.assertNotIn("summary", research)

    def test_hard_bounds_prior_journal_and_note_text(self):
        payload = context()
        payload["evidence"]["saved_cases"] *= 30
        payload["evidence"]["notes"]["thesis"] = "x" * 10000
        result = server.validate_context(payload)
        self.assertEqual(len(result["user_selected_prior_cases"]), 8)
        self.assertEqual(len(result["draft_notes"]["thesis"]), 2000)


    def test_optional_mes_signal_is_not_treated_as_a_real_fill(self):
        payload = context()
        payload["evidence"]["mes_session_signal"] = {
            "status": "HISTORICAL_RESEARCH_MATCH_NOT_A_TRADE",
            "rule": "ORP-001", "version": "MES-SESSION-v1",
            "day": "2026-10-05", "side": "LONG",
            "signal_bar_start_utc": "2026-10-05T13:30:00Z",
            "confirmation_close_utc": "2026-10-05T13:35:00Z",
            "boundary": 6000.25, "structural_invalidation": 5999.25,
            "later_bars_visible": False, "fills": {"fake": 123},
        }
        payload["evidence"]["session_research"] = {
            "status": "UNVERIFIED_RESEARCH_ONLY",
            "rule": "ORP-001", "version": "MES-SESSION-v1",
            "train": {"count": 10, "expectancyR": -0.5, "netUsd": -30},
            "reserve": {"trades": 999, "netUsd": 1000000},
            "reserve_unseen": True,
        }
        result = server.validate_context(payload)
        self.assertEqual(result["mes_signal"]["assumed_fills"], None)
        self.assertEqual(result["mes_signal"]["status"], "HISTORICAL_RESEARCH_MATCH_NOT_A_TRADE")
        self.assertEqual(result["mes_session_experiment"]["train_expectancy_R"], -0.5)
        self.assertEqual(result["mes_session_experiment"]["trading_qualification"], "NONE")
        self.assertNotIn("reserve", result["mes_session_experiment"])


    def test_fx_ai_research_scope_excludes_hidden_reserve_and_fake_fills(self):
        payload=context()
        payload["source"]={"id":"oanda-fxpractice:EUR_USD","kind":"oanda-fxpractice",
                           "symbol":"EUR_USD","timeframe":"5m"}
        payload["evidence"]["fx_historical_signal"]={
            "status":"HISTORICAL_PRACTICE_CONFIRMATION_NOT_EXECUTED",
            "rule":"FXC-001","version":"FXC-001-v1","side":"LONG",
            "day":"2026-10-05","signal_time_utc":"2026-10-05T13:35:00Z",
            "box_high":1.1,"box_low":1.099,
            "signal_spread_pips":1.2,"source_receipt":"receipt",
            "fake_broker_order":10000,
        }
        payload["evidence"]["fx_research"]={
            "status":"UNVERIFIED_FX_RESEARCH_ONLY",
            "version":"FXC-001-v1",
            "training":{"trades":8,"avgNetR":-.25,"winRate":.4},
            "reserve_unseen":True,
            "reserve":{"trades":20,"avgNetR":200},
            "broker_fills":100000,
        }
        result=server.validate_context(payload)
        self.assertEqual(result["fx_historical_signal"]["actual_order_fills"],None)
        self.assertNotIn("fake_broker_order",result["fx_historical_signal"])
        self.assertEqual(result["opt_in_fx_research"]["training_avg_net_R"],-.25)
        self.assertIsNone(result["opt_in_fx_research"]["reserve_results"])
        self.assertFalse(result["opt_in_fx_research"]["broker_fills_verified"])
        payload["replay"]["enabled"]=True
        result=server.validate_context(payload)
        self.assertIsNone(result["opt_in_fx_research"])

    def test_oanda_practice_candle_source_stays_nonexecution(self):
        request = context()
        request["source"] = {
            "id":"oanda-fxpractice:EUR_USD",
            "kind":"oanda-fxpractice",
            "symbol":"EUR_USD",
            "timeframe":"5m",
            "secret_key":"DO_NOT_FORWARD",
        }
        result = server.validate_context(request)
        self.assertTrue(result["provider_provenance"]["practice_candles"])
        self.assertFalse(result["provider_provenance"]["verified_broker_fills"])
        self.assertNotIn("secret_key",result["source"])
        request["source"]["kind"] = "oanda-live"
        with self.assertRaisesRegex(ValueError,"Unsupported source"):
            server.validate_context(request)



class ModelBoundaryTests(unittest.TestCase):
    def test_requires_exact_structured_response(self):
        valid = {
            k: "Needs actual market data" for k in
            ("observation", "interpretation", "falsification",
             "next_experiment", "limitations")
        }
        result = server.structured_analysis({"message": {"content": json.dumps(valid)}})
        self.assertEqual(result["observation"], "Needs actual market data")
        with self.assertRaisesRegex(ValueError, "required research fields"):
            server.structured_analysis({"message": {"content": '{"observation":"ok"}'}})
        with self.assertRaisesRegex(ValueError, "structured JSON"):
            server.structured_analysis({"message": {"content": "This is a buy signal."}})

    def test_fenced_json_from_local_ollama_is_parsed_without_extraction(self):
        valid = {k: "Insufficient verified evidence" for k in (
            "observation", "interpretation", "falsification",
            "next_experiment", "limitations"
        )}
        fenced = "```json\n" + json.dumps(valid) + "\n```"
        self.assertEqual(
            server.structured_analysis({"message": {"content": fenced}})["observation"],
            "Insufficient verified evidence"
        )
        with self.assertRaisesRegex(ValueError, "structured JSON"):
            server.structured_analysis({"message": {"content": "Opinion first " + json.dumps(valid)}})

    def test_host_header_restriction(self):
        accepted = SimpleNamespace(headers={"Host": f"127.0.0.1:{server.PORT}"})
        rejected = SimpleNamespace(headers={"Host": "malicious.invalid"})
        self.assertTrue(server.Handler._trusted_host(accepted))
        self.assertFalse(server.Handler._trusted_host(rejected))



class PracticeEndpointTests(unittest.TestCase):
    def post(self, payload, path="/api/market/fetch", origin=None, token=None):
        encoded=json.dumps(payload).encode("utf-8")
        handle=object.__new__(server.Handler)
        handle.headers={
            "Host": f"127.0.0.1:{server.PORT}",
            "Origin": origin if origin is not None else f"http://127.0.0.1:{server.PORT}",
            "X-Trader-Token": token if token is not None else server.TOKEN,
            "Content-Type":"application/json",
            "Content-Length": str(len(encoded)),
        }
        handle.path=path
        handle.rfile=io.BytesIO(encoded)
        sent=[]
        handle._reply=lambda status,data:sent.append((status,data))
        handle.do_POST()
        self.assertEqual(len(sent),1)
        return sent[0]

    def test_prospective_observer_start_requires_local_approval_and_token(self):
        state={"active":True,"symbol":"EUR_USD","brokerOrdersAllowed":False}
        with patch.object(server.FORWARD,"start",return_value=state) as started:
            status,result=self.post({"symbol":"EUR_USD"},path="/api/forward/start")
        self.assertEqual(status,200)
        self.assertFalse(result["broker_orders"])
        self.assertEqual(result["monitor"]["symbol"],"EUR_USD")
        started.assert_called_once_with("EUR_USD")
        with patch.object(server.FORWARD,"start") as blocked:
            status,_=self.post({"symbol":"EUR_USD"},path="/api/forward/start",
                               token="INVALID")
        self.assertEqual(status,403)
        blocked.assert_not_called()
        with patch.object(server.FORWARD,"start") as blocked:
            status,_=self.post({"symbol":"EUR_USD"},path="/api/forward/start",
                               origin="https://malicious.invalid")
        self.assertEqual(status,403)
        blocked.assert_not_called()

    def test_prospective_start_stop_accept_only_strict_request_shapes(self):
        for value in [
            {"symbol":"MES"},{"symbol":"EUR_USD","order":1},
            {"symbol":"EUR_USD","poll_seconds":1},{"symbol":"USD_JPY","secret":"X"},
            {},{"symbol":123},
        ]:
            with patch.object(server.FORWARD,"start") as not_called:
                status,result=self.post(value,path="/api/forward/start")
            self.assertEqual(status,422)
            not_called.assert_not_called()
        with patch.object(server.FORWARD,"stop") as not_called:
            status,result=self.post({"cancel_order":True},
                                    path="/api/forward/stop")
        self.assertEqual(status,422)
        not_called.assert_not_called()
        with patch.object(server.FORWARD,"stop",return_value={
                "active":False,"brokerOrdersAllowed":False}) as stopped:
            status,result=self.post({},path="/api/forward/stop")
        self.assertEqual(status,200)
        self.assertFalse(result["broker_orders"])
        stopped.assert_called_once()

    def test_get_prospective_status_is_read_only_and_never_exposes_token(self):
        from pathlib import Path
        handle=object.__new__(server.Handler)
        handle.headers={"Host":f"127.0.0.1:{server.PORT}"}
        handle.path="/api/forward/status?symbol=EUR_USD"
        sent=[]
        handle._reply=lambda status,payload:sent.append((status,payload))
        with patch.object(server.market,"storage_path",
                          return_value=Path("/nonexistent_forward_market_test_file.sqlite3")):
            handle.do_GET()
        self.assertEqual(sent[0][0],200)
        self.assertEqual(sent[0][1]["journal"]["summary"]["actualBrokerFills"],0)
        self.assertFalse(sent[0][1]["broker_orders"])
        self.assertNotIn(server.TOKEN,json.dumps(sent[0][1]))

    def test_cross_origin_is_rejected_before_fetch(self):
        status,result=self.post(
            {"symbol":"EUR_USD","count":500},origin="https://untrusted.invalid"
        )
        self.assertEqual(status,403)
        self.assertFalse(result["ok"])

    def test_session_token_required(self):
        status,result=self.post(
            {"symbol":"EUR_USD","count":500},token="WRONG"
        )
        self.assertEqual(status,403)
        self.assertIn("token",result["error"])

    def test_no_order_or_live_market_endpoint_exists(self):
        status,result=self.post({},path="/api/Order/place")
        self.assertEqual(status,404)
        status,result=self.post({},path="/api/oanda-live/submit")
        self.assertEqual(status,404)

    def test_only_allowlisted_practice_instruments_and_parameters(self):
        for body in [
            {"symbol":"MES","count":100},
            {"symbol":"EUR_USD","count":5001},
            {"symbol":"EUR_USD","count":500,"order_units":1},
        ]:
            status,result=self.post(body)
            self.assertEqual(status,422)
            self.assertFalse(result["ok"])

    def test_backfill_is_origin_token_checked_and_strictly_bounded(self):
        for body in [
            {"symbol":"EUR_USD","pages":13},
            {"symbol":"MES","pages":1},
            {"symbol":"EUR_USD","pages":2,"to":"arbitrary-time"},
            {"symbol":"EUR_USD","pages":"3"},
        ]:
            status,result=self.post(body,path="/api/market/backfill")
            self.assertEqual(status,422)
            self.assertFalse(result["ok"])
        receipt={"symbol":"EUR_USD","source":"oanda-fxpractice",
                 "requests":2,"added":1500,"conflicts":0,"augmented":0}
        with patch.object(server.market,"backfill_into_store",return_value=receipt) as mocked:
            status,result=self.post(
                {"symbol":"EUR_USD","pages":2},path="/api/market/backfill")
        self.assertEqual(status,200)
        self.assertFalse(result["execution"])
        self.assertEqual(result["market_receipt"]["requests"],2)
        mocked.assert_called_once_with("EUR_USD",2)
        status,result=self.post({"symbol":"EUR_USD","pages":2},
             path="/api/market/backfill",origin="https://evil.invalid")
        self.assertEqual(status,403)

    def test_success_is_a_receipt_and_explicitly_has_no_execution(self):
        sample={
            "receipt_id":"fixture",
            "symbol":"EUR_USD",
            "source":"oanda-fxpractice",
            "added":1,"repeated":0,"conflicts":0,
        }
        with patch.object(server.market,"fetch_into_store",return_value=sample) as mocked:
            status,result=self.post({"symbol":"EUR_USD","count":100})
        self.assertEqual(status,200)
        self.assertFalse(result["execution"])
        self.assertEqual(result["market_receipt"]["receipt_id"],"fixture")
        mocked.assert_called_once_with("EUR_USD",100)



if __name__ == "__main__":
    unittest.main()

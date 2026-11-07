import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import decision_review as desk

def evidence(source="SYNTHETIC_OFFLINE_FIXTURE"):
    return desk.bounded_packet("CON.F.US.MES.Z26",5,{
        "status":"OBSERVATION_ONLY","range_state":"ABOVE_PRIOR_RANGE",
        "confirmed_through_ms":1700000000000,"latest_complete_close":6000,
        "prior_20_high":5999,"prior_20_low":5980,"average_true_range_14":4,
        "completed_data_stale":False,"gaps_in_last_20":0},
        {"coverage":"MATCHED_IN_FETCH_WINDOW","complete_trade_count":15},source)

class DecisionReviewTests(unittest.TestCase):
    def test_bound_payload_does_not_include_account_credentials_or_fills(self):
        p=evidence()
        self.assertFalse(p["trade_statistics"]["setup_specific_result_available"])
        self.assertNotIn("account_balance",str(p))
        self.assertNotIn("apiKey",str(p))
        self.assertIn("SYNTHETIC",p["source"])

    def test_valid_short_qualitative_local_model(self):
        reply={"message":{"content":json.dumps({
            "observation":"Synthetic prices moved beyond a reference range.",
            "concern":"This observation does not establish a repeatable edge.",
            "next_check":"Review subsequent complete bars and avoid reading the forming candle."})}}
        with patch.object(desk.local_ai,"ollama_request",return_value=reply) as llm:
            out=desk.explain(evidence())
        self.assertEqual(set(out),{"observation","concern","next_check"})
        self.assertEqual(llm.call_count,1)
        self.assertFalse(llm.call_args.kwargs["payload"]["stream"])
        self.assertEqual(llm.call_args.kwargs["payload"]["format"],"json")

    def test_numeric_and_order_claims_are_rejected(self):
        for concern in ("Win probability is 90 percent.","You should buy now.",
                        "Place an order immediately."):
            reply={"message":{"content":json.dumps({
                "observation":"Synthetic price crossed a reference.",
                "concern":concern,
                "next_check":"Inspect the next closed bar."})}}
            with patch.object(desk.local_ai,"ollama_request",return_value=reply):
                with self.assertRaises(ValueError):
                    desk.explain(evidence())

    def test_bad_fields_or_missing_evidence_rejected(self):
        with self.assertRaises(ValueError):
            desk.explain({})
        with patch.object(desk.local_ai,"ollama_request",
                          return_value={"message":{"content":"{}"}}):
            with self.assertRaises(ValueError):
                desk.explain(evidence())

    def test_oversized_model_output_rejected(self):
        reply={"message":{"content":json.dumps({
            "observation":"x"*250,
            "concern":"No proven edge.",
            "next_check":"Wait for next complete candle."})}}
        with patch.object(desk.local_ai,"ollama_request",return_value=reply):
            with self.assertRaises(ValueError):
                desk.explain(evidence())

if __name__=="__main__":
    unittest.main()

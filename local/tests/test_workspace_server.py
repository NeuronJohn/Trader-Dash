"""Offline tests for the read-only, local-only Ollama research boundary."""
import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

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

    def test_hard_bounds_prior_journal_and_note_text(self):
        payload = context()
        payload["evidence"]["saved_cases"] *= 30
        payload["evidence"]["notes"]["thesis"] = "x" * 10000
        result = server.validate_context(payload)
        self.assertEqual(len(result["user_selected_prior_cases"]), 8)
        self.assertEqual(len(result["draft_notes"]["thesis"]), 2000)


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

    def test_host_header_restriction(self):
        accepted = SimpleNamespace(headers={"Host": f"127.0.0.1:{server.PORT}"})
        rejected = SimpleNamespace(headers={"Host": "malicious.invalid"})
        self.assertTrue(server.Handler._trusted_host(accepted))
        self.assertFalse(server.Handler._trusted_host(rejected))


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trade_analytics import reconstruct, summarize


def leg(i, side=0, size=1, pnl=None, t="2026-11-06T14:30:00Z",
        contract="CON.F.US.MES.Z26", fees=1.0, commissions=.25, voided=False):
    return {"id": i, "accountId": 17, "contractId": contract, "side": side,
            "size": size, "price": 6000+i/4, "profitAndLoss": pnl,
            "creationTimestamp": t, "fees": fees, "commissions": commissions,
            "voided": voided, "orderId": i}


class CompletedTradeAnalyticsTests(unittest.TestCase):
    def test_completed_round_trip(self):
        s = summarize([leg(1), leg(2, side=1, pnl=20, t="2026-11-06T14:35:00Z")])
        self.assertEqual(s["complete_trade_count"], 1)
        self.assertEqual(s["completed_net_usd"], 17.5)
        self.assertEqual(s["win_rate"], 1)
        self.assertEqual(s["recent_trades"][0]["duration_seconds"], 300)

    def test_partial_exit_then_full_close(self):
        ls = [leg(1, size=3),
              leg(2, side=1, pnl=10, t="2026-11-06T14:35:00Z"),
              leg(3, side=1, size=2, pnl=-3, t="2026-11-06T14:36:00Z")]
        s = summarize(ls)
        self.assertEqual(s["complete_trade_count"], 1)
        self.assertEqual(s["recent_trades"][0]["total_opened"], 3)
        self.assertEqual(s["completed_net_usd"], 3.25)

    def test_unmatched_close_is_not_complete(self):
        s = summarize([leg(1, side=1, pnl=-50)])
        self.assertEqual(s["complete_trade_count"], 0)
        self.assertEqual(s["issues"]["unmatched_close_legs"], 1)
        self.assertIsNone(s["win_rate"])

    def test_partially_closed_open_cycle(self):
        s = summarize([leg(1, size=2),
                       leg(2, side=1, pnl=10, t="2026-11-06T14:35:00Z")])
        self.assertEqual(s["complete_trade_count"], 0)
        self.assertEqual(s["pending_positions"][0]["remaining_size"], 1)

    def test_same_timestamp_reversal_closes_old_position_first(self):
        t1 = "2026-11-06T14:31:00Z"
        s = summarize([leg(1), leg(3, side=1, t=t1),
                       leg(2, side=1, pnl=6, t=t1),
                       leg(4, side=0, pnl=-3, t="2026-11-06T14:40:00Z")])
        self.assertEqual(s["complete_trade_count"], 2)
        self.assertEqual(s["recent_trades"][0]["side"], "Short")

    def test_voided_half_turn_ignored(self):
        s = summarize([leg(1), leg(2, side=1, pnl=10,
                       t="2026-11-06T14:35:00Z", voided=True)])
        self.assertEqual(s["complete_trade_count"], 0)
        self.assertEqual(len(s["pending_positions"]), 1)

    def test_win_rate_and_drawdown(self):
        ls = [leg(1), leg(2, side=1, pnl=10, t="2026-11-06T14:35:00Z"),
              leg(3, t="2026-11-06T14:40:00Z"),
              leg(4, side=1, pnl=-20, t="2026-11-06T14:45:00Z")]
        s = summarize(ls)
        self.assertEqual(s["win_rate"], .5)
        self.assertGreater(s["completed_trade_peak_to_trough_usd"], 20)

    def test_different_contracts_never_match(self):
        s = summarize([leg(1), leg(2, side=1, pnl=10,
                      contract="CON.F.US.MNQ.Z26", t="2026-11-06T14:32:00Z")])
        self.assertEqual(s["complete_trade_count"], 0)
        self.assertEqual(s["issues"]["unmatched_close_legs"], 1)

    def test_duplicate_leg_ids_raise_error(self):
        with self.assertRaises(ValueError):
            reconstruct([leg(1), leg(1)])


if __name__ == "__main__":
    unittest.main()

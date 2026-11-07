import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from demo_broker import DemoBroker, DemoBridge, CONTRACTS, DEMO_ACCOUNT_ID

class DemoFixtureTests(unittest.TestCase):
    def setUp(self):
        self.broker=DemoBroker()

    def test_every_synthetic_round_trip_matches_ticks(self):
        contract={c["id"]:c for c in CONTRACTS}
        original={x["id"]:x for x in self.broker._fills if not x["voided"]}
        self.assertEqual(len(original),84)
        for i in range(42):
            entry=original[10000+i*2]
            exit=original[10001+i*2]
            c=contract[entry["contractId"]]
            direction=1 if entry["side"]==0 else -1
            self.assertEqual(exit["side"],1-entry["side"])
            self.assertEqual(entry["size"],exit["size"])
            delta=(exit["price"]-entry["price"])*direction
            expected=round(delta/c["tickSize"]*c["tickValue"],2)
            self.assertAlmostEqual(expected,exit["profitAndLoss"],places=5)

    def test_no_broker_token_issued(self):
        with self.assertRaises(RuntimeError):
            self.broker.bearer_token()

    def test_demo_account_cannot_trade(self):
        a=self.broker.accounts()[0]
        self.assertEqual(a["id"],DEMO_ACCOUNT_ID)
        self.assertFalse(a["canTrade"])
        net=sum((x["profitAndLoss"] or 0)-x["fees"]-x["commissions"]
                for x in self.broker._fills if not x["voided"])
        self.assertAlmostEqual(a["balance"],round(50000+net,2))

    def test_synthetic_stream_respects_contract_selection(self):
        bridge=DemoBridge()
        bridge.select(DEMO_ACCOUNT_ID,CONTRACTS[0]["id"])
        first=bridge.snapshot()
        self.assertTrue(first["synthetic"])
        self.assertFalse(first["execution"])
        self.assertEqual(first["selected_contract"],CONTRACTS[0]["id"])
        bridge.select(DEMO_ACCOUNT_ID,CONTRACTS[2]["id"])
        second=bridge.snapshot()
        self.assertEqual(second["selected_contract"],CONTRACTS[2]["id"])

    def test_history_lookback_and_contract_rejection(self):
        self.assertGreater(len(self.broker.snapshot(DEMO_ACCOUNT_ID,30)["legs"]),0)
        with self.assertRaises(ValueError):
            self.broker.snapshot(11111,30)
        with self.assertRaises(ValueError):
            self.broker.bars("CON.F.US.UNKNOWN.Z26")

if __name__=="__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from structure_context import analyze

MIN=60000
def bars(n=25):
    return [{"time":i*5*MIN,"open":100,"high":101,"low":99,"close":100} for i in range(n)]

class StructureTests(unittest.TestCase):
    def test_forming_candle_excluded(self):
        a=bars()
        a[-1]["close"]=250
        a[-1]["high"]=250
        report=analyze(a,5,now_ms=a[-1]["time"]+4*MIN)
        self.assertEqual(report["latest_complete_close"],100)
        self.assertEqual(report["range_state"],"INSIDE_PRIOR_RANGE")

    def test_closed_breakout(self):
        a=bars()
        a[-1]["close"]=103
        a[-1]["high"]=103
        report=analyze(a,5,now_ms=a[-1]["time"]+5*MIN)
        self.assertEqual(report["range_state"],"ABOVE_PRIOR_RANGE")
        self.assertEqual(report["prior_20_high"],101)

    def test_signal_bar_high_cannot_move_prior_range(self):
        a=bars()
        a[-1]["close"]=101.25
        a[-1]["high"]=106
        report=analyze(a,5,now_ms=a[-1]["time"]+5*MIN)
        self.assertEqual(report["prior_20_high"],101)

    def test_replay_cutoff_independence(self):
        a=bars()
        a[-1]["close"]=103
        a[-1]["high"]=103
        early=analyze(a,5,now_ms=a[-2]["time"]+5*MIN)
        late=analyze(a,5,now_ms=a[-1]["time"]+5*MIN)
        self.assertEqual(early["range_state"],"INSIDE_PRIOR_RANGE")
        self.assertEqual(late["range_state"],"ABOVE_PRIOR_RANGE")

    def test_insufficient_data(self):
        self.assertEqual(analyze(bars(10),5,now_ms=100000000)["status"],
                         "INSUFFICIENT_HISTORY")

    def test_malformed_bar_fails_closed(self):
        a=bars()
        a[2]["low"]=110
        with self.assertRaises(ValueError):
            analyze(a,5,now_ms=100000000)

if __name__=="__main__":
    unittest.main()

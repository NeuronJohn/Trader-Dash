import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observation_journal import ObservationJournal, SOURCE_REAL, SOURCE_DEMO

MINUTE = 60_000
INTERVAL = 5 * MINUTE
T0 = 1_800_000_000_000
CONTRACT = "CON.F.US.MES.Z26"


def candle(t, close=100):
    return {"time":t, "open":100, "high":max(101, close),
            "low":min(99, close), "close":close, "volume":200}


def setup():
    older = [candle(T0-(24-i)*INTERVAL) for i in range(24)]
    older.append(candle(T0, 102))
    return older


def observation():
    return {"status":"OBSERVATION_ONLY", "range_state":"ABOVE_PRIOR_RANGE",
            "confirmation_bar_start_ms":T0, "confirmed_through_ms":T0+INTERVAL,
            "latest_complete_close":102.0,
            "prior_20_high":101.0, "prior_20_low":99.0,
            "average_true_range_14":2.0,
            "completed_data_stale":False, "gaps_in_last_20":0}


def later():
    return [candle(T0+i*INTERVAL, v) for i,v in
            enumerate((103,101,104,106,108), start=1)]


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/"journal.sqlite3"
        self.journal=ObservationJournal(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def advance(self,bars=None,context=None,now=None,allow=True,source=SOURCE_REAL,
                account_id=15):
        return self.journal.advance(source,account_id,CONTRACT,5,
                                    setup() if bars is None else bars,
                                    observation() if context is None else context,
                                    allow_record=allow,
                                    now_ms=T0+INTERVAL if now is None else now)

    def test_once_only_after_confirmation(self):
        first=self.advance()
        second=self.advance()
        self.assertEqual(first["recorded"],1)
        self.assertEqual(first["awaiting_future_bars"],1)
        self.assertEqual(second["recorded"],1)
        self.assertEqual(second["matured"],0)
        self.assertTrue(second["not_trades"])
        self.assertFalse(second["statistical_edge_verified"])

    def test_no_future_bar_no_outcome(self):
        bars=setup()+later()
        result=self.advance(bars,now=T0+5*INTERVAL)
        self.assertEqual(result["recorded"],0)
        self.advance()
        partial=self.advance(bars,now=T0+5*INTERVAL,allow=False)
        self.assertEqual(partial["matured"],0)
        self.assertEqual(partial["awaiting_future_bars"],1)
        complete=self.advance(bars,now=T0+6*INTERVAL,allow=False)
        self.assertEqual(complete["matured"],1)
        self.assertEqual(complete["awaiting_future_bars"],0)
        self.assertAlmostEqual(complete["recent"][0]["directional_points"],6)
        self.assertAlmostEqual(complete["recent"][0]["directional_pct"],100*6/102,places=4)

    def test_corrected_future_bar_revises_matured_outcome(self):
        self.advance()
        future=setup()+later()
        first=self.advance(future,now=T0+6*INTERVAL,allow=False)
        self.assertEqual(first["matured"],1)
        self.assertEqual(first["recent"][0]["directional_points"],6)
        corrected=[dict(b) for b in future]
        corrected[-1]["close"]=105
        second=self.advance(corrected,now=T0+6*INTERVAL,allow=False)
        self.assertEqual(second["matured"],1)
        self.assertEqual(second["recent"][0]["directional_points"],3)

    def test_revised_signal_is_excluded_not_counted_as_positive(self):
        self.advance()
        future=setup()+later()
        self.advance(future,now=T0+6*INTERVAL,allow=False)
        corrected=[dict(b) for b in future]
        corrected[24]["close"]=100
        result=self.advance(corrected,now=T0+6*INTERVAL,allow=False)
        self.assertEqual(result["matured"],0)
        self.assertEqual(result["excluded_revised_signals"],1)
        self.assertIsNone(result["favorable_fraction"])

    def test_missing_future_bar_is_excluded_not_interpolated(self):
        self.advance()
        future=later()
        full=setup()+future[:2]+future[3:]
        out=self.advance(full,now=T0+6*INTERVAL,allow=False)
        self.assertEqual(out["matured"],0)
        self.assertEqual(out["excluded_data_gaps"],1)
        self.assertIsNone(out["favorable_fraction"])

    def test_stale_and_lookback_recording_protection(self):
        bad={**observation(),"completed_data_stale":True}
        self.assertEqual(self.advance(context=bad)["recorded"],0)
        self.assertEqual(self.advance(allow=False)["recorded"],0)
        self.assertEqual(self.advance(now=T0+4*INTERVAL)["recorded"],0)
        # History containing a much later candle cannot be presented as
        # though the prior breakout was seen at its actual confirmation.
        self.assertEqual(self.advance(bars=setup()+later(),now=T0+6*INTERVAL)["recorded"],0)

    def test_separate_account_and_sources(self):
        self.advance(source=SOURCE_DEMO)
        self.advance(source=SOURCE_REAL)
        self.advance(source=SOURCE_DEMO,account_id=99)
        self.assertEqual(self.advance(source=SOURCE_REAL)["recorded"],1)
        self.assertEqual(self.advance(source=SOURCE_DEMO)["recorded"],1)
        self.assertEqual(self.advance(source=SOURCE_DEMO,account_id=99)["recorded"],1)
        self.assertEqual(self.advance(source=SOURCE_REAL,account_id=99,allow=False)["recorded"],0)

    def test_persists_after_restart(self):
        self.advance()
        restored=ObservationJournal(self.path)
        result=restored.advance(SOURCE_REAL,15,CONTRACT,5,setup(),observation(),
                                allow_record=True,now_ms=T0+INTERVAL)
        self.assertEqual(result["recorded"],1)

    def test_reject_duplicate_malformed_price_bars(self):
        with self.assertRaises(ValueError):
            self.advance(bars=setup()+[setup()[-1]])
        bad=setup()
        bad[-1]["low"]=200
        with self.assertRaises(ValueError):
            self.advance(bars=bad)

    def test_no_record_if_quote_is_not_fresh_or_signal_is_not_latest(self):
        self.assertEqual(self.advance(allow=False)["recorded"],0)
        self.assertEqual(self.advance(bars=setup()+later()[:1],
                                      now=T0+2*INTERVAL)["recorded"],0)


if __name__ == "__main__":
    unittest.main()

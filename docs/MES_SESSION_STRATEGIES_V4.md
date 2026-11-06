# Trader / Lab v0.4 — MES Session Strategy Research

Development branch: foundation/mes-session-strategies-v4  
Status: draft, unmerged, research only. No live data or order routing.

## What's implemented

The previous historical scanner used generic rolling price patterns. The new MES-SESSION-v1 engine implements two specific opening-range hypotheses with America/Chicago session times, daylight-saving conversions, strict five-minute bar sequencing, and conservative hypothetical fills.

The engine is prototype/session-engine.js. The chart, journal, and model panel remain in prototype/trader-workspace.html. The localhost server safely serves the separate strategy JS file.

### Windows setup and workflow

1. Download the **complete branch**, not only the HTML. The strategy JS file must remain next to the HTML in the prototype folder.
2. Double-click Start-Trader-Research.cmd from the repository root, or open the HTML file directly with its sibling strategy JS present.
3. Import a licensed, authorized historical MES OHLC CSV, named to include MES. Input timestamps must represent five-minute **bar START** in UTC or explicit timezone offset.
4. Go to Strategy Lab. The MES workbench is now at the top; older generic simulations and other hypotheses are collapsed.
5. The data audit automatically checks chronological timestamps, 0.25-point tick prices, 08:30–11:00 CT session coverage, and missing/duplicate bars. This does **not** authenticate the data provider, contract month, roll method, or bar timestamp convention.
6. Confirm you checked the source and timestamp convention.
7. Select ORP-001 or FBR-001. **Find MES setups** identifies historical confirmations using only closed bars; clicking a match opens the chart with the confirmation candle as the last visible bar. Use +1 to reveal future price action.
8. Separately choose **Run MES research** with your explicit per-side slippage and round-trip fee assumptions. Training metrics, reserved holdout exposure gate, and one-contract hypothetical cases are shown.
9. Review modeled cases using the explicitly labeled entry, stop and target chart overlays. Save review snapshots and export archives.

### CSV input

Sample syntax (fabricated values, NOT actual historical prices):

    time,open,high,low,close,volume
    2026-07-06T13:30:00Z,6000.00,6010.00,5990.00,6000.00,500
    2026-07-06T13:35:00Z,6000.00,6009.00,5991.00,6000.00,700

The simulator requires all thirty five-minute bars from 08:30 through 10:55 Chicago time for every included day. Missing sessions are excluded.

## MES instrument assumptions

- CME Micro E-mini S&P 500 contract multiplier is $5 per index point.
- Minimum tick is 0.25 index points, equal to $1.25 for one MES contract.
- Research window 08:30–11:00 CT is a **custom intraday strategy window**, not the full CME Globex futures session.
- Intraday entry before 10:30 CT, time exit no later than 11:00 CT.
- Times use the IANA America/Chicago zone with DST. The 08:30 Chicago candle was 14:30Z on March 6, 2026 and 13:30Z on March 9.
- No continuous-contract rollover, expiry/settlement, exchange holiday, adverse liquidity or economic-release calibration is claimed.

Official CME contract specifications:
https://www.cmegroup.com/markets/equities/sp/micro-e-mini-sandp-500.contractSpecs.html

## Rule versions

### ORP-001: first breakout, first pullback

1. Opening range from the fully closed 08:30, 08:35, and 08:40 CT candles.
2. First completed candle with closing price beyond that range, long or short, after 08:45.
3. First eligible retracement within the next six closed candles: for long, low at/below range high and close at/above range high; mirrored for short.
4. Immediately following fully closed candle must close beyond the pullback bar extreme in breakout direction. If the first retracement fails confirmation, do not cherry-pick later attempts that day.
5. Modeled next-bar-open entry before 10:30 CT with adverse slippage. Stop one MES tick beyond the retracement extreme.
6. Default 2R target, conservatively tick-rounded. Stop, target, or 11:00 CT time exit. One modeled trade maximum per session.

### FBR-001: failed opening-range breakout

1. Same three-bar range.
2. First wick excursion at least two ticks beyond range boundary; reject a bar that breaches both sides, since intrabar order is unknown.
3. Excursion candle or next two completed candles must return and close inside the range.
4. Following fully closed candle must confirm the reversal beyond the return candle's extreme.
5. Next-bar-open entry before 10:30 CT with slippage; stop two ticks beyond the excursion extreme.
6. Target at opening-range midpoint; skip if reward is smaller than initial risk. Stop, target, or 11:00 time exit.

Neither strategy has proven a positive trading edge.

## Fill/accounting assumptions

- One hypothetical MES contract only. USD modeled as five dollars per index point, including assumed slippage and user-set round-trip commission.
- Entry at next five-minute bar open, never the hindsight-favorable signal candle.
- Stop is evaluated before target on any OHLC candle touching both levels; unfavorable gaps fill at worse observed open plus slippage. Favorable target gaps are capped at target.
- Time exit by 11:00. No overnight holding, broker order types, partial fills, live liquidity, limit queue position, contract rollover, or margin model.
- Each session yields no more than one qualifying modeled episode. Rejected sessions and missing signals are preserved.
- Net USD and net R are **estimates**, not historical fills. Closed-equity drawdown is not real-time intrabar drawdown.

## Outcome-blind discovery and model interface

The separate MES setup scanner can analyze partial, contiguous intraday records as of a chosen UTC cutoff. It only regards a candle as observed after its close and never supplies an entry fill or realized result. Selecting a signal starts historical visual reveal at the signal confirmation and excludes subsequent candles until the user advances.

The optional local Ollama analyst can receive explicit, bounded, user-selected MES signal context. Research-mode model output must remain provisional and unverified. The model has no account order permissions.

## Training versus reserved evaluation

The simulator splits by chronological **complete days** with a transition-day buffer, rather than random bars. A reserved evaluation subset remains hidden in the UI until explicitly revealed; initial persisted research runs and pre-reveal exports exclude reserve trade details. Exposure is recorded and later tuning on the same dataset is flagged as contaminated.

This is a browser-based workflow safeguard, not cryptographically secure blind validation. The real next objective is a new untouched holdout and prospective paper tracking. Training samples below 30 trades and reserves below 20 sessions are flagged as insufficient.

## Topstep rules are NOT simulated here

Topstep's Trading Combine requirements have account-level maximum loss limits that can be triggered by intraday **unrealized** P&L, plus a 55% consistency objective as described by their updated 2026 help articles. There are also optional Daily Loss Limit settings for eligible accounts.

This session strategy model does not calculate real account eligibility, trailing maximum-loss survival, force-liquidation, prop account scaling, funded payout eligibility or a realistic execution-system failure rate. Such checks require separate, provider-verified risk accounting and explicit user limits.

Official references:
- https://help.topstep.com/en/articles/8284197-trading-combine-parameters
- https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit
- https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account

## Test gates and known limitations

- Thirteen targeted JavaScript engine tests cover strategy triggers, cutoff independence, DST, missing bars, 0.25 tick grid, ambiguous stop-first fills, adverse gaps, costs, and chronological splitting.
- Three dashboard interaction tests verify the explicit MES data-consent gate, reserve masking, and confirmation-only chart reveal.
- These sixteen tests passed in an equivalent V8 environment. Actual complete npm test, Python unittest, npm build, and real Windows Chrome/Edge interaction remain unexecuted and are required before merge.
- Files: prototype/session-engine.js, tests/session-strategies.test.js, tests/session-ui.test.js, the HTML workspace, and the localhost Python server.

Run from repository root to perform formal validation:

    npm test
    python -m unittest discover -s local/tests -p "test_*.py"
    npm run build

## Next engineering milestones

1. Authorized source imports and verified MES contract-month/tick history with explicit rollover and session-gap quality controls.
2. Forward-paper signal registry that records every confirmed **and rejected** setup before future outcomes, with no hidden hindsight selection.
3. Independent Topstep and FX account **read-only** fill imports, timestamped cost reconciliation, account-specific risk calculations and automated chart snapshots.
4. More realistic trade execution and statistical testing: bid/ask, news exclusions, spread/latency distributions, Monte Carlo uncertainty and untouched holdouts across regimes.
5. Source-cited AI claim verifier and user-coaching evaluation, then production React UI migration; execution only after separate human-approved risk gates.

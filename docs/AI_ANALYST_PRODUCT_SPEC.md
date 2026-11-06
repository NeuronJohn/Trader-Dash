# AI Trading Analyst — Product contract (2026-11-05)

## Objective
Build a chart-first, local-first trading workbench for deliberate skill improvement across separately tracked personal spot-FX and Topstep futures accounts. The analyst is an always-available *review and research assistant*, not a profitable signal oracle.

## Status
- Implemented in this branch: local, deterministic analytics on existing manual v13 journal entries; market / rule-adherence filters; setup comparison; personal trade note field persisted via existing browser-local storage.
- NOT implemented yet: live candlestick chart, broker imports, model inference, AI vision analysis, chart annotation, snapshot capture, paper-trading simulator, replay, validated historical backtesting, real-time execution/risk controls.
- Current fields are self-reported and not audited for spread, commissions, slippage or fills. A negative R and missing R are distinct.

## Interaction pattern
1. **Observe**: chart fills available screen; compact account, market, timeframe, playbook version and safety status. A small Analyst chip indicates data freshness and whether inference is active.
2. **Investigate**: user clicks candles/entry/exit or drags a rectangle around a chart segment, asks a question or draws and attaches a note.
3. **Ground**: analyst assembles timestamped market bars, instrument/session metadata, visible drawings, a bounded chart image, executed orders/fills if imported, relevant personal journal notes and comparable historical setups. No future bars allowed when in replay.
4. **Respond**: separate *observations* from *hypotheses* from *actions to test*. Quote exact relevant data timestamps; show missing-data/confidence and citations to each user's snapshots or backtest run. No unsupported certainty.
5. **Experiment**: user approves a strategy hypothesis, a separate immutable strategy version is created, then sent to a blind out-of-sample and cost-aware test with embargo/walk-forward validation.
6. **Review**: compare the recommendation to realized outcomes using precommitted hypotheses; track analyst calibration, false signals, skipped winning trades, and harm from overrides.
7. **Learn**: retrieve patterns by tags/structured features plus embeddings of notes, with user-confirmed, inspectable memory. Never silently rewrite journal facts.

## Snapshot and drawing design
- Each snapshot: account/mode, instrument, exchange timezone, UTC timestamp, source and version of bars, OHLC window, indicator params, strategy version, viewport, overlays, annotation layer IDs, optional image crop, entry/exit/stop/targets and fills.
- Preserve annotations as normalized chart coordinates (time, price), plus freehand screen-space strokes anchored to viewport; export image + underlying structured drawing vectors + a note document.
- Entry-time and exit-time snapshots immutable as evidence; subsequent layers can add comments without overwriting originals.
- Freeform notes with blocks, tags, linked trades/sessions/experiments, auto-generated typed metadata, full-text search and crosslinks. Attachments in local file store, not base64 in localStorage.
- Use local SQLite migrations + image blobs; encrypted backups and lossless export/import.

## Stats
- Separate accounts and modes: backtest, historical replay, forward paper, Topstep evaluation, funded simulation, own live account. Never merge as one track record.
- Report sample size, net P/L, net R (once risk basis is verified), expectancy and confidence interval, win/loss distribution, drawdown, MAE/MFE, strategy/time-of-day/day-of-week, commissions, slippage, adherence, consecutive losses, rolling performance.
- Distinguish objective fill/risk calculations from subjective labels; label unverified imports.
- Include risk-of-ruin and probability simulations with assumptions shown and no guarantee claims.

## Safety
- Live AI analysis defaults read-only. Any future order submission requires account-specific adapter, broker-verified permission, explicit enabling, position limits, hard risk constraints, stale-feed gates, one-click kill switch, and non-AI reconciliation.
- Topstep local execution only under its authorized account/API conditions. Check current terms before enabling.
- Research/test harness cannot write orders to live adapters. Use separate process capabilities and credentials.
- Request/response logs must redact secrets and provide inspectable provenance.

## First three candidate hypotheses (not proven edges)
A. Opening-range break then first higher-low/lower-high pullback in direction of higher-timeframe trend; skip scheduled high-impact news windows.
B. Initial-session breakout failure: excursion beyond predeclared opening range, prompt reentry inside range, retest, invalidation outside excursion extreme; test separately by volatility regime.
C. FX European–US overlap continuation after a volatility contraction with an explicit expansion trigger, fixed initial invalidation and time-based exit.
For each: exact time-window, bar-resolution, entry trigger, stop, exit, size, fees/spread/slippage and max-trades rules must be frozen *before* backtest. Test many months across regimes; keep untouched dates out of sample. Reject if results fail cost-aware cross-validation or Topstep drawdown survival; do not optimize toward a high historical win rate.

## Engineering stages
1. Existing v13: audited import/export, no data loss, note/search migration, reproducible deterministic stats, test fixtures.
2. Chart engine + full annotation canvas + immutable multi-layer snapshots + metadata-linked journal.
3. Broker/read-only adapters + market-data backfill, timestamp alignment, tick/contract metadata, fill import deduplication.
4. Replay simulator with fees/slippage, strict no-future-data controls, fixed strategy versioning and out-of-sample reports.
5. On-device chart analyst orchestration: deterministic calculations plus user-authorized optional vision/LLM calls, with consent/budget settings.
6. Separate account-specific execution adapters, stress tests and risk interlocks; defer live orders until certified.

## Design rules
Professional, minimal charcoal UI with one dominant chart, restrained green/red for actual outcomes, monospace numeric tables, one collapsible analyst side panel, keyboard shortcuts, clean edit states and screenshots. Avoid fabricated confidence, decorative status badges, bulky onboarding, and duplicate notes.

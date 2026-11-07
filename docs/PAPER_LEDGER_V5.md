# Trader-Dash v0.5 — Evidence-first MES paper ledger

Branch: foundation/forward-paper-ledger-v5. Status: draft research prototype. No broker connection or order execution.

## What works

The MES Strategy Lab now has a Paper research ledger, and the workspace has a Save MES case control. The implementation lives in prototype/paper-ledger.js alongside prototype/session-engine.js and prototype/trader-workspace.html.

Each MES case preserves:
- Original captured five-minute bars from the 08:30 Chicago opening range to the detected confirmation, with a non-cryptographic checksum to detect accidental changes.
- Instrument/series identity, rule and engine version, signal timestamp and user-attested CSV provenance.
- Frozen slippage/commission/target assumptions and a timestamped capture event.
- Optional later review notes appended as events, rather than overwriting the original evidence.
- A separate later modeled outcome, skip, or data conflict, after an explicitly requested reconciliation.

The source CSV is never authenticated. This is not an exchange-signed receipt or real fill ledger.

## How to use it

1. Download the complete branch, keeping both sibling JS files beside the HTML.
2. Double-click Start-Trader-Research.cmd at repository root (Python 3.10+), or open the HTML directly in Edge/Chrome with its sibling JS files intact.
3. Import a licensed, chronological five-minute MES CSV. Required columns: time, open, high, low, close. Each time must be bar-START UTC or contain an explicit timezone offset. Use a stable filename/series label on subsequent incremental imports.
4. Go to Strategy Lab, review the MES audit, and confirm the data convention.
5. Use Find MES setups, select an ORP-001 or FBR-001 historical confirmation, and click Save MES case from the chart. The chart starts at confirmation with future bars hidden. Recording a setup does not require writing a thesis.
6. A separate Record latest confirmation action is available in Strategy Lab. A CSV that ends exactly at the just-closed confirmation and is imported within 15 minutes can be labeled TIMELY_CSV_UNVERIFIED. It is still not a verified forward trading signal.
7. When newer data exists, import an updated CSV with the same exact series label, exit historical reveal, and choose Check outcomes. The case remains pending until a complete 08:30–11:00 CT research session exists and the original captured prefix matches exactly.
8. Review cases, add optional timestamped notes, and export the paper log or full research archive.

Important: An already-complete historical file cannot be relabeled as genuine prospective performance. Browser/device time, CSV source, imported prices and checksum are not a trusted timestamp/provenance authority. The app does not monitor prices while it is closed.

## Results and statistics

Two entirely separate sets of metrics are calculated:
- HISTORICAL_REPLAY — retrospective practice, including full-history data and sessions viewed in reveal mode.
- TIMELY_CSV_UNVERIFIED — user-imported files whose newest observed candle matches a recently confirmed setup, without authenticated feed verification.

Each cohort reports pending, resolved, skipped and conflicting cases, plus modeled average net R, modeled win percentage, and closed-outcome drawdown in R. Per-rule metrics are also in the exported schema. Samples under 30 modeled trades receive a warning. Verified forward cases are always zero.

Reconciliation:
- Checks original five-minute candle prefix against the updated imported series.
- Refuses changed/missing pre-signal candles, incomplete sessions, or candles whose close is later than the observation clock.
- Recomputes the same frozen MES rules with next-open modeled fills and explicit costs. Rule-confirmed signals that have no valid simulated entry are SKIPPED, never arbitrary losses.
- Captures conflict as a separate terminal event; all resolved outcomes remain simulated, not broker executions.

## Persistence and AI access

IndexedDB schema upgraded to v4 with paper_cases while retaining snapshots, datasets, drawings and experiments. The full archive format v4 supports validated, atomic restore of paper cases. Export backups regularly; browser data can be cleared.

The AI analyst receives paper summary fields only when the user explicitly enables My paper research. No paper outcome is included while historical reveal is enabled. The local Python server strips broker identifiers and forces the verified-forward count to zero. The AI is read-only; no account, paid cloud call or order-routing endpoint exists.

The per-case checksum is deliberately non-cryptographic. It can reveal common accidental edits but does not prevent malicious tampering or prove an observation was made in advance.

## Tests and acceptance

Changes include:
- prototype/paper-ledger.js
- prototype/trader-workspace.html
- local/workspace_server.py
- tests/paper-ledger.test.js
- tests/session-ui.test.js
- local/tests/test_workspace_server.py

Forty-four JavaScript regression tests across six test files were exercised in a V8 environment and passed, including prior chart/simulator and MES strategy tests. Full formal Node tests, Python unittests, React build and real Edge/Chrome UI validation have not yet been executed on a Windows checkout. Leave this branch a draft until those checks pass.

Local developer commands from repository root:

    npm test
    python -m unittest discover -s local/tests -p "test_*.py"
    npm run build

No paid GitHub Actions are required.

## Next engineering milestones

1. Licensed read-only streaming and historical feeds with source timestamps, actual MES contract month, exchange sessions/holidays, auditable data-receive receipts, and source identifiers. Use local event-sourced storage such as SQLite to record new matches before prices advance.
2. Authenticated read-only TopstepX trades/fills and separate OANDA FX practice/live fills where available under provider permissions. Do not combine accounts or currencies. Add fees, slippage and actual fill reconciliation.
3. Precise account-level risk: realized and unrealized P&L, dynamic loss thresholds, drawdown survival, margin/contract sizing and Topstep rules verified against current official terms before account spending.
4. True prospective paper trading, untouched holdouts, execution cost sensitivity, rejected and missed setups, regime tests, and statistical uncertainty.
5. Deterministic numeric claim verification for AI explanations, better visual review coaching, and migration of the approved HTML UX into the existing React production application.
6. Consider manual-approved, heavily restricted execution only after all the above can be independently verified.

This milestone enables record first, measure later, without inventing professional readiness or strategy profitability.

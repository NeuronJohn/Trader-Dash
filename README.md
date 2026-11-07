# Trader / Lab — Trading Research Workspace

This repository is being developed as a local-first, chart-first trading research assistant, including MES research and an optional read-only OANDA fxPractice candle store. It is **not** a broker-connected trading application, a verified profitable strategy, or an execution bot.

## Open the current research prototype

On the working branch **foundation/prospective-signal-receipts-v8**, download the full repository ZIP and extract it. Double-click **Start-Trader-Research.cmd** on Windows (requires Python 3.10+). It opens the workspace in your browser at http://127.0.0.1:8765/. The service binds to 127.0.0.1 only and stops when you close its terminal. There are no broker order endpoints.

If Python is not installed, open `prototype/trader-workspace.html` directly in Edge/Chrome. It still supports a synthetic demonstration chart, imported historical CSVs, annotations, a market library, local pattern discovery, a basic strategy simulator, journal snapshots and exports, but **not local Ollama AI**.

The desktop launcher optionally connects to a pre-existing **local** Ollama model (default `qwen3.5:9b`). The model only receives approved research context through the localhost proxy. It is not a verified price analyst, execution tool, or paid cloud service. Its claims must be independently checked.

## Session-aware MES research — v0.4

The Strategy Lab now puts two **MES five-minute cash-session research strategies** first:

- ORP-001: First opening-range breakout, first controlled pullback, next-bar confirmation.
- FBR-001: Opening-range failed breakout, return-and-reversal confirmation.

Both use Chicago time with DST, verified-format five-minute start timestamps, strict tick alignment and conservative cost-aware simulated execution. The source audit checks for complete research windows but cannot verify a CSV provider or a contract rollover.

Use **Find MES setups** for a *confirmation-only*, historical reveal workflow that conceals future bars until you step forward. Use **Run MES research** separately for exploratory modeled P/L and R, with hidden reserved results and exposure history. No result implies a verified strategy or real brokerage fill.

Read [MES Session Strategies v0.4](docs/MES_SESSION_STRATEGIES_V4.md) for the precise rules, safe import requirements, testing steps and limitations.

**Download the full branch** to use this feature: the browser app now loads the adjacent `prototype/session-engine.js` module. A standalone HTML file without that sibling script will still show older functions, but the MES strategies will not activate.

## Paper research ledger — v0.5

The MES workbench now includes a **persistent, evidence-first paper research log**. Record a detected MES confirmation with one click, preserve only the candles that were available by its close, append optional notes, and later reconcile modeled outcomes against a newer imported CSV.

Recorded results are separated into **historical replay** and **timely but unverified CSV** groups. Neither is a verified broker fill or a validated forward strategy. The dashboard automatically tracks pending, skipped, and resolved cases, average modeled R, win rate and closed-result drawdown.

Full local research archives now include paper cases and their events. The HTML must be accompanied by both the sibling modules: session-engine.js **and** paper-ledger.js.

Read [Paper Ledger v0.5](docs/PAPER_LEDGER_V5.md) for instructions, restrictions, tests and the path to real authenticated market data.

## v0.6 — OANDA Practice market data

The first authenticated-provider **read-only research adapter** has been added for OANDA fxPractice. It can fetch completed 5-minute midpoint/bid/ask candles on demand, record first-seen prices and revision conflicts in a private SQLite log, and open saved FX prices in the dashboard.

Use **Start-Trader-Practice.cmd** to enter a dedicated PRACTICE token privately into a local Python process (never in GitHub or the HTML page). Or keep using **Start-Trader-Research.cmd** without provider credentials. The OANDA source is strictly separate from MES/Topstep futures research, and there are no order routes or background price monitoring.

Read [OANDA Practice Market Data v0.6](docs/PRACTICE_MARKET_DATA_V6.md) for the provider-specific setup, receipt audit, credential limits, backups and current Topstep API considerations.

## v0.7 — FXC-001 strategy experiments and longer OANDA history

The OANDA practice chart now feeds a separate FX research laboratory. **FXC-001** is a frozen New York morning contraction/breakout hypothesis that detects historical completed-bar setups and simulates conservative **bid/ask-aware** next-open entries and stop-first exits. Its costs are modeled in pips and R, not verified account dollars. Training and reserved results are separated, saved experiment assumptions are versioned, and a selected confirmation opens a no-future chart reveal.

A **Backfill history** action manually retrieves up to 12 pages (12,000 completed M5 candles) under a strict local-practice allowlist; the dashboard can open 16,000 stored bars. Older v0.6 receipts are extended by separate bid/ask high-low records, preserving their original first-seen observations. No background polling or order submission is added.

Read [FX Strategy Research v0.7](docs/FX_SPREAD_RESEARCH_V7.md) for full rules, setup steps and evidence limitations. The strategies are **not validated profitable**. The branch is draft until actual Windows/OANDA practice tests pass.

## v0.8 — Opt-in prospective FXC practice observations

The first **process-local automatic observation recorder** is now drafted. Select a practice currency pair, explicitly **Arm paper observer** to request newly completed OANDA fxPractice M5 candles at roughly five-minute intervals while the localhost Python server is running, and record qualifying FXC-001 confirmations before later market candles become available. **Stop observer** disables future checks, and the monitor always starts OFF when the server restarts.

Each captured observation has a local receipt time, an original pre-signal candle prefix, an immutable SHA-256 checksum and a separate, later cost-adjusted **modeled** result. Out-of-order or revised data is rejected or recorded as a conflict; backfilled history cannot be relabeled forward. The FX Strategy Lab shows pending cases, separate modeled paper statistics, no-future chart inspection, and a **Back up local evidence** button creating a transactionally consistent SQLite snapshot under your user-local TraderResearch backups folder.

Read [Prospective Practice Paper v0.8](docs/PROSPECTIVE_PAPER_V8.md) for usage, fixed rules, review and validation. This is locally observed OANDA PRACTICE history, **not** an exchange-signed forward record, an authenticated broker fill, a proven strategy or automatic order execution. Full Python tests and actual provider/Windows behavior still need verification.

## What has been built

- Professional dark-mode HTML trading workspace and earlier React/Tailwind discipline app.
- Price-anchored chart drawings with selection, movement, deletion and per-dataset local persistence.
- Historical rule-based setup finder and cross-dataset scanning of imported CSVs.
- Exploratory cost-adjusted OHLC R-multiple research simulator with next-open entries, conservative stop ordering, chronological split/embargo, and saved experiment versions.
- Visual chart journal, structured research notes, screenshots, archive export and restore.
- Evidence-scoped AI context panel with optional local Ollama analysis through a secure loopback-only server.

## Getting started and implementation details

Read [Research Engine v0.3](docs/RESEARCH_ENGINE_V3.md) for user instructions and exact limitations.

The complete product roadmap is in [Trader / Lab Master Plan](docs/TRADER_LAB_MASTER_PLAN.md).

The parent React work is in `src/`. The single-file HTML app in `prototype/` is an interaction/reference implementation; it is not the final production renderer. Do not maintain both forever: the intended next step is to port the approved interface into React and add trustworthy read-only broker/data adapters.

## Testing

```bash
npm test
python -m unittest discover -s local/tests -p "test_*.py"
npm run build
```

No paid GitHub Actions need to be run. The simulator, Ollama proxy and tests are still development code and require full browser/runtime validation before release.

## Safety / data warning

The app does not currently receive authenticated live exchange data or view your brokerage balances, know order fills or fees, or place trades. Imported CSV source authenticity is unknown. Historical OHLC backtests cannot reproduce all intrabar fills or future slippage. The user's Topstep and separately funded FX accounts must not be aggregated or activated until their individual rules and risk limits are verified. Exports must be backed up; clearing browser storage can delete local records.

**Do not use this research prototype as the basis for placing real-money trades without independently validated data, strategy results and risk controls.**

## TopstepX read-only workstation (development v0.9)

This branch introduces an authenticated **local-only, read-only TopstepX/ProjectX** integration. It can pull accessible accounts, futures candles, open positions/orders, and execution-leg records and store deduplicated fills in a local SQLite ledger. The browser dashboard is at `http://127.0.0.1:8765/topstep`; the existing research/AI prototype stays at `/`.

The v0.8 workstation adds a completed-position win-rate/expectancy ledger, local-only SignalR subscriptions for selected account and futures expiry, and a **completed-bar-only** 20-bar structure/ATR monitor. It automatically reports stale or gapped data; none of these observations establish a profitable strategy. On Windows the launcher detects and installs missing free Python dependencies for the stream.

**Test first without an API:** double-click `Start-Topstep-Demo.cmd` (Windows), or set `TRADER_DEMO=1` and run `python local/topstep_server.py`. This runs an entirely offline, unmistakably labeled SYNTHETIC account and market-feed rehearsal using the same UI and local API routes. It never contacts Topstep. Use `Run-Topstep-Preflight.cmd` to execute the local Python and JavaScript tests without paid CI. Demo fixtures are stored separately from real history.

**Start:** enable your official TopstepX ProjectX API subscription, link it, generate a key, then locally set `TOPSTEPX_USERNAME` and `TOPSTEPX_API_KEY` before running `Start-Topstep-Readonly.cmd`. Never commit or paste your credential. See [TopstepX v0.6 setup, limitations and gates](docs/TOPSTEPX_READONLY_V6.md).

This is **not yet live-account validated**. The new rehearsal mode is synthetic and must not be used as broker data. The two official TopstepX SignalR hubs are implemented in code and the dashboard has stream/quote freshness indicators, but no real brokerage connection has been verified in this session. It is not a complete Topstep Maximum Loss Limit calculator or order-entry app. Data remains read-only; performance is computed from broker execution legs, not completed round-trip positions. Use a Practice account for initial validation.

# Trader / Lab — Trading Research Workspace

This repository is being developed as a local-first, chart-first trading research assistant, now including session-aware historical MES strategy experiments. It is **not** a broker-connected trading application, a verified profitable strategy, or an execution bot.

## Open the current research prototype

On the working branch **foundation/mes-session-strategies-v4**, download the full repository ZIP and extract it. Double-click **Start-Trader-Research.cmd** on Windows (requires Python 3.10+). It opens the workspace in your browser at http://127.0.0.1:8765/. The service binds to 127.0.0.1 only and stops when you close its terminal. There are no broker order endpoints.

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

The app cannot currently view your brokerage balances, know order fills or fees, or place trades. Imported CSV source authenticity is unknown. Historical OHLC backtests cannot reproduce all intrabar fills or future slippage. The user's Topstep and separately funded FX accounts must not be aggregated or activated until their individual rules and risk limits are verified. Exports must be backed up; clearing browser storage can delete local records.

**Do not use this research prototype as the basis for placing real-money trades without independently validated data, strategy results and risk controls.**

# Trader / Lab — Research Engine v0.3

This branch is the next working milestone after the chart-tools-and-scanner v0.2 branch. It keeps that previous HTML version's chart, drawing tools, historic pattern finder, journal and JSON backups, and adds a **research simulator, multi-dataset scanning, experiment history, and an optional locally running Ollama analyst**.

## Start on Windows

1. Download or clone this branch of the repository, keeping its folders intact.
2. Double-click **Start-Trader-Research.cmd** at repository root. It needs Python 3.10+ and opens the local workspace at **http://127.0.0.1:8765/** in your default browser.
3. To activate local model analysis, run Ollama and ensure the model **qwen3.5:9b** is installed (or set the TRADER_OLLAMA_MODEL environment variable to one of your installed models before launching). The model status appears in the header and analyst panel.
4. If the server is not installed, you may still open **prototype/trader-workspace.html** directly in Edge/Chrome. All chart and research simulation tools work without a server, but the local AI is not available.
5. Close the launcher console or press Ctrl+C to stop the local service. No persistent daemon is installed.

**Storage note:** A standalone file:// page and the localhost launcher use different browser storage origins. If you already have important data in an earlier standalone copy, **export its JSON archive first**, then restore the archive inside the new localhost workspace. Do not assume imported data or journal notes migrate automatically.

## What the workspace can do

- Import up to 12 OHLC CSVs in one action. Each is a historic data source, not an authenticated live feed.
- Search a library of up to 16 saved datasets for rule-based historical break/retest and failed-break patterns and open each example in its original chart. No cross-market or live ranking of profitable opportunities is claimed.
- Inspect, zoom, pan, select, edit and persist chart-anchored annotations.
- Test a **rolling 17-bar structural hypothesis** through a simple event-driven OHLC outcome model. This is **not** a complete session-based opening-range strategy; those separately specified strategies still need dedicated implementation.
- Select the candidate family; supply an instrument tick size, slippage ticks/side, round-trip fee tick equivalents, reward target and maximum holding bars. No dollar P/L is computed without verified contract/FX conversions.
- Simulate an entry at the *next bar open*, explicit invalidation stop, 2-sided slippage, pessimistic stop-first exits on ambiguous OHLC candles, conservative target price when gapped beyond target, and time exits. Missing bars/gaps can invalidate episodes.
- View training R expectancy, drawdown, and individual trading episodes. The later reserved chronological window is hidden until the user explicitly reveals it, and exposure is logged. **This is a UI research safeguard, not a tamper-proof blind research environment.** Repeated tuning after viewing the reserve invalidates its status as independent evidence.
- Save versions of research runs, reopen their original inputs and recompute them, export JSON reports, and back up research runs alongside journal images, drawing layers and datasets.
- The right-side analyst panel exposes source, time cutoff and inclusion controls, and can optionally call **local Ollama** on selected bars and user-approved context. Quiet is request-only; Assist can analyze the selected case; Coach is a future session-level mode and does not yet operate continuously.

## Precise safety and model boundaries

The local server is `local/workspace_server.py`: Python standard library, bound only to 127.0.0.1. It serves one HTML page and two endpoints: `GET /api/session` (model status + in-memory session token), and `POST /api/analyst` (requires same-origin request, valid token and bounded JSON). No broker, order, payments, credential, remote browser, or external cloud API endpoint exists.

The only outbound HTTP request made by the server is to **http://127.0.0.1:11434** for the locally running Ollama API. The model receives a maximum of 180 selected candles, bounded annotations, optional notes, optional prior cases and explicitly consented exploratory stats, with replay cutoff enforced server-side. The model output is required to be structured (observations, interpretation, falsification, experiment and limitations), but **its factual claims are not yet independently verified**. Never treat the AI output as a trading signal. No paid model calls are made.

The model may take time, may be unavailable, or may return invalid data. The UI will then show an error; the local chart and journal must remain usable.

## Tests

From repository root:

```bash
npm test
python -m unittest discover -s local/tests -p "test_*.py"
npm run build
```

The Node tests require only Node's built-in test runner (Node 20+ recommended). The Python tests use unittest only; no brokerage, market feed, or running model required. Full live-browser interaction checks and an actual local Ollama trial remain necessary.

## What is deliberately not yet built

- Licensed real-time MES/MNQ/EUR/USD data and authenticated market continuity.
- Account-linked risk, Topstep Combine evaluation rules, commissions in verified dollars, FX spread/financing and broker fills.
- Proper per-exchange session calendars, daylight-saving rollovers, futures contract rolls and intrabar tick-level execution.
- Real strategy preregistration with robust untouched holdouts, walk-forward, volatility-regime slices, statistical uncertainty intervals and forward-paper trading.
- AI source/claim verifier and calibration against actual future performance.
- A production React migration and one-click packaged Windows executable.
- Any real-money or funded-account order submission.

**No strategy is qualified from this prototype.** Simulated results can be negative; on synthetic data they have zero evidentiary value for market edge.

## Next development priorities

1. Run the new Node and Python suites, browser smoke tests on Windows Edge and Chrome, and a real local qwen3.5:9b connectivity trial.
2. Port the approved HTML visual system and state contracts into the existing React production app, preserving current journal and imports.
3. Introduce a local SQLite/Parquet market-data store, read-only authorized market provider adapters and broker fill ledger. Do not connect orders.
4. Replace exploratory rolling-range simulator with exact preregistered ORP-001, FBR-001 and FXC-001 strategy-rule runners.
5. Add true blind chronological validation, fee calibration, instrument/session accuracy, rejection reports and paper forward tracking.
6. Activate an evidence-verified local/optional paid AI analyst with budget and approval controls, and only later consider account-specific execution safety.

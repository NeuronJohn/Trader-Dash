# Trader / Lab — Research Workspace v0.7

This directory contains a single-file, self-contained browser prototype of the new professional Trader-Dash research workspace.

## Run
1. Open the GitHub file prototype/trader-workspace.html on this branch.
2. Select Raw, then save the page as trader-workspace.html (do not save GitHub's wrapper page).
3. Double-click the saved HTML file on your Windows machine using current Edge or Chrome. No npm, server, API key or account required.
4. Explore Workspace, Strategy lab and Visual journal.

You can also run a local static server from the repository: python -m http.server 8080, then open http://localhost:8080/prototype/trader-workspace.html.


## New in v0.7 — FXC-001 historical research

The Market workspace now has an explicitly approved **Backfill history** action for up to 12 OANDA fxPractice pages, without background polling. The saved chart window extends to 16,000 five-minute candles. After opening an OANDA practice pair, Strategy Lab shows an FXC-001 panel with a small set of spread/slippage/fee controls, no-future confirmation discovery, conservative bid/ask historical simulation, segregated training/reserved statistics, and saved rule-versioned experiments.

Older provider receipts remain immutable; if they lack bid/ask extrema, supplemental values are recorded with new receipt IDs instead of overwriting the original series. The local Ollama analyst gets strategy statistics only when explicitly enabled, and never receives the hidden reserved outcomes.

See [v0.7 FX research guide](../docs/FX_SPREAD_RESEARCH_V7.md). Neither an indicative candle test nor a historical fit demonstrates tradeable future edge.

## New in v0.6 — Practice FX market receipts

The optional **Start-Trader-Practice.cmd** launcher accepts a local OANDA PRACTICE token with hidden input, without storing it in the app or repository. The Market workspace now has a compact OANDA Practice bar: select EUR/USD, GBP/USD or USD/JPY, fetch completed five-minute candles on demand, then open locally stored midpoint candles with a bid/ask spread summary.

Receipts go into a separate local SQLite database and preserve original price observations when later provider data changes. It is not a live executable quote or forward trading service. No Topstep API connection, live-money environment, scheduled polling, or order endpoint is included.

Read [Market Data v0.6](../docs/PRACTICE_MARKET_DATA_V6.md) for setup, backups and remaining limitations.

## New in v0.5 — Paper research ledger

With both paper-ledger.js and session-engine.js beside this HTML file, the MES workbench now supports outcome-blind research checkpoints. After finding a MES confirmation, click Save MES case from the chart to record the observed candles and frozen research costs without needing to write a thesis. The Paper research ledger in Strategy Lab keeps cases separate by historical replay and timely/unverified CSV observations.

After importing an updated MES CSV under the *same series filename*, exit chart reveal and click Check outcomes to reconcile eligible modeled results, skips and data conflicts. Partial sessions remain pending. Each case supports timestamped notes, and full v4 JSON archives preserve cases and events. No result represents an authenticated brokerage fill or validated strategy. Details: [Paper Ledger v0.5](../docs/PAPER_LEDGER_V5.md).

## New in v0.3

**One-click local launch**: From the repository root on Windows, double-click `Start-Trader-Research.cmd`. This starts a localhost-only Python web server and opens the HTML in your browser. The app remains functional offline if you open this HTML directly. Launching from localhost gives local browser storage a stable origin.

**Research engine**: Import up to 12 CSVs at once, open Market library and scan multiple saved datasets, then select a historical candidate to see its chart structure and missing evidence. This is not continuous online market monitoring.

**Simulation**: Under Strategy laboratory, choose a pattern family, specify the instrument tick size and model transaction costs, run the OHLC simulator and inspect the training results. Reserved chronological results are hidden until you choose to reveal them. Reports are saved in Previous research runs; exported JSON archives now include experiment records. Repeatedly tuning on an exposed reserve period makes it unsuitable for further independent evaluation.

**Local AI**: The optional localhost server checks your local Ollama installation (default model `qwen3.5:9b`). The Analyst panel can send explicitly selected candles/annotations/notes, with opt-in prior journal cases and experiment statistics, to the local model for read-only commentary. Its claims are not independently verified, and no broker actions or cloud services exist.

**Testing**: From the repository root, run `npm test`, `python -m unittest discover -s local/tests -p "test_*.py"`, and `npm run build`. The current changes are developmental and still need full Edge/Chrome visual and interactive smoke testing.

See [Research Engine v0.3](../docs/RESEARCH_ENGINE_V3.md) for full instructions, assumptions, limitations, and the development roadmap.

## Demo workflow
- The chart initially shows clearly labeled SYNTHETIC candles, and the local scanner automatically selects the latest historical rolling-range pattern it recognizes. None of the demo matches are real market evidence.
- Mouse-wheel zoom, shift-wheel horizontal pan or drag in Cursor mode. The 24–180 bar window autosizes candles and price axes; range selection focuses evidence for the analyst.
- Draw multiple price levels, lines, zones, arrows, brush marks and note pins. Edit lets you select, move, label, hide or delete one drawing. Annotations save per dataset in IndexedDB.
- Study the selected historical candidate's boundary, confirmation, invalidation and readiness gaps before writing any note. Notes are optional; the scanner works without them.
- When useful, capture a snapshot to preserve the original PNG, visible candle range, source, drawing layer and your optional observations.
- Open Visual journal to search/edit review text and download PNG. The original thesis remains separate from review text.
- Open the AI Research Analyst panel. Pick data scopes, click a suggested question, and Prepare context. A JSON packet is produced locally; it is not a model response. Copy the full packet for later integration.
- Open Strategy lab to load a clearly labeled untested hypothesis and prepare its research scope.
- Export a full JSON archive containing snapshots, imported datasets and standalone drawing layers. Use Restore archive in the Visual journal to validate and import saved research records atomically. Backup/restore is still a prototype; keep an external copy.

## CSV format
Plain CSV, at least 5 bars, at most 20,000 bars and 5 MB. Required headers are time, open, high, low, close. Use an explicit UTC or offset timestamp, or Unix seconds/milliseconds. Example:

time,open,high,low,close
2026-10-01T13:30:00Z,100,102,99,101
2026-10-01T13:35:00Z,101,103,100,102
2026-10-01T13:40:00Z,102,104,101,103
2026-10-01T13:45:00Z,103,103.5,101,101.5
2026-10-01T13:50:00Z,101.5,103,101,102

Imported values are marked USER CSV / source unverified; they are not automatically licensed, accurate or tied to a broker account.

## Preservation and safety
- Uses browser IndexedDB for snapshots, dataset-specific drawings and imported datasets, and localStorage for the active dataset preference. Saved notes are local to your browser profile/origin, not cloud synced.
- File:// browser storage can be browser-specific. Export regularly; prefer localhost static server for a consistent origin if testing across repeated sessions.
- Chart historical reveal is not a blind strategy test or broker fill simulator. Replay mode excludes previously made full-history annotations and journal cases from its prepared AI context, but it does not substitute for a controlled experiment.
- No external scripts, hosted calls, login, broker order routing, paid AI inference, or real-time quotes.
- This HTML is a UX contract. The existing React application is the production target after visual verification and migration.
- Local scanner uses a deterministic rolling 17-bar structural pattern, not the strategy-lab opening-range rules. Historical matches are NOT live signals, entry prices, positive-expectancy claims or AI results.

## Next
Review docs/TRADER_LAB_MASTER_PLAN.md and port selected shell/interaction modules into the React app. Add complete browser smoke tests, licensed data provenance, read-only broker fills and a true no-lookahead replay simulator before enabling model-based analysis or account execution.

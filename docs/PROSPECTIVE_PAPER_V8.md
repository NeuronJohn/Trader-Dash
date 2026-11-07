# Trader-Dash v0.8 — Provider-received prospective FX paper observations

Development branch: `foundation/prospective-signal-receipts-v8`  
Status: **DRAFT / NOT PRODUCTION VERIFIED. Practice-market research only.**

## Purpose

Earlier versions supported historical FXC-001 backtests and historical replay. They did **not** prove any setup had been observed before its future outcome became known.

v0.8 introduces a narrowly scoped, opt-in local OANDA **fxPractice** observer. Once armed, the local Python server can fetch newly **completed** five-minute historical practice candles at five-minute boundaries, independently evaluate FXC-001's fixed confirmation conditions, and store observations **before** future session bars are complete. Only later does it attach a separate conservative **modeled** outcome.

This creates a stronger **locally recorded prospective practice observation** than retrospective replay, but it is **not an exchange-signed time authority, genuine broker fill, or proof that a strategy has positive expectancy**.

## Windows startup

1. Download the complete v0.8 branch. Keep `local/market_data.py`, `local/forward_monitor.py`, and all three prototype JavaScript research modules alongside the HTML.
2. Run `Start-Trader-Practice.cmd` from the root (Python 3.10+). Give it a dedicated **practice-only** OANDA API token through the hidden input. Do not use a real-money credential or share tokens through ChatGPT, GitHub, notes or browser settings. OANDA bearer tokens may confer trading ability at the provider, but this project implements no order or account-action path.
3. Open the local dashboard (normally `http://127.0.0.1:8765/`). Select EUR/USD, GBP/USD or USD/JPY in the read-only OANDA Practice strip.
4. Click **Arm paper observer** and confirm. Exactly **one pair per local server** is monitored. A new arm will not collect signals whose confirmation already closed before the arm timestamp.
5. The server schedules a read-only candle GET at the next five-minute boundary plus about **30 seconds**, then at five-minute boundaries while active. This does not run when the Python server is closed. There is **no unattended auto-start, order placement, paid cloud AI or real-money brokerage connection**.
6. Newly observed FXC-001 matches are recorded only if the rule's **completed** confirmation candle, the local arm time, and the actual first-seen OANDA practice receipt meet strict ordering limits: the provider observation must arrive no more than **120 seconds after the candle closes**. Late, backfilled, changed or already observed signals cannot be reclassified as new.
7. Open the Strategy Lab using the cached practice pair to see **Prospective paper observations**. Cases begin as `PENDING`. Select one to inspect the historical chart ending **at the confirmation bar**, hiding later outcomes. Use the existing chart drawing, note, screenshot and visual snapshot workflow.
8. Once the complete 07:00–11:00 New York session has been received, the local server can record a second, **modeled** result under the frozen original FXC-001 rules. It never fills an actual broker order. Model statuses are `MODELED`, `SKIPPED` or `CONFLICT`; interrupted sessions remain pending.
9. **Stop observer** halts new fetch scheduling while keeping saved SQLite history. Closing the local server also ends the daemon process-bound observer. Restarting the server leaves monitoring OFF; no old signals are imported into forward status.
10. The local paper journal shows recorded counts, pending cases, modeled results and average modeled R from the **full SQLite record**, plus the latest 50 cases. A user-triggered refresh requests current local statistics. The interface may read status roughly every 30 seconds while open; these are **local status GETs**, not extra OANDA provider polls.
11. Click **Back up local evidence** from the prospective paper journal. The local Python server creates a distinct transactionally consistent **SQLite online backup**, verifies it with SQLite `PRAGMA quick_check`, and shows the resulting private path. This is a file saved under your user-local `TraderResearch/backups` folder, not a browser download. It contains market price receipts, revision audits and prospective observation/outcome tables. Do not share it publicly.

**Important:** The FX Strategy Lab's independent historical results still exist, including hidden training/holdout exposure. They are **not** automatically merged into forward-paper statistics.

## Signal evidence and immutable model events

`local/forward_monitor.py` adds three SQLite tables to the same locally held database:

- `forward_observations`: deterministic unique ID (pair, rule version, confirmation close), source receipt ID and first-seen timestamp, arm time, capture time, full **visible** pre-confirmation candle prefix and SHA-256 prefix checksum, direction, reference range and original frozen assumptions.
- `forward_events`: append-only `CAPTURE` and `MODEL_RESULT` event records with timestamps. Repeated polling cannot manufacture duplicate entries.
- `forward_outcomes`: one separately appended modeled outcome per captured signal; a later result never overwrites the original observation.

The server checks that the first qualifying signal was actually *new*, the original receipt was created after arming, and that all confirmation inputs were contiguous, fully priced and already closed. If the provider later corrects any bar in the same monitored session, its revision audit triggers `CONFLICT`, not a quiet profitable rescore.

Frozen FXC-001 assumptions currently match v0.7 defaults, not the editable **historical simulation** controls: maximum 2-pip spread, 0.2-pip slippage per side, 0 extra fee-equivalent pips, 1.5R target, 1-pip box stop buffer and the same 07:20 baseline/08:00–08:40 box/first closing-break strategy. **The observer does not read or silently update your historical GUI control values.** Any changes to forward rules require a reviewed new rule version before capture.

The result uses ask-side entries and bid-side exits for longs (inverted for shorts), with next-bar-open approximation, adverse stop gaps and stop-first if both stop and target appear in one OHLC bar, and 11:00 ET time exit. This is a historical **price-path approximation**, not an order, broker fill, slippage estimate backed by execution evidence or tradable USD profit.

All statistics remain unqualified: `actualBrokerFills=0`, `verifiedLivePerformance=false`. Only observed matches are scored; **the monitor does not yet audit every no-signal or connectivity-gap session**, so model summaries may be affected by missed opportunities.

## Local-only monitoring and safety

- **OFF by default**; explicit user arm required.
- One selected **practice-only** FX pair, one process-bound monitoring thread, **at most one GET per five-minute close** under normal operation. No continuous high-frequency or order-capable requests.
- Exact market data adapter is injected by `local/workspace_server.py`. All provider network fetches use the existing fixed OANDA fxPractice candle host and GET-only path.
- Activation/deactivation routes are `POST /api/forward/start` and `POST /api/forward/stop`, with trusted localhost Host, same Origin, per-server session token, strict JSON and fixed symbol allowlist. `GET /api/forward/status?symbol=EUR_USD` is a local read-only summary/history endpoint, not an internet API.
- No account ID, balances, credential values or actual order routes are stored or emitted. Do not run a real-money token in this proof of concept.
- User consent to include the local journal in AI context is a separate, **off-by-default** evidence toggle, `Prospective practice journal`. Server-side numeric AI evidence is loaded from **SQLite**, not from user/browser-provided values. When historical replay is enabled, forward outcomes are withheld to prevent hindsight contamination.
- The observer itself runs on the user's own PC. It cannot monitor after the local server quits and has no ChatGPT automation or push-notification bridge.
- A **POST /api/market/backup** action creates a unique local snapshot through SQLite's online backup API and verifies the snapshot. It accepts **no destination path** or arbitrary options, requires same-origin and a session token, and never copies a live WAL database file raw. Both the browser JSON archive and the server SQLite snapshot remain useful: they are distinct artifacts and neither alone is a complete substitute for the other.
- Some stock Windows Python installs lack the `America/New_York` IANA time zone. A deterministic 2007+ US Eastern daylight-saving fallback supports the 2026 research period without installing additional packages.
- All local SQLite tables, hashes, browser controls and OS timestamps remain under the user's control. They **cannot provide independently trusted, exchange-signed evidence** without a separate protected receipt service.

## Tests and release conditions

New tests:
- `local/tests/test_forward_monitor.py`: 14 unit tests with entirely fabricated FX candles for timely capture, zero retroactive reclassification, no-gap rule detection, New York DST, duplicate suppression, delayed model outcome, stop-first exits, changed candle prefixes and provider revisions, all-history statistics, and disabled-by-default watcher.
- `local/tests/test_workspace_server.py`: strict forward start/stop scopes and anti-CSRF token tests, read-only status response, fixed-path backup permission tests, local AI context opt-in, forged client profitability rejection and replay suppression.
- `tests/session-ui.test.js`: observer arm/stop UI, safe localhost actions, read-only source, time-scoped research journal and chart outcome-blind reveal.

**65/65 JavaScript regression tests** passed in an equivalent V8 test environment, including UI tests of the backup action. More Python backup-integrity tests were authored but are not yet executed. Additional Python tests are **written but have not been executed** in the user's actual Windows Python environment. A real OANDA practice connection, browser rendering and real receipt persistence must be verified before production or claims of a working real-money trading system.

Developer validation commands from repository root:

    npm test
    python -m unittest discover -s local/tests -p "test_*.py"
    npm run build

Manual acceptance checks:
- Validate the real fxPractice API completion timing under a dedicated practice credential and confirm that 30-second boundary fetches return the newly completed candle.
- Test no false capture when arming in the middle of a session, crossing daylight saving, losing internet, restarting the server, receiving a revision or importing old data.
- Confirm the exact versioned Python forward detector and JS FXC-001 historical detector produce matching confirmations and modeled results on identical fixture candles; cross-language parity is **not yet fully established** by real-source tests.
- Verify SQLite journal persistence, new one-click WAL-safe snapshot creation and an actual backup **restore** on Windows before relying on the journal.
- Verify that TopstepX remains unconnected and no live execution route is available.

## Next work toward a trading-ready dashboard

1. Run Python tests and genuine OANDA practice collection on Windows, compare server-side vs JavaScript strategy results, and fix any divergences before forward qualification.
2. Add full **market coverage** auditing (every expected M5 slot and no-signal day), connectivity losses, missing signals and exclusion reasons. Missing data must not be disguised as favorable selection.
3. Validate SQLite backup **restore**, user-friendly backup organization and optionally a local tray process so closing the browser does not confuse monitoring state; any auto-start must still be explicitly authorized.
4. Add read-only real fill/balance reconciliation for eligible OANDA and Topstep accounts (with careful management of order-capable credentials), account-specific risk and drawdown rules, untouched forward-paper validation and statistical uncertainty.
5. Build professional source-grounded AI training reviews: explain misses, rule violations, missed/favorable setups, visual annotations and confidence bounds, without delegating capital allocation or orders to the model.

This version is the first process-local automated **observed practice setup → delayed evaluation** milestone, not a proven edge or an independently authenticated trading record.

Official OANDA references:
- https://developer.oanda.com/rest-live-v20/instrument-df/
- https://developer.oanda.com/rest-live-v20/pricing-ep/

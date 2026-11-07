# TopstepX read-only workstation v0.12 (development)

## What exists
- Local, browser-based /topstep dashboard reusing the project research server, plus / for the earlier research workspace.
- Allowlisted ProjectX REST authentication, account discovery, contract search, candle retrieval, open positions and open orders.
- Trade-leg ledger in local SQLite with broker ID upserts and voided-leg exclusions.
- Broker-sourced realized P&L, fees, commissions, session grouping and basic account snapshots.
- No Topstep order endpoints; no futures-trading or fee-performance claims; no payment, hosted model or GitHub Actions dependency.

## Install and start (Windows)
1. Enable official TopstepX ProjectX API access, link the subscription to the TopstepX profile, create an API key in TopstepX Settings > API. Do not expose keys in screenshots, repositories, chats, or the browser.
2. Open a local Command Prompt and enter the following commands (replace placeholders). This process-only setup avoids leaving the secret in repository files:

```bat
set "TOPSTEPX_USERNAME=YOUR_TOPSTEPX_LOGIN_USERNAME"
set "TOPSTEPX_API_KEY=YOUR_API_KEY"
Start-Topstep-Readonly.cmd
```

3. Visit http://127.0.0.1:8765/topstep. Research workspace stays at http://127.0.0.1:8765/.
4. Close the terminal to stop the service. To erase shell variables, close the Command Prompt. Use a Windows-protected secret store for future builds; environment variables can still be inspected locally.

Requires Python 3.10+ with standard library and an OS time zone database providing America/Chicago (on Windows, `pip install tzdata` may be required). No credentials are stored in the SQLite database.

## Important limitations
- **Development code, not production verified.** No authenticated Topstep sandbox or API account was accessible for end-to-end confirmation.
- Topstep says no dedicated sandbox exists; use a Practice account to test integration. API is for eligible simulated accounts, not Live Funded Accounts.
- REST polling approximately every 30 seconds is not tick streaming or order-book data. A rate limiter, SignalR hub streaming, connection recovery, and stale quote detection are follow-ups.
- Only a bounded lookback of 7, 30, 90 or 365 days per account is imported. Brokers may change historical legs outside the lookback, requiring resynchronization. If sync fails, stale data remains local but is not presented as a freshly synchronized account.
- Daily net includes any broker leg timestamps whose exchange session falls inside the request window; partial first/last sessions may be incomplete.
- ProfitAndLoss is closing-leg *gross* P&L; opening and closing fees and commissions are deducted once each. Closing leg count is NOT complete trades or round trips. Realized win rate of completed positions, profit factor, R expectancy and trade duration are not computed until reliable matching is added.
- Session-close drawdown is **not** intraday drawdown, Topstep's trailing Maximum Loss Limit, available loss buffer, account eligibility, or any other official rules calculation.
- API keys authorize trading despite the client being read-only. Keep them private. This local service does not implement hosted access, local HTTPS, or orders. Topstep restricts remote order flow.
- Market/research shell is not yet unified. The new dashboard links to the existing scanner and journal but does not supply the imported Topstep bars to the scanner automatically.

## Next engineering gates
- Unit tests for correction/void accounting, broker response validation, DST sessions, and UI rendering.
- Actual Edge/Chrome smoke tests and live read-only API tests on user's TopstepX Practice account.
- Durable sync metadata, missing-data detection, contract rollover, and more reliable session calendars.
- User hub + market hub streaming, subscriptions and reconnect; broker executed order grouping with precise round-trip metrics.
- Read-only pattern scanner using broker-confirmed price bars, no-lookahead backtests and session rules.
- Real Topstep rules source and agreement-specific MLL/risk panel.
- Trading order routing only after *separate* user approval, dedicated implementation and additional controls.

## v0.7 completed-trade analytics improvements

The Topstep workstation now shows **fee-adjusted completed positions** alongside the original broker execution-leg totals. Complete flat-to-flat positions are reconstructed by contract ID and buy/sell side. Scale-ins, partial exits, same-timestamp reversals and corrected/voided half-turns are handled conservatively. When the selected history starts mid-position, orphan closing legs are excluded from completed-trade metrics and the data-quality warning is visible. Partial positions are never counted as completed trades.

Metrics: complete-position count, net win rate, net expectancy in USD, profit factor, average winner/loser, median, completed-trade peak-to-trough drawdown, recent completed position cycles, and results by contract, direction, Chicago entry hour and weekday. The dashboard does **not** calculate R-multiples from fills because the original protective stop/risk amount is absent. A historical win rate does not imply a statistically validated trading edge.

For initial long-window imports, the adapter now requests trade legs in consecutive 14-day windows, deduplicates broker legs by ID, and upserts corrections into the SQLite journal. The broker remains the source of truth. Imported records are local and scoped by account. A high-volume account may still need rate-limit-aware incremental backfill and streaming updates. The chart no longer silently chooses among multiple futures expiry contracts, remembers an explicitly selected contract locally, and clears stale candles during a contract switch.

**Verification status:** nine isolated deterministic completed-trade tests were executed successfully in the development environment. Additional checked-in tests cover historical backfill and SQLite timestamp filtering, but the complete repository test suite and Windows launcher have not been run against a genuine TopstepX Practice account. The new JavaScript parsed successfully, with no missing referenced DOM element IDs. No live quotes, balance, orders or executions were seen by this development session.

**Remaining:** authenticated Practice-account handshake/snapshots, live SignalR user and market hubs, robust reconnection and stale indicators, contract rollover calendar, full broker-history provenance, genuine account-specific drawdown and daily loss controls, strategy/risk tagging, feeding Topstep candles directly into the research scanner, independent forward performance verification, and user-gated execution if ever separately authorized.

## v0.8 — local-only live ProjectX stream bridge

Official ProjectX real-time API uses separate **user** and **market** SignalR hubs; this version implements both via an optional Python `websocket-client` transport, keeping the JWT exclusively on the local Python backend.

### Data and UI

- The market hub subscribes to `SubscribeContractQuotes` and `SubscribeContractTrades` for the contract selected in the dashboard. The account hub subscribes to `SubscribeAccounts`, `SubscribeOrders`, `SubscribePositions` and `SubscribeTrades` for the selected account.
- The browser POSTs only an account ID and contract ID to **`/topstep/api/live/subscribe`**, a same-origin localhost-only operation that controls subscriptions. There is **no broker order endpoint**.
- The browser polls **`/topstep/api/live`** every 2.5 seconds for a sanitized stream snapshot; the JWT is never included. Price displays include last, bid, ask, stream connection state and a freshness warning. A fresh badge requires both a connected market hub, recent local receipt and a recent provider timestamp; open socket alone does not count.
- ProjectX GatewayQuote events can contain only changed fields. Partial quote messages are merged only into the selected contract's prior quote. Invalid or missing initial prices never create synthetic quotes.
- GatewayUserTrade updates are upserted by broker `id`, including corrected and voided legs; client-side account statistics are refreshed through REST reconciliation after user events. User order/position stream events signal an upcoming REST refresh rather than inventing position state.
- Long-window history is fully backfilled initially and refreshed every six hours. Between full passes, the recent two-day trade window is reconciled. Deep late corrections may remain unseen until the next full pass. The snapshot remains explicitly marked REST-derived rather than true tick-by-tick P&L.
- On account/contract changes, the old worker socket closes and a new subscription begins. On disconnect, the workers reconnect with bounded backoff, handshake again and replay subscriptions.
- Quotes are **not** treated as chart OHLC bars. Broker REST still supplies historical chart candles, which are polled at a slower cadence.

### Deterministic market context

`local/structure_context.py` computes a **completed-candle-only** reference using the previous 20 closed bars, last closed bar, ATR14 and whether the latest close is inside/outside that range. It excludes the current forming candle and flags stale data or gaps. It is exploratory structure labeling, not a backtested strategy, validated edge, order recommendation or Topstep compliance check.

### Start on Windows

The `Start-Topstep-Readonly.cmd` script detects and installs missing `websocket-client` and `tzdata` dependencies using pip, then opens the local service. Internet access may be required on first install. Use an existing TopstepX Practice account with API access enabled; no dedicated API sandbox exists. Ensure another server is not already using port 8765.

Set the two credentials in your local Command Prompt session only:

```bat
set "TOPSTEPX_USERNAME=YOUR_PLATFORM_LOGIN_USERNAME"
set "TOPSTEPX_API_KEY=YOUR_API_KEY"
Start-Topstep-Readonly.cmd
```

Visit `http://127.0.0.1:8765/topstep`, select an account and **specific contract expiry**, and inspect the user/market stream state. Nothing starts streaming until both are selected. The older research workspace remains at `/`. Do not send API keys in chat or commit them to GitHub. Both the model and broker connectors remain local to your machine.

### Local testing

```sh
python -m unittest discover -s local/tests -p "test_*.py"
npm test
npm run build
```

A local isolated test copy of the stream/frame and completed-candle algorithms passed 12 deterministic tests. The committed browser JavaScript was separately syntax-checked and DOM IDs were checked for missing references. **The full GitHub branch tests have not been executed together in this session**, and actual Windows/TopstepX authentication and streaming have not been witnessed. Run the entire suite locally and test the stream against the Practice account before promoting this draft PR.

### Required before production

1. Real authenticated Practice-account user/market SignalR handshake, receipt of genuine quotes and fills, reconnect/late correction tests and broker/SQLite match reconciliation.
2. Authenticate account/contract eligibility and exchange session calendars across DST and contract rolls. Display explicit disconnected/stale indicators during maintenance/holidays.
3. Point-in-time broker-source scanner and walk-forward strategy experiments with real trading costs, risk/position tag capture, and validated no-lookahead evidence.
4. Agreement-specific Topstep maximum loss limit, drawdown and daily loss-rule monitoring derived from **verified authoritative account data**, not historical P&L approximations.
5. Only separately authorized, supervised trade execution, with explicit consent and safety gates, if ever requested.

## v0.9 — no-API offline rehearsal and fail-closed UI

This version includes an **explicitly synthetic** broker and stream provider at `local/demo_broker.py`. It exercises the *same* HTTP endpoints, dashboard, journal SQLite class, fee-adjusted ledger and completed-bar market-context engine as the live implementation. The two fake futures expiries for MES and one for MNQ, 42 deterministic round trips, a voided execution, synthetic chart candles and invented quotes are purely test fixtures. They are not Topstep data, any past trading performance or real streaming.

### Run without any credentials
Download/extract the latest `foundation/topstepx-readonly-v6` branch and double-click **`Start-Topstep-Demo.cmd`** on Windows. A local browser opens at `http://127.0.0.1:8765/topstep`. If your environment lacks Python 3.10+ or the Chicago timezone database, the launcher explains the problem; it may install the freely available `tzdata` package. The demo never needs a Topstep API key, `websocket-client`, a ProjectX subscription or an external trading service.

Alternatively from a terminal:
```sh
# Windows CMD
set TRADER_DEMO=1
python local/topstep_server.py

# PowerShell
$env:TRADER_DEMO="1"
python local/topstep_server.py
```
Stop the process with Ctrl+C. Never put actual credentials into the demo launcher.

### What to exercise
- Select `SYNTHETIC Practice — Not Topstep` and review synthetic performance history.
- Switch between both synthetic MES expiries and the MNQ contract; ensure chart, research structure and quote labels cannot retain the previous instrument.
- Change timeframes and history windows (7/30/90/365 days), inspect the completed-trade list and fee accounting.
- Inspect the mock market/user stream status and synthetic bid/ask changes.
- Use the separate Research workspace link to confirm the older MES strategy lab, annotation tools and local Ollama integration are still accessible. It is not yet wired to receive broker-source live candles.

**The page displays a prominent 'OFFLINE SYNTHETIC DEMO' banner** and the API returns `synthetic: true`. The browser refuses to display account snapshots or candle responses whose provenance does not match the server's declared mode.

Demo fills are stored only under `TraderDash/demo-fixture-ledger.sqlite3`, never in `topstep-ledger.sqlite3`. The demo server returns no broker token and makes no real broker connection; account canTrade is false and no order endpoints exist.

### Automated no-API smoke test
```sh
python -m unittest local.tests.test_topstep_demo_http -v
```
This starts the actual server on an ephemeral localhost port with no API credentials, checks synthetic account data and completed-trade accounting, loads candle history and completed-bar indicators, starts the synthetic stream, checks CSRF/session-token protections, verifies no broker order route exists, and confirms the live database was not touched. It is **committed but has not been executed in this chat session**; run locally and inspect failures before using the release branch.

### v0.9 reliability hardening
When a broker account refresh fails, last-seen values are blanked and an explicit synchronization failure is shown. On market stream failure, previous bid/ask and last-price values are cleared. Changing account or futures expiry clears the existing selection's quotes/charts. Real API credentials are never stored or copied into the offline mode. The Windows demo launcher skips unneeded WebSocket package installation.

### Boundaries
Even a full successful offline rehearsal **does not prove actual Topstep connectivity, correct broker fee reconciliation or production readiness**. Next release gate remains a Practice-account API smoke test with authorized credentials kept exclusively on your machine, matched against the official TopstepX UI. No order execution is permitted by either development mode.

## v0.10 — pre-trade risk worksheet and chart-quality foundation (no API needed)

This milestone adds two independently testable, deterministic, browser/Node modules:

- `topstep/risk-plan.js`: no-order futures plan estimates using **contract-specific** `tickSize` and `tickValue` from the ProjectX contract search response. Long and short risk use stop distance in ticks. Assumed adverse slippage is counted on **both entry and exit**. Estimated **loss per contract = (stopTicks + 2 × slippageTicksPerSide) × tickValue + roundTripFeesUsd**. Estimated **net reward per contract = (targetTicks − 2 × slippageTicksPerSide) × tickValue − roundTripFeesUsd**. Totals multiply by requested quantity; the worksheet displays a maximum quantity fitting the user's self-selected risk budget and contract cap. Price levels must align with the exchange tick. Invalid risk direction, invalid quantity, missing metadata, negative/nonfinite costs and unfavorable net target are explicitly reported.
- `topstep/chart-model.js`: deterministic viewport range, cursor-anchored zoom and drag panning with live-tail return, position hit testing, price-axis auto-fit to **visible** bars, and consistent candle width/geometry. The actual Topstep canvas now draws planned entry/stop/target lines, a crosshair and bar metadata without submitting orders.
- Local server serves both modules over localhost, and Windows preflight includes `npm test` **and** `npm run build`. Offline HTTP smoke tests check that both scripts are actually served.
- New Node tests `tests/risk-plan.test.js` and `tests/chart-model.test.js` test costs, tick math, long/short symmetry, budget caps, alignment, zoom anchor, viewport bounds, geometry and historical pan.

### Evidence and limitations

A local isolated mirror of the pure chart and risk modules passed **17 focused Node tests**. The committed dashboard was checked for JavaScript syntax and all 68 referenced controls. Those tests do **not** establish a full Windows browser smoke test, working Topstep credentials or official compliance.

**IMPORTANT:** `PLAN_WITHIN_SELF_LIMITS` means only that the hypothetical plan fits the **user-entered planning assumptions**. It does NOT mean Topstep approves it, the contract is tradable, the broker stop can be filled at that level, the account has sufficient margin, or the strategy has a positive expectancy. Stop gaps, slippage spikes, event news, open positions, commissions and account-specific rules may invalidate the estimate. No real order routing exists.

### How to explore v0.10 without connecting a broker
1. Open `Start-Topstep-Demo.cmd` (Windows) and select the synthetic account.
2. Select one of the synthetic MES or MNQ expiries. Verify the chart labels its source as synthetic.
3. Zoom using wheel/+/−; drag to inspect older candles; press **Latest** to jump to the newest bars.
4. Open the risk worksheet and enter long/short, entry, stop, target, quantity and a **personal risk cap**. Verify the tick-size check and fee/slippage assumptions. If the completed bar context is current, its last completed close can be copied into the entry field via a separate user click.
5. Run `Run-Topstep-Preflight.cmd` for Python tests, Node tests, and a Vite build. Review any failures before trying real credentials.

This remains an unmerged draft. Before production, test the entire dashboard in Edge/Chrome on Windows and perform an authenticated comparison with the TopstepX Practice account. The risk worksheet is **not** a Topstep official loss-limit engine.

## v0.11 — integrated Decision Desk (no separate chat)

The trading screen now places a compact **Decision Desk** directly beside the selected chart. It automatically combines the *last completed candle* and prior 20-bar range, data continuity, fresh market quote, current account synchronization, open positions/orders, broker eligibility and the selected contract's tick metadata. It emits **PAUSE / WATCH / REVIEW STRUCTURE**, with clear reasons. **REVIEW STRUCTURE is an exploratory pattern observation, NOT permission to trade.** Existing completed-trade statistics are explicitly labeled general historical account results, never evidence that this pattern is profitable.

When a complete, fresh range-break observation is present, **Draft risk plan** copies a *hypothetical* 1×ATR stop / 2×ATR target and the last completed price into the existing tick-aware risk worksheet. The worksheet starts collapsed to reduce clutter and expands only when requested. The user must enter their own risk cap, check levels, and make their own decision. There is no order submission and no official Topstep loss-limit clearance.

The optional local Ollama bridge `/topstep/api/desk/review` is not a general chat endpoint: it accepts only account ID, contract ID, timeframe and an exact completed-candle timestamp, all checked server-side. The server fetches its own account/candle data, checks matching selected live quote, missing bars and current completed-break status, and sends **only a bounded evidence summary** to the local Ollama process. No raw API credentials, account balances, entire fills or arbitrary browser prompts are passed. The model returns three short **qualitative** phrases (observation, concern, next check). Its output is validated to reject numeric claims, execution instructions and synthetic-source omission. The model cannot modify the computed status or prices. One optional local review is automatically attempted per newly observed candidate when Ollama is installed and the data is current. If unavailable, the deterministic Decision Desk continues normally and shows an honest message.

Synthetic demo mode retains a prominent provenance banner, source-tagged analyst results and a separate SQLite journal. There is no cloud AI call. Local review uses the existing one-request-at-a-time Ollama gate and is strictly read-only.

**Tests:** `tests/decision-desk.test.js` adds deterministic no-data, stale-data, no-quote, no-account, exposure, ineligible real account, missing tick metadata, long/short draft and unverifiable stats checks. `local/tests/test_decision_review.py` checks narrow prompt context and response validation. The offline HTTP regression suite verifies the extra script route and fail-closed invalid/stale AI request. Thirteen focused Decision Desk engine cases were executed successfully against the GitHub branch source in the development environment; the full Python/Node/Windows end-to-end suite and real TopstepX Practice account connection remain unverified.

**Next:** run Windows offline preflight and browser interactions, then connect broker-source setup observations to the automatic review journal and outcome verification. Do not conflate structural observations with trade signals or validated expectancy.

## v0.12 — forward observation journal (still no broker key required)

The Decision Desk now has an integrated prospective observation loop: a completed-candle, prior-20-bar range break is recorded once into an account/contract/timeframe/source-keyed SQLite table **only when the user/account stream and selected live quote are fresh** and the signal candle was just confirmed. It cannot retrospectively import an entire chart as though the system observed historical setups in real time. The original reference close and discovery time are immutable.

The journal then waits until **five strictly later, fully closed, contiguous candles** are available. It measures signed fifth-bar close change relative to the original signal close, not actual entry/exit P&L. It never assumes an order, entry fill, stop fill, fee, commission, or target execution. Missing required bars become excluded DATA_GAP observations; a corrected original signal price becomes SIGNAL_REVISED and is excluded; corrected later prices are re-evaluated when the full window overlaps the available data. Events older than the price history window remain pending or previously recorded rather than being fabricated.

The Journal is included in the existing `GET /topstep/api/bars` response only when the frontend supplies a valid `account_id`. There is no new panel hierarchy or user action needed. Beside the Decision Desk's explanation, it shows the observed / pending / matured / excluded counts. Recent observation details are accessible under one collapsed "See recorded observations" disclosure. Fewer than **30** matured observations receive **no displayed directional fraction**; with 30 or more, the positive-direction fraction is descriptive only—not a setup win probability or profitability estimate. Signals can overlap, and no inferential statistical significance is asserted.

The real journal database is `topstep-observation-journal.sqlite3`; the completely synthetic offline demo writes **only** `demo-observation-journal.sqlite3`. The source namespace is also keyed within the database. A demo dataset cannot become live trading evidence. Demo OHLC fixtures are now pure functions of contract + timestamp so earlier candles never silently repaint when new bars arrive.

The local AI Decision Desk receives a bounded, source-checked count of matured and awaiting observations. It cannot invent a setup-specific hit rate or overwrite the deterministic observation math, statuses, account risk data, prices, or trade journal.

### Validation and remaining work

- `local/tests/test_observation_journal.py`: completed-bar timing, five-bar maturation, missing bars, revisions, deduplication, account and source separation, restart persistence, no retrospective signal capture and malformed OHLC rejection.
- `local/tests/test_topstep_demo_http.py`: journal through actual localhost candle endpoint, API account authorization and separate demo/live journal files.
- `local/tests/test_demo_broker.py`: timestamp-stable historical synthetic candles.

Run `Run-Topstep-Preflight.cmd` locally to execute the full Python suite, JavaScript tests and Vite build with no Topstep subscription or paid GitHub Actions. **These new Python and HTTP tests are committed but not yet executed in this session.** The dashboard JavaScript syntax and DOM references were checked in this development environment; a full Windows browser smoke test and real TopstepX Practice-account verification are still outstanding.

### What is NOT being measured

These outcomes are **five-bar directional reference price changes**, not trades. They cannot establish win rate, risk/reward, maximum favorable/adverse excursion within an actual filled position, transaction costs, risk-adjusted expectancy, or whether a strategy outperforms a null hypothesis. They are not evidence that Topstep officially permits a trade. Future strategy validation requires timestamped fill assumptions, out-of-sample testing, realistic costs, sample-size and dependency controls, and actual broker reconciliations.

The visual goal remains one compact Decision Desk bridging chart, market status, risk worksheet and observations—no separate chat requirement.

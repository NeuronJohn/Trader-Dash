# Trader-Dash v0.7 — FXC-001 spread-aware FX strategy laboratory

Branch: foundation/fx-spread-research-v7  
Status: **Development draft. No validated trading edge, real-money data, or order execution.**

## What is new

Trader-Dash now has an actual **FX-only, bid/ask-aware rule engine**, `prototype/fx-research.js`, named FXC-001. It uses the first-observed OANDA fxPractice five-minute historical prices, including full midpoint, bid, and ask opening, high, low and closing components. The strategy UI and chart reveal are independent of MES/Topstep rule tests.

The earlier provider connector displayed prices and stored receipts; v0.7 adds:
- Frozen New York morning contraction-breakout rules that can detect historical confirmations without knowing the future.
- Conservative, next-open modeled entries using ask for long positions / bid for short positions, corresponding bid/ask stop and target evaluation, spread checks, assumed slippage and fees.
- Separate action to simulate full historical outcomes. Training summaries, skippable opportunities and sample-size warnings; reserved chronology is concealed until explicitly revealed.
- Saved versioned experiments and original-receipt fingerprints. A changed input series cannot be silently substituted when reopening an earlier experiment.
- Click a match to open chart replay at its confirmation candle, with the box high, box low and stop reference shown before future price action is revealed.
- A separate optional local Ollama context describing only selected confirmations and explicitly approved training statistics, with no verified-fill claims.

Nothing uses a trading token to submit orders. The algorithm's purpose is to discover a **possible** edge and learn why it may fail, not to present an actionable or guaranteed strategy.

## Windows startup

1. Download the complete branch and keep `prototype/fx-research.js`, `prototype/paper-ledger.js` and `prototype/session-engine.js` beside the HTML.
2. Use `Start-Trader-Practice.cmd` from the repository root. It requires Python 3.10+ and asks for a **practice-only OANDA token** using hidden console input. The token remains in the launched local process environment. Do not use a live-money token, which may have broker-trading permissions.
3. Open the localhost dashboard, select EUR/USD, GBP/USD or USD/JPY in the Practice bar. Click **Refresh chart** to fetch 500 recent closed M5 candles, or **Backfill history** to request up to 12 chronological pages (each 1,000 candles) of older OANDA practice data. Backfill is manually initiated with an explicit confirmation. It cannot place an order and never runs on a background timer.
4. Once practice candles load, Strategy Lab presents FXC-001 instead of the MES tools. **Find FX confirmations** lists outcome-blind matches; select a card to inspect the chart at that exact completed confirmation, then advance through future candles with replay controls.
5. Separately choose **Run FX research** to simulate historical outcomes with your selected spread limit, slippage, round-trip fee-equivalent pips and reward multiple. This does not prove these values reflect your account.
6. Inspect training results. Reserve stays masked until an explicit reveal and an exposure record is persisted. Saved runs can only be recomputed if the original cached input fingerprint still matches.
7. Export your dashboard JSON archive AND separately back up the local SQLite provider-receipt store. The JSON export does not replace the provider database.

Without enough complete New York sessions, FXC-001 will report no statistically useful evidence. The backfill extends the chart read horizon to 16,000 candles so multiweek datasets can be tested. A one-time backfill does not make the workspace a prospective live monitor.

## Precisely frozen FXC-001 rules

- Eligible instrument: OANDA **practice** EUR_USD, GBP_USD or USD_JPY, with **complete** bid, ask and midpoint M5 candles and saved source receipt IDs. CSV, synthetic, MES and old incomplete-component records are rejected.
- Time zone: IANA `America/New_York`, including daylight-saving transitions. The custom research window is **07:00–11:00 New York time**, not an assertion that these hours are the true London/NY market overlap every calendar week.
- Minimum of 48 contiguous five-minute bar-starts from 07:00 through 10:55 local on each included day. Missing/duplicated slots are excluded.
- Baseline volatility reference: high-low range of the eight candles starting 07:20 through 07:55.
- Contraction box: eight candles starting 08:00 through 08:35. Require box width 1–20 pips (default), baseline width at least 2 pips, and box width no more than **80% of baseline range**.
- First confirmed close beginning 08:40 and no later than 09:50 that moves **0.2 pip beyond the box high or low** defines the single directional opportunity. Both-sided sweeps in one OHLC bar are discarded as intrabar-ambiguous. Confirmation bid/ask closing spread must be no greater than **2 pips** (default).
- Model entry at the *next candle open*, strictly before 10:00 NY. A long buys the **ask open** and a short sells the **bid open**, each worsened by assumed per-side slippage. A too-wide next-open spread invalidates the opportunity; no second try is cherry-picked that session.
- Structural modeled stop is 1 pip beyond the opposite box edge in the exit-side price convention. Initial modeled risk must be within **2–35 pips** (default); otherwise skip rather than rewrite the stop.
- Default modeled target **1.5R**, stop-first when both the stop and target appear inside one OHLC candle. Long exit evaluation uses **bid** high/low/open/close; short uses **ask**. Unfavorable stop gaps fill at observed worse opening price; favorable target gaps are capped at the target.
- No position carries beyond the custom 11:00 NY window. Session exit uses the appropriate bid/ask last close, worsened by assumed exit slippage.
- Net results are expressed in **pips and R**, net of assumed round-trip fee-equivalent pips. USD P&L, leverage, margin, rollover financing, account-currency conversion, fill depth, liquidity and rejected live orders are NOT modeled.

The rules are a **testable hypothesis**, not a profitable recommendation. No known win rate or expectancy should be inferred from these defaults.

## Honest training/holdout safeguards

- Only completed session days are split chronologically: roughly 70% training with a transition-day embargo before later reserved dates.
- Training and reserved trades are distinguished; reserved metrics and episode records are omitted from pre-reveal persisted experiment archives, not merely hidden with CSS.
- A user-initiated reveal permanently marks the dataset as previously examined in research history. Further tuning on the same data is not an independent holdout.
- Results under 30 training trades or 20 reserved days explicitly flag insufficient samples. These are warning thresholds, not proof of significance once exceeded.
- Reopened experiments require the identical original candle set, prices and source receipt identifier checksum. The checksum is **non-cryptographic** and not proof of market data authenticity.
- Source request timestamps, replay cutoffs and indicator calculations help avoid lookahead. The simulator cannot model tick ordering within OHLC candles, event/news shocks, stale indicative prices or the difference between account-specific OANDA live spreads and historical base-price-group candles.

OANDA's own documentation notes that historical candle prices can differ from the streaming prices that apply to a specific account; this backtest is therefore **not a verified execution-cost model**.

## OANDA provider history and safe v0.6 upgrade

The Python standard-library SQLite module now supports historical pagination through the fixed fxPractice candle endpoint with a strictly bounded `to` cutoff, no arbitrary provider URLs, redirects or other account actions. Maximum is **12 pages per explicit click**; full normal reads are capped at **16,000** M5 candles. It can return fewer candles for outages, weekends and market closures. Exact pacing and provider schema still require validation against a genuine practice account.

The first-seen price ledger keeps all `bars` records immutable. For **v0.6 cached rows** missing bid/ask high-low extrema, v0.7 adds a `component_extensions` table to record a new receipt containing those missing values. It preserves the original v0.6 candle bytes and original receipt ID; the supplemental component receipt has its own timestamp and ID. An actual conflicting base price is logged separately as a `revision`. The receipts table is migrated in place with an `augmented` count.

A later source correction never replaces first-seen price history. The historical experiment should record which component receipt supplied its complete data.

Storage default:
- Windows: `%LOCALAPPDATA%\TraderResearch\market_receipts.sqlite3`
- Other OS: `~/.local/share/TraderResearch/market_receipts.sqlite3`

**Back up the SQLite database separately** after stopping the local server; it is not currently included in the workspace JSON export. No provider token is written to these files.

## Developer tests

New and existing tests:
- `tests/fx-research.test.js`: 12 cases for exact FX rule triggers, NY daylight-saving conversion, bid/ask next-open fills, ambiguous stop-first bars, adverse gaps, spread-based rejection, false history/price-source classification, missing receipt components, future-cutoff blindness, day-based sample separation, and cost sensitivity.
- `tests/session-ui.test.js`: FX controls, hidden reserved results in persisted versioned runs, confirmation-only visual reveal, source isolation, fingerprint invalidation and bounded manual backfill request.
- `local/tests/test_market_data.py`: bid/ask normalized components, SQLite v0.6 schema migration, supplemental history receipt, duplicate vs correction behavior, backward `to` pagination and bounded provider calls.
- `local/tests/test_workspace_server.py`: localhost token and same-origin access, market read-only route enforcement, bounded backfill, and AI sanitization of FX training/holdout evidence.

**62/62 JavaScript tests** were exercised in an equivalent V8 test environment. The Python test suite is authored but has NOT been executed in a real Windows Python environment. A genuine authenticated OANDA practice API request, full npm test/npm build, browser screenshots/visual QA, and full SQLite migration/backfill end-to-end tests remain prerequisites for merge. No GitHub Actions, paid CI or live execution are triggered.

Commands from the repository root:

    npm test
    python -m unittest discover -s local/tests -p "test_*.py"
    npm run build

## Next required capabilities

1. Test with authorized OANDA practice credentials and verify actual provider response shapes, count+to history behavior, gaps, and rates. Add robust one-click SQLite WAL-safe backups.
2. Transition from manually fetched historical prices to explicit **provider-received prospective signal capture**, with immutable signal rule versions, timestamps and a real paper forward scoreboard.
3. Add source-qualified bid/ask transaction cost distributions, weekend/holiday/news filters, market volatility slices and statistical uncertainty. Validate on untouched market periods.
4. Add read-only account fills and balances (separate OANDA practice/live, TopstepX) with permission inspection, reconciliation and account-specific loss rules. TopstepX access is paid and keys are order-capable; no key has been created here.
5. Connect deterministic statistical verification to the local AI's visual explanation tools. Do not delegate order execution or account security to an LLM.

Reference documentation:
- https://developer.oanda.com/rest-live-v20/instrument-df/
- https://developer.oanda.com/rest-live-v20/pricing-ep/
- https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml
- https://help.oanda.com/us/en/faqs/rest-v20-api-troubleshooting-guide.htm

# Trader-Dash v0.6 — OANDA practice market receipts

Branch: foundation/market-data-receipts-oanda-v6.
Status: development-only, unmerged. No broker execution or verified trading edge.

## Features

Trader-Dash can request completed five-minute candlesticks from the official OANDA fxPractice REST API, by explicit click, through the localhost Python server. The fixed practice-only provider returns midpoint OHLC as well as bid and ask candle information for EUR/USD, GBP/USD and USD/JPY.

The server stores each receipt in a local SQLite database, keeps the first observed candle unchanged, logs later price revisions as conflicts, and records local receipt time, response SHA-256, provider HTTP date and request ID where available. The dashboard can then open cached candle series, display source labels, and show median/max bid-ask closing spread (in pips), time gaps and receipt history. These are **not executable spreads or broker fills**.

No account order/trade endpoints, automatic polling, FX profitability backtest or live-money connection are enabled. Historical MES futures strategies explicitly reject the OANDA FX source.

## Windows setup

1. Download the complete v0.6 GitHub branch and keep the local and prototype directories together.
2. Install Python 3.10+ (standard library only).
3. Double-click Start-Trader-Practice.cmd. In the console, enter a dedicated OANDA PRACTICE token when asked. Characters are hidden; the token is not put into the HTML or saved in the repo. If OANDA_PRACTICE_TOKEN is already present in your process environment, it is reused.
4. The localhost page normally opens at http://127.0.0.1:8765/ . Select a pair in the new OANDA Practice bar on the Market workspace.
5. Click Fetch completed candles. This requests 500 M5 candles. Click Open saved prices to load the recorded series onto the chart. No background refresh or order execution occurs.
6. If you have no practice token, launch the original Start-Trader-Research.cmd and continue with synthetic/CSV research, journals and past cached market receipts.

Only use a **practice** credential. OANDA API tokens can have trading permissions at the provider despite the read-only restriction in this tool. Never enter a live-money token or paste a token into ChatGPT, GitHub, notes or your browser. The token lives in the local Python process environment, not the browser page, IndexedDB, SQLite or server responses. This is a temporary local-input mechanism, not an OS credential vault.

## Official API specifics

Only the following external API path is implemented:

  Host: https://api-fxpractice.oanda.com
  Method: GET
  Path: /v3/instruments/PAIR/candles
  Parameters: granularity=M5, price=MBA, count=500, smooth=false

M is midpoint, B bid and A ask. The server rejects unexpected instrument names, granularity and redirects. A maximum of 1000 completed M5 candles can be fetched per server request, though the UI asks for 500. Incomplete OANDA candles are discarded. Candles are UTC bar-START timestamps. HTTPS certificate verification uses Python defaults.

Official docs:
- https://developer.oanda.com/rest-live-v20/development-guide/
- https://developer.oanda.com/rest-live-v20/pricing-ep/
- https://developer.oanda.com/rest-live-v20/instrument-df/
- https://help.oanda.com/us/en/faqs/rest-v20-api-troubleshooting-guide.htm

OANDA explains that historical candle pricing may differ from account-specific streaming pricing. A midpoint chart does not show the exact bid/ask, funding, commissions or fills available to a real trade. Spread summaries are research observations, not a guaranteed executable quote.

## Storage and backup

The SQLite file defaults to:
- Windows: LOCALAPPDATA / TraderResearch / market_receipts.sqlite3
- Linux/macOS: home / .local / share / TraderResearch / market_receipts.sqlite3

The optional TRADER_MARKET_DB environment variable sets a custom local path for development. The three tables are receipts, bars and revisions. A first-seen bar is unique by source, symbol, timeframe and candle timestamp. Repeated unchanged candles are counted; conflicting corrected prices are stored separately and do not rewrite the first observation. Batches are transactional.

Local timestamps and hashes aid provenance checking but cannot prove an event was truly observed before future prices were available: the owner can modify SQLite, and the provider HTTP Date is not an exchange-signed event ledger.

**Important backup limitation:** the existing full dashboard JSON archive does not contain this new server-owned SQLite file. Close the launcher, then separately copy the database from the path above to preserve provider receipts. One-click SQLite backup is a future milestone.

## Local security

The localhost-only server supports these exact market routes:
- GET /api/market/status — source readiness, allowlisted pairs, local candle counts; never the token value.
- GET /api/market/candles?symbol=EUR_USD&limit=500 — stored, normalized price observations.
- POST /api/market/fetch — one explicit OANDA practice fetch with an anti-CSRF session token, same-origin check, strict instrument/count allowlist, and a single concurrent market fetch.

All other market and order routes are unavailable. No arbitrary URL proxy exists. No cloud model calls are made; optional local Ollama receives explicitly chosen chart evidence with the correct practice-only source label and never a trade token.

## TopstepX is not connected yet

Official Topstep guidance updated September 17, 2026 says TopstepX API is a separate paid ProjectX subscription and its key grants trading access to eligible accounts. Official prices listed in that article were $29/month standard and a 50% Topstep Trader discount; verify price before subscribing. Topstep says there is no sandbox, recommends Practice accounts for API testing, and restricts certain remote order-routing configurations.

We have not bought, connected or requested the ProjectX API. The key's trading permissions are too broad to casually embed in a prototype. Read-only market-data integration should follow explicit user approval and separate local credential isolation.

Official sources:
- https://help.topstep.com/en/articles/11187768-topstepx-api-access
- https://gateway.docs.projectx.com/docs/api-reference/market-data/retrieve-bars/

## Verification

- 46/46 JavaScript chart, research, journal, strategy, and OANDA mock-UI regression tests passed in the V8 development environment.
- Python unit tests were authored for provider normalization, receipt integrity, price revisions, scope restrictions, forged auth/CSRF requests and lack of order routes.
- The complete Python unittest suite, Node test command, React build, actual authenticated OANDA practice fetch, and Windows Edge/Chrome UI tests remain unexecuted on the user's PC. Leave this branch draft.

Developer commands:
    npm test
    python -m unittest discover -s local/tests -p "test_*.py"
    npm run build

## Next

1. Validate with a real practice token on a local Windows PC, including response schemas, daylight-saving and outage behavior.
2. Add one-click SQLite receipt backup and retention controls.
3. Define a separately versioned spread-aware FX strategy experiment engine.
4. Add authenticated timestamped prospective signal capture and read-only fill imports when properly authorized, keeping simulated versus real accounts distinct.
5. Add account-specific risk rules and truthful AI numerical verification before any consideration of execution.

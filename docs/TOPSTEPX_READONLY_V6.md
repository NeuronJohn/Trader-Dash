# TopstepX read-only workstation v0.6 (development)

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

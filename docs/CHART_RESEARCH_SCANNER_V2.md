# Trader-Dash v0.2 — Research-First Chart and Scanner

## Issues fixed from the three screenshots

- Chart candles and axis labels were difficult to read when zooming; mouse navigation and chart scaling were too limited.
- Only a few annotation tools existed, without straightforward selection, moving, hiding or deletion of an individual drawing.
- The AI panel was overloaded with configuration rather than showing useful research. The user was expected to write a trading thesis before investigating any candidate pattern.

## Implemented in the standalone HTML prototype

### Workspace
- Chart-first dark UI; mouse-wheel zoom anchored near the pointer, horizontal scrolling, chart pan by dragging and explicit pan/zoom buttons.
- Consistent candle body sizing at different zoom levels, less crowded time labels and no instructions overlapping the price/time axis.
- Selected historical candidate overlays show a boundary, structural invalidation and confirmation location.

### Drawings
- Separate Cursor, Range and Edit interaction modes.
- Multiple levels, lines, rectangles, arrows, brush strokes and note markers can coexist.
- Select a drawing by clicking it in Edit mode or using the list; move it by dragging, give it a label, hide/show it, remove it individually, or undo the latest drawing.
- Price/time coordinates retained across zoom changes. Unsnapshotted drawings persist per dataset in browser IndexedDB version 2.
- Temporary replay annotations are separated from full-history annotations. Rewinding past a replay drawing's creation hides it.

### Automatic historical setup discovery
- On load, the local scanner examines all available historical candles and highlights the latest matching pattern; Find setups searches again.
- Filter by break-and-retest continuation or failed-break reversal. Show objective checks, UTC timestamp, source, boundary, reference confirmation close and illustrative invalidation.
- Rule named rolling-17-bar-v1. It examines rolling price structure, not the session-based opening-range strategies in the strategy laboratory.
- No account connection or AI inference is required to use this local detector.
- Detected candidates are historical research examples, not executable signals, proof of positive expectancy or verified profit opportunities.
- Source label prominently distinguishes synthetic demo candles from user-imported, still-unverified CSV.
- Scanner honors historical reveal cutoff; no future bars or retrospective journal cases are submitted to a prepared replay research context.

### Research-first interaction
- Automatically found candidate appears in a compact chart overlay and research analyst panel.
- The user reads the detected conditions and missing evidence before optionally adding any personal note or snapshot.
- Advanced evidence toggles and context-packet export are collapsed, rather than dominating the panel.
- Readiness ledger distinguishes a rule match from authentic data, modeled transaction costs, tested strategy edge and broker/risk controls.

## Current implementation boundaries

This remains a standalone HTML UX and research prototype. The parent branch holds the existing React production target. There is no live market feed, cloud/local model inference, read-only broker statement import, order routing, verified backtester, or strategy profitability estimate. Historical reveal is chart practice, not a blind fill simulation. An imported CSV is not automatically authenticated or licensed.

## Build phases

### Phase 1 — UI and data integrity
Run real Edge/Chrome screenshot tests at 24, 35, 90 and 180 bars; check time-axis spacing, zoom-anchor behavior, selection, touch/pointer interactions, undo/delete/hide, browser IndexedDB reopen, and snapshot integrity. Implement lossless archive restore and exports that include standalone drawings. Port the approved layout into React rather than maintain a separate production HTML app.

### Phase 2 — Genuine multi-market searching
Implement a local Python scanner service with a strategy-rule registry, exchange/session-aware timestamps, instrument tick metadata, data-quality gates, bar-close event stream and per-market/timeframe watchlists. Allow automatic searches across authorized historical feeds and new closed candles without requiring an AI call for every bar. Keep all matches, including invalidated candidates, to prevent cherry-picking. Allow Quiet, Assist and Coach modes to control alert frequency.

### Phase 3 — True experiments
Build a no-lookahead execution simulator with fills, stops, fees, spread, slippage, economic events, contract rollover and Topstep loss rules. Preregister rule versions and report out-of-sample net expectancy, uncertainty, drawdowns and performance by regime. Reject patterns without robust validation. The scanner must not label a candidate statistically promising just because its chart looks good.

### Phase 4 — Grounded AI activation
Local and user-approved cloud models receive exact, scoped candle/annotation/journal context with source IDs and cutoff dates. Deterministic code calculates prices and P/L; an independent verifier checks all generated claims against the source. The analyst returns short sections: Observed, Possible interpretation, What could disprove it, What to test, and Missing evidence. Offer visual human research branches rather than forcing written entries.

### Phase 5 — Restricted accounts
Broker read-only adapters precede any trading. Keep personal FX and Topstep accounts independent. Order routing requires separately isolated local adapter, explicit account permissions, hard loss and size caps, stale-feed rejection, emergency controls and compliance with current provider API terms. Never give an LLM direct trading credentials.

## Acceptance evidence
- JavaScript syntax and static DOM element checks.
- Deterministic scanner tests against synthetic bars and poisoned future-bar replay scenarios.
- CSV validation regression tests.
- Simulated UI boot and chart interaction smoke tests.
- Human visual browser QA and full React build before merge.

The next concrete delivery should be multi-market data ingestion and true, replay-safe strategy experimentation, not paid AI opinions on synthetic charts.

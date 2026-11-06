# TRADER / LAB — Master Build Plan
Updated: November 2026
Repository: NeuronJohn/Trader-Dash
Working chain: foundation/ai-chart-analyst → foundation/workspace-html-v1

## Mission
Make an elegant, chart-first Windows trading research workspace that helps a trader formulate, test, and improve genuine trading systems, and personally understand their own decisions. Profitability is a hypothesis to demonstrate, never a promise. The AI analyst must be evidence-grounded and make the human more creative, capable, and accountable.

## Unbreakable product rules
- The chart dominates. AI lives in a contextual, hideable side panel. Every extra button has to earn its space.
- Research, replay, paper, Topstep evaluation, funded simulation, and real-money spot FX are separate account and performance modes. Do not merge them into one win-rate or equity curve.
- Every conclusion cites bar timestamps, source IDs, actual recorded trades, a strategy version, or a reproducible test. No invented edge percentages.
- User-created notes and annotations are first-class evidence. Preserve entry-time claims separately from post-trade hindsight.
- Models cannot alter verified fills, strategy test results, risk caps, or live orders. Approval gates apply to cloud model expense and to any future live trading; permitted read-only task chains may continue without repetitive approval.
- Live execution is an independent service. Research modules and models do not receive order-routing credentials.
- Costs, source quality, gaps, replay leakage, and unknowns must be explicit.
- A single React production interface. The one-file HTML is an offline, inspectable visual and interaction prototype, not a competing long-term codebase.

## Current status and what the prototype DOES NOT mean
Prior branch foundation/ai-chart-analyst contains the older React discipline dashboard, a first evidence analyst based on manual logs, and Chart Studio with CSV import and chart annotations.

This branch adds prototype/trader-workspace.html as a standalone dark-mode user interface. It has: responsive chart-first shell; synthetic candles; user CSV input; candle inspection; range selection; horizontal price levels; chart note markers; chart image capture to IndexedDB; searchable visual journal; exportable JSON backup; three candidate strategy descriptions; local deterministic observations; explicit AI context scoping and JSON packet preparation.

It DOES NOT contain a connected model, licensed live market data, broker fills, a proper historical trading simulator, verified strategies, P/L accounting, account connection, or an order gateway. The chart demo is synthetic; imported CSV prices are unverified. Visual candle reveal is not a blinded strategy experiment.

## The four experiences to deliver

### 1. Workspace
- Chart with keyboard and mouse gestures, multi-timeframe view, instrument/venue selector, watchlist, session/news levels, price/time drawing primitives, controlled annotations and layer visibility.
- Context selection: candle, range, screen rectangle, trade marker, strategy rule or handwritten annotation. The AI panel tells the user precisely what was selected.
- Plan a potential trade: entry thesis, invalidation, stop, target, planned risk, strategy version, and event/news context.
- One action to capture the complete viewport and original annotations; store the structured candle/time context alongside the screenshot.
- Auto-capture entry/exit/fill/stop changes after authorized broker read-only import is connected.
- User can annotate saved charts with post-event lessons, colored strokes, text, links, arrows and callouts without replacing the immutable initial capture.

### 2. Analyst
- Narrow, collapsible panel with Quiet, Assist, and Coach behaviors. Quiet answers only requests; Assist surfaces short useful suggestions after user actions; Coach proposes end-of-session reviews. Pause or hide at any point.
- Local deterministic observers handle price math, session windows, P/L, risk checks, cost models and indicators.
- Cheap optional local model helps tag notes, summarize, identify questions and search history.
- High-capability optional cloud model is reserved for difficult visual synthesis, user-coaching conversations and strategy hypotheses, after budget/approval gate.
- One consolidated AI response separates verified observations, provisional hypotheses, missing data, disconfirmation tests and user options. The user can correct, annotate, branch, or create a new experiment.
- No fake probabilities, “buy now” authority, fabricated similar historical setups, or assertions of profitability from synthetic data.
- An independent verifier checks all claimed levels, prices, outcomes, metrics, timestamps and journal references against actual recorded inputs.
- Cache analyses by market data fingerprint, chart scope, strategy version, prompt and model version. Keep a human-readable reasoning summary and audit trail, not inaccessible black-box claims.
- Evaluate the analyst itself: were its precommitted hypotheses useful out of sample? Did user adherence improve? Did AI prompts increase overtrading? Track misleading claims and corrections.

### 3. Strategy Lab
- Candidate strategy library. Each hypothesis receives a unique ID and immutable versioned rules before testing.
- Formal conditions: market, timezone/session, bar resolution, entry, exit, invalidation, sizing, filters, news rules, maximum trades, commissions, spreads, slippage and rollover.
- Data-quality audit and lookahead-free replay engine. Distinct historical backtest, chronological walk-forward, untouched holdout and prospective paper results.
- Detailed metrics: sample size, net expectancy and uncertainty, win/loss distribution, payoff ratio, profit factor, consecutive losses, realized drawdown, MAE/MFE, duration, sensitivity to execution costs, regime stability and Topstep-rule survival.
- Reject unstable, overfit, or negative-net-expectancy variants. Preserve experiments that failed so the same bad idea is not repeatedly recycled.
- Auto-proposed variants are always labeled hypotheses; the user controls whether a research branch is created.
- Good baseline comparison must include simple naive/placebo entry rules and skipping unverified conditions, not only “the best optimized parameters.”

### 4. Visual Journal
- Objects: Session, Trade, Idea, Snapshot, Annotation, StrategyVersion, Experiment, Review, AIObservation.
- Keep related records in one navigable knowledge base; full-text search, tags, backlinks, chronological timeline and compare-before/after tools.
- Original snapshots and strategy versions immutable. New annotations and user edits versioned. Store source and UTC time.
- One-click screenshots, voice note transcription (optional), tag suggestions (optional), user-written freeform notes without strict field limitations.
- Auto-pull linked broker fills as read-only data from separate adapters; distinguish verified fills and self-reported notes.
- Consolidated analytics can be filtered by account, strategy version, session, market, setup, adherence and time; no mixing simulation/live metrics.

## AI context contract
Every model request includes:
  source: dataset ID, provider/venue, contract or FX pair, data license/freshness, UTC session/timestamp and quality flags
  scope: exact selected bars and price/time axes, current visual annotations, event cutoff
  observations: deterministic metrics with calculation methods
  journal: bounded user-approved similar cases with actual source IDs, account modes and outcomes
  question: exact user prompt, plus currently chosen Assist/Coach/Quiet mode
  permissions: research-only by default; explicit context inclusion toggles
  budget: approved provider/model, estimated cloud cost, user approval grant if relevant
  missing: unknown spread, unavailable fills, stale bars, absent context, replay leakage warnings
  guardrails: no future candles past replay cutoff and no model access to real-money order credentials

Expected machine-readable response:
  observations with source references
  hypotheses and alternatives
  uncertainty and data limitations
  practical user options and creativity branches
  proposed experiment rule draft with rejection criteria
  summary of what the analyst actually did
A verifier rejects any unsupported price or fill statement. Display missing evidence instead of inventing certainty.

## AI lifecycle
IDLE → CONTEXT_READY → APPROVAL_REQUIRED (when paid) → ANALYZING → VERIFYING → PRESENTING → JOURNALED.
At all stages: PAUSE, CANCEL, RETRY, REVISE, BRANCH. When safe and already approved, continue automatically across substeps. AI should not nag after every automatic tool operation.
Proactive triggers: chart selection, annotation, session close, imported fill, risk-limit proximity, completed experiment. User can disable each trigger, and the user can always choose the final decision.

## Technical architecture
- Client: existing React + TypeScript/Vite production app. Reuse approved HTML prototype styles and interaction contracts in components; do not preserve two production client implementations.
- Chart: TradingView Lightweight Charts version 5.2+ with anchored series primitives for vector drawings; separate canvas markup layer for pixel-based freehand snapshot strokes.
- Local Windows service: Python FastAPI. Price/contract/fee arithmetic is deterministic code, never LLM output. SQLite for metadata with migrations, Parquet for historical OHLC and ticks, DuckDB for query/research, local image folder/object store for snapshots.
- Backend endpoints (draft): GET /datasets, POST /datasets/import, GET /bars, GET /sessions, GET /trades, POST /snapshots, POST /notes, POST /analyst/context, POST /analyst/analyze, POST /strategies, POST /experiments/run, GET /experiments/{id}.
- Keep backend for research and journal separate from any eventual execution process. No broker API secrets in browser localStorage or AI prompts. Windows secure credential storage for locally held broker tokens, encrypted archive exports, offline recovery tests.
- All events have source IDs, timestamps, immutable audit fields and idempotency keys. Market history includes timezone, DST, session gaps, tick size, contract point value, data revision and instrument roll rules.
- Data providers: start with verified CSV exports. Then approved read-only TopstepX/ProjectX for eligible futures accounts, and candidate OANDA v20 REST for spot FX pricing/fills. Provider permissions and costs need renewed verification before activating any account.
- Future execution: separate manually enabled account adapter with independent size ceilings, daily loss, max positions, stale-feed policy, reconciliation, human confirmation options and emergency halt. Browser-only safety toggles cannot guarantee an exchange stop.

## Starting strategy hypothesis slate
1. Opening-range break followed by a first structurally defined pullback with higher-timeframe trend. Test on MES and MNQ separately by news and volatility regime.
2. Failed initial-session breakout and prompt return into the opening range, retest/invalidated excursion. Test separately from strategy #1 rather than opportunistically swapping rules.
3. EUR/USD contraction-to-expansion during liquid sessions with bid/ask spread and time-dependent costs. Test complete records across daylight-saving changes and different volatility regimes.
None is a proven edge. Freeze rules and rejection criteria *before* looking at untouched holdout outcomes.

## Milestones and acceptance gates
M0 — HTML foundation. Opens offline, good layout, honest demo labeling, range selection, notes, snapshots and export. One-file prototype exists; browser smoke and UX QA remain.
M1 — React shell conversion. Chart first; preserve old journal data and functions; migrate to shared storage, restore from backup, shortcut/accessibility/browser tests, no GitHub Actions fees required.
M2 — Read-only data spine. Reconcile genuine market prices and broker fills with correct sessions, account modes, contract metadata, spreads and fees; objective and subjective records remain separate.
M3 — Reproducible simulation. Deterministic no-lookahead replay with stops, partial fills, gaps, slippage, fees, economic calendar blackouts; blind chronological validation and reproducible reports.
M4 — AI activation. Local/optional cloud model connected to controlled context packet, image and note retrieval, citation verifier, approvals, cost controls, memory review and proactive quiet/assist/coach modes.
M5 — Forward-paper qualification. Many untouched scenarios, positive fee-adjusted results with uncertainty intervals, acceptable drawdowns and actual user process adherence. No automatic fund deployment.
M6 — Restricted real-money integration. Provider review, independent hard risk limits, credentials isolated, emergency controls tested and explicit user opt-in. Never present an evaluation subscription as a shortcut to earnings.

## Immediate engineering checklist
1. Run HTML prototype in Windows Edge/Chrome; test chart resize, source switch, CSV parsing, note/level markers, capture, journal, JSON backup, AI context copy, and storage failure.
2. Refactor existing oversized React shell into new dashboard navigation, without losing v13 localStorage history.
3. Centralize shared domain models and create a reversible migration from HTML prototype and old journal.
4. Add backup restore, reliable write queues, quota warnings and browser tests.
5. Build authorized historical data import + read-only fill ledger and actual cost models.
6. Build replay and strategy lab before spending on a model or prop-firm evaluation.
7. Connect and evaluate grounded AI only once we have evidence worth analyzing.

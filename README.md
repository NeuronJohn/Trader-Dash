# Trader-Dash — Chart Studio + Evidence Analyst

**Development branch:** `foundation/ai-chart-analyst` (draft, unmerged). A clean, browser-local frontend for recording and reviewing decisions, now with a functional chart workstation.

## Try locally

Requires Node and npm. No paid API account is required for this stage.

```bash
npm ci
npm test
npm run build
npm run dev
```

Open the development URL shown by Vite. The **Charts** tab is the default workspace; **Analyst** shows evidence-based statistics from manual trade records. Legacy Prep/Journal/Review/Calendar/Playbook/Tools remain available.

### Work with candles

Charts defaults to **DEMO / SYNTHETIC** candles. These are **not historical market prices** and must never be used to claim strategy profitability. To use genuine data, click **Import OHLC CSV** and select a file from your authorized market-data provider.

Accepted header and example:

```csv
time,open,high,low,close,volume
2026-10-01T13:30:00Z,100,101,99,100.5,120
2026-10-01T13:35:00Z,100.5,102,100,101,85
2026-10-01T13:40:00Z,101,103,100,102,140
2026-10-01T13:45:00Z,102,104,101,103,90
2026-10-01T13:50:00Z,103,103.5,101,101.5,95
```

- Required columns: `time` (or `timestamp`, `datetime`, `dateutc`), `open`, `high`, `low`, `close`. `volume` is optional.
- Timestamps must use ISO 8601 with explicit UTC `Z` or offset (e.g. `2026-10-01T08:30:00-05:00`), or Unix seconds/milliseconds. Timezone-naive timestamps are rejected.
- CSV checks finite, positive OHLC values; high/low consistency; duplicate timestamps; size limit; and creates a SHA-256 source fingerprint.
- Imported datasets remain in **this browser's IndexedDB** and are isolated from the demo and other datasets.
- Market-data licensing, session adjustment, corporate actions (if any), provider quality and symbol matching still require independent verification.

### Annotate, capture and review

1. Choose **Inspect**, **Price level**, **Trendline** (two clicks), **Draw** (click-drag), or **Note pin**.
2. Select a specific chart drawing to edit its text or remove it.
3. Optionally link a manual trade from the legacy journal; enter a note; choose **Capture snapshot**.
4. Pick the saved snapshot from the right library, add detailed review notes, or write a pin label and click **Place note pin**, then click the image.
5. Export an **annotated PNG**, a snapshot JSON record, or use **Backup archive** for an export of the chart-store records.

A snapshot preserves the **original SVG chart**, source label, original context, visible OHLC bars, drawing definitions and creation timestamp. Later note pins and review text are stored alongside that immutable original. No broker or exchange controls are attached to this studio.

### Visual replay

Check **Historical reveal** to constrain the displayed candles to the chosen past position, then step forward by one or ten candles. This is chart-only reveal practice; it is **not** a fill simulator or validated backtester. Other previously saved snapshots can still exist outside the replay window, so do not claim this is a controlled blind experiment.

### Storage and privacy

- The existing v13 journal remains in browser `localStorage` at its original key; this branch does not remove or migrate that history.
- Candles, drawings and snapshots live in browser `IndexedDB` named `trader-dash-chart-studio`.
- Browser profile changes, storage clearing or private browsing can delete your data. Export backups frequently. There is no archive import UI yet: the JSON exports are for preservation and future migration.
- There is currently no encrypted backup, synchronization, live brokerage connection, candle feed, OpenAI/Ollama inference, paid model use, or automatic trade capture. The **Analyst** tab is deterministic analysis, not connected AI.

## Next engineering milestone

Build a local FastAPI bridge for authorized market-data sources, safe read-only order/fill imports, reproducible historical replay and an optional AI analyst with timestamp-grounded context. Then add a separate strategy lab that validates fixed versions across out-of-sample historical data, costs, slippage, and Topstep risk rules. No real-money order execution before kill-switch and risk guard testing.

See `docs/AI_ANALYST_PRODUCT_SPEC.md` for the full product contract.

# Trader / Lab — HTML Workspace Foundation

This directory contains a single-file, self-contained browser prototype of the new professional Trader-Dash research workspace.

## Run
1. Open the GitHub file prototype/trader-workspace.html on this branch.
2. Select Raw, then save the page as trader-workspace.html (do not save GitHub's wrapper page).
3. Double-click the saved HTML file on your Windows machine using current Edge or Chrome. No npm, server, API key or account required.
4. Explore Workspace, Strategy lab and Visual journal.

You can also run a local static server from the repository: python -m http.server 8080, then open http://localhost:8080/prototype/trader-workspace.html.

## Demo workflow
- Chart initially shows SYNTHETIC candles. You can hover, select a time window, add a horizontal level, attach a note marker, and zoom.
- Write a setup and thesis, then Capture snapshot. Captures include the original chart PNG, visible bar/time context, input source, annotation layer and notes.
- Open Visual journal to search/edit review text and download PNG. The original thesis remains separate from review text.
- Open the AI Research Analyst panel. Pick data scopes, click a suggested question, and Prepare context. A JSON packet is produced locally; it is not a model response. Copy the full packet for later integration.
- Open Strategy lab to load a clearly labeled untested hypothesis and prepare its research scope.
- Export journal to JSON to keep backups. There is not an archive import feature in this standalone v0.1 file.

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
- Uses browser IndexedDB for snapshots and imported datasets and localStorage for an active dataset preference. Saved notes are local to your browser profile/origin, not cloud synced.
- File:// browser storage can be browser-specific. Export regularly; prefer localhost static server for a consistent origin if testing across repeated sessions.
- Chart historical reveal is not a blind strategy test or broker fill simulator. Replay mode excludes previously made full-history annotations and journal cases from its prepared AI context, but it does not substitute for a controlled experiment.
- No external scripts, hosted calls, login, broker order routing, paid AI inference, or real-time quotes.
- This HTML is a UX contract. The existing React application is the production target after visual verification and migration.

## Next
Review docs/TRADER_LAB_MASTER_PLAN.md and port selected shell/interaction modules into the React app. Add browser smoke tests, import/restore, licensed data provenance, read-only broker fills and a true no-lookahead replay simulator before enabling model-based analysis or account execution.

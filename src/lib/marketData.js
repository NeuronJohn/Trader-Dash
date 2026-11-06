// All chart data is explicitly labeled by source. Never treat synthetic candles as market history.
const DEMO_ID = "synthetic-only-v1";
export function buildDemoSeries() {
  let seed = 45127;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const candles = [];
  let price = 5790;
  const start = Date.parse("2026-10-01T13:30:00Z");
  for (let i = 0; i < 320; i++) {
    const trend = i < 90 ? 0.42 : i < 155 ? -0.62 : i < 250 ? 0.7 : -0.13;
    const open = price;
    const close = Math.max(1, open + trend + Math.sin(i * .37) * 1.2 + (rand() - .5) * 8.2);
    const high = Math.max(open, close) + rand() * 3.1;
    const low = Math.min(open, close) - rand() * 3.1;
    candles.push({ time: start + i * 300000, open, high, low, close, volume: Math.round(100 + rand() * 320) });
    price = close;
  }
  return { id: DEMO_ID, label: "DEMO / SYNTHETIC", kind: "synthetic", symbol: "DEMO", timeframe: "5m", candles };
}

function splitCsvLine(line, delimiter) {
  const columns = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      columns.push(cell.trim()); cell = "";
    } else cell += ch;
  }
  columns.push(cell.trim());
  if (quoted) throw new Error("Unclosed CSV quoted field");
  return columns;
}

function parseTimestamp(value, row) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Row " + row + ": missing timestamp");
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  if (/^\d{13}$/.test(text)) return Number(text);
  // Accept strict timezone-qualified ISO strings only, to avoid incorrectly guessing exchange timezones.
  if (!/^\d{4}-\d{2}-\d{2}T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(text))
    throw new Error("Row " + row + ": timestamp must be ISO-8601 with Z/offset, or Unix seconds/ms");
  const n = Date.parse(text);
  if (!Number.isFinite(n)) throw new Error("Row " + row + ": invalid timestamp");
  return n;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
}

export async function importMarketCsv(text, symbol = "Imported") {
  if (typeof text !== "string" || text.length > 8000000) throw new Error("CSV must be text and no larger than 8 MB");
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(row => row.trim());
  if (rows.length < 6) throw new Error("Need at least five market candles and a header row");
  if (rows.length > 60000) throw new Error("Maximum 60,000 candles per import");
  const delimiter = rows[0].includes("\t") ? "\t" : ",";
  const headers = splitCsvLine(rows[0], delimiter).map(x => x.trim().toLowerCase().replace(/[\s_-]/g, ""));
  const col = (...names) => headers.findIndex(h => names.includes(h));
  const fields = {
    time: col("time","timestamp","datetime","dateutc"),
    open: col("open","o"),
    high: col("high","h"),
    low: col("low","l"),
    close: col("close","c"),
    volume: col("volume","vol","v"),
  };
  for (const key of ["time","open","high","low","close"]) {
    if (fields[key] < 0) throw new Error("Missing required column: " + key);
  }
  const candles = [];
  for (let row = 1; row < rows.length; row++) {
    const values = splitCsvLine(rows[row], delimiter);
    const bar = { time: parseTimestamp(values[fields.time], row + 1) };
    for (const key of ["open","high","low","close"]) {
      const raw = values[fields[key]];
      if (raw == null || raw.trim() === "") throw new Error("Row " + (row + 1) + ": missing " + key);
      bar[key] = Number(raw);
      if (!Number.isFinite(bar[key]) || bar[key] <= 0) throw new Error("Row " + (row + 1) + ": invalid " + key);
    }
    const eps = Math.max(1e-8, bar.high * 1e-10);
    if (bar.high + eps < Math.max(bar.open, bar.close, bar.low) || bar.low - eps > Math.min(bar.open, bar.close, bar.high))
      throw new Error("Row " + (row + 1) + ": inconsistent OHLC bounds");
    if (fields.volume >= 0) {
      bar.volume = values[fields.volume] === "" ? null : Number(values[fields.volume]);
      if (bar.volume != null && (!Number.isFinite(bar.volume) || bar.volume < 0))
        throw new Error("Row " + (row + 1) + ": invalid volume");
    }
    candles.push(bar);
  }
  candles.sort((a,b) => a.time-b.time);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time === candles[i-1].time) throw new Error("Duplicate timestamp: " + new Date(candles[i].time).toISOString());
  }
  const displaySymbol = String(symbol).slice(0,40) || "Imported";
  // Include the instrument label so identical numeric series for different symbols cannot share drawings.
  const id = "csv-sha256-" + await sha256(displaySymbol + "\n" + text);
  return { id, label: "IMPORTED CSV / VERIFY SOURCE", kind: "csv", symbol: displaySymbol, timeframe: "Source timestamps", candles };
}

export function utcLabel(ms) {
  return new Date(ms).toISOString().slice(5,16).replace("T"," ");
}

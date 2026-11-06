import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoSeries, importMarketCsv } from "../src/lib/marketData.js";
import { summarizeTrades, buildEvidenceFlags } from "../src/lib/analytics.js";

const header="time,open,high,low,close,volume";
const rows=[
  "2026-10-01T13:30:00Z,100,101,99,100.5,21",
  "2026-10-01T13:35:00Z,100.5,103,100,102.5,22",
  "2026-10-01T13:40:00Z,102.5,104,102,103,29",
  "2026-10-01T13:45:00Z,103,103.2,100,101,30",
  "2026-10-01T13:50:00Z,101,102,100,101.5,25",
];
test("demo candles deterministic and labeled synthetic",()=>{
  const a=buildDemoSeries(),b=buildDemoSeries();
  assert.equal(a.kind,"synthetic");assert.equal(a.candles.length,320);
  assert.deepEqual(a.candles,b.candles);
});
test("CSV accepts exact UTC OHLC and source fingerprint",async()=>{
  const text=[header,...rows].join("\n");
  const result=await importMarketCsv(text,"MES");
  assert.equal(result.kind,"csv");assert.equal(result.symbol,"MES");
  assert.equal(result.candles.length,5);
  assert.ok(result.id.startsWith("csv-sha256-"));
  assert.ok(result.candles[0].time===Date.parse("2026-10-01T13:30:00Z"));
  assert.equal((await importMarketCsv(text,"MES")).id,result.id);
});
test("CSV rejects duplicates, invalid OHLC and timezone-free timestamps",async()=>{
  await assert.rejects(importMarketCsv([header,rows[0],rows[0],...rows.slice(2)].join("\n")),/Duplicate timestamp/);
  await assert.rejects(importMarketCsv([header,"2026-10-01T13:30:00Z,100,99,100,101,5",...rows.slice(1)].join("\n")),/inconsistent OHLC/);
  await assert.rejects(importMarketCsv([header,rows[0].replace("Z",""),...rows.slice(1)].join("\n")),/timestamp must be ISO/);
});
test("unreported trade result excluded from stats; zero is valid",()=>{
  const stats=summarizeTrades([
    {id:"1",date:"2026-10-01",resultR:"2",followedRules:true},
    {id:"2",date:"2026-10-02",resultR:"-1",followedRules:false},
    {id:"3",date:"2026-10-03",resultR:"",followedRules:true},
    {id:"4",date:"2026-10-04",resultR:"0",followedRules:true},
  ]);
  assert.equal(stats.count,3);assert.equal(stats.missingResults,1);
  assert.equal(stats.totalR,1);assert.equal(stats.wins,1);
  assert.equal(stats.losses,1);assert.equal(stats.flat,1);
  assert.equal(stats.longestLossStreak,1);
  assert.equal(stats.expectancyR,1/3);
  assert.ok(buildEvidenceFlags([]).some(f=>f.kind==="data"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "prototype", "trader-workspace.html"), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, "HTML must contain its standalone application script");

const section = (a,b) => {
  const start=source.indexOf(a),end=source.indexOf(b,start);
  assert.ok(start>=0 && end>start,"Missing source section "+a);
  return source.slice(start,end);
};
const logic = new Function(
  "const safeStr=v=>String(v==null?'':v);\n"+
  section("  function demo(){","  function splitCSV")+
  section("  function splitCSV","  function openDB")+
  section("  // Candidate detector:","  function scanHistory()")+
  "\nreturn {demo,readCSV,searchPatterns};"
)();
const {demo,readCSV,searchPatterns}=logic;

test("standalone script syntax and DOM bindings",()=>{
  assert.doesNotThrow(()=>new Function(source));
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
  const refs=[...source.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length,"DOM IDs must be unique");
  for(const name of refs)assert.ok(ids.includes(name),"Missing DOM node "+name);
});
test("all drawing tools are reachable in the toolbar",()=>{
  for(const name of ["inspect","select","edit","level","line","rectangle","arrow","brush","note"])
    assert.ok(html.includes('data-tool="'+name+'"'),name+" tool missing");
});
test("synthetic candles deterministic and explicitly nonmarket",()=>{
  const a=demo(),b=demo();
  assert.equal(a.source,"synthetic");
  assert.equal(a.bars.length,360);
  assert.deepEqual(a,b);
});
test("scanner deterministic; confirmation never uses future bars",()=>{
  const bars=demo().bars;
  const first=searchPatterns(bars,bars.length-1);
  assert.deepEqual(first,searchPatterns(bars,bars.length-1));
  assert.ok(first.length>0,"Synthetic test fixture should exercise the candidate cards");
  for(const hit of first) {
    assert.ok(hit.index>=23&&hit.index<bars.length);
    assert.equal(hit.at,bars[hit.index].time);
    assert.ok(hit.confirmationIndex===hit.index);
    assert.ok(hit.breakIndex<hit.retestIndex&&hit.retestIndex<hit.confirmationIndex);
    assert.ok(hit.invalidation>0);
    assert.ok(hit.checks?.length>=3);
    assert.ok(["breakout","failure"].includes(hit.type));
  }
});
test("replay candidate cutoff never sees or requires future bars",()=>{
  const bars=demo().bars,cutoff=79;
  const baseline=searchPatterns(bars,cutoff);
  const poisoned=bars.map((bar,i)=>i<=cutoff?bar:{...bar,open:1e9,close:1e9,high:1e9,low:1e9});
  assert.deepEqual(searchPatterns(poisoned,cutoff),baseline);
  assert.ok(baseline.every(hit=>hit.index<=cutoff));
  assert.ok(baseline.length>0);
});
test("strict CSV import rejects corruption and accepts valid UTC",()=>{
  const header="time,open,high,low,close";
  const rows=[
    "2026-10-01T13:30:00Z,100,101,99,100.5",
    "2026-10-01T13:35:00Z,100.5,103,100,102.5",
    "2026-10-01T13:40:00Z,102.5,104,102,103",
    "2026-10-01T13:45:00Z,103,103.2,100,101",
    "2026-10-01T13:50:00Z,101,102,100,101.5"
  ];
  const csv=v=>[header,...v].join("\n");
  assert.equal(readCSV(csv(rows),"MES.csv").bars.length,5);
  assert.throws(()=>readCSV(csv([rows[0],rows[0],...rows.slice(2)]),"MES.csv"),/Duplicate timestamp/);
  assert.throws(()=>readCSV(csv([rows[0].replace("Z",""),...rows.slice(1)]),"MES.csv"),/timestamp needs timezone/);
  assert.throws(()=>readCSV(csv(["2026-10-01T13:30:00Z,100,99,100,101",...rows.slice(1)]),"MES.csv"),/Inconsistent OHLC/);
});

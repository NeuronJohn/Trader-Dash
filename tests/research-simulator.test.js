import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const html=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../prototype/trader-workspace.html"),"utf8");
const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source);
function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,start+" section present");
  return source.slice(a,b);
}
const datasetJS=section("  function demo(){","  function splitCSV");
const detectJS=section("  // Candidate detector:","  // Deterministic first-pass");
const engineJS=section("  // Deterministic first-pass","  function scanHistory(");
const {demo,searchPatterns,simulateHistoricalResearch}=new Function(
  "const S={};const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));\n"+
  datasetJS+detectJS+engineJS+"\nreturn {demo,searchPatterns,simulateHistoricalResearch};"
)();
function options(overrides={}){
  return {tickSize:.25,slippageTicks:1,roundTripFeeTicks:1,rewardR:2,maxHold:12,type:"all",...overrides};
}
function casesWithSyntheticSignal(entryBar){
  const bars=Array.from({length:90},(_,i)=>({
    time:Date.parse("2026-10-05T13:30:00Z")+i*300000,
    open:100,high:101,low:99,close:100,
  }));
  if(entryBar)bars[29]={...bars[29],...entryBar};
  const signal={
    id:"synthetic-signal-28",index:28,at:bars[28].time,
    side:"LONG",type:"breakout",version:"fixture",
    confirmationIndex:28,entryIndex:29,invalidation:98
  };
  return {bars,signal};
}
test("synthetic engine is deterministic and expresses research only",()=>{
  const b=demo().bars;
  const x=simulateHistoricalResearch(b,options());
  assert.deepEqual(x,simulateHistoricalResearch(b,options()));
  assert.equal(x.status,"RESEARCH_ONLY_NOT_VERIFIED");
  assert.equal(x.rawSignalCount,searchPatterns(b,b.length-1).length);
  assert.ok(x.full.trades>0);
  assert.ok(x.trades.every(t=>t.entryIndex===t.signalIndex+1));
  assert.ok(x.trades.every(t=>Number.isFinite(t.netR)));
  assert.ok(!("netDollars" in x.full));
});
test("conservative stop-first ordering for ambiguous OHLC bar",()=>{
  const {bars,signal}=casesWithSyntheticSignal({open:100,high:106,low:96,close:103});
  const sim=new Function("searchPatterns",engineJS+"\nreturn simulateHistoricalResearch;")(
    ()=>[signal]);
  const r=sim(bars,options({slippageTicks:0,roundTripFeeTicks:0}));
  assert.equal(r.trades.length,1);
  assert.equal(r.trades[0].entry,100);
  assert.equal(r.trades[0].exit,98);
  assert.equal(r.trades[0].exitReason,"stop");
  assert.equal(r.trades[0].netR,-1);
});
test("adverse stop gap exits at real open rather than imaginary stop fill",()=>{
  const {bars,signal}=casesWithSyntheticSignal({open:95,high:100,low:94,close:99});
  const sim=new Function("searchPatterns",engineJS+"\nreturn simulateHistoricalResearch;")(
    ()=>[signal]);
  // A long entry is at the next open; for a stop gap later in the holding
  // period we place the gap at the second post-signal bar.
  bars[29]={...bars[29],open:100,high:101,low:99,close:100};
  bars[30]={...bars[30],open:95,high:100,low:94,close:99};
  const r=sim(bars,options({slippageTicks:0,roundTripFeeTicks:0}));
  assert.equal(r.trades[0].exitReason,"stop_gap");
  assert.equal(r.trades[0].exit,95);
  assert.equal(r.trades[0].netR,-2.5);
});
test("higher explicit costs cannot improve identical outcome",()=>{
  const {bars,signal}=casesWithSyntheticSignal();
  const sim=new Function("searchPatterns",engineJS+"\nreturn simulateHistoricalResearch;")(
    ()=>[signal]);
  const zero=sim(bars,options({slippageTicks:0,roundTripFeeTicks:0}));
  const more=sim(bars,options({slippageTicks:1,roundTripFeeTicks:2}));
  assert.ok(more.trades[0].netR<zero.trades[0].netR);
});
test("chronological split purges episodes crossing the boundary",()=>{
  const r=simulateHistoricalResearch(demo().bars,options());
  const split=r.splitIndex,embargo=r.embargo;
  const training=r.trades.filter(t=>t.exitIndex<split-embargo);
  const reserved=r.trades.filter(t=>t.signalIndex>=split+embargo);
  assert.equal(r.train.trades,training.length);
  assert.equal(r.holdout.trades,reserved.length);
  assert.equal(r.omittedBoundaryEpisodes,r.trades.length-training.length-reserved.length);
});
test("invalid prices and missing tick-size gate the simulator",()=>{
  const b=demo().bars;
  assert.throws(()=>simulateHistoricalResearch(b,{...options(),tickSize:0}),/tick size/);
  assert.throws(()=>simulateHistoricalResearch(b,{...options(),maxHold:0}),/Holding period/);
  const damaged=b.map(x=>({...x}));damaged[15].high=damaged[15].low-1;
  assert.throws(()=>simulateHistoricalResearch(damaged,options()),/Invalid OHLC/);
});

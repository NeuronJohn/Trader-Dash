import test from "node:test";
import assert from "node:assert/strict";
import "../prototype/session-engine.js";

const E=globalThis.TraderSessionEngine;
assert.ok(E && E.version==="MES-SESSION-v1");

function fixture(day="2026-07-06",winter=false,kind="ORP"){
  const start=Date.parse(day+"T"+(winter?"14:30":"13:30")+":00Z");
  const bar=(i,o=6000,h=6000.25,l=5999.75,c=6000)=>({
    time:start+i*300000,open:o,high:h,low:l,close:c
  });
  const bars=Array.from({length:30},(_,i)=>bar(i));
  bars[0]=bar(0,6000,6010,5990,6000);
  bars[1]=bar(1,6000,6009,5991,6000);
  bars[2]=bar(2,6000,6009,5991,6000);
  if(kind==="ORP"){
    bars[3]=bar(3,6009,6012,6008,6011);
    bars[4]=bar(4,6011,6012,6010,6011);
    bars[5]=bar(5,6011,6013.5,6010.5,6013);
    bars[6]=bar(6,6013,6014,6012,6013.5);
    bars[7]=bar(7,6014,6022,6013,6021);
  }else{
    bars[3]=bar(3,6010,6011,6009.5,6010.5);
    bars[4]=bar(4,6010.5,6010.5,6008.25,6009.5);
    bars[5]=bar(5,6009.5,6009.5,6007,6008);
    bars[6]=bar(6,6008,6009,6007,6008);
    bars[7]=bar(7,6008,6008,5998,5999);
  }
  for(let i=8;i<30;i++){
    bars[i]=kind==="ORP"?bar(i,6020,6021,6019,6020):bar(i,5999,6000,5998,5999);
  }
  return bars;
}
const opts=(rule="ORP-001",o={})=>({rule,roundTripFeeUsd:2.5,slippageTicks:1,targetR:2,source:"synthetic",...o});
const run=(b,o)=>E.run(b,o);

test("handles fixed Chicago opening-range session across 2026 DST transition",()=>{
  const winter=fixture("2026-03-06",true);
  const summer=fixture("2026-03-09",false);
  assert.equal(E.sessionsFromBars(winter).valid.length,1);
  assert.equal(E.sessionsFromBars(summer).valid.length,1);
  const a=run([...winter,...summer],opts());
  assert.equal(a.completeSessions,2);
  assert.deepEqual(a.allTrades.map(t=>t.day),["2026-03-06","2026-03-09"]);
});
test("ORP first pullback confirmation creates only next-bar entry",()=>{
  const bars=fixture(),report=run(bars,opts());
  assert.equal(report.allTrades.length,1);
  const t=report.allTrades[0];
  assert.equal(t.rule,"ORP-001");
  assert.equal(t.signalTime,bars[5].time);
  assert.equal(t.entryTime,bars[6].time);
  assert.equal(t.stop,6009.75);
  assert.equal(t.exitReason,"TARGET");
  assert.equal(t.entry,6013.25);
  assert.equal(t.target,6020.25);
  assert.ok(t.netR>1.5&&t.netR<2);
  assert.equal(report.qualification.startsWith("None"),true);
});
test("FBR uses first opening-range excursion and fixed midpoint target",()=>{
  const bars=fixture("2026-07-07",false,"FBR");
  const t=run(bars,opts("FBR-001")).allTrades[0];
  assert.equal(t.side,"SHORT");
  assert.equal(t.signalTime,bars[5].time);
  assert.equal(t.entryTime,bars[6].time);
  assert.equal(t.stop,6011.5);
  assert.equal(t.target,6000);
  assert.equal(t.exitReason,"TARGET");
});
test("stop always precedes target in OHLC bars with ambiguous intrabar ordering",()=>{
  const bars=fixture();
  bars[6]={...bars[6],high:6022,low:6009};
  const t=run(bars,opts()).allTrades[0];
  assert.equal(t.exitReason,"STOP");
  assert.equal(t.exitIndex,6);
  assert.ok(t.netR<0);
});
test("stop gaps use unfavorable actual opening instead of ideal stop",()=>{
  const bars=fixture();
  bars[7]={...bars[7],open:6007,high:6009,low:6006,close:6008};
  const t=run(bars,opts()).allTrades[0];
  assert.equal(t.exitReason,"STOP_GAP");
  assert.equal(t.exit,6006.75);
  assert.ok(t.netR< -1);
});
test("increasing costs lowers net outcome, holding candles and rule fixed",()=>{
  const bars=fixture();
  const free=run(bars,opts("ORP-001",{roundTripFeeUsd:0,slippageTicks:0})).allTrades[0];
  const paid=run(bars,opts("ORP-001",{roundTripFeeUsd:7.5,slippageTicks:1})).allTrades[0];
  assert.ok(paid.netUsd<free.netUsd);
  assert.ok(paid.netR<free.netR);
});
test("incomplete sessions excluded; off-tick prices rejected",()=>{
  const a=fixture(),b=fixture("2026-07-07");
  const partial=[...a,...b.filter((_,i)=>i!==8)];
  const report=run(partial,opts());
  assert.equal(report.completeSessions,1);
  assert.equal(report.rejectedSessions.length,1);
  const bad=fixture();bad[6]={...bad[6],open:6013.1};
  assert.throws(()=>run(bad,opts()),/0.25-point ticks/);
});
test("same-candle sweep of both range extremes is inconclusive",()=>{
  const bars=fixture("2026-07-07",false,"FBR");
  bars[3]={...bars[3],high:6011,low:5989.25};
  const result=run(bars,opts("FBR-001"));
  assert.equal(result.allTrades.length,0);
  assert.match(result.noSignal[0].reason,/Both opening-range extremes/);
});
test("chronological split uses complete days with transition embargo",()=>{
  const days=[];
  for(let n=1;n<=24;n++){
    const date="2026-07-"+String(n).padStart(2,"0");
    const wd=new Date(date+"T12:00:00Z").getUTCDay();
    if(wd>0 && wd<6)days.push(date);
  }
  const bars=days.flatMap(day=>fixture(day));
  const result=run(bars,opts());
  assert.equal(result.completeSessions,days.length);
  assert.ok(result.split.trainDays>0&&result.split.reserveDays>0);
  assert.equal(result.split.trainDays+result.split.reserveDays+result.split.excludedTransitionDays,days.length);
  assert.ok(result.train.count>0);
  assert.ok(result.reserve.count>0);
  assert.equal(result.split.reserveHasAdequateSample,false);
});
test("does not manufacture sessions from unlabeled or corrupt input",()=>{
  const b=fixture();
  assert.throws(()=>run(b.slice(0,28),opts()),/at least 30/);
  assert.throws(()=>run(b.map((x,i)=>i===8?{...x,time:x.time+1}:x),opts()),/Invalid or unsorted/);
  assert.throws(()=>run(b,opts("WRONG")),/Unknown strategy/);
});

test("signal scanner reveals only completed historical confirmation, not future outcome",()=>{
  const bars=fixture();
  const cutoff=bars[5].time+300000;
  const partial=E.scanSignals(bars.slice(0,6),{rule:"ORP-001",asOfUtc:cutoff});
  assert.equal(partial.matches.length,1);
  const signal=partial.matches[0];
  assert.equal(signal.signalTime,cutoff);
  assert.equal(signal.earliestNextBarStart,cutoff);
  assert.equal(signal.status,"HISTORICAL_RESEARCH_MATCH_NOT_A_TRADE");
  assert.equal(signal.executedTrades,undefined);
  assert.equal("netR" in signal,false);
  assert.equal(E.scanSignals(bars,{rule:"ORP-001",asOfUtc:cutoff-1}).matches.length,0);
});
test("mutating future candles does not alter past detected signals",()=>{
  const bars=fixture();
  const cutoff=bars[5].time+300000;
  const original=E.scanSignals(bars,{rule:"ORP-001",asOfUtc:cutoff});
  const modified=bars.map((b,i)=>i<=5?b:{
    ...b,open:10000,high:10100,low:9999.75,close:10050
  });
  assert.deepEqual(E.scanSignals(modified,{rule:"ORP-001",asOfUtc:cutoff}),original);
});
test("partial failed-breakout signal requires return and next completed confirmation",()=>{
  const bars=fixture("2026-07-07",false,"FBR");
  const at=bars[5].time+300000;
  assert.equal(E.scanSignals(bars,{rule:"FBR-001",asOfUtc:at-1}).matches.length,0);
  const matches=E.scanSignals(bars,{rule:"FBR-001",asOfUtc:at}).matches;
  assert.equal(matches.length,1);
  assert.equal(matches[0].side,"SHORT");
  assert.equal(matches[0].structuralStop,6011.5);
});

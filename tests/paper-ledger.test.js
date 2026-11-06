import test from "node:test";
import assert from "node:assert/strict";
import "../prototype/session-engine.js";
import "../prototype/paper-ledger.js";
const Engine=globalThis.TraderSessionEngine, Paper=globalThis.TraderPaperLedger;
const MS=300000,START=Date.parse("2026-07-06T13:30:00Z");
function fixture(){
  const bar=(i,o=6000,h=6000.25,l=5999.75,c=6000)=>({time:START+i*MS,open:o,high:h,low:l,close:c});
  const bars=Array.from({length:30},(_,i)=>bar(i));
  bars[0]=bar(0,6000,6010,5990,6000);
  bars[1]=bar(1,6000,6009,5991,6000);
  bars[2]=bar(2,6000,6009,5991,6000);
  bars[3]=bar(3,6009,6012,6008,6011);
  bars[4]=bar(4,6011,6012,6010,6011);
  bars[5]=bar(5,6011,6013.5,6010.5,6013);
  bars[6]=bar(6,6013,6014,6012,6013.5);
  bars[7]=bar(7,6014,6022,6013,6021);
  for(let i=8;i<30;i++)bars[i]=bar(i,6020,6021,6019,6020);
  return bars;
}
const data=bars=>({id:"csv-round1",symbol:"MES_5m_2026",source:"user-csv-unverified",bars,timeframe:"5m"});
function signal(bars){const r=Engine.scanSignals(bars,{rule:"ORP-001",asOfUtc:bars[5].time+MS});assert.equal(r.matches.length,1);return r.matches[0]}
function capture(bars,options={}){
  return Paper.newCase({signal:signal(bars),dataset:data(bars),
    rule:"ORP-001",clockMs:bars[5].time+MS+120000,
    replay:true,caseId:"case-20260706",...options});
}
test("captures only prefix and separates historical replay from market-forward status",()=>{
  const bars=fixture(),trial=capture(bars);
  assert.equal(trial.origin,"HISTORICAL_REPLAY");
  assert.equal(trial.prefix.length,6);
  assert.equal(trial.prefix.at(-1).time,bars[5].time);
  assert.equal(trial.status,"PENDING");
  assert.equal(trial.outcome,undefined);
  assert.equal(Paper.verifyCase(trial),true);
});
test("time-limited CSV observation is still unverified; cannot qualify a trading strategy",()=>{
  const all=fixture(),onlySignal=all.slice(0,6);
  const fresh=capture(onlySignal,{replay:false});
  assert.equal(fresh.origin,"TIMELY_CSV_UNVERIFIED");
  assert.equal(Paper.summary([fresh]).verifiedForwardCases,0);
  const old=capture(all,{replay:false});
  assert.equal(old.origin,"HISTORICAL_REPLAY"); // full outcome already available in file
  const late=capture(onlySignal,{replay:false,clockMs:all[5].time+MS+16*60000});
  assert.equal(late.origin,"HISTORICAL_REPLAY");
});
test("cannot settle a case without a complete session; can reconcile newly imported append",()=>{
  const all=fixture(),early=all.slice(0,6),trial=capture(early,{replay:false});
  const pending=Paper.reconcile(trial,data(all.slice(0,12)),Engine,Date.now());
  assert.equal(pending.status,"PENDING");
  assert.equal(pending.knownBars,12);
  const resolved=Paper.reconcile(trial,{...data(all),id:"csv-new-hash"},Engine,Date.now());
  assert.equal(resolved.status,"RESOLVED");
  assert.equal(resolved.outcome.exitReason,"TARGET");
  assert.ok(resolved.outcome.netUsd>0);
  const final=Paper.appendResolution(trial,resolved,Date.now());
  assert.equal(final.status,"RESOLVED");
  assert.equal(final.events.length,2);
  assert.throws(()=>Paper.appendResolution(final,resolved,Date.now()),/already finalized/);
});
test("changed pre-signal historical bar causes a hard conflict rather than a re-score",()=>{
  const all=fixture(),trial=capture(all.slice(0,6),{replay:false});
  const edited=all.map(b=>({...b}));edited[2].high=6008.75;
  const result=Paper.reconcile(trial,data(edited),Engine,Date.now());
  assert.equal(result.status,"CONFLICT");
  assert.match(result.reason,/changed or disappeared/);
});
test("rule-confirmation without valid next-open risk becomes SKIPPED, not a loss",()=>{
  const all=fixture(),trial=capture(all.slice(0,6),{replay:false});
  const altered=all.map(b=>({...b}));
  altered[6]={...altered[6],open:6008,high:6010,low:6007,close:6009};
  const res=Paper.reconcile(trial,data(altered),Engine,Date.now());
  assert.equal(res.status,"SKIPPED");
  const final=Paper.appendResolution(trial,res,Date.now());
  assert.equal(final.outcome,undefined);
  assert.equal(Paper.summary([final]).groups.TIMELY_CSV_UNVERIFIED.skipped,1);
});
test("mixed summaries never merge replay with unverified-timely trials",()=>{
  const all=fixture(),historical=capture(all,{caseId:"historical"});
  const timely=capture(all.slice(0,6),{replay:false,caseId:"timely"});
  const h=Paper.appendResolution(historical,Paper.reconcile(historical,data(all),Engine,Date.now()),Date.now());
  const t=Paper.appendResolution(timely,Paper.reconcile(timely,data(all),Engine,Date.now()),Date.now());
  const report=Paper.summary([h,t]);
  assert.equal(report.groups.HISTORICAL_REPLAY.resolved,1);
  assert.equal(report.groups.TIMELY_CSV_UNVERIFIED.resolved,1);
  assert.equal(report.verifiedForwardCases,0);
});
test("tampered recorded prefix is rejected during import",()=>{
  const t=capture(fixture());
  t.prefix[0].high=9000;
  assert.throws(()=>Paper.verifyCase(t),/checksum mismatch/);
});
test("a different instrument/series cannot be substituted on reconciliation",()=>{
  const all=fixture(),c=capture(all.slice(0,6));
  assert.equal(Paper.reconcile(c,{...data(all),symbol:"MNQ_5m"},Engine,Date.now()).status,"UNAVAILABLE");
});

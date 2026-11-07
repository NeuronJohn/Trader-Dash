import test from "node:test";
import assert from "node:assert/strict";
import "../prototype/fx-research.js";

const E=globalThis.TraderFxResearch,MS=300000;
function day(date="2026-07-06",winter=false,{spread=1}={}){
  const time=Date.parse(date+"T"+(winter?"12:00":"11:00")+":00Z");
  const pip=0.0001,half=spread*pip/2;
  const candle=(i,o=1.1008,h=1.1010,l=1.1006,c=1.1008,spreadPips=spread)=>{
    const halfSpread=spreadPips*pip/2;
    return {time:time+i*MS,open:o,high:h,low:l,close:c,
      bidOpen:o-halfSpread,bidHigh:h-halfSpread,bidLow:l-halfSpread,bidClose:c-halfSpread,
      askOpen:o+halfSpread,askHigh:h+halfSpread,askLow:l+halfSpread,askClose:c+halfSpread,
      receiptId:"receipt-"+date,receivedAt:time+48*MS+3600000};
  };
  const b=Array.from({length:48},(_,i)=>candle(i));
  for(let i=4;i<12;i++)b[i]=candle(i,1.1006,1.1025,1.0995,1.1008); // 30 pip baseline
  for(let i=12;i<20;i++)b[i]=candle(i,1.1008,1.1012,1.1004,1.1008); // 8 pip box
  b[20]=candle(20,1.1013,1.1020,1.1013,1.1016);
  b[21]=candle(21,1.1018,1.1020,1.10165,1.1019);
  b[22]=candle(22,1.1019,1.1046,1.1018,1.1043);
  for(let i=23;i<48;i++)b[i]=candle(i,1.1040,1.1041,1.1039,1.1040);
  return b;
}
const args=(bars,config={},other={})=>({bars,symbol:"EUR_USD",source:"oanda-fxpractice",config,...other});
const run=(bars,config={})=>E.simulate(bars,{symbol:"EUR_USD",source:"oanda-fxpractice",config});
const scan=(bars,asOfUtc)=>E.inspect(bars,{symbol:"EUR_USD",source:"oanda-fxpractice",asOfUtc});

test("FXC-001 uses a first closed-bar NY contraction breakout, then next-bar ask entry and bid target exit",()=>{
  const b=day(),report=run(b);
  assert.equal(report.completeSessions,1);
  assert.equal(report.trades.length,1);
  const trade=report.trades[0];
  assert.equal(trade.rule,"FXC-001");
  assert.equal(trade.side,"LONG");
  assert.equal(trade.signalTime,b[20].time+MS);
  assert.equal(trade.entryTime,b[21].time);
  assert.equal(trade.exitReason,"TARGET");
  assert.ok(Math.abs(trade.entry-(b[21].askOpen+0.2*0.0001))<1e-10);
  assert.ok(trade.initialRiskPips>10);
  assert.ok(trade.netR<1.5);
  assert.equal(report.qualification.startsWith("NONE"),true);
});
test("NY DST switch maps NY 07:00 to winter 12:00Z and summer 11:00Z",()=>{
  const a=day("2026-03-06",true),b=day("2026-03-09",false);
  const result=run([...a,...b]);
  assert.equal(result.completeSessions,2);
  assert.deepEqual(result.trades.map(t=>t.day),["2026-03-06","2026-03-09"]);
});
test("first confirmation cannot see future bars and no simulated win is exposed by scan",()=>{
  const b=day(),asOf=b[20].time+MS;
  const early=scan(b,asOf-1),at=scan(b,asOf);
  assert.equal(early.matches.length,0);
  assert.equal(at.matches.length,1);
  assert.equal(at.matches[0].sourceReceiptId,b[20].receiptId);
  assert.equal(at.matches[0].signalTime,asOf);
  assert.equal(at.matches[0].outcomeIncluded,false);
  assert.equal("netR" in at.matches[0],false);
  const mutated=b.map((x,i)=>i<=20?x:{...x,
    open:x.open+0.5,high:x.high+0.5,low:x.low+0.5,close:x.close+0.5,
    bidOpen:x.bidOpen+0.5,bidHigh:x.bidHigh+0.5,bidLow:x.bidLow+0.5,bidClose:x.bidClose+0.5,
    askOpen:x.askOpen+0.5,askHigh:x.askHigh+0.5,askLow:x.askLow+0.5,askClose:x.askClose+0.5
  });
  assert.deepEqual(scan(mutated,asOf),at);
});
test("historical bid stop is prioritized over bid target when long candle spans both",()=>{
  const b=day();
  b[21]={...b[21],high:1.1050,askHigh:1.10505,bidHigh:1.10495,
    low:1.0990,bidLow:1.09895,askLow:1.09905};
  const result=run(b);
  assert.equal(result.trades[0].exitReason,"STOP_FIRST");
  assert.ok(result.trades[0].netR< -1);
});
test("adverse bid opening gap causes worse-than-stop long loss",()=>{
  const b=day();
  b[22]={...b[22],open:1.0985,high:1.0990,low:1.0983,close:1.0987,
    bidOpen:1.09845,bidHigh:1.09895,bidLow:1.09825,bidClose:1.09865,
    askOpen:1.09855,askHigh:1.09905,askLow:1.09835,askClose:1.09875};
  const t=run(b).trades[0];
  assert.equal(t.exitReason,"ADVERSE_STOP_GAP");
  assert.ok(t.netR < -1);
});
test("next-bar excessive ask-bid entry spread rejects first breakout instead of finding later trade",()=>{
  const b=day(),old=b[21];
  b[21]={...old,askOpen:old.open+0.0003,bidOpen:old.open-0.0003,
    askHigh:old.high+0.0003,askLow:old.low+0.0003,askClose:old.close+0.0003,
    bidHigh:old.high-0.0003,bidLow:old.low-0.0003,bidClose:old.close-0.0003};
  const out=run(b);
  assert.equal(out.trades.length,0);
  assert.equal(out.skips.length,1);
  assert.match(out.skips[0].reason,/spread/);
});
test("cost sensitivity: more slippage and round-trip fees lowers modeled pips and R",()=>{
  const b=day();
  const cheap=run(b,{slippagePipsPerSide:0,feesPipsRoundTrip:0}).trades[0];
  const costly=run(b,{slippagePipsPerSide:0.8,feesPipsRoundTrip:1}).trades[0];
  assert.ok(costly.netPips<cheap.netPips);
  assert.ok(costly.netR<cheap.netR);
});
test("incomplete NY session and missing 5-minute bars are rejected, never filled across gap",()=>{
  const a=day(),b=day("2026-07-07");
  const full=[...a,...b.filter((_,i)=>i!==35)];
  const out=run(full);
  assert.equal(out.completeSessions,1);
  assert.equal(out.rejectedSessions.length,1);
  assert.equal(out.trades.length,1);
});
test("missing bid/ask extrema or receipt metadata blocks research instead of falling back to midpoint",()=>{
  const b=day();delete b[4].askLow;
  assert.throws(()=>run(b),/Full bid\/ask OHLC/);
  const c=day();delete c[5].receiptId;
  assert.throws(()=>run(c),/Missing first-seen provider receipt/);
});
test("user CSV and MES sources cannot enter FX engine",()=>{
  const b=day();
  assert.throws(()=>E.simulate(b,{symbol:"EUR_USD",source:"user-csv-unverified"}),/OANDA fxPractice/);
  assert.throws(()=>E.simulate(b,{symbol:"MES",source:"oanda-fxpractice"}),/Unsupported FX pair/);
});
test("time-indexed training and reserve are kept separate by session days",()=>{
  const days=[];
  for(let i=1;i<=30;i++){
    const date="2026-07-"+String(i).padStart(2,"0");
    const wd=new Date(date+"T12:00:00Z").getUTCDay();
    if(wd>0&&wd<6)days.push(date);
  }
  const b=days.flatMap(d=>day(d));
  const out=run(b);
  assert.equal(out.completeSessions,days.length);
  assert.equal(out.split.trainingDays+out.split.reserveDays+out.split.embargoDays,days.length);
  assert.ok(out.train.trades>0&&out.reserve.trades>0);
  assert.equal(out.trades.length,days.length);
  assert.equal(out.split.reserveAdequate,false);
});
test("signal-time spread spikes reject without peeking at future",()=>{
  const b=day(),c=b[20];
  b[20]={...c,askClose:c.close+0.00035,bidClose:c.close-0.00035,
    askHigh:c.high+0.00035,bidHigh:c.high-0.00035,
    askOpen:c.open+0.00035,bidOpen:c.open-0.00035,
    askLow:c.low+0.00035,bidLow:c.low-0.00035};
  const out=run(b);
  assert.equal(out.trades.length,0);
  assert.match(out.noSignals[0].reason,/spread/);
});

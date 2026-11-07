/* Trader / Lab — evidence-first MES paper/replay case ledger v0.5
 * No network, orders, credentials, model calls or background monitoring.
 * Deliberately never labels user-imported CSV evidence as verified.
 */
(function(root){
"use strict";
const BAR_MS=300000;
const CT="America/Chicago";
const RULES=new Set(["ORP-001","FBR-001"]);
const TYPES=new Set(["HISTORICAL_REPLAY","TIMELY_CSV_UNVERIFIED"]);
const FIELDS=["time","open","high","low","close"];
const ct=new Intl.DateTimeFormat("en-US",{timeZone:CT,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function local(ms){const p=Object.fromEntries(ct.formatToParts(new Date(ms)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));return {day:p.year+"-"+p.month+"-"+p.day,minute:Number(p.hour)*60+Number(p.minute)}}
function fail(s){throw Error(s)}
function normalizedBars(bars){
  if(!Array.isArray(bars)||bars.length<3||bars.length>20000)fail("OHLC series absent or too long");
  let prev=-Infinity;
  return bars.map((b,i)=>{
    if(!b || !Number.isSafeInteger(b.time) || b.time%BAR_MS!==0 || b.time<=prev)fail("Invalid chronological 5-minute timestamp at "+i);
    if(!FIELDS.slice(1).every(k=>Number.isFinite(b[k]) && b[k]>0) || b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close,b.high))fail("Invalid OHLC at "+i);
    prev=b.time;return Object.fromEntries(FIELDS.map(k=>[k,b[k]]));
  });
}
function serialize(x){return JSON.stringify(x)}
// Lightweight error-detection checksum, NOT a cryptographic signature or provenance proof.
function checksum(x){
  const text=serialize(x);let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(16).padStart(8,"0");
}
function prefixFor(bars,signalTime){
  const b=normalizedBars(bars);
  const index=b.findIndex(x=>x.time===signalTime-BAR_MS);
  if(index<2)fail("Confirmation candle or opening range missing");
  const info=local(b[index].time),start=info.day;
  let a=index;
  while(a>0 && local(b[a-1].time).day===start && local(b[a-1].time).minute>=510)a--;
  const prefix=b.slice(a,index+1);
  if(prefix.length<3||prefix.length>24||local(prefix[0].time).minute!==510)fail("Opening range 08:30 CT and uninterrupted prefix required");
  if(!prefix.every((x,j)=>j===0||x.time-prefix[j-1].time===BAR_MS))fail("Gap before confirmation bar");
  return prefix;
}
function newCase({signal,dataset,clockMs,rule,slippageTicks=1,roundTripFeeUsd=2.5,targetR=2,replay=true,caseId}){
  if(!signal || !RULES.has(signal.rule) || signal.rule!==rule || signal.status!=="HISTORICAL_RESEARCH_MATCH_NOT_A_TRADE")fail("Select a frozen MES historical confirmation first");
  if(!dataset || dataset.source!=="user-csv-unverified" || !/(^|[^a-z])mes(?=[^a-z]|$)/i.test(dataset.symbol||""))fail("An imported MES CSV is required");
  if(!Number.isSafeInteger(clockMs) || !Number.isSafeInteger(signal.signalTime) || clockMs<signal.signalTime)fail("Observation clock predates signal confirmation");
  const prefix=prefixFor(dataset.bars,signal.signalTime);
  const a=dataset.bars;
  const latest=a[a.length-1].time+BAR_MS;
  const hasLater=latest>signal.signalTime;
  const timely=!replay&&!hasLater&&clockMs-signal.signalTime<=15*60000;
  if(!Number.isFinite(slippageTicks)||slippageTicks<0||slippageTicks>20||
    !Number.isFinite(roundTripFeeUsd)||roundTripFeeUsd<0||roundTripFeeUsd>100||
    !Number.isFinite(targetR)||targetR<.5||targetR>6)fail("Invalid frozen simulation costs");
  const origin=timely?"TIMELY_CSV_UNVERIFIED":"HISTORICAL_REPLAY";
  const plan={rule,slippageTicks,roundTripFeeUsd,targetR,engineVersion:"MES-SESSION-v1",contract:"1 MES"};
  const fingerprint=checksum(prefix);
  const seed={
    schema:"trader.paper-case.v1",id:caseId||"case-"+clockMs+"-"+checksum([signal.signalTime,signal.rule,dataset.symbol]),
    createdAtUtc:new Date(clockMs).toISOString(),
    origin,source:"user-csv-unverified",datasetId:dataset.id,seriesSymbol:dataset.symbol,
    rule,day:signal.day,side:signal.side,signalTime:signal.signalTime,
    signalBarStart:signal.signalBarStart,rangeBoundary:signal.boundary,
    structuralStop:signal.structuralStop,
    prefix, prefixChecksum:fingerprint,plan,
    sourceAttestation:"USER_IMPORT_NOT_VERIFIED",
    status:"PENDING",
    events:[],
  };
  seed.events=[{type:"CAPTURE",atUtc:seed.createdAtUtc,reason:origin,
    dataChecksum:fingerprint,description:"No future outcomes stored at capture time"}];
  return seed;
}
function verifyCase(c){
  if(!c||c.schema!=="trader.paper-case.v1"||typeof c.id!=="string"||c.id.length>180||
    !TYPES.has(c.origin)||!RULES.has(c.rule)||!c.plan||c.plan.rule!==c.rule||
    typeof c.seriesSymbol!=="string" || c.seriesSymbol.length>80 || typeof c.day!=="string" ||
    !Number.isSafeInteger(c.signalTime)||!Number.isFinite(Date.parse(c.createdAtUtc))||
    !Array.isArray(c.events)||c.events.length>100||c.events.length<1||
    !Array.isArray(c.prefix)||c.prefix.length>24||c.prefix.length<3 ||
    !["PENDING","RESOLVED","SKIPPED","CONFLICT"].includes(c.status))fail("Malformed paper case");
  const p=normalizedBars(c.prefix);
  if(checksum(p)!==c.prefixChecksum || p.at(-1).time+BAR_MS!==c.signalTime)fail("Captured prefix checksum mismatch");
  const first=c.events[0];
  if(!first||first.type!=="CAPTURE"||first.dataChecksum!==c.prefixChecksum)fail("Capture record missing");
  if(c.events.some(e=>!e||typeof e.type!=="string"||typeof e.atUtc!=="string"))fail("Invalid event history");
  if(c.status==="RESOLVED" && (!c.outcome||!Number.isFinite(c.outcome.netR)||!Number.isFinite(c.outcome.netUsd)))fail("Malformed resolved outcome");
  if(c.status!=="PENDING"){
    const lastResolution=c.events.findLast(e=>e.result===c.status);
    if(!lastResolution)fail("Final status has no matching event");
  }
  return true;
}
function reconcile(c,data,engine,atMs){
  verifyCase(c);
  if(c.status!=="PENDING")return {status:c.status,reason:"This case has already been finalized"};
  if(!data||data.source!=="user-csv-unverified"||data.symbol!==c.seriesSymbol)
    return {status:"UNAVAILABLE",reason:"Use an imported CSV with the same instrument/series label"};
  if(!engine||engine.version!==c.plan.engineVersion)fail("Original rule engine unavailable");
  if(!Number.isSafeInteger(atMs))fail("Clock timestamp required");
  let normalized;
  try{normalized=normalizedBars(data.bars)}catch(e){return {status:"CONFLICT",reason:e.message}}
  if(normalized.at(-1).time+BAR_MS>atMs)return {status:"PENDING",reason:"File contains candles that close after the observation clock; cannot score future data"};
  const present=new Map(normalized.map(b=>[b.time,b]));
  for(const saved of c.prefix){
    const current=present.get(saved.time);
    if(!current||serialize(current)!==serialize(saved))
      return {status:"CONFLICT",reason:"Original pre-signal candles changed or disappeared; refusing to score altered history"};
  }
  if(checksum(c.prefix)!==c.prefixChecksum)return {status:"CONFLICT",reason:"Captured evidence checksum changed"};
  const relevant=normalized.filter(b=>local(b.time).day===c.day&&local(b.time).minute>=510&&local(b.time).minute<660);
  if(relevant.length<30){
    return {status:"PENDING",reason:"Complete session through 10:55 CT is not available; no result yet",knownBars:relevant.length};
  }
  let report;
  try{report=engine.run(normalized,{
    rule:c.rule,slippageTicks:c.plan.slippageTicks,
    roundTripFeeUsd:c.plan.roundTripFeeUsd,targetR:c.plan.targetR,
    source:"user-csv-unverified",
  })}catch(e){return {status:"CONFLICT",reason:"Imported dataset could not be simulated: "+e.message}}
  const sessionRejected=report.rejectedSessions.find(x=>x.day===c.day);
  if(sessionRejected)return {status:"CONFLICT",reason:"Captured session excluded for gaps or duplicates"};
  const matching=report.allTrades.find(t=>t.day===c.day&&t.rule===c.rule&&t.signalTime===c.signalBarStart&&t.side===c.side);
  if(!matching){
    return {status:"SKIPPED",reason:"Historical signal existed but no valid modeled entry satisfied the frozen rules or risk/reward",outcome:null};
  }
  return {status:"RESOLVED",reason:"Cost-adjusted hypothetical one-contract MES outcome, NOT a broker fill",
    outcome:{
      entry:matching.entry,exit:matching.exit,stop:matching.stop,target:matching.target,
      exitReason:matching.exitReason,netR:matching.netR,netUsd:matching.netUsd,
      feesUsd:matching.feesUsd,model:"OHLC_CONSERVATIVE_UNVERIFIED",
      entryTime:matching.entryTime,exitTime:matching.exitTime,
    }};
}
function appendResolution(c, resolution, clockMs){
  verifyCase(c);
  if(c.status!=="PENDING")fail("Case already finalized: append-only history");
  if(c.events.length>=100)fail("Event log full; export records before finalizing");
  if(!["RESOLVED","SKIPPED","CONFLICT"].includes(resolution.status))fail("Only finalized outcomes may be appended");
  if(!Number.isSafeInteger(clockMs)||clockMs<Date.parse(c.createdAtUtc))fail("Resolution time predates case");
  const out=JSON.parse(serialize(c));
  out.status=resolution.status;
  if(resolution.status==="RESOLVED" && (!resolution.outcome||!Number.isFinite(resolution.outcome.netR)))fail("Missing valid modeled outcome");
  if(resolution.status==="RESOLVED")out.outcome=resolution.outcome;
  out.events.push({type:resolution.status==="CONFLICT"?"DATA_CONFLICT":"MODEL_RESULT",
    atUtc:new Date(clockMs).toISOString(),reason:String(resolution.reason||"").slice(0,300),
    result:resolution.status,
    modeledNetR:resolution.status==="RESOLVED"?resolution.outcome.netR:null});
  return out;
}
function appendNote(c,note,clockMs){
  verifyCase(c);
  if(!Number.isSafeInteger(clockMs)||clockMs<Date.parse(c.createdAtUtc))fail("Note timestamp predates case");
  if(typeof note!=="string"||note.length>1200)fail("Note exceeds 1200 characters");
  const out=JSON.parse(serialize(c));
  if(out.events.length>=100)fail("Event history is full; export your ledger");
  out.events.push({type:"NOTE",atUtc:new Date(clockMs).toISOString(),text:note.slice(0,1200)});
  return out;
}
function summary(cases){
  const names=["HISTORICAL_REPLAY","TIMELY_CSV_UNVERIFIED"];
  const groups=Object.fromEntries(names.map(name=>[name,{
    total:0,pending:0,resolved:0,skipped:0,conflicts:0,wins:0,
    winRate:null,averageNetR:null,netR:null,closedDrawdownR:null,
    byRule:{}
  }]));
  const all={};
  for(const c of cases){
    verifyCase(c);
    const g=groups[c.origin];g.total++;
    const key=c.origin+"|"+c.rule;
    if(!all[key])all[key]={count:0,results:[]};
    const r=all[key];
    if(c.status==="PENDING")g.pending++;
    if(c.status==="RESOLVED"){
      g.resolved++;r.results.push({at:c.signalTime,value:c.outcome.netR});
      r.count++;
      if(c.outcome.netR>0)g.wins++;
    }
    if(c.status==="SKIPPED")g.skipped++;
    if(c.status==="CONFLICT")g.conflicts++;
  }
  for(const name of names){
    const g=groups[name],series=[];
    for(const rule of RULES){
      const data=all[name+"|"+rule];
      if(!data)continue;
      const results=data.results.sort((a,b)=>a.at-b.at);
      let eq=0,peak=0,dd=0,wins=0;
      for(const x of results){eq+=x.value;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(x.value>0)wins++}
      g.byRule[rule]={
        count:results.length,wins,winRate:results.length?wins/results.length:null,
        averageNetR:results.length?eq/results.length:null,
        netR:results.length?eq:null,closedDrawdownR:results.length?dd:null
      };
      series.push(...results);
    }
    series.sort((a,b)=>a.at-b.at);
    let equity=0,peak=0,dd=0;
    for(const x of series){equity+=x.value;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity)}
    g.netR=g.resolved?equity:null;
    g.averageNetR=g.resolved?equity/g.resolved:null;
    g.winRate=g.resolved?g.wins/g.resolved:null;
    g.closedDrawdownR=g.resolved?dd:null;
  }
  return {
    schema:"trader.paper-summary.v1",sourceVerified:false,brokerFillsVerified:false,
    verifiedForwardCases:0,groups,
    warning:"Research-only closed-trade R metrics. Replay and user-attested timely CSV observations are NEVER independently verified forward performance."
  };
}
root.TraderPaperLedger=Object.freeze({
  version:"PAPER-LEDGER-v1",newCase,verifyCase,reconcile,appendResolution,appendNote,summary,prefixFor,checksum
});
})(typeof globalThis!=="undefined"?globalThis:this);

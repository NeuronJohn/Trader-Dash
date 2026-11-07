/* Trader-Dash FXC-001: rule-frozen, spread-aware, outcome-blind research.
 * No orders, network, account balances, or automatic background monitoring.
 * OANDA practice historical bid/ask OHLC are INDICATIVE, not executable fills.
 */
(function(root){
"use strict";
const VERSION="FXC-001-v1",BAR_MS=300000,TZ="America/New_York";
const SYMBOLS=Object.freeze({EUR_USD:0.0001,GBP_USD:0.0001,USD_JPY:0.01});
const START=7*60,END=11*60,SLOTS=48;
const DEFAULTS=Object.freeze({
  maxSpreadPips:2, slippagePipsPerSide:0.2, feesPipsRoundTrip:0,
  targetR:1.5, contractionRatio:0.8,
  maxBoxPips:20,minBoxPips:1,breakoutBufferPips:0.2,stopBufferPips:1,
  minRiskPips:2,maxRiskPips:35
});
const formatter=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function parts(time){
  const p=Object.fromEntries(formatter.formatToParts(new Date(time)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return {day:p.year+"-"+p.month+"-"+p.day,weekday:p.weekday,minute:Number(p.hour)*60+Number(p.minute)};
}
function err(s){throw Error(s)}
function priceCheck(b,i){
  const names=["open","high","low","close","bidOpen","bidHigh","bidLow","bidClose","askOpen","askHigh","askLow","askClose"];
  for(const key of names)if(!Number.isFinite(b[key])||b[key]<=0)
    err("Full bid/ask OHLC required at bar "+i+"; older receipts must be refreshed under v0.7, or exclude this dataset");
  for(const prefix of ["","bid","ask"]){
    const k=prefix?["Open","High","Low","Close"].map(x=>prefix+x):["open","high","low","close"];
    if(b[k[1]]<Math.max(b[k[0]],b[k[2]],b[k[3]])||
       b[k[2]]>Math.min(b[k[0]],b[k[1]],b[k[3]]))
      err("Invalid "+(prefix||"mid")+" OHLC at "+i);
  }
  for(const key of ["Open","Close"])
    if(b["ask"+key]<b["bid"+key])err("Ask below bid at bar "+i);
  if(!Number.isSafeInteger(b.time)||b.time%BAR_MS!==0)err("Invalid M5 UTC bar-start at "+i);
}
function verifyInput(bars,symbol,source){
  if(!Object.prototype.hasOwnProperty.call(SYMBOLS,symbol))err("Unsupported FX pair");
  if(source!=="oanda-fxpractice")err("Only OANDA fxPractice receipts are eligible; CSV and futures data remain separate");
  if(!Array.isArray(bars)||bars.length<48||bars.length>50000)err("FX research requires 48–50,000 received M5 bars");
  let last=-Infinity;
  bars.forEach((b,i)=>{
    priceCheck(b,i);
    if(b.time<=last)err("Repeated or unsorted FX timestamps at "+i);
    if(!Number.isSafeInteger(b.receivedAt)||typeof b.receiptId!=="string"||!b.receiptId)
      err("Missing first-seen provider receipt at "+i);
    if(b.time+BAR_MS>b.receivedAt+2000)err("Provider receipt precedes candle close at "+i);
    last=b.time;
  });
  return SYMBOLS[symbol];
}
function options(user={}){
  const o={...DEFAULTS,...user};
  for(const key of Object.keys(DEFAULTS))if(!Number.isFinite(o[key]))err("Invalid FX assumption "+key);
  if(o.maxSpreadPips<0||o.maxSpreadPips>20||
    o.slippagePipsPerSide<0||o.slippagePipsPerSide>10||
    o.feesPipsRoundTrip<0||o.feesPipsRoundTrip>30||
    o.targetR<0.5||o.targetR>5||
    o.contractionRatio<0.2||o.contractionRatio>1||
    o.maxBoxPips<2||o.maxBoxPips>100||
    o.minBoxPips<0.1||o.minBoxPips>o.maxBoxPips||
    o.breakoutBufferPips<0||o.breakoutBufferPips>5||
    o.stopBufferPips<0||o.stopBufferPips>10||
    o.minRiskPips<0.5||o.minRiskPips>o.maxRiskPips||
    o.maxRiskPips>100)
    err("FX assumptions outside bounded research limits");
  return o;
}
function groupSessions(bars,asOfUtc=Infinity){
  const group=new Map();
  for(const b of bars){
    if(b.time+BAR_MS>asOfUtc)continue; // never expose unclosed candles at cutoff
    const loc=parts(b.time);
    if(loc.weekday==="Sat"||loc.weekday==="Sun"||loc.minute<START||loc.minute>=END)continue;
    const slot=(loc.minute-START)/5;
    const m=group.get(loc.day)||new Map();
    if(m.has(slot))m.set(slot,null);else m.set(slot,b);
    group.set(loc.day,m);
  }
  return [...group.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,m])=>{
    const max=Math.max(...m.keys()),result=[];
    let valid=m.has(0);
    for(let i=0;i<=max;i++){
      const b=m.get(i);
      if(!b || (i>0&&b.time-result[i-1]?.time!==BAR_MS)){valid=false;break}
      result.push(b);
    }
    return {day,valid,bars:valid?result:[],totalSlots:m.size,complete:valid&&result.length===SLOTS,
      reason:valid?"": "Missing/duplicate 5m NY-session candles"};
  });
}
const range=(bars,a,b)=>({
  high:Math.max(...bars.slice(a,b).map(x=>x.high)),
  low:Math.min(...bars.slice(a,b).map(x=>x.low)),
});
function pattern(session,pip,o){
  const b=session.bars;
  if(!session.valid||b.length<21)return {reason:"Insufficient contiguous 07:00–08:40 NY bars"};
  const baseline=range(b,4,12),box=range(b,12,20);
  const baselinePips=(baseline.high-baseline.low)/pip;
  const boxPips=(box.high-box.low)/pip;
  if(baselinePips<2)return {reason:"Pre-box baseline below 2 pips; contraction ratio undefined"};
  if(boxPips<o.minBoxPips||boxPips>o.maxBoxPips||
    boxPips>baselinePips*o.contractionRatio)
    return {reason:"Predefined 08:00–08:40 contraction condition not met"};
  const last=Math.min(35,b.length); // first signal 08:40, last 09:50; entry before 10:00
  for(let i=20;i<last;i++){
    const c=b[i],upper=c.close>=box.high+o.breakoutBufferPips*pip;
    const lower=c.close<=box.low-o.breakoutBufferPips*pip;
    if(!upper&&!lower)continue;
    const side=upper?"LONG":"SHORT",signalSpread=(c.askClose-c.bidClose)/pip;
    if(signalSpread>o.maxSpreadPips)return {reason:"First breakout spread too wide at confirmation",signalIndex:i};
    // A wick sweeping both extremes is order-ambiguous, even with a directional close.
    if(c.high>=box.high+o.breakoutBufferPips*pip &&
       c.low<=box.low-o.breakoutBufferPips*pip)
      return {reason:"First breakout swept both box extremes: unknown intrabar sequence",signalIndex:i};
    return {
      rule:"FXC-001",version:VERSION,day:session.day,side,signalIndex:i,
      signalTime:c.time+BAR_MS,signalBarStart:c.time,
      boxHigh:box.high,boxLow:box.low,baselinePips,boxPips,signalSpreadPips:signalSpread,
      stopReference:upper?box.low-o.stopBufferPips*pip:box.high+o.stopBufferPips*pip,
      sourceReceiptId:c.receiptId,receivedAt:c.receivedAt,
      note:"Frozen 08:00–08:40 NY contraction breakout; first qualifying close only"
    };
  }
  return {reason:"No confirmed breakout between 08:40 and 09:55 NY"};
}
function fill(session,c,pip,o){
  const bars=session.bars,d=c.side==="LONG"?1:-1,at=c.signalIndex+1;
  if(at>=36)return {status:"SKIPPED",reason:"Entry begins at/after 10:00 NY"};
  const opening=bars[at];
  if(!opening)return {status:"SKIPPED",reason:"No completed next bar to model entry"};
  const spread=(opening.askOpen-opening.bidOpen)/pip;
  if(spread>o.maxSpreadPips)return {status:"SKIPPED",reason:"Next-open spread exceeds frozen limit"};
  const slip=o.slippagePipsPerSide*pip;
  const entry=(d===1?opening.askOpen:opening.bidOpen)+d*slip;
  const stop=c.stopReference;
  const risk=d*(entry-stop),riskPips=risk/pip;
  if(riskPips<o.minRiskPips||riskPips>o.maxRiskPips)
    return {status:"SKIPPED",reason:"Next-open spread/gap moved initial stop distance outside frozen limits"};
  const target=entry+d*o.targetR*risk;
  for(let i=at;i<SLOTS;i++){
    const b=bars[i];
    if(!b)return {status:"SKIPPED",reason:"Incomplete session before modeled exit"};
    const open=d===1?b.bidOpen:b.askOpen;
    const high=d===1?b.bidHigh:b.askHigh;
    const low=d===1?b.bidLow:b.askLow;
    const stopGap=d===1?open<=stop:open>=stop;
    const stopTouch=d===1?low<=stop:high>=stop;
    const targetGap=d===1?open>=target:open<=target;
    const targetTouch=d===1?high>=target:low<=target;
    let exit=null,reason=null;
    if(stopGap){exit=open;reason="ADVERSE_STOP_GAP"}
    else if(stopTouch){exit=stop;reason="STOP_FIRST"}
    else if(targetGap){exit=target;reason="TARGET_GAP_CAPPED"}
    else if(targetTouch){exit=target;reason="TARGET"}
    else if(i===SLOTS-1){exit=d===1?b.bidClose:b.askClose;reason="NY_SESSION_EXIT"}
    if(exit===null)continue;
    exit-=d*slip;
    const grossPips=d*(exit-entry)/pip,netPips=grossPips-o.feesPipsRoundTrip;
    return {status:"SIMULATED",rule:c.rule,version:VERSION,day:c.day,side:c.side,
      signalTime:c.signalTime,entryTime:opening.time,exitTime:b.time+BAR_MS,
      entry,stop,target,exit,exitReason:reason,entrySpreadPips:spread,
      signalSpreadPips:c.signalSpreadPips,initialRiskPips:riskPips,
      grossPips,netPips,netR:netPips/riskPips,
      openingBoxPips:c.boxPips,sourceReceiptId:c.sourceReceiptId,
      disclaimer:"Historical bid/ask OHLC approximation, stop-first on ambiguity; not account fills"};
  }
  return {status:"SKIPPED",reason:"No exit before research end"};
}
function metrics(trades){
  let eq=0,peak=0,dd=0,wins=0,pos=0,neg=0,pips=0;
  for(const t of trades){
    eq+=t.netR;peak=Math.max(eq,peak);dd=Math.max(dd,peak-eq);pips+=t.netPips;
    if(t.netR>0){wins++;pos+=t.netR}else if(t.netR<0)neg-=t.netR;
  }
  return {trades:trades.length,wins,winRate:trades.length?wins/trades.length:null,
    avgNetR:trades.length?eq/trades.length:null,netR:trades.length?eq:null,
    avgNetPips:trades.length?pips/trades.length:null,
    maxClosedDrawdownR:trades.length?dd:null,
    profitFactor:neg?pos/neg:null};
}
function inspect(bars,{symbol,source="oanda-fxpractice",rule="FXC-001",config={},asOfUtc}={}){
  if(rule!=="FXC-001")err("Unrecognized FX rule version");
  const pip=verifyInput(bars,symbol,source),o=options(config);
  const cutoff=asOfUtc===undefined?bars.at(-1).time+BAR_MS:asOfUtc;
  if(!Number.isFinite(cutoff))err("Finite discovery UTC cutoff required");
  const sessions=groupSessions(bars,cutoff),matches=[],rejections=[];
  for(const s of sessions){
    const c=pattern(s,pip,o);
    if(c.rule)matches.push({...c,status:"CLOSED_BAR_MATCH_NOT_EXECUTABLE",outcomeIncluded:false});
    else rejections.push({day:s.day,reason:c.reason||s.reason});
  }
  return {schema:"trader.fx-discovery.v1",rule,version:VERSION,symbol,
    asOfUtc:cutoff,matches,rejections,
    fillsIncluded:false,source:"oanda-fxpractice",accountPricingVerified:false};
}
function simulate(bars,{symbol,source="oanda-fxpractice",rule="FXC-001",config={}}={}){
  if(rule!=="FXC-001")err("Unrecognized FX rule version");
  const pip=verifyInput(bars,symbol,source),o=options(config);
  const sessions=groupSessions(bars),valid=sessions.filter(x=>x.complete);
  const rejected=sessions.filter(x=>!x.complete).map(x=>({day:x.day,reason:x.reason||"Incomplete NY research window"}));
  const trades=[],skips=[],noSignals=[];
  for(const s of valid){
    const c=pattern(s,pip,o);
    if(!c.rule){noSignals.push({day:s.day,reason:c.reason});continue}
    const t=fill(s,c,pip,o);
    if(t.status==="SIMULATED")trades.push(t);
    else skips.push({day:s.day,reason:t.reason,signalTime:c.signalTime});
  }
  const cut=Math.floor(valid.length*.7);
  const trainDays=valid.slice(0,Math.max(0,cut-1)).map(s=>s.day);
  const reserveDays=valid.slice(Math.min(valid.length,cut+1)).map(s=>s.day);
  const trainSet=new Set(trainDays),reserveSet=new Set(reserveDays);
  const trainTrades=trades.filter(t=>trainSet.has(t.day));
  const reserveTrades=trades.filter(t=>reserveSet.has(t.day));
  return {schema:"trader.fx-research.v1",status:"UNVERIFIED_FX_RESEARCH_ONLY",
    rule,version:VERSION,symbol,source,pipSize:pip,timezone:TZ,
    engineAssumptions:o,
    model:"Historical OANDA practice bid/ask OHLC; actual BUY ask/SELL bid; stop-first; no real fills",
    completeSessions:valid.length,rejectedSessions:rejected,
    noSignals,skips,trades,train:metrics(trainTrades),reserve:metrics(reserveTrades),reserveTrades,
    split:{trainingDays:trainDays.length,reserveDays:reserveDays.length,
      embargoDays:valid.length-trainDays.length-reserveDays.length,
      trainThrough:trainDays.at(-1)||null,reserveFrom:reserveDays[0]||null,
      reserveAdequate:reserveDays.length>=20},
    qualification:"NONE. Pricing, costs, account trading permissions, financing and all live fills unverified.",
  };
}
root.TraderFxResearch=Object.freeze({
  version:VERSION,defaults:DEFAULTS,inspect,simulate,metrics,verifyInput,groupSessions
});
})(typeof globalThis!=="undefined"?globalThis:this);

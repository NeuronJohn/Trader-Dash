/* Trader / Lab — session-aware MES research rules, v1.
 * Browser + Node compatible; no network, LLM, broker, storage or order permissions.
 * Research-only: fixed 5-minute START timestamps, Chicago cash-session window.
 * Prices and session handling MUST be audited against an authorized data provider.
 */
(function (root) {
  "use strict";
  const TZ = "America/Chicago";
  const BAR_MS = 300000;
  const TICK = 0.25;
  const POINT_USD = 5;
  const WINDOW_START = 8 * 60 + 30;
  const WINDOW_END = 11 * 60;
  const ENTRY_END = 10 * 60 + 30;
  const SESSION_BARS = (WINDOW_END - WINDOW_START) / 5;
  const VERSION = "MES-SESSION-v1";
  const RULES = Object.freeze({
    "ORP-001": "Opening-range first-break / first-pullback confirmation",
    "FBR-001": "Opening-range failed break / return confirmation",
  });
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const toParts = (utcMs) => {
    const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs))
      .filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    return {
      day: p.year + "-" + p.month + "-" + p.day,
      weekday: p.weekday,
      minute: Number(p.hour) * 60 + Number(p.minute),
    };
  };
  const onTick = n => Math.abs(n / TICK - Math.round(n / TICK)) < 1e-5;
  const roundTick = (n, mode) => {
    const t = n / TICK;
    return (mode === "floor" ? Math.floor(t + 1e-7) : Math.ceil(t - 1e-7)) * TICK;
  };
  function requiredBars(bars) {
    if (!Array.isArray(bars) || bars.length < SESSION_BARS) throw Error("Need at least 30 five-minute MES candles");
    let prev = -Infinity;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (!b || !Number.isSafeInteger(b.time) || b.time <= prev || b.time % BAR_MS !== 0 ||
          !["open","high","low","close"].every(k => Number.isFinite(b[k]) && b[k] > 0) ||
          b.high < Math.max(b.open, b.close, b.low) ||
          b.low > Math.min(b.open, b.close, b.high))
        throw Error("Invalid or unsorted five-minute OHLC at row " + (i+1));
      if (!["open","high","low","close"].every(k => onTick(b[k])))
        throw Error("MES prices must be aligned to 0.25-point ticks (row " + (i+1) + ")");
      prev = b.time;
    }
  }
  function sessionsFromBars(bars) {
    requiredBars(bars);
    const groups = new Map();
    for (const bar of bars) {
      const p = toParts(bar.time);
      if (p.weekday === "Sat" || p.weekday === "Sun" || p.minute < WINDOW_START || p.minute >= WINDOW_END) continue;
      const group = groups.get(p.day) || new Map();
      const slot = (p.minute - WINDOW_START) / 5;
      if (!group.has(slot)) group.set(slot, bar);
      else group.set(slot, null); // duplicate local timestamp is invalid
      groups.set(p.day, group);
    }
    const valid = [], excluded = [];
    for (const [day, slots] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
      const b = Array.from({length: SESSION_BARS}, (_,i) => slots.get(i));
      const full = slots.size === SESSION_BARS && b.every(Boolean);
      const continuous = full && b.every((c,i) => i === 0 || c.time - b[i-1].time === BAR_MS);
      if (!full || !continuous) {
        excluded.push({day, reason:"Missing/duplicate candles or time discontinuity between 08:30 and 11:00 CT"});
        continue;
      }
      valid.push({day, bars:b, startTime:b[0].time});
    }
    return {valid,excluded, scannedSessions:groups.size};
  }
  function priorRange(b) {
    return {high: Math.max(...b.slice(0,3).map(x => x.high)),
      low: Math.min(...b.slice(0,3).map(x => x.low))};
  }
  // No signal may use a bar that has not yet fully closed. entryIndex is next bar open.
  function orpCandidate(s) {
    const b=s.bars,{high,low}=priorRange(b);
    let breakout = null, direction = 0;
    for(let i=3;i<24;i++){
      if(b[i].close>high){breakout=i;direction=1;break}
      if(b[i].close<low){breakout=i;direction=-1;break}
    }
    if(breakout==null)return {reason:"No first opening-range breakout during entry window"};
    for(let i=breakout+1;i<=Math.min(breakout+6,21);i++){
      // The first structurally eligible retest consumes the opportunity even
      // if next-bar confirmation fails, avoiding selective second attempts.
      const retest=direction===1
        ? b[i].low<=high && b[i].close>=high
        : b[i].high>=low && b[i].close<=low;
      if(!retest)continue;
      const confirm=i+1,entry=confirm+1;
      const confirmed=direction===1
        ? b[confirm].close>b[i].high
        : b[confirm].close<b[i].low;
      if(!confirmed)return {reason:"First pullback did not confirm on next completed bar"};
      if(entry>=24)return {reason:"Confirmation too late for pre-10:30 entry"};
      const stop=direction===1?roundTick(b[i].low-TICK,"floor"):roundTick(b[i].high+TICK,"ceil");
      return {
        rule:"ORP-001",ruleVersion:VERSION,day:s.day,side:direction===1?"LONG":"SHORT",
        signalIndex:confirm,entryIndex:entry,stop,
        boundary:direction===1?high:low,rangeHigh:high,rangeLow:low,
        breakoutIndex:breakout,retestIndex:i,
        explanation:"First opening-range breakout, first eligible pullback, next-bar confirmation"
      };
    }
    return {reason:"No qualifying first pullback with timely confirmation"};
  }
  function fbrCandidate(s) {
    const b=s.bars,{high,low}=priorRange(b);
    for(let i=3;i<23;i++){
      let side=0;
      const upper=b[i].high>=high+2*TICK,lower=b[i].low<=low-2*TICK;
      // If both sides were swept on one OHLC bar, no defensible event order
      // can be recovered. Reject instead of choosing a favorable narrative.
      if(upper&&lower)return {reason:"Both opening-range extremes swept in one candle; sequence unknown"};
      if(upper)side=-1;
      else if(lower)side=1;
      if(!side)continue;
      // First excursion gets at most 3 bars to return into the opening range.
      for(let ret=i;ret<=Math.min(i+2,22);ret++){
        const returned=side===-1?b[ret].close<high:b[ret].close>low;
        if(!returned)continue;
        const confirm=ret+1,entry=confirm+1;
        if(entry>=24)return {reason:"Return confirmation too late for entry window"};
        const confirmed=side===-1?b[confirm].close<b[ret].low:b[confirm].close>b[ret].high;
        if(!confirmed)return {reason:"First return failed next-bar confirmation"};
        const relevant=b.slice(i,confirm+1);
        const excursionExtreme=side===-1?Math.max(...relevant.map(x=>x.high)):Math.min(...relevant.map(x=>x.low));
        const stop=side===-1?roundTick(excursionExtreme+2*TICK,"ceil"):roundTick(excursionExtreme-2*TICK,"floor");
        return {
          rule:"FBR-001",ruleVersion:VERSION,day:s.day,
          side:side===1?"LONG":"SHORT",signalIndex:confirm,entryIndex:entry,stop,
          boundary:side===-1?high:low,rangeHigh:high,rangeLow:low,
          breakoutIndex:i,retestIndex:ret,
          fixedTarget:roundTick((high+low)/2,side===1?"floor":"ceil"),
          explanation:"Opening-range excursion, immediate return, next-bar reversal confirmation"
        };
      }
      return {reason:"First qualified excursion did not return within two subsequent bars"};
    }
    return {reason:"No opening-range excursion within early entry window"};
  }
  function evaluate(s,c,options) {
    if(!c || !c.rule)return null;
    const direction=c.side==="LONG"?1:-1;
    const slip=options.slippageTicks*TICK;
    const rawEntry=s.bars[c.entryIndex].open;
    const entry=rawEntry+direction*slip;
    const initialRisk=direction*(entry-c.stop);
    if(initialRisk < TICK) return null;
    // Count one tick of price at a minimum; FBR target is the fixed OR midpoint.
    const intended= c.rule==="FBR-001" ? c.fixedTarget :
      roundTick(entry+direction*options.targetR*initialRisk,direction===1?"floor":"ceil");
    if(direction*(intended-entry)<TICK) return null;
    if(c.rule==="FBR-001" && direction*(intended-entry)<initialRisk) return null;
    let result=null;
    for(let i=c.entryIndex;i<SESSION_BARS;i++){
      const b=s.bars[i];
      let price=null,reason=null;
      const stopGap=direction===1?b.open<=c.stop:b.open>=c.stop;
      const stopHit=direction===1?b.low<=c.stop:b.high>=c.stop;
      const targetGap=direction===1?b.open>=intended:b.open<=intended;
      const targetHit=direction===1?b.high>=intended:b.low<=intended;
      if(stopGap){price=b.open-direction*slip;reason="STOP_GAP"}
      else if(stopHit){price=c.stop-direction*slip;reason="STOP"}
      else if(targetGap){price=intended-direction*slip;reason="TARGET_CONSERVATIVE"}
      else if(targetHit){price=intended-direction*slip;reason="TARGET"}
      else if(i===SESSION_BARS-1){price=b.close-direction*slip;reason="SESSION_EXIT"}
      if(price!==null){
        const grossUsd=direction*(price-entry)*POINT_USD;
        const netUsd=grossUsd-options.roundTripFeeUsd;
        const riskUsd=initialRisk*POINT_USD;
        result={
          rule:c.rule,version:VERSION,day:s.day,side:c.side,
          signalTime:s.bars[c.signalIndex].time,
          entryTime:s.bars[c.entryIndex].time,
          exitTime:b.time+BAR_MS,
          entry,stop:c.stop,target:intended,exit:price,exitIndex:i,
          exitReason:reason,
          initialRiskUsd:riskUsd,feesUsd:options.roundTripFeeUsd,
          grossUsd,netUsd,netR:netUsd/riskUsd,
          boundary:c.boundary,rangeHigh:c.rangeHigh,rangeLow:c.rangeLow,
          explanation:c.explanation,
          assumptions:"1 MES contract; start-of-bar UTC 5m; conservative OHLC stop-first; 08:30–11:00 CT",
        };
        break;
      }
    }
    return result;
  }
  function metrics(trades) {
    let equity=0,peak=0,dd=0,gains=0,losses=0,winning=0,netUsd=0,peakUsd=0,ddUsd=0;
    for(const t of trades) {
      equity+=t.netR;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);
      netUsd+=t.netUsd;peakUsd=Math.max(peakUsd,netUsd);ddUsd=Math.max(ddUsd,peakUsd-netUsd);
      if(t.netR>0){winning++;gains+=t.netR}
      else if(t.netR<0)losses+=-t.netR;
    }
    return {
      count:trades.length,winning,winRate:trades.length?winning/trades.length:null,
      expectancyR:trades.length?equity/trades.length:null,
      netR:equity,netUsd,
      maxClosedDrawdownR:dd,maxClosedDrawdownUsd:ddUsd,
      profitFactor:losses?gains/losses:null,
    };
  }
  function run(bars, opts={}) {
    const rule=opts.rule||"ORP-001";
    if(!Object.prototype.hasOwnProperty.call(RULES,rule))throw Error("Unknown strategy version");
    const slip=Number(opts.slippageTicks ?? 1);
    const fees=Number(opts.roundTripFeeUsd ?? 2.5);
    const target=Number(opts.targetR ?? 2);
    if(!Number.isFinite(slip)||slip<0||slip>20||
      !Number.isFinite(fees)||fees<0||fees>100||
      !Number.isFinite(target)||target<.5||target>6)
      throw Error("Invalid assumptions: slippage ticks, round-trip fee USD, or target R");
    const options={slippageTicks:slip,roundTripFeeUsd:fees,targetR:target};
    const source=opts.source || "user-csv-unverified";
    const {valid,excluded,scannedSessions}=sessionsFromBars(bars);
    const trades=[],noSignal=[];
    for(const session of valid){
      const c=rule==="ORP-001"?orpCandidate(session):fbrCandidate(session);
      if(!c.rule){noSignal.push({day:session.day,reason:c.reason});continue}
      const trade=evaluate(session,c,options);
      if(!trade){noSignal.push({day:session.day,reason:"Invalid risk/reward at next open or inadequate target distance"});continue}
      trades.push(trade); // One deterministic trade per complete cash session.
    }
    // Split by DAYS, not by rows, and withhold a transition session.
    const days=valid.map(x=>x.day);
    const cut=Math.floor(days.length*.7);
    const reserved=days.slice(Math.min(days.length,cut+1));
    const training=days.slice(0,Math.max(0,cut-1));
    const trainingDays=new Set(training),reserveDays=new Set(reserved);
    const trainTrades=trades.filter(x=>trainingDays.has(x.day));
    const reserveTrades=trades.filter(x=>reserveDays.has(x.day));
    return {
      schema:"trader.session-research.v1",status:"UNVERIFIED_RESEARCH_ONLY",
      rule,version:VERSION,instrument:"MES",venue:"CME",account:"NO_ACCOUNT",
      source,timezone:TZ,
      dataConvention:"Timestamps are 5-minute bar START UTC milliseconds; complete 08:30–11:00 CT sessions only",
      model:"Next bar open plus slippage; OHLC stop-first; gap stops adverse; one MES contract",
      assumptions:{...options,tickSize:TICK,pointValueUsd:POINT_USD},
      scannedSessions,completeSessions:valid.length,rejectedSessions:excluded,
      noSignal,allTrades:trades,train:metrics(trainTrades),
      reserve:metrics(reserveTrades),reserveTrades,
      split:{trainDays:training.length,reserveDays:reserved.length,excludedTransitionDays:valid.length-training.length-reserved.length,
        trainingThrough:training.at(-1)||null,reserveFrom:reserved[0]||null,
        reserveHasAdequateSample:reserved.length>=20},
      qualification:"None. Historic data provider, fees, contract roll, actual fills and out-of-sample sample size unverified.",
    };
  }
  root.TraderSessionEngine=Object.freeze({version:VERSION,rules:RULES,run,metrics,sessionsFromBars,orpCandidate,fbrCandidate});
})(typeof globalThis !== "undefined" ? globalThis : this);

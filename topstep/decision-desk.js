/* Trader Decision Desk — deterministic bridge, not a predictive signal engine.
 * Pure JS: same logic in browser and offline regression tests.
 * A model may explain this evidence; it never sets the status or price fields.
 */
(function(root){
"use strict";
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const fmt=n=>finite(n)?n.toLocaleString("en-US",{maximumFractionDigits:5}):"—";
function assess(input={}){
 const c=input.context,contract=input.contractId||"",tf=input.minutes;
 const base={source:input.synthetic?"SYNTHETIC_OFFLINE_FIXTURE":"TOPSTEPX_REST",
   status:"PAUSE",draftAllowed:false,side:null,entry:null,headline:"Check the data",
   summary:"Select an account and contract to see the market context.",
   caution:"This is research, not an order or an official Topstep rule check.",
   statsNote:"No setup-specific performance has been demonstrated.",
   candidateKey:null,level:null,confirmedAt:null,synthetic:!!input.synthetic};
 if(!contract||![1,5,15,30,60].includes(tf)||!c||c.status!=="OBSERVATION_ONLY"){
   base.summary=c?.status==="INSUFFICIENT_HISTORY"?"Need at least 22 completed bars.":"Select an active contract with completed candles.";
   return base;
 }
 if(!finite(c.confirmed_through_ms)||!finite(c.latest_complete_close)
   ||!finite(c.prior_20_high)||!finite(c.prior_20_low)||!finite(c.average_true_range_14)
   ||c.average_true_range_14<=0||c.prior_20_high<c.prior_20_low){
   base.summary="Broker candle context is incomplete or invalid.";
   return base;
 }
 const s=input.stats;
 if(s?.status==="UNAVAILABLE"||s?.coverage==="PARTIAL_OR_UNCERTAIN")
   base.statsNote="Trade history is incomplete; completed-trade statistics cannot establish an edge.";
 else if(s?.complete_trade_count>0)
   base.statsNote=s.complete_trade_count+" completed positions tracked in the selected history window; not labeled to this setup. No setup-specific edge measured.";
 const broken=!!c.completed_data_stale||!!c.gaps_in_last_20;
 const accountOk=input.accountFresh===true;
 const marketOk=input.quoteFresh===true;
 const isBreak=c.range_state==="ABOVE_PRIOR_RANGE"||c.range_state==="BELOW_PRIOR_RANGE";
 const side=c.range_state==="ABOVE_PRIOR_RANGE"?"LONG":c.range_state==="BELOW_PRIOR_RANGE"?"SHORT":null;
 const level=side==="LONG"?c.prior_20_high:side==="SHORT"?c.prior_20_low:null;
 base.candidateKey=[base.source,contract,tf,c.confirmation_bar_start_ms,c.range_state].join("|");
 base.confirmedAt=c.confirmed_through_ms;
 base.level=level;
 base.side=side;
 base.entry=c.latest_complete_close;
 if(broken){
   base.headline="Data quality needs attention";
   base.summary=c.gaps_in_last_20?"Missing candles in the 20-bar reference.":"The last completed candle is too old.";
   base.caution="Do not interpret stale or discontinuous bars as a current setup.";
   return base;
 }
 if(!accountOk||!marketOk){
   base.headline="Verify account and live market";
   base.summary=(!accountOk?"Account sync is missing or stale. ":"")+
     (!marketOk?"Live quote is disconnected or stale.":"");
   base.caution="Structure can be reviewed historically, but current readiness is not verified.";
   return base;
 }
 if(!isBreak){
   base.status="WATCH";
   base.headline="Wait for a completed-bar change";
   base.summary="Last "+tf+"m close "+fmt(c.latest_complete_close)+" is inside the previous 20-bar range ("+fmt(c.prior_20_low)+"–"+fmt(c.prior_20_high)+").";
   base.caution="No range-break observation. Wait for a confirmed completed candle; do not chase the forming candle.";
   return base;
 }
 base.status="REVIEW";
 base.headline=side==="LONG"?"Range break observed above":"Range break observed below";
 base.summary="Completed "+tf+"m candle closed at "+fmt(c.latest_complete_close)+", "+
   (side==="LONG"?"above prior high ":"below prior low ")+fmt(level)+".";
 base.caution="Structural observation only. No validated expectancy, liquidity, margin, Topstep loss-limit clearance or automatic entry.";
 const meta=input.contractSpec;
 base.draftAllowed=!!(meta&&finite(meta.tickSize)&&meta.tickSize>0&&
                         finite(meta.tickValue)&&meta.tickValue>0);
 return base;
}
function draft(assessment,context,spec){
 if(!assessment||assessment.status!=="REVIEW"||!assessment.draftAllowed||
    !context||!spec||!finite(context.average_true_range_14)){
   throw Error("Verified, tick-aware structure is required to draft a plan");
 }
 const tick=spec.tickSize;
 const direction=assessment.side==="LONG"?1:assessment.side==="SHORT"?-1:0;
 if(!direction||!finite(tick)||tick<=0)throw Error("Invalid contract tick size");
 const entry=Math.round(assessment.entry/tick)*tick;
 const riskTicks=Math.max(4,Math.ceil(context.average_true_range_14/tick));
 const round=n=>Number(n.toFixed(8));
 return {side:assessment.side,entry:round(entry),
   stop:round(entry-direction*riskTicks*tick),
   target:round(entry+direction*2*riskTicks*tick),
   basis:"ILLUSTRATIVE_ATR_NOT_VALIDATED",
   disclaimer:"Illustrative one-ATR stop and two-ATR target. Inspect and edit before making any personal trading decision."};
}
root.TraderDecision=Object.freeze({assess,draft});
})(typeof globalThis!=="undefined"?globalThis:this);

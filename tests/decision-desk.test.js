import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source=readFileSync(new URL("../topstep/decision-desk.js",import.meta.url),"utf8");
const ctx={};runInNewContext(source,ctx);
const desk=ctx.TraderDecision;
const context={
  status:"OBSERVATION_ONLY",range_state:"ABOVE_PRIOR_RANGE",
  confirmation_bar_start_ms:1700000000000,confirmed_through_ms:1700000300000,
  latest_complete_close:6002,prior_20_high:6001,prior_20_low:5985,
  average_true_range_14:4,completed_data_stale:false,gaps_in_last_20:0,
};
const spec={tickSize:.25,tickValue:1.25};
const input={context,contractId:"CON.F.US.MES.Z26",minutes:5,
  synthetic:true,accountFresh:true,quoteFresh:true,contractSpec:spec,
  stats:{complete_trade_count:12,coverage:"MATCHED_IN_FETCH_WINDOW"},
  positionCount:0,orderCount:0,accountCanTrade:false};

test("range break gives a review observation, not an order or a confidence score",()=>{
 const r=desk.assess(input);
 assert.equal(r.status,"REVIEW");
 assert.equal(r.side,"LONG");
 assert.equal(r.draftAllowed,true);
 assert.equal(r.level,6001);
 assert.match(r.statsNote,/not labeled to this setup/i);
 assert.equal("confidence" in r,false);
 assert.equal("execute" in r,false);
});
test("inside range is watch, not a forced trade",()=>{
 const r=desk.assess({...input,context:{...context,range_state:"INSIDE_PRIOR_RANGE"}});
 assert.equal(r.status,"WATCH");
 assert.equal(r.draftAllowed,false);
});
test("missing account or market evidence blocks readiness",()=>{
 for(const patch of [{accountFresh:false},{quoteFresh:false}]){
   const r=desk.assess({...input,...patch});
   assert.equal(r.status,"PAUSE");
   assert.equal(r.draftAllowed,false);
 }
});
test("stale or discontinuous candles block plans",()=>{
 for(const patch of [{completed_data_stale:true},{gaps_in_last_20:2}]){
   const r=desk.assess({...input,context:{...context,...patch}});
   assert.equal(r.status,"PAUSE");
   assert.equal(r.draftAllowed,false);
 }
});
test("exposure and real account ineligibility block plans",()=>{
 assert.equal(desk.assess({...input,positionCount:1}).status,"PAUSE");
 assert.equal(desk.assess({...input,orderCount:1}).status,"PAUSE");
 assert.equal(desk.assess({...input,synthetic:false,accountCanTrade:false}).status,"PAUSE");
});
test("unknown contract metadata blocks draft even on a confirmed range break",()=>{
 const r=desk.assess({...input,contractSpec:null});
 assert.equal(r.status,"REVIEW");
 assert.equal(r.draftAllowed,false);
 assert.throws(()=>desk.draft(r,context,spec),/Verified/);
});
test("illustrative ATR plan is tick-aligned and explicitly unvalidated",()=>{
 const r=desk.assess(input);
 const p=desk.draft(r,context,spec);
 assert.equal(p.entry,6002);
 assert.equal(p.stop,5998);
 assert.equal(p.target,6010);
 assert.equal(p.basis,"ILLUSTRATIVE_ATR_NOT_VALIDATED");
 assert.match(p.disclaimer,/edit/);
});
test("short-side illustrative plan mirrors long-side ATR stop",()=>{
 const c={...context,range_state:"BELOW_PRIOR_RANGE",latest_complete_close:5984};
 const r=desk.assess({...input,context:c});
 const p=desk.draft(r,c,spec);
 assert.equal(r.side,"SHORT");
 assert.equal(p.entry,5984);
 assert.equal(p.stop,5988);
 assert.equal(p.target,5976);
});
test("incomplete trade stats are not claimed as setup expectancy",()=>{
 const r=desk.assess({...input,stats:{coverage:"PARTIAL_OR_UNCERTAIN",
   complete_trade_count:30,win_rate:.9}});
 assert.match(r.statsNote,/incomplete/i);
 assert.doesNotMatch(r.statsNote,/90%|confidence|probability/);
});
test("missing candle context pauses and does not invent figures",()=>{
 const r=desk.assess({...input,context:null});
 assert.equal(r.status,"PAUSE");
 assert.equal(r.entry,null);
 assert.equal(r.draftAllowed,false);
});

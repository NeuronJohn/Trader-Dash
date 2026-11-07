import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const code = readFileSync(new URL("../topstep/risk-plan.js", import.meta.url), "utf8");
const ctx = {};
runInNewContext(code, ctx);
const risk = ctx.TraderRisk;
const sample = {
  side: "LONG", entry: 6000, stop: 5995, target: 6010,
  tickSize: 0.25, tickValue: 1.25, budgetUsd: 100,
  feeRoundTripUsd: 3, slippageTicksPerSide: 1, maxContracts: 10, quantity: 2,
};

test("MES: complete downside, round-trip fee/slippage and max affordable size", () => {
  const result = risk.analyze(sample);
  assert.equal(result.riskEachUsd, 30.5);
  assert.equal(result.rewardEachUsd, 44.5);
  assert.equal(result.riskUsd, 61);
  assert.equal(result.rewardUsd, 89);
  assert.equal(result.maxByBudget, 3);
  assert.equal(result.suggestedQuantity, 3);
  assert.equal(result.status, "PLAN_WITHIN_SELF_LIMITS");
  assert.equal(result.execution, false);
});

test("long and short mirror the same absolute tick distances", () => {
  const a = risk.analyze(sample);
  const b = risk.analyze({...sample, side:"SHORT", stop:6005, target:5990});
  assert.equal(b.riskEachUsd, a.riskEachUsd);
  assert.equal(b.rewardEachUsd, a.rewardEachUsd);
  assert.equal(b.stopTicks, 20);
  assert.equal(b.targetTicks, 40);
});

test("requested size above self-limit never gets accepted", () => {
  const a = risk.analyze({...sample, quantity:4});
  assert.equal(a.status, "REVIEW_REQUIRED");
  assert.equal(a.riskUsd, 122);
  assert.equal(a.suggestedQuantity, 3);
});

test("unfavorable reward after costs flags review", () => {
  const a = risk.analyze({...sample, target:6000.25});
  assert.equal(a.status, "REVIEW_REQUIRED");
  assert.ok(a.rewardEachUsd < 0);
});

test("tick misalignment and invalid stop directions fail closed", () => {
  assert.throws(()=>risk.analyze({...sample, entry:6000.1}), /tick size/);
  assert.throws(()=>risk.analyze({...sample, stop:6005}), /loss side/);
  assert.throws(()=>risk.analyze({...sample, target:5998}), /profit side/);
});

test("unsupported quantity/limits and empty budget rejected", () => {
  assert.throws(()=>risk.analyze({...sample,quantity:1.5}),/quantity/);
  assert.throws(()=>risk.analyze({...sample,budgetUsd:NaN}),/positive/);
  assert.throws(()=>risk.analyze({...sample,maxContracts:0}),/maximum/);
  assert.throws(()=>risk.analyze({...sample,slippageTicksPerSide:-1}),/slippage/);
});

test("zero fees and zero slippage are supported explicitly", () => {
  const a = risk.analyze({...sample,feeRoundTripUsd:0,slippageTicksPerSide:0});
  assert.equal(a.riskEachUsd,25);
  assert.equal(a.rewardEachUsd,50);
});

test("budget below one-contract risk produces zero allowable quantity",()=>{
  const a=risk.analyze({...sample,budgetUsd:10});
  assert.equal(a.suggestedQuantity,0);
  assert.equal(a.status,"REVIEW_REQUIRED");
});

test("fractional tick sizes work for exchange FX futures",()=>{
  const a=risk.analyze({...sample,entry:1.0800,stop:1.0790,target:1.0820,
    tickSize:0.00005,tickValue:6.25,budgetUsd:2000});
  assert.equal(a.stopTicks,20);
  assert.equal(a.targetTicks,40);
});

test("risk worksheet never returns an order request",()=>{
  const a=risk.analyze(sample);
  assert.equal(a.planningOnly,true);
  assert.equal(a.source,"PERSONAL_RISK_WORKSHEET_NOT_BROKER_RULES");
  assert.ok(!Object.hasOwn(a,"orderId"));
});

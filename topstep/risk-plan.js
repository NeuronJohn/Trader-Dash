/* Pure, read-only futures risk worksheet. Browser + Node use the same function.
 * User budgets are personal planning caps, NOT Topstep rule compliance.
 */
(function(root){
"use strict";
function valid(n,nonnegative=false){
  return typeof n==="number" && Number.isFinite(n) && (nonnegative?n>=0:n>0);
}
function aligned(price,tick){
  if(!valid(price)||!valid(tick))return false;
  const ticks=price/tick;
  return Math.abs(ticks-Math.round(ticks))<1e-6;
}
function round(n,places=4){
  return Math.round((n+Number.EPSILON)*10**places)/10**places;
}
function analyze(input){
  if(!input||typeof input!=="object")throw Error("Missing trade plan");
  const {entry,stop,target,tickSize,tickValue,budgetUsd,feeRoundTripUsd,
    slippageTicksPerSide,maxContracts,quantity,side}=input;
  if(side!=="LONG"&&side!=="SHORT")throw Error("Choose Long or Short");
  if(![entry,stop,target,tickSize,tickValue,budgetUsd].every(x=>valid(x)))throw Error("Enter positive, finite prices, contract tick specs and a personal risk budget");
  if(!valid(feeRoundTripUsd,true)||!valid(slippageTicksPerSide,true)||slippageTicksPerSide>25)
    throw Error("Invalid fees or slippage assumption");
  if(!Number.isSafeInteger(maxContracts)||maxContracts<1||maxContracts>1000)
    throw Error("Set a realistic maximum contract count");
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)
    throw Error("Choose a positive integer quantity");
  if(![entry,stop,target].every(x=>aligned(x,tickSize)))
    throw Error("Entry, stop and target must align with the contract tick size");
  const direction=side==="LONG"?1:-1;
  const stopTicks=round(direction*(entry-stop)/tickSize,8);
  const targetTicks=round(direction*(target-entry)/tickSize,8);
  if(stopTicks<=0)throw Error("Stop must be on the loss side of entry");
  if(targetTicks<=0)throw Error("Target must be on the profit side of entry");
  const entryExitSlippage=2*slippageTicksPerSide;
  const riskEach=round((stopTicks+entryExitSlippage)*tickValue+feeRoundTripUsd,4);
  const rewardEach=round((targetTicks-entryExitSlippage)*tickValue-feeRoundTripUsd,4);
  if(!valid(riskEach))throw Error("Invalid effective risk");
  const maxByBudget=Math.max(0,Math.min(1000,Math.floor((budgetUsd+1e-8)/riskEach)));
  const suggestedQuantity=Math.min(maxByBudget,maxContracts);
  const estimatedRisk=round(quantity*riskEach,2);
  const estimatedReward=round(quantity*rewardEach,2);
  const ratio=round(rewardEach/riskEach,3);
  const issues=[];
  if(quantity>maxContracts)issues.push("Requested size exceeds the user-entered contract cap");
  if(estimatedRisk>budgetUsd+1e-7)issues.push("Estimated downside exceeds the personal risk budget");
  if(rewardEach<=0)issues.push("Estimated reward is nonpositive after costs");
  return {
    status:issues.length?"REVIEW_REQUIRED":"PLAN_WITHIN_SELF_LIMITS",
    source:"PERSONAL_RISK_WORKSHEET_NOT_BROKER_RULES",
    planningOnly:true,execution:false,
    stopTicks,targetTicks,
    riskEachUsd:riskEach,rewardEachUsd:rewardEach,
    riskUsd:estimatedRisk,rewardUsd:estimatedReward,rewardRiskRatio:ratio,
    suggestedQuantity,maxByBudget,quantity,
    feeRoundTripUsd,slippageTicksPerSide,
    issues,
    limitations:[
      "Uses hypothetical entry, target, stop and constant slippage; a stop order does not guarantee this fill",
      "Excludes actual account-level drawdown, margin, open positions, pending orders and Topstep loss-limit rules",
      "A valid risk worksheet does not establish a trading edge or justify execution"
    ]
  };
}
root.TraderRisk=Object.freeze({analyze,aligned});
})(typeof globalThis!=="undefined"?globalThis:this);

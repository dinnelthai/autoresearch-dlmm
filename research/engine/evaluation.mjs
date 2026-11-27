// Extracted from the offline research engine; calculations unchanged.
import {EPS,clone,sum,assert,price,cvar} from './numeric.mjs';
import {nav,reportAt} from './accounting.mjs';
import {fresh,classify} from './market.mjs';
import {risk} from './risk.mjs';
import {applyAction} from './liquidity.mjs';
import {event,executePending,submit} from './events.mjs';
function evaluate(s,c,action,scenarios,{mappedStart=null}={}){
  let start;
  try{
    assert(fresh(s,c),'REFERENCE_UNAVAILABLE_OR_STALE');
    assert(Array.isArray(scenarios)&&scenarios.length>0&&scenarios.every(v=>Array.isArray(v.events)&&v.events.length>0),'SCENARIO_SAMPLE_EMPTY');
    const p=s.market.ref.price,base=nav(s,p),out=[];
    assert(Number.isFinite(base)&&base>0,'SCENARIO_BASE_INVALID');
    start=clone(mappedStart??s);start.pending=null;
    if(mappedStart){assert(start.pool===s.pool&&start.lastTime===s.lastTime&&start.initialNav===s.initialNav&&start.baseline.x===s.baseline.x&&start.baseline.y===s.baseline.y&&nav(start,p)<=base+EPS&&start.cost>=s.cost,'MAPPED_SCENARIO_STATE_INVALID');}
    else applyAction(start,c,action,s.lastTime);
    const g=classify(start,c),rr=risk(start,c,p);
    if(["OPEN","ADD","REPOSITION"].includes(action.type)){
      if(!start.bins.length)throw Error("EMPTY_DEPLOYMENT");
      if(scenarios.some(v=>v.volumeDiagnostic&&(!v.volumeDiagnostic.flowWindowSeconds||v.volumeDiagnostic.modeledVolumeSol<=0)))throw Error("FORECAST_VOLUME_EVIDENCE_UNAVAILABLE");
      if(scenarios.some(v=>v.volumeDiagnostic&&(v.volumeDiagnostic.missingLiquiditySteps>0||v.volumeDiagnostic.missingCrossedBins>0)))throw Error('FORECAST_LIQUIDITY_COVERAGE_INCOMPLETE');
      if(start.turnover+start.rebalanceTurnover>c.maxTurnoverSol||start.rebalances>c.maxRebalances)throw Error("REBALANCE_BUDGET");
      if(["UNKNOWN","STRESS","DISTRIBUTION_RANGE","DEAD_RANGE"].includes(g.regime)||g.flags.includes("HOLDER_CONCENTRATION"))throw Error("MARKET_ADMISSION");
      if(g.flags.includes("TOXIC_BID")&&sum(start.bins.map(b=>b.y))>EPS)throw Error("TOXIC_BID");
      if(g.flags.includes("TOXIC_ASK")&&sum(start.bins.map(b=>b.x))>EPS)throw Error("TOXIC_ASK");
    }
    if(rr.violations.length)throw Error(rr.violations.join(","));
    for(const scenario of scenarios){
      const sim=clone(mappedStart?start:s);sim.pending=null;sim.seen=[];sim.lastTime=s.lastTime;sim.quality=[];
      if(!mappedStart&&!["HOLD","NO_LP"].includes(action.type))submit(sim,c,action,s.lastTime);
      // Observe pre/post-action path, not just the terminal mark. Existing passive
      // exposure remains a comparator even when a hypothetical shock violates limits.
      let minNav=base,peakNav=base,maxDrawdownSol=0,maxInventoryRatio=0,maxInventoryTokens=0,minWalletSol=Infinity,maxStressLossSol=0,minExitHeadroomSol=Infinity,observations=0,unobserved=0;
      const pathViolations=new Set(),fillStats={swapCount:0,eligibleCount:0,filledCount:0,inventoryLimitedCount:0,requestedNotionalSol:0,filledNotionalSol:0};
      function observe(){
        if(!fresh(sim,c)){unobserved++;return;}
        const px=sim.market.ref.price,v=nav(sim,px),r=risk(sim,c,px),headroom=r.exitExposure.prospectiveHeadroomSol;
        assert([v,r.worstRatio,r.postX,sim.wallet.y,r.stressLoss,headroom].every(Number.isFinite),'SCENARIO_PATH_NONFINITE');
        minNav=Math.min(minNav,v);peakNav=Math.max(peakNav,v);maxDrawdownSol=Math.max(maxDrawdownSol,peakNav-v);
        maxInventoryRatio=Math.max(maxInventoryRatio,r.worstRatio);maxInventoryTokens=Math.max(maxInventoryTokens,r.postX);
        minWalletSol=Math.min(minWalletSol,sim.wallet.y);maxStressLossSol=Math.max(maxStressLossSol,r.stressLoss);minExitHeadroomSol=Math.min(minExitHeadroomSol,headroom);observations++;
        for(const v of r.violations)pathViolations.add(v);
      }
      observe();
      for(const e of scenario.events){const fill=event(sim,c,e);if(e.type==='SWAP'&&fill){fillStats.swapCount++;if(fill.requestedBaseQty>0){fillStats.eligibleCount++;const px=price(c,e.bin);fillStats.requestedNotionalSol+=fill.requestedBaseQty*px;fillStats.filledNotionalSol+=fill.filledBaseQty*px;if(fill.filledBaseQty>0)fillStats.filledCount++;if(['INVENTORY_LIMITED','INVENTORY_UNAVAILABLE'].includes(fill.status))fillStats.inventoryLimitedCount++;}}observe();executePending(sim,c,e.t);observe();}

      if(sim.pending||sim.receipts.slice(s.receipts.length).some(r=>["REJECTED","FAILED","EXPIRED","PARTIAL"].includes(r.status)))throw Error("SCENARIO_EXECUTION_UNAVAILABLE");
      assert(fresh(sim,c),'SCENARIO_END_REFERENCE_UNAVAILABLE');
      assert(!unobserved,'SCENARIO_PATH_REFERENCE_UNAVAILABLE');
      const end=reportAt(sim,sim.market.ref.price),before=reportAt(s,sim.market.ref.price);
      assert([end.nav,end.alpha,end.ratio,end.fee,end.cost,before.alpha,before.fee,before.cost].every(Number.isFinite),'SCENARIO_NONFINITE_OUTPUT');
      if(sim.quality.some(q=>q.reason==="FROZEN_PATH_SHARE_LIMIT"))throw Error("FROZEN_PATH_SHARE_LIMIT");
      out.push({name:scenario.name,incrementalAlpha:end.alpha-before.alpha,pnl:end.nav-base,loss:Math.max(0,base-minNav),terminalLoss:Math.max(0,base-end.nav),ratio:end.ratio,fee:end.fee-before.fee,cost:end.cost-before.cost,fillDiagnostics:{...fillStats,filledNotionalFraction:fillStats.requestedNotionalSol>0?fillStats.filledNotionalSol/fillStats.requestedNotionalSol:null,basis:'SYNTHETIC_PARTICIPATION_NOT_PROBABILITY'},pathRisk:{minNav,maxDrawdownSol,maxInventoryRatio,maxInventoryTokens,minWalletSol,maxStressLossSol,minExitHeadroomSol,observations,violations:[...pathViolations]}});
    }
    const mean=fn=>sum(out.map(fn))/out.length,tail=cvar(out.map(a=>a.loss),c.beta),terminalCvar=cvar(out.map(a=>a.terminalLoss),c.beta),utility=mean(a=>a.incrementalAlpha)-c.lambda*tail-c.kappaSol*mean(a=>(a.ratio-c.targetRatio)**2);
    assert(Number.isFinite(utility)&&Number.isFinite(tail),'SCENARIO_NONFINITE_SCORE');
    return {action,feasible:true,...(mappedStart?{scoreBasis:'MAPPED_IMMEDIATE_ACTION_SCENARIOS'}:{}),utility,expectedPnl:mean(a=>a.pnl),expectedAlpha:mean(a=>a.incrementalAlpha),expectedFee:mean(a=>a.fee),expectedOperationCost:mean(a=>a.cost),cvar:tail,terminalCvar,pathRisk:{lossBasis:'MAX_LOSS_FROM_INITIAL_NAV_ALONG_SAMPLED_PATH',breachScenarioCount:out.filter(a=>a.pathRisk.violations.length).length,scenarioCount:out.length,maxDrawdownSol:Math.max(...out.map(a=>a.pathRisk.maxDrawdownSol)),maxInventoryRatio:Math.max(...out.map(a=>a.pathRisk.maxInventoryRatio)),maxInventoryTokens:Math.max(...out.map(a=>a.pathRisk.maxInventoryTokens)),minWalletSol:Math.min(...out.map(a=>a.pathRisk.minWalletSol)),maxStressLossSol:Math.max(...out.map(a=>a.pathRisk.maxStressLossSol)),minExitHeadroomSol:Math.min(...out.map(a=>a.pathRisk.minExitHeadroomSol)),violations:[...new Set(out.flatMap(a=>a.pathRisk.violations))]},volumeDiagnostics:scenarios.map(v=>v.volumeDiagnostic??null),fillDiagnostics:out.map(v=>({name:v.name,...v.fillDiagnostics})),scenarios:out,allocation:clone(start.bins),allocationLabel:"IMMEDIATE_PLAN_PREVIEW_NOT_EXECUTION",risk:rr};
  }catch(err){return {action,feasible:false,reason:err.message}}
}
// Matched scenario difference; costs already included in net NAV, never deduct twice.
function compareWithHold(candidate,hold,c){
  if(!candidate?.feasible||!hold?.feasible||!Array.isArray(candidate.scenarios)||!Array.isArray(hold.scenarios)||!candidate.scenarios.length||candidate.scenarios.length!==hold.scenarios.length)return {status:'HOLD_COMPARISON_UNAVAILABLE',eligible:false};
  const rows=candidate.scenarios.map((x,i)=>{const h=hold.scenarios[i];if(x.name!==h.name||![x.pnl,h.pnl,x.cost,h.cost,x.fee,h.fee].every(Number.isFinite))return null;const net=x.pnl-h.pnl,cost=x.cost-h.cost;return {name:x.name,netPnlDeltaSol:net,grossBeforeOperationCostDeltaSol:net+cost,operationCostDeltaSol:cost,feeDeltaSol:x.fee-h.fee}});
  if(rows.some(x=>!x)||!Number.isFinite(candidate.utility)||!Number.isFinite(hold.utility))return {status:'HOLD_COMPARISON_UNAVAILABLE',eligible:false};
  const mean=k=>sum(rows.map(x=>x[k]))/rows.length,net=mean('netPnlDeltaSol'),cost=mean('operationCostDeltaSol'),gross=mean('grossBeforeOperationCostDeltaSol'),utilityDelta=candidate.utility-hold.utility,margin=c.minImprovementSol+c.uncertaintySol;
  return {status:'MATCHED_SYNTHETIC_HOLD_COMPARISON',eligible:net>EPS&&utilityDelta>margin,netPnlDeltaSol:net,grossBeforeOperationCostDeltaSol:gross,operationCostDeltaSol:cost,feeDeltaSol:mean('feeDeltaSol'),utilityDelta,requiredUtilityMarginSol:margin,positiveNetScenarioCount:rows.filter(x=>x.netPnlDeltaSol>EPS).length,scenarioCount:rows.length,rows,costBasis:'DECLARED_LOGICAL_OPERATION_AGGREGATE_ALREADY_IN_NET_NAV'};
}
export {evaluate,compareWithHold};

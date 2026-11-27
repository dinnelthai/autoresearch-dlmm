// Extracted from the offline research engine; calculations unchanged.
import {EPS} from './numeric.mjs';
import {balances} from './accounting.mjs';
import {fresh,classify,marketAdmission,referenceUncertainty} from './market.mjs';
import {risk} from './risk.mjs';
import {forecast} from './forecast.mjs';
import {evaluate,compareWithHold} from './evaluation.mjs';
function candidatePlans(s,c,mode="adaptive"){
  const g=classify(s,c),open=s.bins.length>0,plans=[{type:open?"HOLD":"NO_LP"}];
  if(open)plans.push({type:"REDUCE",fraction:.5},{type:"REMOVE_AND_HOLD"});
  if(s.allowDispose&&balances(s).x>EPS)plans.push({type:"REMOVE_AND_DISPOSE"});
  const shapes=mode==="adaptive"?["spot","curve","bid_ask","hybrid","asymmetric"]:[mode==="asymmetric"?"asymmetric":mode];
  for(const shape of shapes)for(const width of (mode==="adaptive"?[2,4,8]:[4]))for(const size of (mode==="adaptive"?[.5,1]:[1])){
    const isAsym=shape==="asymmetric";
    const spec={shape:isAsym?"hybrid":shape,width,bidFraction:g.regime==="DOWNTREND"||g.flags.includes("TOXIC_BID")?0:size,askFraction:g.flags.includes("TOXIC_ASK")?0:isAsym&&g.regime==="UPTREND"?.25*size:.7*size,active:shape==="curve"?.2:shape==="spot"?.1:0,alphaBid:isAsym?.75:.5,alphaAsk:isAsym?.25:.5,skewBid:isAsym?-1:0,skewAsk:isAsym?1:0};
    const action={type:open?"REPOSITION":"OPEN",label:shape,spec};plans.push(action);
    if(!open&&balances(s).x<EPS&&s.wallet.y>c.minSolReserve)plans.push({...action,acquireSol:(s.wallet.y-c.minSolReserve)*.25,label:shape+"+initial_inventory"});
  }
  if(mode==="adaptive")for(const a of [0,.25,.5,.75,1])for(const b of [0,.25,.5,.75,1]){plans.push({type:open?"REPOSITION":"OPEN",label:"hybrid_grid",spec:{shape:"hybrid",width:4,bidFraction:g.regime==="DOWNTREND"||g.flags.includes("TOXIC_BID")?0:.5,askFraction:g.flags.includes("TOXIC_ASK")?0:.5,alphaBid:a,alphaAsk:b,active:0}})}
  return plans;
}
// Shared economic selection; callers retain their own execution and protective gates.
// Stable ranking preserves candidate order on equal scores.
function selectByUtility(rows,base,c,{scoreKey='utility',requireBaseline=true}={}){
  const valid=r=>r?.feasible===true&&Number.isFinite(r[scoreKey]);
  const baseline=valid(base)?base:null;
  if(requireBaseline&&!baseline)return null;
  const ranked=rows.filter(r=>r!==base&&valid(r)).sort((a,b)=>b[scoreKey]-a[scoreKey]);
  const best=ranked[0];
  if(!baseline)return best??null;
  return best&&best[scoreKey]-baseline[scoreKey]>c.minImprovementSol+c.uncertaintySol?best:baseline;
}
function decide(s,c,mode="adaptive"){
  if(!fresh(s,c))return {action:{type:s.bins.length?"REMOVE_AND_HOLD":"NO_LP"},reason:"UNKNOWN_REFERENCE",candidates:[],regime:"UNKNOWN"};
  const g=classify(s,c),p=s.market.ref.price,r=risk(s,c,p);
  if(g.regime==="UNKNOWN"&&!r.violations.length&&!g.flags.includes("HOLDER_CONCENTRATION"))return {action:{type:s.bins.length?"HOLD":"NO_LP"},reason:"WARMUP_OR_INSUFFICIENT_FEATURES",regime:g.regime,risk:r,candidates:[]};
  if(!marketAdmission(g)){
    return {action:{type:s.bins.length?"REMOVE_AND_HOLD":"NO_LP"},reason:"MARKET_GATE",regime:g.regime,risk:r,candidates:[]};
  }
  const sc=forecast(s,c),results=candidatePlans(s,c,mode).map(a=>evaluate(s,c,a,sc)),base=results[0];
  for(const row of results)if(row.action.type==='REPOSITION'&&row.feasible){row.holdComparison=compareWithHold(row,base,c);if(!row.holdComparison.eligible){row.feasible=false;row.reason='REPOSITION_NET_ADVANTAGE_NOT_ESTABLISHED';}}
  const feasible=results.filter(a=>a.feasible).sort((a,b)=>b.utility-a.utility);
  if(!s.bins.length&&!base?.feasible)return {action:{type:'NO_LP'},reason:'BASELINE_UNAVAILABLE_NO_DEPLOYMENT',regime:g.regime,risk:r,candidates:results};
  if(!feasible.length)return {action:{type:s.bins.length?"REMOVE_AND_HOLD":"NO_LP"},reason:"RISK_BLOCKED",regime:g.regime,risk:r,candidates:results};
  let best=selectByUtility(results,base,{...c,uncertaintySol:referenceUncertainty(s,c)},{requireBaseline:!s.bins.length});
  if(best.action.type==="REPOSITION"&&(s.market.t-s.lastActionTime<c.cooldownSeconds||s.rebalances>=c.maxRebalances||s.turnover+s.rebalanceTurnover>=c.maxTurnoverSol)){if(base.feasible)best=base;else best=feasible.find(v=>v.action.type!=="REPOSITION")||{action:{type:"REMOVE_AND_HOLD"},feasible:false,reason:"REBALANCE_BUDGET"};}
  return {action:best.action,reason:best===base?"BASELINE_WINS_OR_MARGIN":"MAX_FEASIBLE_UTILITY",regime:g.regime,risk:r,selected:best,candidates:results,forecastLabel:"SYNTHETIC_EQUAL_WEIGHT_SCENARIOS_NOT_CALIBRATED"};
}
export {candidatePlans,decide,selectByUtility};

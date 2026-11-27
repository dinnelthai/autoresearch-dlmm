// T09 new-position research previews only. No SDK transaction, token conversion or live execution.
import {Engine} from '../engine.mjs';
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
const sum=(a,k)=>a.reduce((s,b)=>s+b[k],0);
const BASE='NO_LP';
export function previewPlans(model,cfg,market,{asOf,checkAllocation=null}){
 const result={status:'BLOCKED',decisionReady:false,executionReady:false,selected:null,candidates:[],reason:null,forecastLabel:'SYNTHETIC_EQUAL_WEIGHT_SCENARIOS_NOT_CALIBRATED',volumeBasis:'EXPLICIT_FLOW_WINDOW_FROZEN_TARGET_BIN_PROXY',allocationLabel:'FLOATING_POINT_RESEARCH_PREVIEW_NOT_PROTOCOL_AMOUNTS',scope:'NEW_POSITION_ONLY'};
 const block=reason=>({...result,reason});
 if(model.bins.length||model.status!=='FLAT')return block('EXISTING_POSITION_REQUIRES_T10');
 if(!model.market?.ref?.valid||!Number.isSafeInteger(asOf)||asOf<model.lastTime||asOf>model.market.ref.expiresAt||asOf-model.market.t>cfg.maxReferenceAge)return block('REFERENCE_UNAVAILABLE_OR_STALE');
 const g=Engine.classify(model,cfg),p=model.market.ref.price;
 result.currentRisk=Engine.risk(model,cfg,p);result.alerts=[...new Set([...g.flags,...result.currentRisk.violations])];result.regime=g.regime;
 if(!['HEALTHY_RANGE','UPTREND','DOWNTREND'].includes(g.regime)||g.flags.includes('HOLDER_CONCENTRATION'))return block('MARKET_ADMISSION:'+g.regime);
 assert(Number.isInteger(market.activeId)&&Array.isArray(market.bins),'market bin metadata required');
 if(Engine.binId(cfg,p)!==market.activeId)return block('REFERENCE_AND_ACTIVE_BIN_MISMATCH');
 const known=new Map(market.bins.map(b=>[b.binId,b]));
 const scenarios=Engine.forecast(model,cfg);
 const actions=Engine.candidatePlans(model,cfg,'adaptive').filter(a=>a.type===BASE||(a.type==='OPEN'&&!a.acquireSol));
 const rows=[];
 for(const action of actions){
  const row={family:action.type===BASE?BASE:action.label,action,feasible:false,reason:null,score:null,allocation:null};
  let v,bins;
  if(checkAllocation&&action.type==='OPEN'){
   try{const trial=structuredClone(model);Engine.applyAction(trial,cfg,action,trial.lastTime);bins=trial.bins}catch(e){row.reason=String(e.message).slice(0,180);rows.push(row);continue}
  }else{
   v=Engine.evaluate(model,cfg,action,scenarios);if(!v.feasible){row.reason=v.reason;rows.push(row);continue}bins=v.allocation??[];
  }
  if(action.type==='OPEN'){
   if(!bins.length){row.reason='EMPTY_ALLOCATION';rows.push(row);continue;}
   // A known active-side placement and observed external liquidity are prerequisites.
   let reason=null;
   for(const b of bins){
    if(!Number.isInteger(b.id)||!finite(b.x)||!finite(b.y)||!finite(b.liquidity)||b.x<0||b.y<0||b.liquidity<=0){reason='INVALID_ALLOCATION';break;}
    if((b.id<market.activeId&&b.x>0)||(b.id>market.activeId&&b.y>0)){reason='WRONG_ACTIVE_BIN_SIDE';break;}
    if(!known.has(b.id)){reason='BIN_NOT_OBSERVED';break;}
    const ext=model.poolBins[b.id];
    if(!finite(ext)||ext<=0||b.liquidity/(b.liquidity+ext)>cfg.maxBinShare){reason='OBSERVED_BIN_SHARE_LIMIT';break;}
   }
   if(reason){row.reason=reason;rows.push(row);continue;}
   const x=sum(bins,'x'),y=sum(bins,'y');
   if(x>model.wallet.x+1e-9||y+cfg.minSolReserve+cfg.operationCostSol>model.wallet.y+1e-9){row.reason='DECLARED_BUDGET_EXCEEDED';rows.push(row);continue;}
  }
  row.feasible=true;row.allocation={bidSol:sum(bins,'y'),askMeme:sum(bins,'x'),lowerBinId:bins.length?Math.min(...bins.map(b=>b.id)):null,upperBinId:bins.length?Math.max(...bins.map(b=>b.id)):null,bins:bins.map(b=>({binId:b.id,priceSolPerMeme:Engine.price(cfg,b.id),meme:b.x,sol:b.y}))};
  try{
   if(checkAllocation&&action.type==='OPEN'){const {modelStart,...summary}=checkAllocation(row);row.integerMapping=summary;v=Engine.evaluate(model,cfg,action,scenarios,{mappedStart:modelStart});}
   if(!v?.feasible)throw Error(v?.reason??'MODEL_INFEASIBLE');
   if(![v.utility,v.expectedPnl,v.expectedAlpha,v.expectedFee,v.cvar,v.terminalCvar].every(finite))throw Error('NONFINITE_MODEL_OUTPUT');
   row.score=v.utility;row.scoreBasis=v.scoreBasis??'LOGICAL_ACTION_SCENARIOS';row.reason=null;row.scenarioEstimates={pnlSol:v.expectedPnl,alphaSol:v.expectedAlpha,feeSol:v.expectedFee,operationCostSol:v.expectedOperationCost,cvarLossSol:v.cvar,terminalCvarLossSol:v.terminalCvar,pathRisk:v.pathRisk,cvarBasis:'SAMPLED_PATH_MAX_LOSS_FROM_START_NAV',volumeDiagnostics:v.volumeDiagnostics,fillDiagnostics:v.fillDiagnostics};row.risk=v.risk;
  }catch(e){row.feasible=false;row.reason=String(e.message).slice(0,180)}
  rows.push(row);
 }
 const base=rows.find(r=>r.family===BASE);
 const ranked=rows.filter(r=>r.feasible&&r.family!==BASE).sort((a,b)=>b.score-a.score);
 let selected=base?.feasible?base:null,reason='NO_LP_BASELINE_OR_UNCERTAINTY_MARGIN';
 // Never promote deployment if the comparison baseline is infeasible.
 if(selected&&ranked.length&&ranked[0].score-base.score>cfg.minImprovementSol+cfg.uncertaintySol){selected=ranked[0];reason='HIGHEST_FEASIBLE_SCENARIO_SCORE';}
 if(!selected)reason='BASELINE_UNAVAILABLE_NO_DEPLOYMENT';
 const families=[BASE,'spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'].map(f=>({family:f,total:rows.filter(r=>r.family===f).length,feasible:rows.filter(r=>r.family===f&&r.feasible).length,best:rows.filter(r=>r.family===f&&r.feasible).sort((a,b)=>b.score-a.score)[0]??null}));
 return {...result,status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',reason,regime:g.regime,selected,candidates:rows,families,limitations:['Path CVaR measures maximum loss from initial NAV on sampled scenarios, not continuous drawdown. Path breach counts are diagnostics, not calibrated probabilities or execution approval.','No implicit spot acquisition or disposal; existing-position actions belong to T10.','Scenario estimates are model outputs, not expected realized income, calibrated probability, or protocol-exact amounts.','Observed bin share uses model value proxy, not protocol liquidity shares; exact SDK feasibility and rounding are pending.','No LP is a valid baseline; no deployment if baseline unavailable.']};
}

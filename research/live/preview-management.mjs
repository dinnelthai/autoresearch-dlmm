// T10: research-only position management. No signing, transaction construction or spot disposal.
import {Engine} from '../engine.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sum=(a,k)=>a.reduce((s,b)=>s+b[k],0);
const copy=v=>JSON.parse(JSON.stringify(v));
export function previewManagement(model,cfg,market,{asOf,operations=null,position=null,virtualProtection=false,checkAllocation=null}={}){
 const result={status:'BLOCKED',decisionReady:false,executionReady:false,selected:null,candidates:[],alerts:[],forecastLabel:'SYNTHETIC_EQUAL_WEIGHT_SCENARIOS_NOT_CALIBRATED',volumeBasis:'EXPLICIT_FLOW_WINDOW_FROZEN_TARGET_BIN_PROXY',scope:'EXISTING_POSITION_ONLY'};
 const block=reason=>({...result,reason});
 if(!model.bins.some(b=>b.liquidity>0)||model.status!=='OPEN')return block('NO_NONEMPTY_POSITION');
 if(!model.market?.ref?.valid||!Number.isSafeInteger(asOf)||asOf<model.lastTime||asOf>model.market.ref.expiresAt||asOf-model.market.t>cfg.maxReferenceAge)return {...block('REFERENCE_UNAVAILABLE_OR_STALE'),alerts:['MANUAL_POSITION_REVIEW_REQUIRED']};
 const s=copy(model);s.lastTime=asOf;
 const p=s.market.ref.price,g=Engine.classify(s,cfg),risk=Engine.risk(s,cfg,p);
 result.regime=g.regime;result.currentRisk=risk;result.currentExitDiagnostic=Engine.liquidation(s,cfg);result.alerts=[...new Set([...g.flags,...risk.violations])];
 result.position={address:position?.position??null,owner:position?.owner??null,lockReleasePointRaw:position?.lockReleasePointRaw??null,feeOwner:position?.feeOwner??null};
 result.alerts.push('WITHDRAWAL_PERMISSION_AND_LOCK_UNVERIFIED');
 // Counters must be independently reconciled for the same position lifecycle.
 const historyOk=operations&&operations.position===position?.position&&operations.asOf===asOf&&Number.isSafeInteger(operations.lastActionTime)&&operations.lastActionTime>=0&&operations.lastActionTime<=s.lastTime&&Number.isSafeInteger(operations.rebalances)&&operations.rebalances>=0&&finite(operations.rebalanceTurnoverSol)&&operations.rebalanceTurnoverSol>=0&&finite(operations.spotTurnoverSol)&&operations.spotTurnoverSol>=0;
 if(historyOk){s.lastActionTime=operations.lastActionTime;s.rebalances=operations.rebalances;s.rebalanceTurnover=operations.rebalanceTurnoverSol;s.turnover=operations.spotTurnoverSol;}
 else result.alerts.push('OPERATION_HISTORY_UNVERIFIED');
 const cooldown=historyOk?s.lastTime-s.lastActionTime>=cfg.cooldownSeconds:false;
 const budget=historyOk&&s.rebalances<cfg.maxRebalances&&s.turnover+s.rebalanceTurnover<cfg.maxTurnoverSol;
 const marketOk=Engine.marketAdmission(g);
 const activeOk=Number.isInteger(market.activeId)&&Engine.binId(cfg,p)===market.activeId;
 result.controls={operationHistorySupplied:!!historyOk,cooldownElapsed:cooldown,rebalanceBudgetAvailable:!!budget,activeBinAligned:activeOk,marketAdmission:marketOk};
 if(!activeOk)result.alerts.push('REFERENCE_AND_ACTIVE_BIN_MISMATCH');
 const known=new Set((market.bins??[]).map(b=>b.binId));
 const scenarios=Engine.forecast(s,cfg);
 const evaluated=new Map();
 const actions=Engine.candidatePlans(s,cfg,'adaptive').filter(a=>['HOLD','REDUCE','REMOVE_AND_HOLD','REPOSITION'].includes(a.type)&&!a.acquireSol);
 for(const action of actions){
  const row={action,feasible:false,score:null,reason:null,scenarioEstimates:null,allocation:null,postRisk:null,inventoryAfterAction:null};
  if(action.type==='REPOSITION'&&(!marketOk||risk.violations.length||!activeOk||!historyOk||!cooldown||!budget)){
   row.reason='REPOSITION_GATE';result.candidates.push(row);continue;
  }
  // Immediate what-if calculation on a copy, not an execution receipt.
  const trial=copy(s);
  try{
   Engine.applyAction(trial,cfg,action,s.lastTime);
   row.postRisk=Engine.risk(trial,cfg,p);row.inventoryAfterAction=Engine.balances(trial);
   row.exitDiagnostic=Engine.liquidation(trial,cfg);
   if(['REDUCE','REMOVE_AND_HOLD'].includes(action.type)){
    const b=risk.exitExposure,a=row.postRisk.exitExposure;
    row.protectiveDiagnostic={status:'IMMEDIATE_MODEL_ONLY',remainingViolations:row.postRisk.violations,newViolations:row.postRisk.violations.filter(v=>!risk.violations.includes(v)),bidExposureReductionSol:risk.bid-row.postRisk.bid,currentMemeDelta:row.inventoryAfterAction.x-Engine.balances(s).x,prospectiveInventoryReductionMeme:risk.postX-row.postRisk.postX,prospectiveExitHeadroomImprovementSol:a.status==='PROXY_ONLY'&&b.status==='PROXY_ONLY'?a.prospectiveHeadroomSol-b.prospectiveHeadroomSol:null,walletSolDelta:trial.wallet.y-s.wallet.y,disposal:false,executionReady:false};
   }
   row.estimatedOperationCostSol=trial.cost-s.cost;
   row.allocation={bidSol:sum(trial.bins,'y'),askMeme:sum(trial.bins,'x'),bins:trial.bins.map(b=>({binId:b.id,meme:b.x,sol:b.y,priceSolPerMeme:Engine.price(cfg,b.id)}))};
   if(action.type==='REPOSITION'){
    if(!trial.bins.length)throw Error('EMPTY_ALLOCATION');
    for(const b of trial.bins){
     const ext=s.poolBins[b.id];
     if(!known.has(b.id)||!finite(ext)||ext<=0||b.liquidity/(b.liquidity+ext)>cfg.maxBinShare)throw Error('OBSERVED_BIN_SHARE_LIMIT');
     if((b.id<market.activeId&&b.x>0)||(b.id>market.activeId&&b.y>0))throw Error('WRONG_ACTIVE_BIN_SIDE');
    }
   }
   let modelStart=null;
   if(checkAllocation&&action.type!=='HOLD'){row.feasible=true;const {modelStart:mapped,...summary}=checkAllocation(row);modelStart=mapped;row.integerMapping=summary;}
   const v=Engine.evaluate(s,cfg,action,scenarios,{mappedStart:modelStart});
   if(!v.feasible)throw Error(v.reason??'MODEL_INFEASIBLE');
   if(![v.utility,v.expectedPnl,v.expectedAlpha,v.expectedFee,v.cvar,v.terminalCvar].every(finite))throw Error('NONFINITE_MODEL_OUTPUT');
   evaluated.set(row,v);
   row.feasible=true;row.score=v.utility;row.scoreBasis=v.scoreBasis??'LOGICAL_ACTION_SCENARIOS';row.scenarioEstimates={pnlSol:v.expectedPnl,alphaSol:v.expectedAlpha,feeSol:v.expectedFee,operationCostSol:v.expectedOperationCost,cvarLossSol:v.cvar,terminalCvarLossSol:v.terminalCvar,pathRisk:v.pathRisk,cvarBasis:'SAMPLED_PATH_MAX_LOSS_FROM_START_NAV',volumeDiagnostics:v.volumeDiagnostics,fillDiagnostics:v.fillDiagnostics};
  }catch(e){row.feasible=false;row.reason=String(e.message).slice(0,180);}
  result.candidates.push(row);
 }
 const hold=result.candidates.find(r=>r.action.type==='HOLD');
 for(const row of result.candidates){if(!row.feasible||row===hold)continue;row.holdComparison=Engine.compareWithHold(evaluated.get(row),evaluated.get(hold),cfg);if(row.action.type==='REPOSITION'&&!row.holdComparison.eligible){row.feasible=false;row.reason='REPOSITION_NET_ADVANTAGE_NOT_ESTABLISHED';}}
 result.costBasis='DECLARED_LOGICAL_OPERATION_AGGREGATE_ALREADY_IN_NET_NAV';
 const protective=result.candidates.filter(r=>r.feasible&&['REDUCE','REMOVE_AND_HOLD'].includes(r.action.type));
 const hardRisk=risk.violations.length>0||!marketOk;
 if(hardRisk){
  result.alerts.push('MANUAL_RISK_REVIEW_REQUIRED');
  // Never say risk is resolved merely because liquidity has been removed.
  result.protectiveAlternatives=protective;
  result.protectiveDiagnostics=result.candidates.filter(r=>r.protectiveDiagnostic).map(r=>({action:r.action.type,feasible:r.feasible,reason:r.reason,...r.protectiveDiagnostic}));
  result.reason='HARD_RISK_REVIEW_NO_AUTOMATIC_SELECTION';
  // Paper follows the canonical market gate by withdrawing exposure, even when
  // retained inventory still violates risk limits. Never relabel a failed scenario as feasible.
  if(virtualProtection){
   const remove=result.candidates.find(r=>r.action.type==='REMOVE_AND_HOLD'&&r.protectiveDiagnostic&&r.allocation?.bins.length===0&&finite(r.estimatedOperationCostSol)&&r.postRisk?.bid===0);
   if(remove){try{const selected={...remove,protectiveExecution:true};if(checkAllocation){const {modelStart,...summary}=checkAllocation(selected);selected.integerMapping=summary;}result.selected=selected;result.reason='VIRTUAL_MARKET_OR_RISK_GATE_REMOVE';}catch(e){result.reason=String(e.message).slice(0,180);result.alerts.push('VIRTUAL_PROTECTION_MAPPING_BLOCKED')}}
  }
 }else if(hold?.feasible){
  result.selected=Engine.selectByUtility(result.candidates,hold,{...cfg,uncertaintySol:Engine.referenceUncertainty(s,cfg)},{scoreKey:'score'});
  result.reason=result.selected===hold?'HOLD_BASELINE_OR_UNCERTAINTY_MARGIN':'RESEARCH_SCENARIO_IMPROVEMENT';
 }else result.reason='HOLD_BASELINE_UNAVAILABLE';
 result.status='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED';
 result.limitations=['Gross hypothetical sale estimates are not net liquidation value or realized proceeds; protective diagnostics retain MEME and may leave residual risk.','Reposition must exceed matched HOLD net PnL and utility margin; modeled cost is a declared aggregate already subtracted from NAV, not verified per-instruction fees or migration costs.','Path CVaR measures maximum loss from initial NAV on sampled scenarios; path breach diagnostics do not imply execution approval.','Withdrawal retains token exposure; no disposal or implicit spot trades.','Counters are supplied reviewed metadata, not independently reconciled history.','Lock/fee rights, costs, realized PnL, Markout, protocol rounding and live feasibility not verified.','No live recommendations or transaction amounts.'];
 return result;
}

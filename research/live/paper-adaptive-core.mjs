// T10 on a virtual observed-share position only. No chain position or signing.
import {Engine as E} from '../engine.mjs';
import {strategyTuning} from '../engine/numeric.mjs';
import {rawHuman} from './engine-input.mjs';
import {snapshotRows} from './paper-fee-core.mjs';
import {previewManagement} from './preview-management.mjs';
import {previewPlans} from './preview-plans.mjs';
import {scaledFloat} from './allocation-diagnostic.mjs';
import {mapAllocation,principalForShares} from './paper-share-core.mjs';
import {assert,errorCode} from './research-contract.mjs';
const raw=v=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v),'PAPER_ADAPTIVE_RAW');return BigInt(v)};
export function adaptivePolicy(p){
 assert(p&&Number.isSafeInteger(p.cooldownSeconds)&&p.cooldownSeconds>=15&&p.cooldownSeconds<=86400&&Number.isSafeInteger(p.maxRebalances)&&p.maxRebalances>=0&&p.maxRebalances<=100&&Number.isFinite(p.maxTurnoverSol)&&p.maxTurnoverSol>0&&p.maxTurnoverSol<=100000,'PAPER_ADAPTIVE_POLICY');return {cooldownSeconds:p.cooldownSeconds,maxRebalances:p.maxRebalances,maxTurnoverSol:p.maxTurnoverSol};
}
// The tuned cooldown is a strategy preference, bounded below by the experiment control.
// Absolute experiment loss limits are also upper bounds on modeled loss budgets.
export function paperDecisionConfig(riskConfig,controls,tuning,policy){
 const checked=adaptivePolicy(controls),prefs=strategyTuning(tuning);
 const loss=Number(raw(policy.maxLossSolRaw))/1e9;
 assert(Number.isFinite(loss)&&loss>0,'PAPER_ADAPTIVE_LOSS_LIMIT');
 const cfg={...riskConfig,...checked,...prefs,cooldownSeconds:Math.max(checked.cooldownSeconds,prefs.cooldownSeconds??0),maxLossSol:Math.min(riskConfig.maxLossSol,loss)};
 E.config(cfg);
 return cfg;
}
export function paperEnvironment(reviewed){
 const {latest,observations,asOf,cfg}=reviewed;
 return {...E.classify({market:latest,history:observations,lastTime:asOf,marks:[],fills:[]},cfg),markoutBasis:'UNAVAILABLE_OBSERVED_SHARE_SNAPSHOTS'};
}
export function restoreVirtualModel({state,row,snapshot,reviewed}){
 const {identity:i,map}=snapshotRows(snapshot),{cfg,latest,observations,asOf}=reviewed,p=row.points.at(-1);
 assert(row.mode==='adaptive'&&['HOLD_ONLY','OPEN_PROXY'].includes(row.status)&&p.slot===i.slot&&state.pool===i.pool&&latest.pool===i.pool&&asOf>=latest.t,'PAPER_ADAPTIVE_SCOPE');
 const positionBins=(row.status==='OPEN_PROXY'?row.mapping?.rows??[]:[]).map(r=>{const b=map.get(r.binId),s=raw(b.liquiditySupplyRaw),v=raw(r.shareRaw);assert(s>0n&&v*10n<=s,'PAPER_ADAPTIVE_SHARE');return {id:r.binId,x:rawHuman(String(v*raw(b.amountXRaw)/s),i.sides[0].decimals),y:rawHuman(String(v*raw(b.amountYRaw)/s),9)}});
 const model=E.newState({pool:i.pool,entry:positionBins.length?'position':p.walletXRaw==='0'?'sol':'holding',meme:rawHuman(p.walletXRaw,i.sides[0].decimals),sol:rawHuman(p.walletYRaw,9),pendingFeeX:rawHuman(p.feeXRaw,i.sides[0].decimals),pendingFeeY:rawHuman(p.feeYRaw,9),positionBins,initialPrice:latest.ref.price,goal:state.adaptiveRequest.goal,allowDispose:false},cfg);
 // Restore the frozen experiment capital rather than treating each management tick as a new investment.
 model.baseline={x:rawHuman(state.capital.xRaw,i.sides[0].decimals),y:rawHuman(state.capital.yRaw,9)};
 model.initialNav=rawHuman(row.initialNavYRaw,9);model.cost=rawHuman(p.costYRaw,9);
 model.claimed={x:rawHuman(row.claimedFeeXRaw??'0',i.sides[0].decimals),y:rawHuman(row.claimedFeeYRaw??'0',9)};
 model.feesEarned={x:model.claimed.x+model.pendingFees.x,y:model.claimed.y+model.pendingFees.y};
 model.lastActionTime=row.lastActionTime??Math.floor(state.frozenAt/1000);model.rebalances=row.rebalances??0;model.rebalanceTurnover=rawHuman(row.turnoverYRaw??'0',9);
 model.history=observations.slice(0,-1);E.event(model,cfg,{...latest,id:'virtual-market:'+latest.id});
 const bins=[...map.values()],external=bins.flatMap(b=>{const x=rawHuman(b.amountXRaw,i.sides[0].decimals),y=rawHuman(b.amountYRaw,9);return x+y>0?[{id:b.binId,externalLiquiditySol:x*E.price(cfg,b.binId)+y}]:[]});
 if(external.length)E.event(model,cfg,{type:'POOL_STATE',id:'virtual-pool:'+i.rawHash,t:latest.t,bins:external});
 // The position is marked at the capture/analysis boundary, not the older quote timestamp.
 // Do not change any evidence timestamp or synthesize a newer MARKET observation.
 model.lastTime=asOf;
 return {model,identity:i,map,bins};
}
export function reentryBlock(row,cfg,asOf){
 if(row.status!=='HOLD_ONLY')return null;
 if(row.lastActionTime!=null&&asOf-row.lastActionTime<(cfg.cooldownSeconds??0))return 'PAPER_ADAPTIVE_REENTRY_COOLDOWN';
 if((row.entries??0)>0&&((row.rebalances??0)>=cfg.maxRebalances||raw(row.turnoverYRaw??'0')>=scaledFloat(cfg.maxTurnoverSol,9)))return 'PAPER_ADAPTIVE_REENTRY_BUDGET';
 return null;
}
export function virtualManagement({state,row,snapshot,reviewed}){
 const {cfg,asOf}=reviewed,{model,identity:i,map,bins}=restoreVirtualModel({state,row,snapshot,reviewed});
 const checkAllocation=selected=>{
  const mapped=validatedAdaptiveRemap({row:{...row,rebalances:row.rebalances??0},selected,snapshot,state,cfg});
  const modelStart=mappedScenarioStart(model,cfg,map,i,row,mapped,selected.action.type);
  return {modelStart,basis:'OBSERVED_SHARE_PROXY',binCount:mapped.mapping?.rows.length??0,principalXRaw:String(mapped.principalX),principalYRaw:String(mapped.principalY),walletXRaw:String(mapped.walletX),walletYRaw:String(mapped.walletY),costYRaw:String(mapped.cost),navYRaw:String(mapped.nav),turnoverYRaw:String(mapped.turnover)};
 };
 if(row.status==='HOLD_ONLY'){
  const blocked=reentryBlock(row,cfg,asOf);
  if(blocked)return {status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',selected:null,reason:blocked};
  return previewPlans(model,cfg,{activeId:i.activeId,bins},{asOf,checkAllocation});
 }
 const position={position:'VIRTUAL:'+state.id},operations={position:position.position,asOf,lastActionTime:row.lastActionTime??Math.floor(state.frozenAt/1000),rebalances:row.rebalances??0,rebalanceTurnoverSol:rawHuman(row.turnoverYRaw??'0',9),spotTurnoverSol:0};
 return previewManagement(model,cfg,{activeId:i.activeId,bins},{asOf,position,operations,virtualProtection:true,checkAllocation});
}
// Require a later observation and elapsed intent delay; always apply the current feasible plan.
export function adaptiveIntent({row,preview,slot,requestedAt,now,reviewHash,delaySeconds=10}){
 const flat=row.status==='HOLD_ONLY',selected=preview?.status===(flat?'RESEARCH_PLAN_PREVIEW_UNVERIFIED':'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED')?preview.selected:null,action=(selected?.feasible||!flat&&selected?.protectiveExecution===true&&selected?.action?.type==='REMOVE_AND_HOLD')&&(flat?['OPEN']:['REDUCE','REPOSITION','REMOVE_AND_HOLD']).includes(selected.action?.type)&&!selected.action.acquireSol?selected.action.type:null;
 if(!action)return {pending:null,apply:null,reason:preview?.reason??'PAPER_ADAPTIVE_NO_SELECTION'};
 const pending=row.pendingAdaptive;
 if(pending&&pending.action===action&&now-pending.createdAt<=600000){
  if(slot>pending.slot&&requestedAt>pending.createdAt&&now>=pending.createdAt+delaySeconds*1000)return {pending:null,apply:selected,reason:'PAPER_ADAPTIVE_REVALIDATED'};
  return {pending,apply:null,reason:'PAPER_ADAPTIVE_INTENT_PENDING'};
 }
 return {pending:{action,spec:selected.action.spec??null,slot,createdAt:now,reviewHash},apply:null,reason:'PAPER_ADAPTIVE_INTENT_PENDING'};
}
export function remapAdaptive({row,selected,snapshot,state,cfg}){
 const {identity:i,map}=snapshotRows(snapshot),pt=row.points.at(-1),opening=selected.action.type==='OPEN',cost=scaledFloat(opening?cfg.operationCostSol:selected.estimatedOperationCostSol,9,true);
 const walletX=raw(pt.walletXRaw),walletY=raw(pt.walletYRaw),principalX=raw(pt.principalXRaw),principalY=raw(pt.principalYRaw),feeX=raw(pt.feeXRaw),feeY=raw(pt.feeYRaw);
 assert(cost<=walletY,'PAPER_ADAPTIVE_COST_UNFUNDED');
 const x=walletX+principalX+feeX,y=walletY+principalY+feeY-cost;
 const oldTurnover=raw(row.turnoverYRaw??'0'),price=raw(pt.priceQ64Raw),value=(a,b)=>b+a*price/(1n<<64n);
 if(selected.action.type==='REDUCE'){
  assert(row.status==='OPEN_PROXY'&&Number.isFinite(selected.action.fraction)&&selected.action.fraction>0&&selected.action.fraction<1,'PAPER_ADAPTIVE_REDUCE_FRACTION');
  const fraction=scaledFloat(selected.action.fraction,9),den=1000000000n;
  assert(fraction>0n&&fraction<den,'PAPER_ADAPTIVE_REDUCE_FRACTION');
  const rows=row.mapping.rows.map(r=>({binId:r.binId,shareRaw:String(raw(r.shareRaw)*(den-fraction)/den)})).filter(r=>raw(r.shareRaw)>0n);
  assert(rows.length&&rows.some((r)=>raw(r.shareRaw)<raw(row.mapping.rows.find(x=>x.binId===r.binId).shareRaw)),'PAPER_ADAPTIVE_REDUCE_DUST');
  const retained=principalForShares(map,rows),dx=principalX-retained.x,dy=principalY-retained.y;
  assert(dx>=0n&&dy>=0n,'PAPER_ADAPTIVE_REDUCE_PRINCIPAL');
  const mapping={...row.mapping,integerAllocation:null,rows,allocation:{...row.mapping.allocation,shares:rows},reductionBasis:'RETAINED_OBSERVED_SHARES'};
  return {mapping,walletX:walletX+dx,walletY:walletY+dy-cost,principalX:retained.x,principalY:retained.y,cost,turnover:oldTurnover+value(dx,dy),status:'OPEN_PROXY',retainedFees:{x:feeX,y:feeY}};
 }
 if(selected.action.type==='REMOVE_AND_HOLD')return {mapping:null,walletX:x,walletY:y,principalX:0n,principalY:0n,cost,turnover:oldTurnover+value(principalX,principalY),status:'HOLD_ONLY'};
 assert((opening?row.status==='HOLD_ONLY':selected.action.type==='REPOSITION'&&row.status==='OPEN_PROXY'&&row.rebalances<cfg.maxRebalances)&&Array.isArray(selected.allocation?.bins)&&selected.allocation.bins.length>0,'PAPER_ADAPTIVE_REPOSITION');
 const bins=selected.allocation.bins,lo=Math.min(...bins.map(b=>b.binId)),hi=Math.max(...bins.map(b=>b.binId));
 const mapping=mapAllocation({mode:'adaptive',row:{family:'adaptive',action:{type:'OPEN'},feasible:true,allocation:{...selected.allocation,lowerBinId:lo,upperBinId:hi}},identity:i,map,budget:{allowDispose:false,memeRaw:String(x),solRaw:String(y),minSolReserve:cfg.minSolReserve,operationCostSol:0,maxBinShare:cfg.maxBinShare}});
 const d=mapping.integerAllocation,dx=raw(d.totalMemeRaw),dy=raw(d.totalSolRaw);
 const reentry=opening&&(row.entries??0)>0;
 assert(!reentry||(row.rebalances??0)<cfg.maxRebalances,'PAPER_ADAPTIVE_REENTRY_BUDGET');
 const turnover=opening&&!reentry?oldTurnover:oldTurnover+value(principalX,principalY)+value(dx,dy);
 assert(turnover<=scaledFloat(cfg.maxTurnoverSol,9)&&y-dy>=raw(state.policy.exitCostSolRaw),'PAPER_ADAPTIVE_TURNOVER_OR_RESERVE');
 const principal=principalForShares(map,mapping.rows);
 return {mapping,walletX:x-dx,walletY:y-dy,principalX:principal.x,principalY:principal.y,cost,turnover,status:'OPEN_PROXY'};
}

 // One exact preflight is shared by candidate selection and the committed action.
 // The scenario score is still a floating-point estimate, not a re-simulation of the rounded shares.
export function validatedAdaptiveRemap(args){
 const {row,state}=args,r=remapAdaptive(args),pt=row.points.at(-1),fees=r.retainedFees??{x:0n,y:0n};
 const nav=r.walletY+r.principalY+fees.y+(r.walletX+r.principalX+fees.x)*raw(pt.priceQ64Raw)/(1n<<64n);
 assert(nav<=raw(pt.navYRaw),'PAPER_ADAPTIVE_NAV_INCREASE_ON_ACTION');
 if(r.status==='OPEN_PROXY'){
  const initial=raw(row.initialNavYRaw),previousPeak=raw(pt.peakYRaw),peak=nav>previousPeak?nav:previousPeak,dd=peak?(peak-nav)*10000n/peak:0n;
  assert(initial-nav<raw(state.policy.maxLossSolRaw)&&dd<BigInt(state.policy.maxDrawdownBps),'PAPER_ADAPTIVE_POST_ACTION_RISK_LIMIT');
 }
 return {...r,nav};
}

 // Convert the already validated integer accounting state to the canonical forecast state.
 // No forecast-specific allocation or fee engine; immediate mapped action is a labeled
 // conditional scenario, while actual Paper intent delay/revalidation remains unchanged.
export function mappedScenarioStart(model,cfg,map,i,row,mapped,action){
 const state=structuredClone(model),xdec=i.sides[0].decimals;
 const human=(v,d)=>rawHuman(String(v),d);
 state.wallet={x:human(mapped.walletX,xdec),y:human(mapped.walletY,9)};
 state.bins=(mapped.mapping?.rows??[]).map(r=>{const b=map.get(r.binId),share=raw(r.shareRaw),supply=raw(b.liquiditySupplyRaw),x=human(share*raw(b.amountXRaw)/supply,xdec),y=human(share*raw(b.amountYRaw)/supply,9);return {id:r.binId,x,y,liquidity:x*E.price(cfg,r.binId)+y}});
 state.pendingFees=mapped.retainedFees?{x:human(mapped.retainedFees.x,xdec),y:human(mapped.retainedFees.y,9)}:{x:0,y:0};
 if(!mapped.retainedFees)state.claimed={x:state.claimed.x+model.pendingFees.x,y:state.claimed.y+model.pendingFees.y};
 state.cost=model.cost+human(mapped.cost,9);state.rebalanceTurnover=human(mapped.turnover,9);state.rebalances=(row.rebalances??0)+(action==='REPOSITION'||action==='OPEN'&&(row.entries??0)>0?1:0);state.lastActionTime=state.lastTime;state.status=mapped.status==='OPEN_PROXY'?'OPEN':'FLAT';state.pending=null;
 return state;
}

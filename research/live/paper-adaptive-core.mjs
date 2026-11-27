// T10 on a virtual observed-share position only. No chain position or signing.
import {Engine as E} from '../engine.mjs';
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
export function paperEnvironment(reviewed){
 const {latest,observations,asOf,cfg}=reviewed;
 return E.classify({market:latest,history:observations,lastTime:asOf,marks:[],fills:[]},cfg);
}
export function virtualManagement({state,row,snapshot,reviewed}){
 const {identity:i,map}=snapshotRows(snapshot),{cfg,latest,observations,asOf}=reviewed,p=row.points.at(-1);
 assert(row.mode==='adaptive'&&['HOLD_ONLY','OPEN_PROXY'].includes(row.status)&&p.slot===i.slot&&state.pool===i.pool&&latest.pool===i.pool&&asOf>=latest.t,'PAPER_ADAPTIVE_SCOPE');
 const positionBins=(row.status==='OPEN_PROXY'?row.mapping?.rows??[]:[]).map(r=>{const b=map.get(r.binId),s=raw(b.liquiditySupplyRaw),v=raw(r.shareRaw);assert(s>0n&&v*10n<=s,'PAPER_ADAPTIVE_SHARE');return {id:r.binId,x:rawHuman(String(v*raw(b.amountXRaw)/s),i.sides[0].decimals),y:rawHuman(String(v*raw(b.amountYRaw)/s),9)}});
 const model=E.newState({pool:i.pool,entry:positionBins.length?'position':p.walletXRaw==='0'?'sol':'holding',meme:rawHuman(p.walletXRaw,i.sides[0].decimals),sol:rawHuman(p.walletYRaw,9),pendingFeeX:rawHuman(p.feeXRaw,i.sides[0].decimals),pendingFeeY:rawHuman(p.feeYRaw,9),positionBins,initialPrice:latest.ref.price,goal:state.adaptiveRequest.goal,allowDispose:false},cfg);
 model.history=observations.slice(0,-1);E.event(model,cfg,{...latest,id:'virtual-market:'+latest.id});
 const bins=[...map.values()],external=bins.flatMap(b=>{const x=rawHuman(b.amountXRaw,i.sides[0].decimals),y=rawHuman(b.amountYRaw,9);return x+y>0?[{id:b.binId,externalLiquiditySol:x*E.price(cfg,b.binId)+y}]:[]});
 if(external.length)E.event(model,cfg,{type:'POOL_STATE',id:'virtual-pool:'+i.rawHash,t:latest.t,bins:external});
 if(row.status==='HOLD_ONLY'){
  if(row.lastActionTime!=null&&latest.t-row.lastActionTime<cfg.cooldownSeconds)return {status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',selected:null,reason:'PAPER_ADAPTIVE_REENTRY_COOLDOWN'};
  if((row.entries??0)>0&&((row.rebalances??0)>=cfg.maxRebalances||raw(row.turnoverYRaw??'0')>=scaledFloat(cfg.maxTurnoverSol,9)))return {status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',selected:null,reason:'PAPER_ADAPTIVE_REENTRY_BUDGET'};
  return previewPlans(model,cfg,{activeId:i.activeId,bins},{asOf});
 }
 const position={position:'VIRTUAL:'+state.id},operations={position:position.position,asOf,lastActionTime:row.lastActionTime??Math.floor(state.frozenAt/1000),rebalances:row.rebalances??0,rebalanceTurnoverSol:rawHuman(row.turnoverYRaw??'0',9),spotTurnoverSol:0};
 return previewManagement(model,cfg,{activeId:i.activeId,bins},{asOf,position,operations});
}
// Require a later observation and elapsed intent delay; always apply the current feasible plan.
export function adaptiveIntent({row,preview,slot,requestedAt,now,reviewHash,delaySeconds=10}){
 const flat=row.status==='HOLD_ONLY',selected=preview?.status===(flat?'RESEARCH_PLAN_PREVIEW_UNVERIFIED':'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED')?preview.selected:null,action=selected?.feasible&&(flat?['OPEN']:['REPOSITION','REMOVE_AND_HOLD']).includes(selected.action?.type)&&!selected.action.acquireSol?selected.action.type:null;
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

// T10 on a virtual observed-share position only. No chain position or signing.
import {Engine as E} from '../engine.mjs';
import {rawHuman} from './engine-input.mjs';
import {snapshotRows} from './paper-fee-core.mjs';
import {previewManagement} from './preview-management.mjs';
import {allocationDiagnostic,scaledFloat} from './allocation-diagnostic.mjs';
import {proportionalShare,assertProjectedShareLimit} from './paper-share-core.mjs';
import {assert,errorCode} from './research-contract.mjs';
const raw=v=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v),'PAPER_ADAPTIVE_RAW');return BigInt(v)};
export function adaptivePolicy(p){
 assert(p&&Number.isSafeInteger(p.cooldownSeconds)&&p.cooldownSeconds>=15&&p.cooldownSeconds<=86400&&Number.isSafeInteger(p.maxRebalances)&&p.maxRebalances>=0&&p.maxRebalances<=100&&Number.isFinite(p.maxTurnoverSol)&&p.maxTurnoverSol>0&&p.maxTurnoverSol<=100000,'PAPER_ADAPTIVE_POLICY');return {cooldownSeconds:p.cooldownSeconds,maxRebalances:p.maxRebalances,maxTurnoverSol:p.maxTurnoverSol};
}
export function virtualManagement({state,row,snapshot,reviewed}){
 const {identity:i,map}=snapshotRows(snapshot),{cfg,latest,observations,asOf}=reviewed,p=row.points.at(-1);
 assert(row.mode==='adaptive'&&row.status==='OPEN_PROXY'&&p.slot===i.slot&&state.pool===i.pool&&latest.pool===i.pool&&asOf>=latest.t,'PAPER_ADAPTIVE_SCOPE');
 const positionBins=row.mapping.rows.map(r=>{const b=map.get(r.binId),s=raw(b.liquiditySupplyRaw),v=raw(r.shareRaw);assert(s>0n&&v*10n<=s,'PAPER_ADAPTIVE_SHARE');return {id:r.binId,x:rawHuman(String(v*raw(b.amountXRaw)/s),i.sides[0].decimals),y:rawHuman(String(v*raw(b.amountYRaw)/s),9)}});
 const model=E.newState({pool:i.pool,entry:'position',meme:rawHuman(p.walletXRaw,i.sides[0].decimals),sol:rawHuman(p.walletYRaw,9),pendingFeeX:rawHuman(p.feeXRaw,i.sides[0].decimals),pendingFeeY:rawHuman(p.feeYRaw,9),positionBins,initialPrice:latest.ref.price,goal:state.adaptiveRequest.goal,allowDispose:false},cfg);
 model.history=observations.slice(0,-1);E.event(model,cfg,{...latest,id:'virtual-market:'+latest.id});
 const bins=[...map.values()],external=bins.flatMap(b=>{const x=rawHuman(b.amountXRaw,i.sides[0].decimals),y=rawHuman(b.amountYRaw,9);return x+y>0?[{id:b.binId,externalLiquiditySol:x*E.price(cfg,b.binId)+y}]:[]});
 if(external.length)E.event(model,cfg,{type:'POOL_STATE',id:'virtual-pool:'+i.rawHash,t:latest.t,bins:external});
 const position={position:'VIRTUAL:'+state.id},operations={position:position.position,asOf,lastActionTime:row.lastActionTime??Math.floor(state.frozenAt/1000),rebalances:row.rebalances??0,rebalanceTurnoverSol:rawHuman(row.turnoverYRaw??'0',9),spotTurnoverSol:0};
 return previewManagement(model,cfg,{activeId:i.activeId,bins},{asOf,position,operations});
}
// Require a later, matching re-evaluation. Only full reposition/removal supported; reduce remains diagnostic.
export function adaptiveIntent({row,preview,slot,requestedAt,now,reviewHash,delaySeconds=10}){
 const selected=preview?.status==='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED'?preview.selected:null,action=selected?.feasible&&['REPOSITION','REMOVE_AND_HOLD'].includes(selected.action?.type)&&!selected.action.acquireSol?selected.action.type:null;
 if(!action)return {pending:null,apply:null,reason:preview?.reason??'PAPER_ADAPTIVE_NO_SELECTION'};
 const pending=row.pendingAdaptive;
 if(pending&&pending.action===action&&pending.reviewHash!==reviewHash&&slot>pending.slot&&requestedAt>pending.createdAt&&now>=pending.createdAt+delaySeconds*1000&&now-pending.createdAt<=600000){
  // Revalidate action type and exact plan specification; no price or allocation from prior snapshot reused.
  if(JSON.stringify(pending.spec??null)===JSON.stringify(selected.action.spec??null))return {pending:null,apply:selected,reason:'PAPER_ADAPTIVE_REVALIDATED'};
 }
 return {pending:{action,spec:selected.action.spec??null,slot,createdAt:now,reviewHash},apply:null,reason:'PAPER_ADAPTIVE_INTENT_PENDING'};
}
export function remapAdaptive({row,selected,snapshot,state,cfg}){
 const {identity:i,map}=snapshotRows(snapshot),pt=row.points.at(-1),cost=scaledFloat(selected.estimatedOperationCostSol,9,true);
 const walletX=raw(pt.walletXRaw),walletY=raw(pt.walletYRaw),principalX=raw(pt.principalXRaw),principalY=raw(pt.principalYRaw),feeX=raw(pt.feeXRaw),feeY=raw(pt.feeYRaw);
 assert(cost<=walletY,'PAPER_ADAPTIVE_COST_UNFUNDED');
 const x=walletX+principalX+feeX,y=walletY+principalY+feeY-cost;
 const oldTurnover=raw(row.turnoverYRaw??'0'),price=raw(pt.priceQ64Raw),value=(a,b)=>b+a*price/(1n<<64n);
 if(selected.action.type==='REMOVE_AND_HOLD')return {mapping:row.mapping,walletX:x,walletY:y,principalX:0n,principalY:0n,cost,turnover:oldTurnover,status:'EXITED_PROXY'};
 assert(selected.action.type==='REPOSITION'&&row.rebalances<cfg.maxRebalances&&Array.isArray(selected.allocation?.bins)&&selected.allocation.bins.length>0,'PAPER_ADAPTIVE_REPOSITION');
 const bins=selected.allocation.bins,lo=Math.min(...bins.map(b=>b.binId)),hi=Math.max(...bins.map(b=>b.binId));
 const d=allocationDiagnostic({row:{family:'adaptive',action:{type:'OPEN'},feasible:true,allocation:{...selected.allocation,lowerBinId:lo,upperBinId:hi}},market:{activeId:i.activeId,decimalsX:i.sides[0].decimals,decimalsY:9,bins:[...map.values()]},budget:{allowDispose:false,memeRaw:String(x),solRaw:String(y),minSolReserve:cfg.minSolReserve,operationCostSol:0}});
 assert(d.status==='INTEGER_DIAGNOSTIC_ONLY'&&d.rows.length<=256&&!d.zeroRows,'PAPER_ADAPTIVE_ALLOCATION_BLOCKED');
 const rows=d.rows.map(v=>proportionalShare(map.get(v.binId),v,i.activeId)),dx=raw(d.totalMemeRaw),dy=raw(d.totalSolRaw);
 assertProjectedShareLimit(rows,cfg.maxBinShare);
 const turnover=oldTurnover+value(principalX,principalY)+value(dx,dy);
 assert(turnover<=scaledFloat(cfg.maxTurnoverSol,9)&&y-dy>=raw(state.policy.exitCostSolRaw),'PAPER_ADAPTIVE_TURNOVER_OR_RESERVE');
 const pX=rows.reduce((n,r)=>n+raw(r.shareRaw)*raw(map.get(r.binId).amountXRaw)/raw(map.get(r.binId).liquiditySupplyRaw),0n),pY=rows.reduce((n,r)=>n+raw(r.shareRaw)*raw(map.get(r.binId).amountYRaw)/raw(map.get(r.binId).liquiditySupplyRaw),0n);
 return {mapping:{mode:'adaptive',status:'SHARE_PROXY_MAPPED_UNVERIFIED',rows,integerAllocation:d,allocation:{schemaVersion:1,pool:i.pool,mintX:i.mintX,mintY:i.mintY,openingSlot:i.slot,openingRawHash:i.rawHash,shares:rows.map(r=>({binId:r.binId,shareRaw:r.shareRaw}))}},walletX:x-dx,walletY:y-dy,principalX:pX,principalY:pY,cost,turnover,status:'OPEN_PROXY'};
}

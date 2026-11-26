// Fixed opening allocation, observed-share proxy. Independent of swap replay.
import {IntegerKernel as K} from '../integer.mjs';
import {mapPaperPlans} from './paper-share-core.mjs';
import {adaptiveIntent,remapAdaptive} from './paper-adaptive-core.mjs';
import {snapshotRows,estimateFeeGrowth} from './paper-fee-core.mjs';
import {assert,hash,errorCode} from './research-contract.mjs';
const raw=(v,bits=128)=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<BigInt(bits)),'PAPER_SNAPSHOT_RAW_INVALID');return BigInt(v)};
const s=v=>v.toString(),Q=K.Q;
export const PAPER_SNAPSHOT_LIMIT=200000;
const RETAINED_POINTS=1000;
function appendPoint(row,point){const points=[...row.points,point];return {points:points.slice(-RETAINED_POINTS),pointsDropped:(row.pointsDropped??0)+Math.max(0,points.length-RETAINED_POINTS),maxDrawdownBps:Math.max(row.maxDrawdownBps??0,point.drawdownBps)}}
const modes=['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid','adaptive'];
const limits=['openOrderAmountRaw','totalProcessingOrderAmountRaw','processedOrderRemainingAmountRaw'];
function facts(snapshot){
 const {identity:i,map}=snapshotRows(snapshot),active=map.get(i.activeId);
 assert(active&&raw(active.priceQ64Raw)>0n&&i.sides?.length===2&&i.sides[1].decimals===9,'PAPER_SNAPSHOT_MARK_UNAVAILABLE');
 const p=snapshot.proof,requested=Date.parse(p?.requestedAt),received=Date.parse(p?.receivedAt);
 assert(typeof p?.path==='string'&&hash(p.manifestHash)&&p.accountsHash===i.rawHash&&Number.isFinite(requested)&&Number.isFinite(received)&&requested<=received,'PAPER_SNAPSHOT_TIME_OR_PROOF');
 return {i,map,price:raw(active.priceQ64Raw),proof:p,requested,received};
}
function mark(x,y,p){return y+x*p/Q}
function scope(a,b){assert(['pool','mintX','mintY','vaultX','vaultY','binStep','sdkCommit','idlBlob'].every(k=>a.i[k]===b.i[k])&&a.i.sides.every((v,n)=>v.mint===b.i.sides[n].mint&&v.decimals===b.i.sides[n].decimals),'PAPER_SNAPSHOT_SCOPE_CHANGED')}
function principal(map,rows){
 let x=0n,y=0n;
 for(const r of rows){const b=map.get(r.binId),share=raw(r.shareRaw);assert(b&&[2,3].includes(b.version)&&limits.every(k=>b.version===2?b[k]===null:raw(b[k],64)===0n),'PAPER_SNAPSHOT_BIN_UNAVAILABLE');
  const supply=raw(b.liquiditySupplyRaw);assert(supply>0n&&share*10n<=supply,'PAPER_SNAPSHOT_SHARE_LIMIT');
  x+=share*raw(b.amountXRaw,64)/supply;y+=share*raw(b.amountYRaw,64)/supply}
 return {x,y};
}
function samplePoint({slot,received,price,wallet,principal,fees,initial,hold,peak,cost,status}){
 const nav=mark(wallet.x+principal.x+fees.x,wallet.y+principal.y+fees.y,price);
 const nextPeak=nav>peak?nav:peak,drawdown=nextPeak?(nextPeak-nav)*10000n/nextPeak:0n;
 return {slot,receivedAt:received,priceQ64Raw:s(price),walletXRaw:s(wallet.x),walletYRaw:s(wallet.y),principalXRaw:s(principal.x),principalYRaw:s(principal.y),feeXRaw:s(fees.x),feeYRaw:s(fees.y),costYRaw:s(cost),navYRaw:s(nav),pnlYRaw:s(nav-initial),excessVsHoldYRaw:s(nav-hold),drawdownBps:Number(drawdown),peakYRaw:s(nextPeak),status};
}
const zero=()=>({x:0n,y:0n});
export function openSnapshotExperiment({id,snapshot,report,budget,policy,backendHash,frozenAt}){
 assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&hash(backendHash)&&Number.isSafeInteger(frozenAt),'PAPER_SNAPSHOT_EXPERIMENT_ID');
 const a=facts(snapshot);assert(a.received<=frozenAt,'PAPER_SNAPSHOT_OPENING_FUTURE');
 assert(Number.isInteger(policy?.maxDrawdownBps)&&policy.maxDrawdownBps>=1&&policy.maxDrawdownBps<=10000&&Number.isSafeInteger(policy.maxGapSeconds)&&policy.maxGapSeconds>=10&&policy.maxGapSeconds<=3600,'PAPER_SNAPSHOT_RISK_POLICY');
 assert(frozenAt-a.received<=policy.maxGapSeconds*1000,'PAPER_SNAPSHOT_OPENING_STALE');
 const exitCost=raw(policy.exitCostSolRaw,64),maxLoss=raw(policy.maxLossSolRaw,64);assert(maxLoss>0n,'PAPER_SNAPSHOT_RISK_POLICY');
 const mapping=mapPaperPlans({snapshot,report,budget});assert(mapping.status==='PAPER_SHARE_DIAGNOSTIC_UNVERIFIED','PAPER_SNAPSHOT_MAPPING_BLOCKED');
 const capital={x:raw(budget.memeRaw,64),y:raw(budget.solRaw,64)},initial=mark(capital.x,capital.y,a.price);assert(initial>0n,'PAPER_SNAPSHOT_CAPITAL');
 const rows=mapping.rows.map(r=>{
  const base={mode:r.mode,mapping:r,initialNavYRaw:s(initial),points:[],status:r.status==='BLOCKED'?'BLOCKED':r.status==='NO_LP'?'HOLD_ONLY':'OPEN_PROXY',reason:r.reason??null};
  if(base.status==='BLOCKED')return base;
  try{
   const d=r.integerAllocation,opened=base.status==='OPEN_PROXY',cost=opened?raw(d.modelCostReserveRaw,64):0n;
   const wallet={x:capital.x-(opened?raw(d.totalMemeRaw,64):0n),y:capital.y-(opened?raw(d.totalSolRaw,64)+cost:0n)};
   assert(wallet.x>=0n&&wallet.y>=0n&&(!opened||wallet.y>=exitCost),'PAPER_SNAPSHOT_WALLET_OR_EXIT_RESERVE');
   const p=opened?principal(a.map,r.rows):zero();
   const pt=samplePoint({slot:a.i.slot,received:a.received,price:a.price,wallet,principal:p,fees:zero(),initial,hold:initial,peak:initial,cost,status:base.status});
   return {...base,points:[pt],pointsDropped:0,maxDrawdownBps:pt.drawdownBps,claimedFeeXRaw:'0',claimedFeeYRaw:'0'};
  }catch(e){return {...base,status:'BLOCKED',reason:errorCode(e,'PAPER_SNAPSHOT_OPEN_FAILED')}}
 });
 return {schemaVersion:1,scope:'PAPER_SNAPSHOT_FIXED_SHARE_ONLY',status:'SNAPSHOT_RESEARCH_UNVERIFIED',id,pool:a.i.pool,mintX:a.i.mintX,mintY:a.i.mintY,decimalsX:a.i.sides[0].decimals,decimalsY:9,frozenAt,backendHash,policy:{...policy,exitCostSolRaw:s(exitCost),maxLossSolRaw:s(maxLoss)},capital:{xRaw:s(capital.x),yRaw:s(capital.y)},opening:{slot:a.i.slot,proof:a.proof},last:{slot:a.i.slot,proof:a.proof},snapshotCount:1,rows,decisionReady:false,executionReady:false,pnlReady:false,protocolExact:false,coverageVerified:false,calibrated:false,limitations:['Observed-share principal and cumulative observed fee entitlement on the external market path; not an added-liquidity counterfactual. No dilution fees or swap replay fees added.','Constant supply at each observed endpoint only; intervening changes, trade paths and execution prices unknown.','Active Bin Q64 mark in raw Y units; not independent reference or executable exit value.','Virtual exits are same-snapshot accounting marks minus declared cost; no actual realized PnL, liquidation guarantee or strategy rebalance.','Initial plan frozen locally; capture timestamps and local archive integrity do not prove independent causal provenance.','Latest 1000 points retained per strategy; lifetime peak, max sampled drawdown and claimed fees retained. Not a complete historical series.']};
}
export function advanceSnapshotExperiment(state,{opening,previous,snapshot,backendHash,now,exit=false,segmentOpenings={}}){
 assert(state?.scope==='PAPER_SNAPSHOT_FIXED_SHARE_ONLY'&&state.status==='SNAPSHOT_RESEARCH_UNVERIFIED'&&state.backendHash===backendHash&&state.executionReady===false&&state.pnlReady===false&&Number.isSafeInteger(state.snapshotCount)&&state.snapshotCount<PAPER_SNAPSHOT_LIMIT&&Array.isArray(state.rows)&&state.rows.length===8&&state.rows.every((r,i)=>r.mode===modes[i]),'PAPER_SNAPSHOT_CHECKPOINT_SCOPE');
 const a=facts(opening),b=facts(previous),c=facts(snapshot);scope(a,b);scope(b,c);
 assert(state.opening.slot===a.i.slot&&state.opening.proof.manifestHash===a.proof.manifestHash&&state.opening.proof.accountsHash===a.proof.accountsHash&&state.last.slot===b.i.slot&&state.last.proof.manifestHash===b.proof.manifestHash&&state.last.proof.accountsHash===b.proof.accountsHash&&state.pool===c.i.pool&&state.mintX===c.i.mintX&&state.mintY===c.i.mintY,'PAPER_SNAPSHOT_CHECKPOINT_BINDING');
 assert(c.i.slot>b.i.slot&&c.requested>state.frozenAt&&c.requested>=b.received&&c.received<=now,'PAPER_SNAPSHOT_ORDER_OR_LOOKAHEAD');
 const gap=c.received-b.received>state.policy.maxGapSeconds*1000;
 const initial=mark(raw(state.capital.xRaw),raw(state.capital.yRaw),a.price),hold=mark(raw(state.capital.xRaw),raw(state.capital.yRaw),c.price);
 const rows=state.rows.map(r=>{
  if(r.status==='BLOCKED')return r;
  const last=r.points.at(-1),block=reason=>({...r,status:'BLOCKED',reason,blockedAtSlot:c.i.slot});
  try{
   assert(last&&last.slot===b.i.slot,'PAPER_SNAPSHOT_ROW_STALE');
   let wallet={x:raw(last.walletXRaw),y:raw(last.walletYRaw)},p=zero(),fees=zero(),cost=raw(last.costYRaw),status=r.status,reason=r.reason,claimedX=raw(r.claimedFeeXRaw??'0'),claimedY=raw(r.claimedFeeYRaw??'0');
   if(status==='OPEN_PROXY'){
    assert(!gap,'PAPER_SNAPSHOT_GAP');
    const anchor=r.segmentOpening?segmentOpenings[r.mode]:opening,segment=facts(anchor);scope(a,segment);
    if(r.segmentOpening)assert(segment.i.slot===r.segmentOpening.slot&&segment.proof.manifestHash===r.segmentOpening.proof.manifestHash&&segment.proof.accountsHash===r.segmentOpening.proof.accountsHash,'PAPER_ADAPTIVE_SEGMENT_CHANGED');
    for(const v of r.mapping.rows){const x=segment.map.get(v.binId),y=b.map.get(v.binId),z=c.map.get(v.binId);
     assert(x&&y&&z&&x.version===y.version&&y.version===z.version&&x.priceQ64Raw===z.priceQ64Raw&&x.liquiditySupplyRaw===y.liquiditySupplyRaw&&y.liquiditySupplyRaw===z.liquiditySupplyRaw&&raw(z.feeXPerTokenRaw)>=raw(y.feeXPerTokenRaw)&&raw(z.feeYPerTokenRaw)>=raw(y.feeYPerTokenRaw),'PAPER_SNAPSHOT_SUPPLY_OR_GROWTH_CHANGED')}
    p=principal(c.map,r.mapping.rows);
    const fee=estimateFeeGrowth({before:anchor,after:snapshot,allocation:r.mapping.allocation});assert(fee.status==='PAPER_FEE_ESTIMATES_UNVERIFIED','PAPER_SNAPSHOT_FEE_BLOCKED');
    fees={x:raw(fee.totals.observedXRaw),y:raw(fee.totals.observedYRaw)};
    const nav=mark(wallet.x+p.x+fees.x,wallet.y+p.y+fees.y,c.price),peak=raw(last.peakYRaw),high=nav>peak?nav:peak;
    const loss=initial-nav,dd=high?(high-nav)*10000n/high:0n;
    if(exit||loss>=raw(state.policy.maxLossSolRaw)||dd>=BigInt(state.policy.maxDrawdownBps)){
     const feeCost=raw(state.policy.exitCostSolRaw);assert(wallet.y+p.y+fees.y>=feeCost,'PAPER_SNAPSHOT_EXIT_COST_UNFUNDED');
     claimedX+=fees.x;claimedY+=fees.y;wallet={x:wallet.x+p.x+fees.x,y:wallet.y+p.y+fees.y-feeCost};cost+=feeCost;p=zero();fees=zero();status='EXITED_PROXY';reason=exit?'MANUAL_VIRTUAL_EXIT':'RISK_VIRTUAL_EXIT';
    }
   }
   const point=samplePoint({slot:c.i.slot,received:c.received,price:c.price,wallet,principal:p,fees,initial,hold,peak:raw(last.peakYRaw),cost,status});
   return {...r,status,reason,claimedFeeXRaw:s(claimedX),claimedFeeYRaw:s(claimedY),...appendPoint(r,point)};
  }catch(e){return block(errorCode(e,'PAPER_SNAPSHOT_UPDATE_FAILED'))}
 });
 return {...state,last:{slot:c.i.slot,proof:c.proof},snapshotCount:state.snapshotCount+1,rows};
}

// Apply a reviewed virtual management intent to the current accounting point only.
// The original capital baseline is retained; closed-segment fees move into wallet once.
export function updateAdaptiveSnapshot(state,{snapshot,reviewed,preview,reviewHash,now}){
 const row=state.rows.find(r=>r.mode==='adaptive');
 if(!state.adaptiveRequest||row?.status!=='OPEN_PROXY')return state;
 assert(Number.isSafeInteger(now)&&now>=Date.parse(snapshot.proof.receivedAt)&&hash(reviewHash),'PAPER_ADAPTIVE_REVIEW_BINDING');
 const c=facts(snapshot);assert(state.last.slot===c.i.slot&&state.last.proof.accountsHash===c.proof.accountsHash,'PAPER_ADAPTIVE_POINT_SCOPE');
 const intent=adaptiveIntent({row,preview,slot:c.i.slot,requestedAt:c.requested,now,reviewHash,delaySeconds:Math.max(1,reviewed.cfg.executionDelaySeconds)});
 let next={...row,pendingAdaptive:intent.pending,adaptiveReason:intent.reason,adaptiveDecisions:(row.adaptiveDecisions??0)+1};
 if(intent.apply){
  try{
   const r=remapAdaptive({row:{...row,rebalances:row.rebalances??0},selected:intent.apply,snapshot,state,cfg:reviewed.cfg}),last=row.points.at(-1);
   const initial=raw(row.initialNavYRaw),hold=mark(raw(state.capital.xRaw),raw(state.capital.yRaw),c.price);
   const point=samplePoint({slot:c.i.slot,received:c.received,price:c.price,wallet:{x:r.walletX,y:r.walletY},principal:{x:r.principalX,y:r.principalY},fees:zero(),initial,hold,peak:raw(last.peakYRaw),cost:raw(last.costYRaw)+r.cost,status:r.status});
   assert(BigInt(point.navYRaw)<=BigInt(last.navYRaw),'PAPER_ADAPTIVE_NAV_INCREASE_ON_ACTION');
   if(r.status==='OPEN_PROXY')assert(initial-BigInt(point.navYRaw)<raw(state.policy.maxLossSolRaw)&&point.drawdownBps<state.policy.maxDrawdownBps,'PAPER_ADAPTIVE_POST_ACTION_RISK_LIMIT');
   next={...next,mapping:r.mapping,status:r.status,reason:r.status==='EXITED_PROXY'?'VIRTUAL_T10_REMOVE':null,pendingAdaptive:null,segmentOpening:{slot:c.i.slot,proof:c.proof},lastActionTime:reviewed.latest.t,rebalances:(row.rebalances??0)+(r.status==='OPEN_PROXY'?1:0),turnoverYRaw:s(r.turnover),claimedFeeXRaw:s(raw(row.claimedFeeXRaw??'0')+raw(last.feeXRaw)),claimedFeeYRaw:s(raw(row.claimedFeeYRaw??'0')+raw(last.feeYRaw)),points:[...row.points.slice(0,-1),point],maxDrawdownBps:Math.max(row.maxDrawdownBps??0,point.drawdownBps),adaptiveReason:'VIRTUAL_T10_'+intent.apply.action.type};
  }catch(e){next={...next,pendingAdaptive:null,adaptiveReason:errorCode(e,'PAPER_ADAPTIVE_REMAP_BLOCKED')}}
 }
 return {...state,rows:state.rows.map(r=>r===row?next:r)};
}

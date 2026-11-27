// Fixed opening allocation, observed-share proxy. Independent of swap replay.
import {IntegerKernel as K} from '../integer.mjs';
import {mapPaperPlans,principalForShares as principal} from './paper-share-core.mjs';
import {adaptiveIntent,remapAdaptive} from './paper-adaptive-core.mjs';
import {snapshotRows,intervalFees,INTERVAL_FEE_BASIS} from './paper-fee-core.mjs';
import {assert,hash,errorCode} from './research-contract.mjs';
const raw=(v,bits=128)=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<BigInt(bits)),'PAPER_SNAPSHOT_RAW_INVALID');return BigInt(v)};
const s=v=>v.toString(),Q=K.Q;
export const PAPER_SNAPSHOT_LIMIT=200000;
export const PAPER_FEE_BASIS=INTERVAL_FEE_BASIS;
const RETAINED_POINTS=1000;
function appendPoint(row,point){const points=[...row.points,point];return {points:points.slice(-RETAINED_POINTS),pointsDropped:(row.pointsDropped??0)+Math.max(0,points.length-RETAINED_POINTS),maxDrawdownBps:Math.max(row.maxDrawdownBps??0,point.drawdownBps)}}
const modes=['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid','adaptive'];
function facts(snapshot){
 const {identity:i,map}=snapshotRows(snapshot),active=map.get(i.activeId);
 assert(active&&raw(active.priceQ64Raw)>0n&&i.sides?.length===2&&i.sides[1].decimals===9,'PAPER_SNAPSHOT_MARK_UNAVAILABLE');
 const p=snapshot.proof,requested=Date.parse(p?.requestedAt),received=Date.parse(p?.receivedAt);
 assert(typeof p?.path==='string'&&hash(p.manifestHash)&&p.accountsHash===i.rawHash&&Number.isFinite(requested)&&Number.isFinite(received)&&requested<=received,'PAPER_SNAPSHOT_TIME_OR_PROOF');
 return {i,map,price:raw(active.priceQ64Raw),proof:p,requested,received};
}
function mark(x,y,p){return y+x*p/Q}
function scope(a,b){assert(['pool','mintX','mintY','vaultX','vaultY','binStep','sdkCommit','idlBlob'].every(k=>a.i[k]===b.i[k])&&a.i.sides.every((v,n)=>v.mint===b.i.sides[n].mint&&v.decimals===b.i.sides[n].decimals),'PAPER_SNAPSHOT_SCOPE_CHANGED')}
function samplePoint({slot,received,price,wallet,principal,fees,initial,hold,peak,cost,status}){
 const nav=mark(wallet.x+principal.x+fees.x,wallet.y+principal.y+fees.y,price);
 const nextPeak=nav>peak?nav:peak,drawdown=nextPeak?(nextPeak-nav)*10000n/nextPeak:0n;
 return {slot,receivedAt:received,priceQ64Raw:s(price),walletXRaw:s(wallet.x),walletYRaw:s(wallet.y),principalXRaw:s(principal.x),principalYRaw:s(principal.y),feeXRaw:s(fees.x),feeYRaw:s(fees.y),costYRaw:s(cost),navYRaw:s(nav),pnlYRaw:s(nav-initial),excessVsHoldYRaw:s(nav-hold),drawdownBps:Number(drawdown),peakYRaw:s(nextPeak),status};
}
const zero=()=>({x:0n,y:0n});
export function openSnapshotExperiment({id,snapshot,report,budget,policy,backendHash,frozenAt,adaptiveOnly=false}){
 assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&hash(backendHash)&&Number.isSafeInteger(frozenAt),'PAPER_SNAPSHOT_EXPERIMENT_ID');
 const a=facts(snapshot);assert(a.received<=frozenAt,'PAPER_SNAPSHOT_OPENING_FUTURE');
 assert(Number.isInteger(policy?.maxDrawdownBps)&&policy.maxDrawdownBps>=1&&policy.maxDrawdownBps<=10000&&Number.isSafeInteger(policy.maxGapSeconds)&&policy.maxGapSeconds>=10&&policy.maxGapSeconds<=3600,'PAPER_SNAPSHOT_RISK_POLICY');
 assert(frozenAt-a.received<=policy.maxGapSeconds*1000,'PAPER_SNAPSHOT_OPENING_STALE');
 const exitCost=raw(policy.exitCostSolRaw,64),maxLoss=raw(policy.maxLossSolRaw,64);assert(maxLoss>0n,'PAPER_SNAPSHOT_RISK_POLICY');
 const mapping=adaptiveOnly?{status:'PAPER_SHARE_DIAGNOSTIC_UNVERIFIED',rows:['NO_LP','adaptive'].map(mode=>({mode,status:'NO_LP',reason:null,rows:[]}))}:mapPaperPlans({snapshot,report,budget});assert(mapping.status==='PAPER_SHARE_DIAGNOSTIC_UNVERIFIED','PAPER_SNAPSHOT_MAPPING_BLOCKED');
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
   if(opened)assert(initial-BigInt(pt.navYRaw)<maxLoss&&pt.drawdownBps<policy.maxDrawdownBps,'PAPER_SNAPSHOT_OPENING_RISK_LIMIT');
   return {...base,points:[pt],pointsDropped:0,maxDrawdownBps:pt.drawdownBps,claimedFeeXRaw:'0',claimedFeeYRaw:'0',...(r.mode==='adaptive'?{entries:opened?1:0}: {})};
  }catch(e){return {...base,status:'BLOCKED',reason:errorCode(e,'PAPER_SNAPSHOT_OPEN_FAILED')}}
 });
 return {schemaVersion:1,scope:'PAPER_SNAPSHOT_FIXED_SHARE_ONLY',...(adaptiveOnly?{strategyScope:'ADAPTIVE_ONLY'}:{}),status:'SNAPSHOT_RESEARCH_UNVERIFIED',id,pool:a.i.pool,mintX:a.i.mintX,mintY:a.i.mintY,decimalsX:a.i.sides[0].decimals,decimalsY:9,frozenAt,backendHash,policy:{...policy,exitCostSolRaw:s(exitCost),maxLossSolRaw:s(maxLoss)},capital:{xRaw:s(capital.x),yRaw:s(capital.y)},opening:{slot:a.i.slot,proof:a.proof,priceQ64Raw:s(a.price)},last:{slot:a.i.slot,proof:a.proof},snapshotCount:1,feeBasis:PAPER_FEE_BASIS,gapCount:0,rows,decisionReady:false,executionReady:false,pnlReady:false,protocolExact:false,coverageVerified:false,calibrated:false,limitations:['Observed-share principal and cumulative interval-diluted fee estimates; not an added-liquidity counterfactual or a guaranteed lower bound. No undiluted or swap replay fees added.','Fee dilution uses mean external supply at each pair of observed endpoints; intervening supply changes and trade paths are unknown.','Active Bin Q64 mark in raw Y units; not independent reference or executable exit value.','Virtual exits and repositions use same-snapshot accounting marks and declared costs; no actual realized PnL or guaranteed execution.','Initial plan frozen locally; capture timestamps and local archive integrity do not prove independent causal provenance.','Latest 1000 points retained per strategy; lifetime peak, max sampled drawdown and claimed fees retained. Not a complete historical series.']};
}
export function advanceSnapshotExperiment(state,{previous,snapshot,backendHash,now,exit=false}){
 assert(state?.scope==='PAPER_SNAPSHOT_FIXED_SHARE_ONLY'&&state.status==='SNAPSHOT_RESEARCH_UNVERIFIED'&&state.backendHash===backendHash&&state.feeBasis===PAPER_FEE_BASIS&&state.executionReady===false&&state.pnlReady===false&&Number.isSafeInteger(state.snapshotCount)&&state.snapshotCount<PAPER_SNAPSHOT_LIMIT&&Array.isArray(state.rows)&&(state.strategyScope==='ADAPTIVE_ONLY'?state.rows.length===2&&state.rows[0].mode==='NO_LP'&&state.rows[1].mode==='adaptive':state.rows.length===8&&state.rows.every((r,i)=>r.mode===modes[i])),'PAPER_SNAPSHOT_CHECKPOINT_SCOPE');
 const b=facts(previous),c=facts(snapshot);scope(b,c);
 assert(state.last.slot===b.i.slot&&state.last.proof.manifestHash===b.proof.manifestHash&&state.last.proof.accountsHash===b.proof.accountsHash&&state.pool===c.i.pool&&state.mintX===c.i.mintX&&state.mintY===c.i.mintY&&state.decimalsX===c.i.sides[0].decimals&&state.decimalsY===c.i.sides[1].decimals,'PAPER_SNAPSHOT_CHECKPOINT_BINDING');
 assert(c.i.slot>b.i.slot&&c.requested>state.frozenAt&&c.requested>=b.received&&c.received<=now,'PAPER_SNAPSHOT_ORDER_OR_LOOKAHEAD');
 const gap=c.received-b.received>state.policy.maxGapSeconds*1000;
 const initial=mark(raw(state.capital.xRaw),raw(state.capital.yRaw),raw(state.opening.priceQ64Raw)),hold=mark(raw(state.capital.xRaw),raw(state.capital.yRaw),c.price);
 assert(initial>0n&&state.rows.every(r=>r.initialNavYRaw===s(initial)),'PAPER_BASELINE_CHANGED');
 const rows=state.rows.map(r=>{
  if(r.status==='BLOCKED')return r;
  const last=r.points.at(-1),block=reason=>({...r,status:'BLOCKED',reason,blockedAtSlot:c.i.slot,pendingAdaptive:null});
  try{
   assert(last&&last.slot===b.i.slot,'PAPER_SNAPSHOT_ROW_STALE');
   let wallet={x:raw(last.walletXRaw),y:raw(last.walletYRaw)},p=zero(),fees=zero(),cost=raw(last.costYRaw),status=r.status,reason=r.reason,claimedX=raw(r.claimedFeeXRaw??'0'),claimedY=raw(r.claimedFeeYRaw??'0'),observedPeak=raw(last.peakYRaw),feeGrowth=r.feeGrowth??[],feeCarry=r.feeCarry??null;
   if(status==='OPEN_PROXY'){
    assert(!gap,'PAPER_SNAPSHOT_GAP');
    p=principal(c.map,r.mapping.rows);
    const interval=intervalFees(b.map,c.map,r.mapping.rows,feeGrowth);fees={x:interval.fees.x+raw(feeCarry?.xRaw??'0'),y:interval.fees.y+raw(feeCarry?.yRaw??'0')};feeGrowth=interval.growth;
    const nav=mark(wallet.x+p.x+fees.x,wallet.y+p.y+fees.y,c.price),peak=raw(last.peakYRaw),high=nav>peak?nav:peak;
    observedPeak=high;
    const loss=initial-nav,dd=high?(high-nav)*10000n/high:0n;
    if(exit||loss>=raw(state.policy.maxLossSolRaw)||dd>=BigInt(state.policy.maxDrawdownBps)){
     const feeCost=raw(state.policy.exitCostSolRaw);assert(wallet.y+p.y+fees.y>=feeCost,'PAPER_SNAPSHOT_EXIT_COST_UNFUNDED');
     claimedX+=fees.x;claimedY+=fees.y;wallet={x:wallet.x+p.x+fees.x,y:wallet.y+p.y+fees.y-feeCost};cost+=feeCost;p=zero();fees=zero();feeGrowth=[];feeCarry=null;status='EXITED_PROXY';reason=exit?'MANUAL_VIRTUAL_EXIT':'RISK_VIRTUAL_EXIT';
    }
   }
   const point=samplePoint({slot:c.i.slot,received:c.received,price:c.price,wallet,principal:p,fees,initial,hold,peak:observedPeak,cost,status});
   return {...r,status,reason,feeGrowth,...(r.feeCarry?{feeCarry}:{}),...(status==='EXITED_PROXY'?{pendingAdaptive:null}:{}),claimedFeeXRaw:s(claimedX),claimedFeeYRaw:s(claimedY),...appendPoint(r,point)};
  }catch(e){return block(errorCode(e,'PAPER_SNAPSHOT_UPDATE_FAILED'))}
 });
 return {...state,last:{slot:c.i.slot,proof:c.proof},snapshotCount:state.snapshotCount+1,gapCount:(state.gapCount??0)+(gap?1:0),rows};
}

// Apply a reviewed virtual management intent to the current accounting point only.
// The original capital baseline is retained; closed-segment fees move into wallet once.
export function updateAdaptiveSnapshot(state,{snapshot,reviewed,preview,reviewHash,now}){
 const row=state.rows.find(r=>r.mode==='adaptive');
 if(!state.adaptiveRequest||!['HOLD_ONLY','OPEN_PROXY'].includes(row?.status))return state;
 assert(Number.isSafeInteger(now)&&now>=Date.parse(snapshot.proof.receivedAt)&&hash(reviewHash),'PAPER_ADAPTIVE_REVIEW_BINDING');
 const c=facts(snapshot);assert(state.last.slot===c.i.slot&&state.last.proof.accountsHash===c.proof.accountsHash,'PAPER_ADAPTIVE_POINT_SCOPE');
 const intent=adaptiveIntent({row,preview,slot:c.i.slot,requestedAt:c.requested,now,reviewHash,delaySeconds:Math.max(1,reviewed.cfg.executionDelaySeconds)});
 let next={...row,pendingAdaptive:intent.pending,adaptiveReason:intent.reason,adaptiveDecisions:(row.adaptiveDecisions??0)+1};
 if(row.status==='HOLD_ONLY'&&row.lastActionTime!=null&&reviewed.latest.t-row.lastActionTime<(reviewed.cfg.cooldownSeconds??0))return {...state,rows:state.rows.map(r=>r===row?{...next,pendingAdaptive:null,adaptiveReason:'PAPER_ADAPTIVE_REENTRY_COOLDOWN'}:r)};
 if(intent.apply){
  try{
   const r=remapAdaptive({row:{...row,rebalances:row.rebalances??0},selected:intent.apply,snapshot,state,cfg:reviewed.cfg}),last=row.points.at(-1);
   const initial=raw(row.initialNavYRaw),hold=mark(raw(state.capital.xRaw),raw(state.capital.yRaw),c.price);
   const point=samplePoint({slot:c.i.slot,received:c.received,price:c.price,wallet:{x:r.walletX,y:r.walletY},principal:{x:r.principalX,y:r.principalY},fees:r.retainedFees??zero(),initial,hold,peak:raw(last.peakYRaw),cost:raw(last.costYRaw)+r.cost,status:r.status});
   assert(BigInt(point.navYRaw)<=BigInt(last.navYRaw),'PAPER_ADAPTIVE_NAV_INCREASE_ON_ACTION');
   if(r.status==='OPEN_PROXY')assert(initial-BigInt(point.navYRaw)<raw(state.policy.maxLossSolRaw)&&point.drawdownBps<state.policy.maxDrawdownBps,'PAPER_ADAPTIVE_POST_ACTION_RISK_LIMIT');
   const action=intent.apply.action.type,entries=row.entries??(row.status==='OPEN_PROXY'?1:0);
   next={...next,mapping:r.mapping,feeGrowth:[],feeCarry:r.retainedFees?{xRaw:s(r.retainedFees.x),yRaw:s(r.retainedFees.y)}:null,...(action==='REDUCE'?{reductions:(row.reductions??0)+1}:{}),status:r.status,reason:r.status==='HOLD_ONLY'?'VIRTUAL_T10_REMOVE':null,pendingAdaptive:null,segmentOpening:r.status==='OPEN_PROXY'?{slot:c.i.slot,proof:c.proof}:null,lastActionTime:Math.floor(c.received/1000),entries:entries+(action==='OPEN'?1:0),rebalances:(row.rebalances??0)+(action==='REPOSITION'||action==='OPEN'&&entries>0?1:0),turnoverYRaw:s(r.turnover),claimedFeeXRaw:s(raw(row.claimedFeeXRaw??'0')+ (r.retainedFees?0n:raw(last.feeXRaw))),claimedFeeYRaw:s(raw(row.claimedFeeYRaw??'0')+(r.retainedFees?0n:raw(last.feeYRaw))),points:[...row.points.slice(0,-1),point],maxDrawdownBps:Math.max(row.maxDrawdownBps??0,point.drawdownBps),adaptiveReason:'VIRTUAL_T10_'+intent.apply.action.type};
  }catch(e){next={...next,pendingAdaptive:null,adaptiveReason:errorCode(e,'PAPER_ADAPTIVE_REMAP_BLOCKED')}}
 }
 return {...state,rows:state.rows.map(r=>r===row?next:r)};
}

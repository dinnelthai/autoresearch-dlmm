// Pure scheduling/public projection helpers; no real trading.
import {assert,hash} from './research-contract.mjs';
export function nextPaperCapture(state,market){
 assert(state?.pool===market?.pool&&state.mintX===market.mintX&&state.mintY===market.mintY&&Number.isSafeInteger(market.slot)&&hash(market.rawHash),'PAPER_AUTO_SCOPE');
 assert(market.slot>=state.last.slot,'PAPER_AUTO_SLOT_REGRESSED');
 if(market.slot===state.last.slot){assert(market.rawHash===state.last.proof.accountsHash,'PAPER_AUTO_SAME_SLOT_CONFLICT');return false}
 return true;
}
// Descriptive paired observation only. Every configured strategy remains in the denominator.
export function pairedObservation(state){
 const base=state.rows.find(r=>r.mode==='NO_LP'),b=base?.points?.at(-1),n=state.snapshotCount;
 const count=r=>(r.pointsDropped??0)+(r.points?.length??0);
 const signed=v=>typeof v==='string'&&/^-?\d{1,80}$/.test(v);
 const eligible=state.feeBasis==='FROZEN_FEE_FLOW_DILUTION_PROXY_V1'&&state.gapCount===0&&Number.isSafeInteger(n)&&n>=2&&base?.status==='HOLD_ONLY'&&b?.slot===state.last.slot&&count(base)===n&&signed(b.navYRaw);
 const rows=state.rows.map(r=>{
  const p=r.points?.at(-1);let status='UNPAIRED_OBSERVATION',alpha=null;
  if(r.status==='BLOCKED')status='BLOCKED_PATH';
  else if(eligible&&['HOLD_ONLY','OPEN_PROXY','EXITED_PROXY'].includes(r.status)&&p?.slot===b.slot&&p.receivedAt===b.receivedAt&&p.priceQ64Raw===b.priceQ64Raw&&r.initialNavYRaw===base.initialNavYRaw&&count(r)===n&&signed(p.navYRaw)&&signed(p.excessVsHoldYRaw)&&BigInt(p.navYRaw)-BigInt(b.navYRaw)===BigInt(p.excessVsHoldYRaw)){status='PAIRED_OBSERVED_PREFIX_ONLY';alpha=p.excessVsHoldYRaw}
  return {mode:r.mode,status,excessVsHoldYRaw:alpha,observedPoints:count(r),lastObservedSlot:p?.slot??null};
 });
 return {scope:'SAME_EXPERIMENT_OBSERVED_PREFIX_ONLY',openingSlot:state.opening?.slot??null,endSlot:state.last.slot,gapCount:state.gapCount??null,totalStrategies:rows.length,pairedStrategies:rows.filter(r=>r.status==='PAIRED_OBSERVED_PREFIX_ONLY').length,blockedStrategies:rows.filter(r=>r.status==='BLOCKED_PATH').length,unpairedStrategies:rows.filter(r=>r.status==='UNPAIRED_OBSERVATION').length,completeEvaluationWindow:false,rankingReady:false,rows};
}
export function paperPublic(state,job,{now,maxAgeMs}){
 const received=Date.parse(state.last.proof.receivedAt),fresh=Number.isFinite(received)&&received<=now&&now-received<=Math.min(maxAgeMs,state.policy.maxGapSeconds*1000);
 const comparison=pairedObservation(state);
 const window=state.window?{...state.window,status:state.window.status==='ENDPOINT_OBSERVED'?'ENDPOINT_OBSERVED':job.running===false?job.status:state.window.status}:null;
 const endpointObserved=window?.status==='ENDPOINT_OBSERVED';
 return {schemaVersion:1,scope:'PAPER_AUTO_RESEARCH_ONLY',pool:state.pool,id:state.id,status:job.status,reason:job.reason??null,running:job.running===true,checkpointFresh:fresh&&job.status==='UPDATED_UNVERIFIED',slot:state.last.slot,receivedAt:received,snapshotCount:state.snapshotCount,feeBasis:state.feeBasis??null,window,endpointObserved,historyHead:state.historyHead??null,comparison,rows:state.rows.map(r=>{const p=r.status==='BLOCKED'?null:r.points.at(-1);return {mode:r.mode,status:r.status,reason:r.reason,adaptiveReason:r.adaptiveReason??null,rebalances:r.rebalances??0,initialNavYRaw:r.initialNavYRaw,latest:p?{navYRaw:p.navYRaw,pnlYRaw:p.pnlYRaw,excessVsHoldYRaw:comparison.rows.find(v=>v.mode===r.mode)?.excessVsHoldYRaw??null,costYRaw:p.costYRaw,feeXRaw:p.feeXRaw,feeYRaw:p.feeYRaw,totalFeeXRaw:(BigInt(r.claimedFeeXRaw??'0')+BigInt(p.feeXRaw)).toString(),totalFeeYRaw:(BigInt(r.claimedFeeYRaw??'0')+BigInt(p.feeYRaw)).toString(),drawdownBps:p.drawdownBps,maxDrawdownBps:r.maxDrawdownBps??p.drawdownBps,pointsDropped:r.pointsDropped??0}:null}}),executionReady:false,decisionReady:false,pnlReady:false,protocolExact:false};
}

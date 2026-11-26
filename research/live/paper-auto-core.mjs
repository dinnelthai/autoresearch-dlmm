// Pure scheduling/public projection helpers; no real trading.
import {assert,hash} from './research-contract.mjs';
export function nextPaperCapture(state,market){
 assert(state?.pool===market?.pool&&state.mintX===market.mintX&&state.mintY===market.mintY&&Number.isSafeInteger(market.slot)&&hash(market.rawHash),'PAPER_AUTO_SCOPE');
 assert(market.slot>=state.last.slot,'PAPER_AUTO_SLOT_REGRESSED');
 if(market.slot===state.last.slot){assert(market.rawHash===state.last.proof.accountsHash,'PAPER_AUTO_SAME_SLOT_CONFLICT');return false}
 return true;
}
export function paperPublic(state,job,{now,maxAgeMs}){
 const received=Date.parse(state.last.proof.receivedAt),fresh=Number.isFinite(received)&&received<=now&&now-received<=Math.min(maxAgeMs,state.policy.maxGapSeconds*1000);
 return {schemaVersion:1,scope:'PAPER_AUTO_RESEARCH_ONLY',pool:state.pool,id:state.id,status:job.status,reason:job.reason??null,running:job.running===true,checkpointFresh:fresh&&job.status==='UPDATED_UNVERIFIED',slot:state.last.slot,receivedAt:received,snapshotCount:state.snapshotCount,rows:state.rows.map(r=>{const p=r.status==='BLOCKED'?null:r.points.at(-1);return {mode:r.mode,status:r.status,reason:r.reason,adaptiveReason:r.adaptiveReason??null,rebalances:r.rebalances??0,initialNavYRaw:r.initialNavYRaw,latest:p?{navYRaw:p.navYRaw,pnlYRaw:p.pnlYRaw,excessVsHoldYRaw:p.excessVsHoldYRaw,costYRaw:p.costYRaw,feeXRaw:p.feeXRaw,feeYRaw:p.feeYRaw,totalFeeXRaw:(BigInt(r.claimedFeeXRaw??'0')+BigInt(p.feeXRaw)).toString(),totalFeeYRaw:(BigInt(r.claimedFeeYRaw??'0')+BigInt(p.feeYRaw)).toString(),drawdownBps:p.drawdownBps,maxDrawdownBps:r.maxDrawdownBps??p.drawdownBps,pointsDropped:r.pointsDropped??0}:null}}),executionReady:false,decisionReady:false,pnlReady:false,protocolExact:false};
}

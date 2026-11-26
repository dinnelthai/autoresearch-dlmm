// Compact per-observation archive. No replay or independent coverage claim.
import {assert,hash} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
export const HISTORY_SHARD_SIZE=128,HISTORY_SHARD_BYTES=4*1024*1024;
export function historyRecord(state,previousHash){
 assert(Number.isSafeInteger(state.snapshotCount)&&state.snapshotCount>=1&&state.snapshotCount<=200000&&(state.snapshotCount===1?previousHash===null:hash(previousHash))&&Array.isArray(state.rows)&&state.rows.length===8,'PAPER_HISTORY_SCOPE');
 const record={schemaVersion:1,id:state.id,pool:state.pool,sequence:state.snapshotCount,previousHash,slot:state.last.slot,proof:state.last.proof,feeBasis:state.feeBasis,backendHash:state.backendHash,gapCount:state.gapCount,window:state.window,rows:state.rows.map(r=>({mode:r.mode,status:r.status,reason:r.reason??null,adaptiveReason:r.adaptiveReason??null,rebalances:r.rebalances??0,claimedFeeXRaw:r.claimedFeeXRaw??'0',claimedFeeYRaw:r.claimedFeeYRaw??'0',maxDrawdownBps:r.maxDrawdownBps??null,point:r.points.at(-1)?.slot===state.last.slot?r.points.at(-1):null,mappingHash:sha(JSON.stringify(r.mapping??null)),pendingAdaptive:r.pendingAdaptive??null})),...(state.snapshotCount===1?{opening:{capital:state.capital,policy:state.policy,adaptiveRequest:state.adaptiveRequest??null,opening:state.opening}}:{})};
 return {...record,recordHash:sha(JSON.stringify(record))};
}
export function validateHistoryRecord(record,{id,pool,sequence,previousHash}){
 const {recordHash,...body}=record??{};
 assert(hash(recordHash)&&sha(JSON.stringify(body))===recordHash&&body.schemaVersion===1&&body.id===id&&body.pool===pool&&body.sequence===sequence&&body.previousHash===previousHash&&Array.isArray(body.rows)&&body.rows.length===8,'PAPER_HISTORY_CHAIN');
 return recordHash;
}
export function appendHistoryShard(records,record){
 assert(Array.isArray(records)&&records.length<=HISTORY_SHARD_SIZE,'PAPER_HISTORY_SHARD');
 const offset=(record.sequence-1)%HISTORY_SHARD_SIZE;
 if(records.length===offset+1){assert(JSON.stringify(records[offset])===JSON.stringify(record),'PAPER_HISTORY_ORPHAN_CONFLICT');return records}
 assert(records.length===offset,'PAPER_HISTORY_SHARD_SEQUENCE');
 if(offset)assert(records[offset-1].recordHash===record.previousHash,'PAPER_HISTORY_SHARD_LINK');
 return [...records,record];
}

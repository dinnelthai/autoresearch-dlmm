// Atomic bounded shard replacement before checkpoint. Crash tails must match exactly; never truncate.
import {join} from 'node:path';
import {assert} from './research-contract.mjs';
import {historyRecord,validateHistoryRecord,appendHistoryShard,HISTORY_SHARD_SIZE,HISTORY_SHARD_BYTES} from './paper-history-core.mjs';
export function createPaperHistoryStore({read,atomic}){
 const path=(dir,n)=>join(dir,'history-'+String(Math.floor((n-1)/HISTORY_SHARD_SIZE)).padStart(6,'0')+'.json');
 async function shard(dir,n){try{return JSON.parse(await read(path(dir,n),HISTORY_SHARD_BYTES))}catch(e){if(e.code==='ENOENT')return [];throw e}}
 async function append(dir,state,previous){
  const prior=previous?.historyHead??null;
  assert(previous?previous.snapshotCount+1===state.snapshotCount&&prior?.sequence===previous.snapshotCount:state.snapshotCount===1,'PAPER_HISTORY_CHECKPOINT_LINK');
  const record=historyRecord(state,prior?.recordHash??null),records=await shard(dir,record.sequence);
  if(prior){
   // The committed checkpoint binds the preceding record. Full chain audit is explicit verify().
   const sameShard=path(dir,prior.sequence)===path(dir,record.sequence),a=sameShard?records:await shard(dir,prior.sequence),offset=(prior.sequence-1)%HISTORY_SHARD_SIZE,tail=a[offset];
   assert(Array.isArray(a)&&a.length>=offset+1&&a.length<=Math.min(HISTORY_SHARD_SIZE,offset+2)&&tail,'PAPER_HISTORY_PRIOR_MISSING');
   const link=validateHistoryRecord(tail,{id:state.id,pool:state.pool,sequence:prior.sequence,previousHash:tail.previousHash});
   assert(link===prior.recordHash&&JSON.stringify(tail)===JSON.stringify(historyRecord(previous,tail.previousHash)),'PAPER_HISTORY_PRIOR_MISSING');
  }
  const next=appendHistoryShard(records,record);
  if(next!==records){assert(Buffer.byteLength(JSON.stringify(next))<=HISTORY_SHARD_BYTES,'PAPER_HISTORY_SHARD_SIZE');await atomic(path(dir,record.sequence),next)}
  return {...state,historyHead:{sequence:record.sequence,recordHash:record.recordHash}};
 }
 async function verify(dir,state){
  let previousHash=null,lastSlot=-1,lastRecord=null;const head=state.historyHead;assert(head?.sequence===state.snapshotCount,'PAPER_HISTORY_CHECKPOINT_LINK');
  for(let n=1;n<=head.sequence;){
   const records=await shard(dir,n),size=Math.min(HISTORY_SHARD_SIZE,head.sequence-n+1);
   assert(Array.isArray(records)&&records.length===size,'PAPER_HISTORY_MISSING_OR_EXTRA');
   for(const r of records){previousHash=validateHistoryRecord(r,{id:state.id,pool:state.pool,sequence:n,previousHash});assert(Number.isSafeInteger(r.slot)&&r.slot>lastSlot,'PAPER_HISTORY_SLOT');lastSlot=r.slot;lastRecord=r;n++}
  }
  assert(previousHash===head.recordHash&&lastSlot===state.last.slot&&JSON.stringify(lastRecord)===JSON.stringify(historyRecord(state,lastRecord.previousHash)),'PAPER_HISTORY_HEAD_MISMATCH');
  if(head.sequence%HISTORY_SHARD_SIZE===0)assert((await shard(dir,head.sequence+1)).length===0,'PAPER_HISTORY_MISSING_OR_EXTRA');
  return {status:'LOCAL_HISTORY_CHAIN_VERIFIED',records:head.sequence,headHash:previousHash,coverageVerified:false,pnlReady:false};
 }
 return {append,verify};
}

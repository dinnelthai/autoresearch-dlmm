// Compact per-observation archive. No replay or independent coverage claim.
import {assert,hash} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
export const HISTORY_SHARD_SIZE=128,HISTORY_SHARD_BYTES=4*1024*1024;
// Compact research log. Full raw bin observations remain linked by capture proof.
export function marketLog(m,reviewed=null,environment=null,reason=null){
 const e=reviewed?.latest,ref=e?.ref,price=m.bins?.find(b=>b.binId===m.activeId)?.priceQ64Raw??null;
 return {activeId:m.activeId,binStep:m.binStep,priceQ64Raw:price,binCount:m.bins?.length??null,regime:environment?.regime??'UNKNOWN',flags:environment?.flags??[],features:environment?.features??null,reason:reason??null,inputBasis:reviewed?(reviewed.basis??'REVIEWED_MODEL'):null,observationTime:e?.t??null,asOf:reviewed?.asOf??null,referencePrice:ref?.price??null,referencePools:ref?.pools??[],referenceExpiresAt:ref?.expiresAt??null,flowSol:e?.flowSol??null,flowWindowSeconds:e?.flowWindowSeconds??null,buyImbalance:e?.buyImbalance??null,holderShare:e?.holderShare??null,holderOutflow:e?.holderOutflow??null,exitDepth:e?.exitDepth??null,tokenSafe:e?.tokenSafe??null};
}
function candidateSummary(r){
 if(!r)return null;
 const a=r.allocation,v=r.scenarioEstimates;
 return {family:r.family??r.action?.label??null,action:r.action?.type??null,spec:r.action?.spec??null,feasible:r.feasible===true,reason:r.reason??null,score:r.score??null,pnlSol:v?.pnlSol??null,alphaSol:v?.alphaSol??null,feeSol:v?.feeSol??null,cvarLossSol:v?.cvarLossSol??null,operationCostSol:r.estimatedOperationCostSol??v?.operationCostSol??null,allocation:a?{bidSol:a.bidSol,askMeme:a.askMeme,lowerBinId:a.lowerBinId??null,upperBinId:a.upperBinId??null,binCount:a.bins?.length??0}:null};
}
export function decisionLog(preview,{inputHash,reason,outcome,slot,observedAt,kind,decidedAt,input}){
 const groups=new Map();
 for(const r of preview?.candidates??[]){
  const key=r.family??r.action?.type??'UNKNOWN',g=groups.get(key)??{family:key,total:0,feasible:0,best:null,rejections:{}};
  g.total++;if(r.feasible){g.feasible++;if(!g.best||r.score>g.best.score)g.best=candidateSummary(r)}else{const k=String(r.reason??'UNKNOWN').slice(0,180);g.rejections[k]=(g.rejections[k]??0)+1}groups.set(key,g);
 }
 if(!preview?.candidates?.length&&Array.isArray(preview?.families))for(const f of preview.families)groups.set(f.family,{family:f.family,total:f.total??1,feasible:f.feasible??(f.best?1:0),best:candidateSummary(f.best),rejections:f.best?{}:{NO_FEASIBLE_PLAN:1}});
 return {slot,observedAt,...(kind?{kind}:{}),...(decidedAt!=null?{decidedAt}:{}),...(input?{input}:{}),inputHash:inputHash??null,status:preview?.status??'NO_MODEL_DECISION',reason:reason??preview?.reason??null,selected:candidateSummary(preview?.selected),candidateCount:[...groups.values()].reduce((n,g)=>n+g.total,0),groups:[...groups.values()],outcome:outcome??null,controls:preview?.controls??null,alerts:preview?.alerts??[]};
}
export function operationLog(previous,next,beforeDecision=null){
 return next.rows.flatMap(r=>{
  const old=previous?.rows.find(x=>x.mode===r.mode),before=old?.points.at(-1)??null,after=r.points.at(-1)??null;
  const sameSlotBefore=r.mode==='adaptive'?beforeDecision:null;
  const action=r.status==='BLOCKED'&&old?.status!=='BLOCKED'?'BLOCKED':r.status==='EXITED_PROXY'&&old?.status!=='EXITED_PROXY'?'EXIT':r.status==='HOLD_ONLY'&&old?.status==='OPEN_PROXY'?'REMOVE_AND_HOLD':r.status==='OPEN_PROXY'&&old?.status!=='OPEN_PROXY'?((old?.entries??0)>0?'REENTRY':'OPEN'):r.status==='OPEN_PROXY'&&(r.rebalances??0)>(old?.rebalances??0)?'REPOSITION':null;
  if(!action)return [];
  return [{mode:r.mode,action,reason:['BLOCKED','EXIT'].includes(action)?r.reason??null:r.adaptiveReason??r.reason??null,beforeStatus:old?.status??null,afterStatus:r.status,before:sameSlotBefore??before,after:after?.slot===next.last.slot?after:null,comparisonBasis:sameSlotBefore?'SAME_CAPTURE_PRE_DECISION':'PRIOR_CAPTURE_OR_INITIAL_CAPITAL',mappingHash:sha(JSON.stringify(r.mapping??null))}];
 });
}
export function historyRecord(state,previousHash){
 assert(Number.isSafeInteger(state.snapshotCount)&&state.snapshotCount>=1&&state.snapshotCount<=200000&&(state.snapshotCount===1?previousHash===null:hash(previousHash))&&Array.isArray(state.rows)&&(state.rows.length===8||state.rows.length===2&&state.rows[0].mode==='NO_LP'&&state.rows[1].mode==='adaptive'),'PAPER_HISTORY_SCOPE');
 const record={schemaVersion:1,id:state.id,pool:state.pool,sequence:state.snapshotCount,previousHash,slot:state.last.slot,proof:state.last.proof,feeBasis:state.feeBasis,backendHash:state.backendHash,gapCount:state.gapCount,window:state.window,...(state.observationLog?{observationLog:state.observationLog}:{}),...(state.adaptiveInputBasis?{adaptiveInputBasis:state.adaptiveInputBasis}:{}),...(state.collectedObservations?.length?{collectedObservation:state.collectedObservations.at(-1)}:{}),rows:state.rows.map(r=>({mode:r.mode,status:r.status,reason:r.reason??null,adaptiveReason:r.adaptiveReason??null,rebalances:r.rebalances??0,claimedFeeXRaw:r.claimedFeeXRaw??'0',claimedFeeYRaw:r.claimedFeeYRaw??'0',maxDrawdownBps:r.maxDrawdownBps??null,point:r.points.at(-1)?.slot===state.last.slot?r.points.at(-1):null,mappingHash:sha(JSON.stringify(r.mapping??null)),pendingAdaptive:r.pendingAdaptive??null,...(r.feeGrowth?{feeGrowthHash:sha(JSON.stringify(r.feeGrowth))}:{}),...(r.entries!=null?{entries:r.entries,turnoverYRaw:r.turnoverYRaw??'0',lastActionTime:r.lastActionTime??null}:{})})),...(state.snapshotCount===1?{opening:{capital:state.capital,policy:state.policy,adaptiveRequest:state.adaptiveRequest??null,opening:state.opening,researchBinding:state.researchBinding??null}}:{})};
 return {...record,recordHash:sha(JSON.stringify(record))};
}
export function validateHistoryRecord(record,{id,pool,sequence,previousHash}){
 const {recordHash,...body}=record??{};
 assert(hash(recordHash)&&sha(JSON.stringify(body))===recordHash&&body.schemaVersion===1&&body.id===id&&body.pool===pool&&body.sequence===sequence&&body.previousHash===previousHash&&Array.isArray(body.rows)&&(body.rows.length===8||body.rows.length===2&&body.rows[0].mode==='NO_LP'&&body.rows[1].mode==='adaptive'),'PAPER_HISTORY_CHAIN');
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

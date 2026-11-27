// One configured pool per isolated virtual experiment service. No wallet or RPC writes.
import {mkdir} from 'node:fs/promises';
import {atomicJson as atomic,withWriterLock} from './terminal-runtime.mjs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPaperSnapshotReader,readSnapshotCheckpoint,snapshotCheckpoint,advancePaperCapture} from './paper-snapshot.mjs';
import {openSnapshotExperiment,updateAdaptiveSnapshot,PAPER_SNAPSHOT_LIMIT} from './paper-snapshot-run-core.mjs';
import {nextPaperCapture,paperPublic} from './paper-auto-core.mjs';
import {currentMarket,requestFromDraft} from './terminal-core.mjs';
import {adaptivePolicy,virtualManagement} from './paper-adaptive-core.mjs';
import {reviewedObservations} from './review-observations.mjs';
import {fixedPaperReport} from './paper-share-core.mjs';
import {assert,hash,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
import {freezePaperWindow,paperWindowCapture,paperWindowExpired,finishPaperWindow} from './paper-window-core.mjs';
import {createPaperHistoryStore} from './paper-history-store.mjs';
export function createTerminalPaperService({ROOT,DATA,pool,maxAgeMs,backendHash,io,loadState,preview,loadReview,isStopping,idlPath='data/raw/dlmm-idl.json',intervalMs=15000}){
 const dir=join(DATA,'paper-auto',pool),pointer=join(dir,'active.json');
 const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
 let job=null,timer=null,flight=null,closed=false,snapshotReader=null;
 const history=createPaperHistoryStore({read,atomic});
 async function init(){await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir)}
 async function active(){try{const x=JSON.parse(await read(pointer,16384));assert(x?.pool===pool&&typeof x.id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x.id)&&typeof x.running==='boolean','PAPER_AUTO_POINTER');return x}catch(e){if(e.code==='ENOENT')return null;throw e}}
 async function checkpoint(a){try{return readSnapshotCheckpoint(JSON.parse(await read(join(dir,a.id,'checkpoint.json'),32*1024*1024)),a.id,pool)}catch(e){if(e.message==='PAPER_SNAPSHOT_CHECKPOINT_HASH')throw Error('PAPER_AUTO_CHECKPOINT_HASH');throw e}}
 async function save(state,previous=null){const dst=join(dir,state.id);await mkdir(dst,{recursive:true,mode:0o700});await io.safeDataPath(dst);state=await history.append(dst,state,previous);await atomic(join(dst,'checkpoint.json'),snapshotCheckpoint(state));return state}
 async function reader(){if(!snapshotReader)snapshotReader=createPaperSnapshotReader({ROOT,io,idl:idlPath});return snapshotReader}
 async function exclusive(fn){assert(!closed&&!isStopping()&&!flight,'PAPER_AUTO_BUSY');const task=(async()=>{await init();return withWriterLock(dir,fn)})();flight=task;try{return await task}finally{if(flight===task)flight=null}}
 async function get(scope=pool){assert(scope===pool,'PAPER_AUTO_POOL_SCOPE');const a=await active();if(!a)return {schemaVersion:1,scope:'PAPER_AUTO_RESEARCH_ONLY',pool,status:'NO_EXPERIMENT',running:false,checkpointFresh:false,rows:[],executionReady:false,decisionReady:false,pnlReady:false,protocolExact:false};const state=await checkpoint(a);const current=!a.running?{status:a.finalStatus??'PAUSED',running:false}:state.backendHash!==backendHash?{status:'BLOCKED',reason:'PAPER_AUTO_CODE_CHANGED',running:true}:job?.id===a.id?job:{status:'WAITING_FOR_OBSERVATION',running:true};return paperPublic(state,current,{now:Date.now(),maxAgeMs})}
 async function context(scope=pool){assert(scope===pool,'PAPER_AUTO_POOL_SCOPE');const m=currentMarket(await loadState(pool),pool,Date.now(),maxAgeMs);let r=null;try{r=await loadReview(m,Date.now())}catch{}const valid=r?.expiresAt>Date.now();return {schemaVersion:1,scope:'PAPER_OPEN_CONTEXT_RESEARCH_ONLY',pool,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:valid?r.reviewHash:null,expiresAt:Math.min(valid?r.expiresAt:Infinity,m.receivedAt+maxAgeMs),executionReady:false,decisionReady:false,pnlReady:false}}
 async function start(body){return exclusive(async()=>{
  const a=await active();assert(!a?.running,'PAPER_AUTO_ALREADY_RUNNING');
  assert(body?.draft?.pool===pool&&body.policy&&body.draft?.riskConfig?.maxBinShare<=.1,'PAPER_AUTO_POOL_OR_SHARE_LIMIT');
  const m=currentMarket(await loadState(pool),pool,Date.now(),maxAgeMs);
  const request=requestFromDraft(body.draft,m);
  const capture=await (await reader())(await io.safeDataPath(m.capture));
  assert(capture.identity.slot===m.slot&&capture.identity.rawHash===m.rawHash,'PAPER_AUTO_OPENING_CHANGED');
  const {solRaw,memeRaw,riskConfig}=request;
  const budget={solRaw,memeRaw,allowDispose:false,minSolReserve:riskConfig.minSolReserve,operationCostSol:riskConfig.operationCostSol,maxBinShare:riskConfig.maxBinShare};
  let r=fixedPaperReport({snapshot:capture,budget}),reviewHash=null;
  if(body.reviewHash!=null){
   // Optional reviewed research can replace fixed controls; failures never suppress the controls.
   try{
    const reviewed=await preview(body,'plans'),b=reviewed.terminalBinding;
    assert(reviewed.status==='RESEARCH_DIAGNOSTIC_UNVERIFIED'&&reviewed.planPreview?.status==='RESEARCH_PLAN_PREVIEW_UNVERIFIED'&&b?.scope==='RESEARCH_ONLY'&&b.expiresAt>Date.now()&&b.marketSlot===m.slot&&b.marketRawHash===m.rawHash&&b.reviewHash===body.reviewHash,'PAPER_AUTO_PLAN_BLOCKED');
    assert(Object.keys(budget).every(k=>budget[k]===b.researchBudget[k]),'PAPER_AUTO_REVIEW_BUDGET_CHANGED');
    r=reviewed;reviewHash=b.reviewHash;
   }catch(e){r.planPreview.adaptiveReason=errorCode(e,'PAPER_ADAPTIVE_REVIEW_UNAVAILABLE')}
  }
  const id='auto-'+randomUUID(),state=openSnapshotExperiment({id,snapshot:capture,report:r,budget,policy:body.policy,backendHash,frozenAt:Date.now()});
  if(body.policy.adaptive){
   const controls=adaptivePolicy(body.policy.adaptive);state.adaptiveRequest={...request,riskConfig:{...riskConfig,...controls}};
   const row=state.rows.find(r=>r.mode==='adaptive'),base=state.rows[0];
   if(row?.status==='BLOCKED'&&base.status==='HOLD_ONLY')state.rows=state.rows.map(v=>v===row?{...structuredClone(base),mode:'adaptive',mapping:null,adaptiveReason:row.reason}:v);
  }
  state.window=freezePaperWindow(state.frozenAt,body.policy.evaluationDays,state.policy.maxGapSeconds);state.researchBinding={requestHash:sha(JSON.stringify(request)),reviewHash,reportHash:sha(JSON.stringify(r)),marketSlot:m.slot,marketRawHash:m.rawHash,planBasis:reviewHash?'REVIEWED_MODEL':'FIXED_OBSERVED_BIN_CONTROL'};
  assert(state.rows[0].status==='HOLD_ONLY','PAPER_AUTO_BASELINE_UNAVAILABLE');
  await save(state);await atomic(pointer,{pool,id,running:true});job={id,status:'WAITING_FOR_OBSERVATION',running:true};return get();
 })}
 async function finish(a,status,reason=null){await atomic(pointer,{...a,running:false,finalStatus:status,finishedAt:Date.now()});job={id:a.id,status,running:false,...(reason?{reason}:{})}}
 async function pause(body){return exclusive(async()=>{const a=await active();assert(a?.running&&body?.pool===pool&&body?.id===a.id,'PAPER_AUTO_EXPERIMENT_CHANGED');await finish(a,'PAUSED');return get()})}
 async function tick(){
  if(closed||isStopping()||flight)return;
  try{await exclusive(async()=>{
   const a=await active();if(!a?.running)return;
   try{
    const state=await checkpoint(a);assert(state.backendHash===backendHash,'PAPER_AUTO_CODE_CHANGED');
    if(state.window?.status==='ENDPOINT_OBSERVED'){await finish(a,'ENDPOINT_OBSERVED');return}
    if(state.snapshotCount>=PAPER_SNAPSHOT_LIMIT){await finish(a,'SNAPSHOT_LIMIT_REACHED');return}
    const m=currentMarket(await loadState(pool),pool,Date.now(),maxAgeMs);
    if(!nextPaperCapture(state,m)){if(paperWindowExpired(state.window,Date.now())){await finish(a,'MISSED_ENDPOINT');return}if(job?.id!==a.id||job.status!=='UPDATED_UNVERIFIED')job={id:a.id,status:'WAITING_FOR_OBSERVATION',running:true};return}
    const load=await reader(),snapshot=await load(await io.safeDataPath(m.capture));
    assert(snapshot.identity.slot===m.slot&&snapshot.identity.rawHash===m.rawHash,'PAPER_AUTO_CAPTURE_CHANGED');
    // Ignore a collector request started before local experiment freeze. Never treat it as a later observation.
    if(Date.parse(snapshot.proof.requestedAt)<=state.frozenAt){if(paperWindowExpired(state.window,Date.now())){await finish(a,'MISSED_ENDPOINT');return}job={id:a.id,status:'WAITING_FOR_POST_FREEZE_CAPTURE',running:true};return}
    const windowCapture=paperWindowCapture(state.window,snapshot.proof);
    if(windowCapture==='MISSED_ENDPOINT'){await finish(a,'MISSED_ENDPOINT');return}
    let next=await advancePaperCapture(state,{load,snapshot,backendHash,now:Date.now(),exit:windowCapture==='ENDPOINT'});
    const row=next.rows.find(r=>r.mode==='adaptive');
    if(windowCapture!=='ENDPOINT'&&next.adaptiveRequest&&['HOLD_ONLY','OPEN_PROXY'].includes(row?.status)){
     try{
      const review=await loadReview(m,Date.now());
      const evidence=async(path,digest)=>{assert(hash(digest),'PAPER_ADAPTIVE_EVIDENCE_HASH');const bytes=await read(path,8*1024*1024);assert(sha(bytes)===digest,'PAPER_ADAPTIVE_EVIDENCE_CHANGED');return bytes};
      const reviewed=await reviewedObservations({m,req:next.adaptiveRequest,review:review.review,evidence});
      const management=virtualManagement({state:next,row,snapshot,reviewed});
      assert(review.expiresAt>Date.now()&&m.receivedAt+maxAgeMs>Date.now(),'PAPER_ADAPTIVE_REVIEW_EXPIRED');
      next=updateAdaptiveSnapshot(next,{snapshot,reviewed,preview:management,reviewHash:review.reviewHash,now:Date.now()});
     }catch(e){next={...next,rows:next.rows.map(r=>r.mode==='adaptive'?{...r,pendingAdaptive:null,adaptiveReason:errorCode(e,'PAPER_ADAPTIVE_REVIEW_UNAVAILABLE')}:r)}}
    }
    if(windowCapture==='ENDPOINT')next={...next,window:finishPaperWindow(state.window,'ENDPOINT_OBSERVED',Date.parse(snapshot.proof.receivedAt))};
    next=await save(next,state);
    if(windowCapture==='ENDPOINT'){await finish(a,'ENDPOINT_OBSERVED');return}
    if(next.snapshotCount>=PAPER_SNAPSHOT_LIMIT){await finish(a,'SNAPSHOT_LIMIT_REACHED');return}
    job={id:a.id,status:'UPDATED_UNVERIFIED',running:true};
   }catch(e){job={id:a.id,status:'BLOCKED',reason:errorCode(e,'PAPER_AUTO_UPDATE_FAILED'),running:true};
    // No successful endpoint is fabricated on unavailable market data. Stop after grace, retain last committed history.
    try{const last=await checkpoint(a);if(paperWindowExpired(last.window,Date.now())){await finish(a,'MISSED_ENDPOINT',errorCode(e,'PAPER_AUTO_UPDATE_FAILED'))}}catch{}
   }
  })}catch(e){job={id:job?.id,status:'BLOCKED',reason:errorCode(e,'PAPER_AUTO_SCHEDULER_BUSY'),running:true}}
 }
 function startScheduler(){if(timer||closed)return;timer=setInterval(()=>{void tick()},intervalMs);void tick()}
 async function stop(){closed=true;if(timer)clearInterval(timer);timer=null;if(flight)await flight.catch(()=>{});snapshotReader=null}
 return {get,context,start,pause,tick,startScheduler,stop};
}

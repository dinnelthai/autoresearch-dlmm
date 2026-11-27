// One configured pool per isolated virtual experiment service. No wallet or RPC writes.
import {mkdir,readdir} from 'node:fs/promises';
import {atomicJson as atomic,withWriterLock} from './terminal-runtime.mjs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPaperSnapshotReader,advancePaperCapture} from './paper-snapshot.mjs';
import {openSnapshotExperiment,updateAdaptiveSnapshot,PAPER_SNAPSHOT_LIMIT} from './paper-snapshot-run-core.mjs';
import {nextPaperCapture,paperPublic,paperStatus} from './paper-auto-core.mjs';
import {currentMarket,requestFromDraft} from './terminal-core.mjs';
import {strategyTuning} from '../engine/numeric.mjs';
import {adaptivePolicy,paperDecisionConfig,virtualManagement,paperEnvironment} from './paper-adaptive-core.mjs';
import {reviewedObservations,collectedPaperInputs,paperTickObservation} from './review-observations.mjs';
import {diagnosticLog} from './diagnostic-log.mjs';
import {assert,hash,errorCode} from './research-contract.mjs';
import {sha,verifiedEvidence} from './evidence-digest.mjs';
import {freezePaperWindow,paperWindowCapture,paperWindowExpired,finishPaperWindow} from './paper-window-core.mjs';
import {createPaperReport} from './paper-report-core.mjs';
import {createPaperHistoryStore,createSnapshotStore} from './paper-history-store.mjs';
import {marketLog,decisionLog,operationLog} from './paper-history-core.mjs';
export function createTerminalPaperService({ROOT,DATA,pool,maxAgeMs,backendHash,io,loadState,preview,loadReview,refreshFeatures,isStopping,idlPath='data/raw/dlmm-idl.json'}){
 const dir=join(DATA,'paper-auto',pool),pointer=join(dir,'active.json');
 const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
 let job=null,flight=null,closed=false,snapshotReader=null,lastFeatureAttempt=-Infinity,featureFlight=null,features=null;
 const store=createSnapshotStore({read,atomic,withHistory:true});
 async function init(){await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir)}
 async function active(){try{const x=JSON.parse(await read(pointer,16384));assert(x?.pool===pool&&typeof x.id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x.id)&&typeof x.running==='boolean','PAPER_AUTO_POINTER');return x}catch(e){if(e.code==='ENOENT')return null;throw e}}
 async function checkpoint(a){try{return await store.load(join(dir,a.id),a.id,pool)}catch(e){if(e.message==='PAPER_SNAPSHOT_CHECKPOINT_HASH')throw Error('PAPER_AUTO_CHECKPOINT_HASH');throw e}}
 async function save(state,previous=null){const dst=join(dir,state.id);await mkdir(dst,{recursive:true,mode:0o700});await io.safeDataPath(dst);return store.save(dst,state,previous)}
 async function reader(){if(!snapshotReader)snapshotReader=createPaperSnapshotReader({ROOT,io,idl:idlPath});return snapshotReader}
 async function exclusive(fn){assert(!closed&&!isStopping()&&!flight,'PAPER_AUTO_BUSY');const task=(async()=>{await init();return withWriterLock(dir,fn)})();flight=task;try{return await task}finally{if(flight===task)flight=null}}
 async function get(scope=pool){assert(scope===pool,'PAPER_AUTO_POOL_SCOPE');const a=await active();if(!a)return paperStatus(pool,'NO_EXPERIMENT');const state=await checkpoint(a);const current=!a.running?{status:a.finalStatus??'PAUSED',running:false}:state.backendHash!==backendHash?{status:'BLOCKED',reason:'PAPER_AUTO_CODE_CHANGED',running:true}:job?.id===a.id?job:{status:'WAITING_FOR_OBSERVATION',running:true};return paperPublic(state,{...current,features},{now:Date.now(),maxAgeMs})}
 async function reportCatalog(scope=pool){
  assert(scope===pool,'PAPER_AUTO_POOL_SCOPE');
  const a=await active();let ids=[];
  try{ids=(await readdir(await io.safeDataPath(dir),{withFileTypes:true})).filter(x=>x.isDirectory()&&/^auto-[a-zA-Z0-9_-]{1,59}$/.test(x.name)).map(x=>x.name).sort()}catch(e){if(e.code!=='ENOENT')throw e}
  const others=ids.filter(id=>id!==a?.id);
  return {scope:'PAPER_REPORT_CATALOG',pool,activeId:a?.id??null,activeRunning:a?.running??false,total:ids.length,ids:[...(a?[a.id]:[]),...others.slice(0,99)]};
 }
 let reporting=false;
 async function report(body){
  assert(body?.pool===pool,'PAPER_AUTO_POOL_SCOPE');assert(!reporting,'PAPER_REPORT_BUSY');
  reporting=true;
  try{
   const a=await active(),id=body.id??a?.id;
   assert(typeof id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(id),'PAPER_REPORT_ID');
   const state=await checkpoint({id}),from=body.from??Math.max(1,state.snapshotCount-29);
   assert(Number.isSafeInteger(from)&&from>=1&&from<=state.snapshotCount,'PAPER_REPORT_PAGE');
   const aggregate=createPaperReport(state),records=[];
   const audit=await createPaperHistoryStore({read}).verify(join(dir,id),state,{committedPrefix:true,onRecord:r=>{
    aggregate.add(r);if(r.sequence>=from&&r.sequence<from+30)records.push({sequence:r.sequence,slot:r.slot,time:Date.parse(r.proof.receivedAt),log:r.observationLog??null});
   }});
   const current=await active();
   return {...aggregate.finish(),historyVerification:audit,experimentStatus:state.window?.status==='ENDPOINT_OBSERVED'?'ENDPOINT_OBSERVED':current?.id===id?(current.running?(state.backendHash!==backendHash?'BLOCKED_MODEL_CHANGED':job?.id===id?job.status:'RUNNING'):current.finalStatus??'PAUSED'):'HISTORICAL',logPage:{from,limit:30,total:state.snapshotCount,records}};
  }finally{reporting=false}
 }
 // Export a bounded committed-history tail independently of the report/strategy gates.
 async function diagnostics(scope=pool){
  assert(scope===pool,'PAPER_AUTO_POOL_SCOPE');
  const out={pool,job:job??null,features:features??null,backendHash,experiment:null,history:[],errors:[]};
  try{const a=await active();out.active=a;if(a){
   const state=await checkpoint(a);
   out.experiment={id:state.id,snapshotCount:state.snapshotCount,backendHash:state.backendHash,capital:state.capital,policy:state.policy,adaptiveRequest:state.adaptiveRequest,last:state.last,historyHead:state.historyHead,rows:state.rows.map(r=>({mode:r.mode,status:r.status,reason:r.reason,adaptiveReason:r.adaptiveReason,pendingAdaptive:r.pendingAdaptive,mapping:r.mapping,latest:r.points?.at(-1)}))};
   const end=state.snapshotCount,start=Math.max(1,end-127);
   for(let k=Math.floor((start-1)/128);k<=Math.floor((end-1)/128);k++){
    try{const rows=JSON.parse(await read(join(dir,a.id,'history-'+String(k).padStart(6,'0')+'.json'),4*1024*1024));out.history.push(...rows.filter(r=>r.sequence>=start&&r.sequence<=end&&r.pool===pool&&r.id===a.id))}catch(e){out.errors.push({stage:'HISTORY_READ',reason:errorCode(e)})}
   }
   out.historyScope={from:start,to:end,complete:out.history.length===end-start+1,chainVerified:false};
  }}catch(e){out.errors.push({stage:'CHECKPOINT_READ',reason:errorCode(e)})}
  return out;
 }
 async function context(scope=pool){assert(scope===pool,'PAPER_AUTO_POOL_SCOPE');const m=currentMarket(await loadState(pool),pool,Date.now(),maxAgeMs);let r=null;try{r=await loadReview(m,Date.now())}catch{}const valid=r?.expiresAt>Date.now();return {schemaVersion:1,scope:'PAPER_OPEN_CONTEXT_RESEARCH_ONLY',pool,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:valid?r.reviewHash:null,expiresAt:Math.min(valid?r.expiresAt:Infinity,m.receivedAt+maxAgeMs),executionReady:false,decisionReady:false,pnlReady:false}}
 async function start(body){return exclusive(async()=>{
  const a=await active();assert(!a?.running,'PAPER_AUTO_ALREADY_RUNNING');
  assert(body?.draft?.pool===pool&&body.policy&&body.draft?.riskConfig?.maxBinShare<=.1,'PAPER_AUTO_POOL_OR_SHARE_LIMIT');
  const m=currentMarket(await loadState(pool),pool,Date.now(),maxAgeMs);
  const request=requestFromDraft(body.draft,m),optimization=body.policy.optimization??null;
  const capture=await (await reader())(await io.safeDataPath(m.capture));
  assert(capture.identity.slot===m.slot&&capture.identity.rawHash===m.rawHash,'PAPER_AUTO_OPENING_CHANGED');
  if(optimization){
   assert(body.policy.adaptive&&body.policy.tuning==null&&optimization.status==='PROPOSED_FOR_NEW_PAPER_WINDOW'&&optimization.source==='UNVERIFIED_NORMALIZED_EVENT_OPTIMIZATION'&&hash(optimization.datasetSha256)&&Array.isArray(optimization.validationPools)&&optimization.validationPools.includes(pool)&&Number.isSafeInteger(optimization.nextWindowAfter)&&optimization.nextWindowAfter>=0,'PAPER_OPTIMIZATION_PROPOSAL_INVALID');
   assert(Date.parse(capture.proof.requestedAt)>optimization.nextWindowAfter*1000,'PAPER_OPTIMIZATION_REQUIRES_LATER_WINDOW');
   if(a){const previous=await checkpoint(a);assert(m.slot>previous.last.slot&&Date.parse(capture.proof.requestedAt)>Date.parse(previous.last.proof.receivedAt),'PAPER_OPTIMIZATION_REQUIRES_NEW_CAPTURE')}
  }
  const {solRaw,memeRaw,riskConfig}=request;
  const budget={solRaw,memeRaw,allowDispose:false,minSolReserve:riskConfig.minSolReserve,operationCostSol:riskConfig.operationCostSol,maxBinShare:riskConfig.maxBinShare};
  const controls=adaptivePolicy(body.policy.adaptive??{cooldownSeconds:120,maxRebalances:8,maxTurnoverSol:30}),tuning=strategyTuning(optimization?.tuning??body.policy.tuning??{});
  const id='auto-'+randomUUID(),state=openSnapshotExperiment({id,snapshot:capture,budget,policy:body.policy,backendHash,frozenAt:Date.now(),adaptiveOnly:true});
  state.researchRequest=request;
  state.adaptiveRequest={...request,riskConfig:paperDecisionConfig(riskConfig,controls,tuning,state.policy)};
  const row=state.rows.find(r=>r.mode==='adaptive');row.adaptiveReason='ADAPTIVE_RESEARCH_INPUT_REQUIRED';row.mapping=null;
  state.window=freezePaperWindow(state.frozenAt,body.policy.evaluationDays,state.policy.maxGapSeconds);
  state.researchBinding={requestHash:sha(JSON.stringify(request)),reviewHash:null,reportHash:sha(JSON.stringify(state.adaptiveRequest)),marketSlot:m.slot,marketRawHash:m.rawHash,planBasis:'ADAPTIVE_ONLY',...(optimization?{optimization:{datasetSha256:optimization.datasetSha256,nextWindowAfter:optimization.nextWindowAfter,tuning:strategyTuning(optimization.tuning),proposalHash:sha(JSON.stringify(optimization))}}:{})};
  assert(state.rows[0].status==='HOLD_ONLY'&&row.status==='HOLD_ONLY','PAPER_AUTO_BASELINE_UNAVAILABLE');
  state.observationLog={market:marketLog(m,null,null,'INITIAL_OBSERVATION'),decision:decisionLog(null,{slot:m.slot,observedAt:state.frozenAt,reason:'INITIAL_ADAPTIVE_WARMUP',kind:'INITIAL_CONTROLS',decidedAt:state.frozenAt,inputHash:state.researchBinding.reportHash}),operations:operationLog(null,state)};
  await save(state);await atomic(pointer,{pool,id,running:true});job={id,status:'WAITING_FOR_OBSERVATION',running:true};features=null;lastFeatureAttempt=-Infinity;return get();
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
    const prior=state.collectedObservations??[],captureAt=Date.parse(snapshot.proof.receivedAt);
    const sample=paperTickObservation(m,captureAt,features?.observation,maxAgeMs);
    if(sample.event.t>(prior.at(-1)?.event.t??-1))next.collectedObservations=[...prior,sample].slice(-(state.adaptiveRequest?.riskConfig?.regimeLookback??12));
    const row=next.rows.find(r=>r.mode==='adaptive'),beforeDecision=row?.points.at(-1),req=next.adaptiveRequest??next.researchRequest;
    let logMarket=marketLog(m,null,null,'MODEL_INPUT_UNAVAILABLE'),logDecision=decisionLog(null,{slot:m.slot,observedAt:Date.parse(snapshot.proof.receivedAt),kind:'NO_MODEL_DECISION',reason:windowCapture==='ENDPOINT'?'WINDOW_ENDPOINT':next.adaptiveRequest?'NO_ELIGIBLE_ADAPTIVE_PATH':'ADAPTIVE_DISABLED'});
    if(req&&next.collectedObservations?.length){try{const collected=collectedPaperInputs({m,req,samples:next.collectedObservations,asOf:Math.floor(Date.parse(snapshot.proof.receivedAt)/1000)});logMarket=marketLog(m,collected,paperEnvironment(collected))}catch(e){logMarket=marketLog(m,null,null,errorCode(e,'PAPER_MARKET_ENVIRONMENT_UNAVAILABLE'))}}
    if(windowCapture!=='ENDPOINT'&&next.adaptiveRequest&&['HOLD_ONLY','OPEN_PROXY'].includes(row?.status)){
     try{
      let reviewed,reviewHash,collectedError;
      if(next.collectedObservations?.length){
       try{reviewed=collectedPaperInputs({m,req:next.adaptiveRequest,samples:next.collectedObservations,asOf:Math.floor(Date.parse(snapshot.proof.receivedAt)/1000)});reviewHash=sha(JSON.stringify(next.collectedObservations))}
       catch(e){collectedError=e}
      }
      if(!reviewed){
       try{
        const review=await loadReview(m,Date.now());
        reviewed=await reviewedObservations({m,req:next.adaptiveRequest,review:review.review,evidence:(path,digest)=>verifiedEvidence(p=>read(p,8*1024*1024),path,digest,'PAPER_ADAPTIVE_EVIDENCE_CHANGED')});
        assert(review.expiresAt>Date.now()&&m.receivedAt+maxAgeMs>Date.now(),'PAPER_ADAPTIVE_REVIEW_EXPIRED');
        reviewHash=review.reviewHash;
       }catch(e){throw collectedError??e}
      }
      logMarket=marketLog(m,reviewed,paperEnvironment(reviewed));
      const management=virtualManagement({state:next,row,snapshot,reviewed});
      next=updateAdaptiveSnapshot(next,{snapshot,reviewed,preview:management,reviewHash,now:Date.now()});
      next.adaptiveInputBasis=reviewed.basis??'REVIEWED_MODEL';
      const decided=next.rows.find(r=>r.mode==='adaptive');logDecision=decisionLog(management,{slot:m.slot,observedAt:Date.parse(snapshot.proof.receivedAt),kind:'ADAPTIVE_MODEL',decidedAt:Date.now(),inputHash:reviewHash,input:{basis:reviewed.basis??'REVIEWED_MODEL',asOf:reviewed.asOf,latest:reviewed.latest,observationCount:reviewed.observations.length,observationsHash:sha(JSON.stringify(reviewed.observations)),configHash:sha(JSON.stringify(reviewed.cfg))},outcome:decided.adaptiveReason});
     }catch(e){const reason=errorCode(e,'PAPER_ADAPTIVE_REVIEW_UNAVAILABLE');next={...next,rows:next.rows.map(r=>r.mode==='adaptive'?{...r,pendingAdaptive:null,adaptiveReason:reason}:r)};logDecision=decisionLog(null,{slot:m.slot,observedAt:Date.parse(snapshot.proof.receivedAt),reason,kind:'NO_MODEL_DECISION',decidedAt:Date.now(),outcome:'NO_ACTION'})}
    }
    if(windowCapture==='ENDPOINT')next={...next,window:finishPaperWindow(state.window,'ENDPOINT_OBSERVED',Date.parse(snapshot.proof.receivedAt))};
    next.observationLog={market:logMarket,decision:logDecision,featureCollection:features?{slot:features.slot,observedAt:features.observedAt,sources:features.sources,modelInputStatus:features.modelInputStatus??null,modelInputReason:features.modelInputReason??null}:null,operations:operationLog(state,next,logDecision.selected?beforeDecision:null)};
    next=await save(next,state);
    diagnosticLog({component:'PAPER',event:'MODEL_TICK',status:logDecision.selected?'SELECTED':'NO_ACTION',reason:logDecision.reason??logDecision.outcome});
    if(windowCapture==='ENDPOINT'){await finish(a,'ENDPOINT_OBSERVED');return}
    if(next.snapshotCount>=PAPER_SNAPSHOT_LIMIT){await finish(a,'SNAPSHOT_LIMIT_REACHED');return}
    job={id:a.id,status:'UPDATED_UNVERIFIED',running:true};
    // Feature collection is independent of accounting; never hold the paper writer waiting on remote APIs.
    if(req&&refreshFeatures&&!featureFlight&&Date.now()-lastFeatureAttempt>=60000){
     lastFeatureAttempt=Date.now();const task=Promise.resolve().then(()=>refreshFeatures(m)).then(result=>{if(job?.id===a.id&&job.running)features=result}).catch(()=>{}).finally(()=>{if(featureFlight===task)featureFlight=null});featureFlight=task;
    }
   }catch(e){job={id:a.id,status:'BLOCKED',reason:errorCode(e,'PAPER_AUTO_UPDATE_FAILED'),running:true};
    diagnosticLog({component:'PAPER',event:'UPDATE',status:'BLOCKED',reason:job.reason});
    // No successful endpoint is fabricated on unavailable market data. Stop after grace, retain last committed history.
    try{const last=await checkpoint(a);if(paperWindowExpired(last.window,Date.now())){await finish(a,'MISSED_ENDPOINT',errorCode(e,'PAPER_AUTO_UPDATE_FAILED'))}}catch{}
   }
  })}catch(e){job={id:job?.id,status:'BLOCKED',reason:errorCode(e,'PAPER_AUTO_SCHEDULER_BUSY'),running:true}}
 }
 async function stop(){closed=true;if(flight)await flight.catch(()=>{});if(featureFlight)await featureFlight;snapshotReader=null}
 return {get,context,start,pause,tick,stop,reportCatalog,report,diagnostics};
}

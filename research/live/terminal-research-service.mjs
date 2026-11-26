// Immutable snapshot, historical replay and candidate assembly. No current report binding.
import {readFile,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {currentMarket,requestFromDraft} from './terminal-core.mjs';
import {inputStatus} from './research-input-status.mjs';
import {assembleCandidate,reviewStructureRequired} from './evidence-builder.mjs';
import {snapshotManifest,reviewEvidenceRefs,snapshotFileList} from './research-snapshot.mjs';
import {replayRequest,replayResult} from './research-replay.mjs';
import {assert,sha} from './terminal-runtime.mjs';
export function createResearchArchiveService({ROOT,DATA,cfg,pool,maxAgeMs,validateScope,loadState,loadReview,safeDataPath,boundedRead,archives,run,marketObservations}){
async function researchInputs(scope){
 const now=Date.now();let state=null,m=null,review=null,reason=null;
 try{state=await loadState(scope);m=currentMarket(state,scope,now,maxAgeMs)}catch{reason='MARKET_CAPTURE_UNAVAILABLE'}
 if(m&&snapshotReviewPath(scope)){try{review=(await loadReview(m,now,snapshotReviewPath(scope))).review}catch(e){reason=e.message}}
 else if(m)reason='POOL_RESEARCH_NOT_CONFIGURED';
 return inputStatus({pool:scope,market:m,history:state?.streams?.['history:'+scope],external:marketObservations.external(),holder:m?marketObservations.holder(scope,m.mintX):null,review,reviewReason:reason,now,maxAgeMs});
}
function snapshotReviewPath(scope){const map=cfg.researchReviews;if(map&&typeof map==='object'&&!Array.isArray(map)&&Object.hasOwn(map,scope)&&typeof map[scope]==='string')return map[scope];return scope===pool?cfg.review:null}
async function saveResearchSnapshot(body,pinned=null){
 const scope=validateScope(body?.pool),now=pinned?.at??Date.now(),state=pinned?.state??await loadState(scope),m=currentMarket(state,scope,now,maxAgeMs);
 assert(body.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 const source=await safeDataPath(m.capture),mb=await boundedRead(await safeDataPath(join(source,'manifest.json')),16*1024*1024),manifest=JSON.parse(mb);
 assert(manifest.pool===scope&&manifest.contextSlot===m.slot&&manifest.commitment==='finalized'&&manifest.raw?.file==='accounts.json'&&manifest.raw.sha256===m.rawHash,'SNAPSHOT_RAW_IDENTITY_MISMATCH');
 assert(sha(await boundedRead(await safeDataPath(join(source,'accounts.json')),32*1024*1024))===m.rawHash,'SNAPSHOT_RAW_HASH_MISMATCH');
 let reviewed=null,reviewStatus='NOT_AVAILABLE';
 const reviewPath=snapshotReviewPath(scope);
 if(reviewPath){try{
  const candidate=await loadReview(m,now,reviewPath);reviewStructureRequired(candidate.review,m,now);let budget=64*1024*1024;
  for(const ref of reviewEvidenceRefs(candidate.review)){const b=await boundedRead(await safeDataPath(ref.path),Math.min(budget,8*1024*1024));assert(sha(b)===ref.sha256,'SNAPSHOT_REVIEW_HASH_MISMATCH');budget-=b.length}
  reviewed=candidate;reviewStatus='MATCHED_HASHES_UNVERIFIED';
 }catch{reviewStatus='REVIEW_MISSING_STALE_OR_UNVERIFIED'}}
 const externalLast=marketObservations.external();
 const external=externalLast?.pool===scope&&externalLast.marketSlot===m.slot&&externalLast.marketRawHash===m.rawHash&&externalLast.expiresAt>now?externalLast:null,holder=marketObservations.holder(scope,m.mintX);
 const diagnostic=inputStatus({pool:scope,market:m,history:state.streams?.['history:'+scope],external,holder,review:reviewed?.review,reviewReason:reviewStatus,now,maxAgeMs});
 const frozen={...state,streams:{market:state.streams.market},history:{}};
 for(const [k,x] of Object.entries(state.streams??{}))if(k.startsWith('position:')&&x.status==='CAPTURED_UNVERIFIED'&&x.evidence?.slot===m.slot&&x.evidence?.report?.rawHash===m.rawHash)frozen.streams[k]=x;
 const files=new Map([['state.json',Buffer.from(JSON.stringify(frozen))],['diagnostic.json',Buffer.from(JSON.stringify(diagnostic))],['capture-manifest.json',mb]]);
 if(reviewed)files.set('review.json',reviewed.reviewBytes);
 if(external)files.set('external.json',Buffer.from(JSON.stringify(external)));
 if(diagnostic.holderFeatures&&holder)files.set('holder.json',Buffer.from(JSON.stringify(holder)));
 const out=snapshotManifest({pool:scope,market:m,createdAt:now,files:[...files].map(([name,b])=>({name,sha256:sha(b),bytes:b.length})),reviewStatus,diagnostic});
 const base=join(DATA,'research-snapshots');await mkdir(base,{recursive:true,mode:0o700});const tmp=await mkdtemp(join(base,'.pending-')),dir=join(base,out.snapshotId);
 try{for(const [name,b] of files)await writeFile(join(tmp,name),b,{mode:0o600,flag:'wx'});await writeFile(join(tmp,'manifest.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,dir)}catch(e){await rm(tmp,{recursive:true,force:true});throw e}
 await archives.add({kind:'snapshot',pool:scope,id:out.snapshotId,snapshotId:out.snapshotId,marketSlot:m.slot,marketRawHash:m.rawHash,createdAt:now,status:out.reviewStatus});
 return {...out,capture:relative(ROOT,dir)};
}
async function replayResearchSnapshot(body){
 const scope=validateScope(body?.pool),id=body?.snapshotId;
 assert(typeof id==='string'&&/^[0-9a-f]{64}$/.test(id),'INVALID_SNAPSHOT_ID');
 const dir=await safeDataPath(join(DATA,'research-snapshots',id));
 const manifest=JSON.parse(await boundedRead(await safeDataPath(join(dir,'manifest.json')),128*1024));
 assert(manifest.snapshotId===id&&manifest.pool===scope,'REPLAY_SCOPE_INVALID');
 const files=new Map();
 for(const f of snapshotFileList(manifest)){const b=await boundedRead(await safeDataPath(join(dir,f.name)),f.bytes);files.set(f.name,b)}
 const mode=body.mode??'plans';assert(['plans','management'].includes(mode),'REPLAY_MODE_INVALID');let policyBytes=null,policy=null,position=null;
 if(mode==='management'){position=validateScope(body.position);const entry=cfg.managementPolicies&&Object.hasOwn(cfg.managementPolicies,position)?cfg.managementPolicies[position]:null;assert(entry&&typeof entry.policy==='string','MANAGEMENT_POLICY_NOT_CONFIGURED');policyBytes=await boundedRead(await safeDataPath(entry.policy),32768);policy=JSON.parse(policyBytes)}
 const x=replayRequest(manifest,files,{pool:scope,snapshotId:id,draft:body.draft,mode,position,policy});
 const source=await safeDataPath(x.market.capture);
 assert(sha(await boundedRead(await safeDataPath(join(source,'manifest.json')),16*1024*1024))===sha(files.get('capture-manifest.json')),'REPLAY_CAPTURE_MANIFEST_CHANGED');
 assert(sha(await boundedRead(await safeDataPath(join(source,'accounts.json')),32*1024*1024))===x.market.rawHash,'REPLAY_CAPTURE_HASH_MISMATCH');
 let budget=64*1024*1024;for(const r of x.evidence){const b=await boundedRead(await safeDataPath(r.path),Math.min(budget,8*1024*1024));assert(sha(b)===r.sha256,'REPLAY_EVIDENCE_CHANGED');budget-=b.length}
 const sourcePaths=['research/engine.mjs','research/integer.mjs','research/live/analyze-state.mjs','research/live/engine-input.mjs','research/live/preview-plans.mjs','research/live/research-replay.mjs','research/live/research-snapshot.mjs','research/live/terminal-core.mjs','research/live/quote-evidence.mjs','research/live/external-market.mjs','research/live/reference-math.mjs','research/live/research-input-status.mjs','research/live/market-features.mjs','research/live/evidence-builder.mjs','research/live/preview-management.mjs','research/live/research-catalog.mjs','research/live/terminal-research-service.mjs','research/live/terminal-market-service.mjs','research/live/terminal-runtime.mjs'];
 const code=()=>Promise.all(sourcePaths.map(async path=>({path,sha256:sha(await readFile(join(ROOT,path)))})));
 const sourceHashes=await code(),base=join(DATA,'research-runs',scope);await mkdir(base,{recursive:true,mode:0o700});
 const tmp=await mkdtemp(join(base,'.pending-'));
 try{
  // Use verified bytes, not mutable service state or the current review config.
  await writeFile(join(tmp,'state.json'),files.get('state.json'),{mode:0o600,flag:'wx'});
  await writeFile(join(tmp,'review.json'),files.get('review.json'),{mode:0o600,flag:'wx'});
  await writeFile(join(tmp,'request.json'),JSON.stringify(x.request),{mode:0o600,flag:'wx'});
  if(policyBytes)await writeFile(join(tmp,'policy.json'),policyBytes,{mode:0o600,flag:'wx'});
  const report=await run(['--state',join(tmp,'state.json'),'--request',join(tmp,'request.json'),'--review',join(tmp,'review.json'),mode==='management'?'--management':'--plans']);
  assert(JSON.stringify(await code())===JSON.stringify(sourceHashes),'REPLAY_CODE_CHANGED');
  const out=replayResult({manifest,request:x.request,report,sourceHashes,generatedAt:Date.now(),policyHash:policyBytes?sha(policyBytes):null,owner:x.owner});
  await writeFile(join(tmp,'report.json'),JSON.stringify(report),{mode:0o600,flag:'wx'});
  await writeFile(join(tmp,'manifest.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600,flag:'wx'});
  const resultDir=join(base,out.runId);await rename(tmp,resultDir);
  await archives.add({kind:'run',pool:scope,id:out.runId,snapshotId:id,marketSlot:out.marketSlot,marketRawHash:out.marketRawHash,createdAt:out.generatedAt,status:out.status,mode,position:out.position??null});
  return {...out,report,capture:relative(ROOT,resultDir)};
 }catch(e){await rm(tmp,{recursive:true,force:true});throw e}
}
async function buildResearchCandidate(body){
 const scope=validateScope(body?.pool),state=await loadState(scope),m=currentMarket(state,scope,Date.now(),maxAgeMs);
 assert(body.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 if(body.draft)requestFromDraft(body.draft,m);
 const sourceErrors=[];let clock=null;
 const reason=(name,e)=>sourceErrors.push({source:name,reason:/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'SOURCE_CAPTURE_FAILED'});
 // Read independent sources concurrently; do not silently substitute later market state.
 await Promise.all([
  marketObservations.captureMarketTime(m).then(x=>{clock=x}).catch(e=>reason('CHAIN_TIME',e)),
  (async()=>{try{await marketObservations.externalObservation({pool:scope},m)}catch(e){reason('EXTERNAL',e)}})(),
  (async()=>{try{await marketObservations.holderObservation({pool:scope},m)}catch(e){reason('HOLDER',e)}})()
 ]);
 const at=Date.now();currentMarket(state,scope,at,maxAgeMs);
 const snapshot=await saveResearchSnapshot({pool:scope,marketSlot:m.slot,marketRawHash:m.rawHash},{state,at});
 const diagnostic=JSON.parse(await boundedRead(await safeDataPath(join(snapshot.capture,'diagnostic.json')),8*1024*1024));
 const candidate=assembleCandidate({market:m,snapshot,diagnostic,clock,sourceErrors,createdAt:at});
 const base=join(DATA,'research-candidates',scope);await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'.pending-')),dest=join(base,candidate.candidateId);
 try{await writeFile(join(dir,'manifest.json'),JSON.stringify(candidate,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(dir,dest)}catch(e){await rm(dir,{recursive:true,force:true});throw e}
 await archives.add({kind:'candidate',pool:scope,id:candidate.candidateId,snapshotId:snapshot.snapshotId,marketSlot:m.slot,marketRawHash:m.rawHash,createdAt:at,status:'RESEARCH_CANDIDATE_ONLY'});
 let replay=null,replayReason=null;
 if(body.draft&&candidate.replayEligible){try{replay=await replayResearchSnapshot({pool:scope,snapshotId:snapshot.snapshotId,draft:body.draft})}catch(e){replayReason=/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'REPLAY_VALIDATION_FAILED'}}
 else replayReason=body.draft?'MATCHED_REVIEW_REQUIRED':'EXPLICIT_RESEARCH_BUDGET_REQUIRED';
 return {...candidate,capture:relative(ROOT,dest),replay,replayReason};
}

async function loadResearchRun(body){
   const scope=validateScope(body.pool),id=body.runId;assert(typeof id==='string'&&/^[0-9a-f]{64}$/.test(id),'INVALID_RUN_ID');
   const dir=await safeDataPath(join(DATA,'research-runs',scope,id)),m=JSON.parse(await boundedRead(await safeDataPath(join(dir,'manifest.json')),128*1024)),{runId,...rest}=m;
   assert(runId===id&&sha(JSON.stringify(rest))===id&&m.pool===scope&&m.scope==='HISTORICAL_RESEARCH_ONLY'&&m.executionReady===false&&m.decisionReady===false&&m.pnlReady===false,'RUN_MANIFEST_INVALID');
   const bytes=await boundedRead(await safeDataPath(join(dir,'report.json')),8*1024*1024),reqBytes=await boundedRead(await safeDataPath(join(dir,'request.json')),32768);
   assert(sha(bytes)===m.reportHash&&sha(reqBytes)===m.requestHash,'RUN_ARTIFACT_HASH_MISMATCH');
   if(m.mode==='management')assert(sha(await boundedRead(await safeDataPath(join(dir,'policy.json')),32768))===m.policyHash,'RUN_POLICY_HASH_MISMATCH');
   const report=JSON.parse(bytes);assert(report.pool===scope&&!report.terminalBinding&&!report.reviewId&&report.decisionReady===false&&report.executionReady===false,'RUN_REPORT_SCOPE');
   return {...m,report};
}
 return {researchInputs,saveResearchSnapshot,replayResearchSnapshot,buildResearchCandidate,loadResearchRun};
}

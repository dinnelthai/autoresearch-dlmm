import {analyzeState} from './analyze-state.mjs';
// Immutable snapshot, historical replay and candidate assembly. No current report binding.
import {mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {currentMarket,requestFromDraft} from './terminal-core.mjs';
import {inputStatus} from './research-input-status.mjs';
import {assembleCandidate,reviewStructureRequired} from './evidence-builder.mjs';
import {snapshotManifest,reviewEvidenceRefs,snapshotFileList} from './research-snapshot.mjs';
import {replayRequest,replayResult} from './research-replay.mjs';
import {assert,errorCode,hash} from './research-contract.mjs';
import {sha,verifiedEvidence} from './evidence-digest.mjs';
export function createResearchArchiveService({ROOT,DATA,cfg,pool,maxAgeMs,validateScope,loadState,loadReview,safeDataPath,boundedRead,archives,marketObservations,sourceHashes}){
const read=(path,limit)=>safeDataPath(path).then(p=>boundedRead(p,limit));
async function saveArchive(base,id,manifest,files=[]){
 await mkdir(base,{recursive:true,mode:0o700});
 const tmp=await mkdtemp(join(base,'.pending-')),dir=join(base,id);
 try{for(const [name,b] of files)await writeFile(join(tmp,name),b,{mode:0o600,flag:'wx'});await writeFile(join(tmp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,dir);return dir}
 catch(e){await rm(tmp,{recursive:true,force:true});throw e}
}
async function reviewedBytes(refs,reason){
 let budget=64*1024*1024;const files=new Map();
 for(const r of refs){const b=await verifiedEvidence(p=>read(p,Math.min(budget,8*1024*1024)),r.path,r.sha256,reason);budget-=b.length;files.set(r.path,b)}
 return files;
}
async function researchInputs(scope){
 const now=Date.now();let state=null,m=null,review=null,reason=null;
 try{state=await loadState(scope);m=currentMarket(state,scope,now,maxAgeMs)}catch{reason='MARKET_CAPTURE_UNAVAILABLE'}
 if(m&&snapshotReviewPath(scope)){try{review=(await loadReview(m,now,snapshotReviewPath(scope))).review}catch(e){reason=errorCode(e,'REVIEW_VALIDATION_FAILED')}}
 else if(m)reason='POOL_RESEARCH_NOT_CONFIGURED';
 return inputStatus({pool:scope,market:m,history:state?.streams?.['history:'+scope],external:marketObservations.external(scope),holder:m?marketObservations.holder(scope,m.mintX):null,review,reviewReason:reason,now,maxAgeMs});
}
function snapshotReviewPath(scope){const map=cfg.researchReviews;if(map&&typeof map==='object'&&!Array.isArray(map)&&Object.hasOwn(map,scope)&&typeof map[scope]==='string')return map[scope];return scope===pool?cfg.review:null}
async function captureResearchSnapshot(body,pinned=null){
 const scope=validateScope(body?.pool),now=pinned?.at??Date.now(),state=pinned?.state??await loadState(scope),m=currentMarket(state,scope,now,maxAgeMs);
 assert(body.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 const source=await safeDataPath(m.capture),mb=await boundedRead(await safeDataPath(join(source,'manifest.json')),16*1024*1024),manifest=JSON.parse(mb);
 assert(manifest.pool===scope&&manifest.contextSlot===m.slot&&manifest.commitment==='finalized'&&manifest.raw?.file==='accounts.json'&&manifest.raw.sha256===m.rawHash,'SNAPSHOT_RAW_IDENTITY_MISMATCH');
 assert(sha(await boundedRead(await safeDataPath(join(source,'accounts.json')),32*1024*1024))===m.rawHash,'SNAPSHOT_RAW_HASH_MISMATCH');
 let reviewed=null,reviewStatus='NOT_AVAILABLE';
 const reviewPath=snapshotReviewPath(scope);
 if(reviewPath){try{
  const candidate=await loadReview(m,now,reviewPath);reviewStructureRequired(candidate.review,m,now);
  await reviewedBytes(reviewEvidenceRefs(candidate.review),'SNAPSHOT_REVIEW_HASH_MISMATCH');
  reviewed=candidate;reviewStatus='MATCHED_HASHES_UNVERIFIED';
 }catch{reviewStatus='REVIEW_MISSING_STALE_OR_UNVERIFIED'}}
 const externalLast=marketObservations.external(scope);
 const external=externalLast?.pool===scope&&externalLast.marketSlot===m.slot&&externalLast.marketRawHash===m.rawHash&&externalLast.expiresAt>now?externalLast:null,holder=marketObservations.holder(scope,m.mintX);
 const diagnostic=inputStatus({pool:scope,market:m,history:state.streams?.['history:'+scope],external,holder,review:reviewed?.review,reviewReason:reviewStatus,now,maxAgeMs});
 if(pinned?.collection)diagnostic.collection=pinned.collection;
 const frozen={...state,streams:{market:state.streams.market},history:{}};
 for(const [k,x] of Object.entries(state.streams??{}))if(k.startsWith('position:')&&x.status==='CAPTURED_UNVERIFIED'&&x.evidence?.slot===m.slot&&x.evidence?.report?.rawHash===m.rawHash)frozen.streams[k]=x;
 const files=new Map([['state.json',Buffer.from(JSON.stringify(frozen))],['diagnostic.json',Buffer.from(JSON.stringify(diagnostic))],['capture-manifest.json',mb]]);
 if(reviewed)files.set('review.json',reviewed.reviewBytes);
 if(external)files.set('external.json',Buffer.from(JSON.stringify(external)));
 if(diagnostic.holderFeatures&&holder)files.set('holder.json',Buffer.from(JSON.stringify(holder)));
 const out=snapshotManifest({pool:scope,market:m,createdAt:now,files:[...files].map(([name,b])=>({name,sha256:sha(b),bytes:b.length})),reviewStatus,diagnostic});
 const dir=await saveArchive(join(DATA,'research-snapshots'),out.snapshotId,out,files);
 await archives.add({kind:'snapshot',pool:scope,id:out.snapshotId,snapshotId:out.snapshotId,marketSlot:m.slot,marketRawHash:m.rawHash,createdAt:now,status:out.reviewStatus});
 return {snapshot:{...out,capture:relative(ROOT,dir)},diagnostic};
}
async function saveResearchSnapshot(body){return (await captureResearchSnapshot(body)).snapshot}
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
 // Freeze verified evidence once. The calculation consumes exactly these bytes.
 const manifestPath=join(x.market.capture,'manifest.json'),accountsPath=join(x.market.capture,'accounts.json');
 const mb=await read(manifestPath,16*1024*1024),ab=await read(accountsPath,32*1024*1024);
 assert(sha(mb)===sha(files.get('capture-manifest.json')),'REPLAY_CAPTURE_MANIFEST_CHANGED');
 assert(sha(ab)===x.market.rawHash,'REPLAY_CAPTURE_HASH_MISMATCH');
 const evidence=await reviewedBytes(x.evidence,'REPLAY_EVIDENCE_CHANGED');
 evidence.set(manifestPath,mb);evidence.set(accountsPath,ab);
 const report=await analyzeState({state:JSON.parse(files.get('state.json')),req:x.request,review:x.review,plans:mode==='plans',management:mode==='management',readData:async path=>{assert(evidence.has(path),'REPLAY_EVIDENCE_UNAVAILABLE');return evidence.get(path)}});
 const out=replayResult({manifest,request:x.request,report,sourceHashes,generatedAt:Date.now(),policyHash:policyBytes?sha(policyBytes):null,owner:x.owner});
 // State and review already live in the linked immutable snapshot; do not duplicate them in each run.
 const artifacts=[['request.json',JSON.stringify(x.request)],['report.json',JSON.stringify(report)]];
 if(policyBytes)artifacts.push(['policy.json',policyBytes]);
 const resultDir=await saveArchive(join(DATA,'research-runs',scope),out.runId,out,artifacts);
 await archives.add({kind:'run',pool:scope,id:out.runId,snapshotId:id,marketSlot:out.marketSlot,marketRawHash:out.marketRawHash,createdAt:out.generatedAt,status:out.status,mode,position:out.position??null});
 return {...out,report,capture:relative(ROOT,resultDir)};
}
async function buildResearchCandidate(body){
 const scope=validateScope(body?.pool),state=await loadState(scope),m=currentMarket(state,scope,Date.now(),maxAgeMs);
 assert(body.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 if(body.draft)requestFromDraft(body.draft,m);
 const sourceErrors=[];let clock=null;
 const reason=(name,e)=>sourceErrors.push({source:name,reason:errorCode(e,'SOURCE_CAPTURE_FAILED')});
 // Read independent sources concurrently; do not silently substitute later market state.
 await Promise.all([
  marketObservations.captureMarketTime(m).then(x=>{clock=x}).catch(e=>reason('CHAIN_TIME',e)),
  (async()=>{try{await marketObservations.externalObservation({pool:scope},m)}catch(e){reason('EXTERNAL',e)}})(),
  (async()=>{try{await marketObservations.holderObservation({pool:scope},m)}catch(e){reason('HOLDER',e)}})()
 ]);
 const at=Date.now();currentMarket(state,scope,at,maxAgeMs);
 const {snapshot,diagnostic}=await captureResearchSnapshot({pool:scope,marketSlot:m.slot,marketRawHash:m.rawHash},{state,at,collection:{clock,sourceErrors}});
 const candidate=assembleCandidate({market:m,snapshot,diagnostic,clock,sourceErrors,createdAt:at});
 let replay=null,replayReason=null;
 if(body.draft&&candidate.replayEligible){try{replay=await replayResearchSnapshot({pool:scope,snapshotId:snapshot.snapshotId,draft:body.draft})}catch(e){replayReason=errorCode(e,'REPLAY_VALIDATION_FAILED')}}
 else replayReason=body.draft?'MATCHED_REVIEW_REQUIRED':'EXPLICIT_RESEARCH_BUDGET_REQUIRED';
 return {...candidate,capture:snapshot.capture,replay,replayReason};
}

async function loadResearchRun(body){
   const scope=validateScope(body.pool),id=body.runId;assert(hash(id),'INVALID_RUN_ID');
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

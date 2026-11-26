// T12 formal terminal, single configured Pool. Localhost only, no signing.
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile,rm,realpath,rename,open,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {buildReview,assertSameReview} from './review-core.mjs';
import {allocationDiagnostic} from './allocation-diagnostic.mjs';
import {sdkWeightDiagnostic} from './sdk-weight-diagnostic.mjs';
import {validateWalletEvidence,walletReview} from './wallet-evidence-core.mjs';
import {parseArgs} from 'node:util';
import {PublicKey} from '@solana/web3.js';
import {poolAddress,currentMarket,requestFromDraft,reviewMatches,positionCapture,managementRequest,marketDisplay,scopedTerminalRequest} from './terminal-core.mjs';
import {observationKey,summarizeRisk,emptyLedger,recoverLedger,record,visibleObservation} from './monitor-core.mjs';
import {getPriceHistory} from './price-history.mjs';
import {getPoolInfo,cachedLoader} from './market-api.mjs';
import {observeExternalMarket} from './external-market.mjs';
import {inputStatus} from './research-input-status.mjs';
import {captureHolderFeatures} from './capture-holder-features.mjs';
import {cohortChange} from './market-features.mjs';
import {featureSeries} from './feature-series.mjs';
import {verifyQuoteEvidence} from './quote-evidence.mjs';
import {createReadRpc} from './rpc-read.mjs';
import {chainTimeFact,assembleCandidate,reviewStructureRequired} from './evidence-builder.mjs';
import {snapshotManifest,reviewEvidenceRefs,snapshotFileList} from './research-snapshot.mjs';
import {replayRequest,replayResult} from './research-replay.mjs';
import {researchCatalog} from './research-catalog.mjs';
import {positionIndex,positionDetail} from './wallet-position-core.mjs';
import {positionObservation,ledgerProjection,windowLedger} from './position-observation-workflow.mjs';
import {assembleLedger} from './position-ledger-core.mjs';
import {incrementalLedgerStore,nextLedgerPage,appendLedgerPage} from './incremental-ledger.mjs';
import {diagnosticLog} from './diagnostic-log.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data');
const {values}=parseArgs({options:{config:{type:'string'},port:{type:'string',default:'8790'},help:{type:'boolean'}}});
if(values.help){console.log('node research/live/terminal-server.mjs --config data/terminal-config.json [--port 8790]');process.exit(0)}
const assert=(x,m)=>{if(!x)throw Error(m)},sha=x=>createHash('sha256').update(x).digest('hex');
assert(values.config,'CONFIG_REQUIRED');
const cfg=JSON.parse(await readFile(values.config,'utf8')),pool=cfg.pool,port=Number(values.port),maxAgeMs=(cfg.maxAgeSeconds??180)*1000;
assert(poolAddress(pool)&&Number.isInteger(port)&&port>=1024&&port<=65535&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=15000&&maxAgeMs<=600000,'INVALID_CONFIG');
const additionalPools=cfg.researchPools??[];assert(Array.isArray(additionalPools)&&additionalPools.length<=8&&additionalPools.every(p=>poolAddress(p)&&new PublicKey(p).toBase58()===p&&p!==pool)&&new Set(additionalPools).size===additionalPools.length,'INVALID_RESEARCH_POOLS');
const configuredPools=new Set([pool,...additionalPools]);
const origin='http://127.0.0.1:'+port;
async function safeDataPath(path){const root=await realpath(DATA),p=await realpath(resolve(ROOT,path)),rel=relative(root,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'INVALID_DATA_PATH');return p}
async function boundedRead(path,limit){const h=await open(path,'r');try{const st=await h.stat();assert(st.isFile()&&st.size<=limit,'EVIDENCE_SIZE_EXCEEDED');const bytes=Buffer.alloc(st.size+1);let n=0;while(n<bytes.length){const r=await h.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}assert(n===st.size,'EVIDENCE_SIZE_CHANGED');return bytes.subarray(0,n)}finally{await h.close()}}
async function loadState(scope=pool){
 const path=join(DATA,configuredPools.has(scope)?'live':'live-preview',scope,'state.json');
 return JSON.parse(await boundedRead(await safeDataPath(path),64*1024*1024));
}
const archives=researchCatalog(DATA,async(path,limit)=>boundedRead(await safeDataPath(path),limit));
const previewCfg=cfg.dynamicCapture??{};
const previewAttempts=new Map();
let previewJob=null,previewChild=null;
function validateScope(scope){assert(poolAddress(scope)&&new PublicKey(scope).toBase58()===scope,'INVALID_POOL_ADDRESS');return scope}
function startPreviewCapture(scope){
 if(stopping||configuredPools.has(scope)||previewCfg.enabled===false)return 'DISABLED';
 if(previewJob)return previewJob.pool===scope?'COLLECTING':'COLLECTOR_BUSY';
 const now=Date.now(),last=previewAttempts.get(scope);
 if(last!==undefined&&now-last<30000)return 'RETRY_COOLDOWN';
 previewAttempts.delete(scope);previewAttempts.set(scope,now);while(previewAttempts.size>8)previewAttempts.delete(previewAttempts.keys().next().value);
 const job={pool:scope};previewJob=job;
 job.done=(async()=>{
  const base=join(DATA,'terminal');await mkdir(base,{recursive:true,mode:0o700});
  const dir=await mkdtemp(join(base,'preview-'));
  try{
   const path=join(dir,'config.json');
   await writeFile(path,JSON.stringify({pool:scope,positions:[],references:[],provider:previewCfg.provider??'solana-rpc',idl:previewCfg.idl??'data/raw/dlmm-idl.json',pollSeconds:60,maxAgeSeconds:180,historyPages:1,historyLimit:1}),{mode:0o600});
   if(stopping)return;
   await new Promise((ok,fail)=>{
    const child=spawn(process.execPath,[join(ROOT,'research/live/state-service.mjs'),'--config',path,'--once','--market-only'],{cwd:ROOT,env:process.env,stdio:'ignore'});
    previewChild=child;let hard=null;
    const terminate=()=>{child.kill('SIGTERM');hard=setTimeout(()=>child.kill('SIGKILL'),10000)};
    const timer=setTimeout(terminate,180000);
    const cleanup=()=>{clearTimeout(timer);if(hard)clearTimeout(hard);if(previewChild===child)previewChild=null};
    child.once('error',e=>{cleanup();fail(e)});child.once('close',()=>{cleanup();ok()});
   });
  }finally{await rm(dir,{recursive:true,force:true})}
 })().catch(()=>{}).finally(()=>{if(previewJob===job)previewJob=null});
 return 'COLLECTING';
}
function marketSummary(m){return {slot:m.slot,rawHash:m.rawHash,activeId:m.activeId,binStep:m.binStep,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,decimalsY:m.decimalsY,receivedAt:m.receivedAt,binCount:m.bins.length,expiresAt:m.receivedAt+maxAgeMs,display:marketDisplay(m)}}
async function scopedOverview(scope){
 if(scope===pool)return overview();
 validateScope(scope);
 let market=null,sequence=null,reason='POOL_CAPTURE_PENDING',collection='IDLE';
 try{const s=await loadState(scope),now=Date.now();sequence=s.sequence;const m=currentMarket(s,scope,now,maxAgeMs);market=marketSummary(m);if(!configuredPools.has(scope)&&now-m.receivedAt>=Math.min(60000,maxAgeMs/2))collection=startPreviewCapture(scope)}
 catch{collection=startPreviewCapture(scope);reason=configuredPools.has(scope)?'RESEARCH_COLLECTOR_UNAVAILABLE':collection==='DISABLED'?'DYNAMIC_CAPTURE_DISABLED':collection==='COLLECTOR_BUSY'?'POOL_COLLECTOR_BUSY':collection==='RETRY_COOLDOWN'?'POOL_CAPTURE_RETRY_COOLDOWN':'POOL_CAPTURE_PENDING'}
 return {pool:scope,sequence,status:market?'CAPTURED_UNVERIFIED':'BLOCKED',reason:market?null:reason,market,collection,reviewGate:{status:'BLOCKED',reason:'POOL_RESEARCH_NOT_CONFIGURED'},positions:[],monitoring:[],streams:{},decisionReady:false,executionReady:false,freshnessBasis:'LOCAL_RECEIPT_ONLY',scope:configuredPools.has(scope)?'SCOPED_RESEARCH_ONLY':'MARKET_PREVIEW_ONLY'};
}
const html=await readFile(join(ROOT,'research/live/terminal.html'));
const startup={apiVersion:'flow-data-v9',startedAt:Date.now(),htmlHash:sha(html),serverHash:sha(await readFile(fileURLToPath(import.meta.url)))};
let busy=false,monitorTimer=null,monitorJob=null,stopping=false,monitorLock=null,monitorLockPath=null,monitorFile=null,monitorCursor=0,monitorError=null,monitorLastCycle=null;
const monitorEnabled=cfg.monitoring?.enabled===true,monitorSeconds=cfg.monitoring?.intervalSeconds??30;
assert(Number.isInteger(monitorSeconds)&&monitorSeconds>=15&&monitorSeconds<=600,'INVALID_MONITOR_INTERVAL');
let ledger=emptyLedger(pool);
async function jsonBody(req){assert(req.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED');let size=0,parts=[];for await(const b of req){size+=b.length;assert(size<=32768,'BODY_TOO_LARGE');parts.push(b)}return JSON.parse(Buffer.concat(parts).toString('utf8'))}
function run(args,script='analyze-state.mjs',timeout=30000){return new Promise((ok,fail)=>{const p=spawn(process.execPath,[join(ROOT,'research/live',script),...args],{cwd:ROOT,stdio:['ignore','pipe','ignore']});let parts=[],size=0,failed=false;const timer=setTimeout(()=>{failed=true;p.kill('SIGKILL')},timeout);p.stdout.on('data',b=>{size+=b.length;if(size>8*1024*1024){failed=true;p.kill('SIGKILL')}else parts.push(b)});p.once('error',e=>{clearTimeout(timer);fail(e)});p.once('close',()=>{clearTimeout(timer);try{assert(!failed,'ANALYSIS_TIMEOUT_OR_SIZE');ok(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){fail(e)}})})}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
function blocked(reason){return {schemaVersion:1,pool,status:'BLOCKED',decisionReady:false,executionReady:false,gaps:[reason]}}
// Review availability is a preflight, not verification of its underlying evidence.
async function loadReview(m,now,path=cfg.review){
 assert(path,'REVIEW_NOT_CONFIGURED');
 let bytes;try{bytes=await boundedRead(await safeDataPath(path),8*1024*1024)}catch{throw Error('REVIEW_FILE_UNAVAILABLE')}
 let review;try{review=JSON.parse(bytes)}catch{throw Error('REVIEW_JSON_INVALID')}
 reviewMatches(review,m,now);
 const latest=review.observations.at(-1);assert(Array.isArray(latest.references)&&latest.references.length>=2&&latest.references.every(r=>Number.isSafeInteger(r.observedAt)&&r.observedAt<=latest.t&&now/1000-r.observedAt<review.maxAgeSeconds),'REVIEW_REFERENCE_STALE_OR_MISSING');
 const expiry=(Math.min(review.asOf,review.marketObservedAt,latest.t,...latest.references.map(r=>r.observedAt))+review.maxAgeSeconds)*1000;
 return {review,reviewBytes:bytes,reviewHash:sha(bytes),expiresAt:expiry};
}
async function managementContext(s,m,address,now){
 const p=positionCapture(s,m,address,now,maxAgeMs);
 assert(p.commonMarketCapture,'POSITION_MARKET_CAPTURE_MISMATCH');
 const entry=cfg.managementPolicies?.[address];
 assert(entry&&typeof entry.policy==='string','MANAGEMENT_POLICY_NOT_CONFIGURED');
 let bytes;try{bytes=await boundedRead(await safeDataPath(entry.policy),32768)}catch{throw Error('MANAGEMENT_POLICY_UNAVAILABLE')}
 let policy;try{policy=JSON.parse(bytes)}catch{throw Error('MANAGEMENT_POLICY_INVALID')}
 const request=managementRequest(policy,m,p.report);
 const r=await loadReview(m,now,entry.review??cfg.review);
 assert(!r.review.operations||r.review.operations.position===address,'MANAGEMENT_HISTORY_POSITION_MISMATCH');
 return {p,request,policyHash:sha(bytes),...r,expiresAt:Math.min(p.expiresAt,m.receivedAt+maxAgeMs,r.expiresAt)};
}
async function overview(){
 const s=await loadState(),now=Date.now();assert(s.pool===pool&&s.schemaVersion===1&&s.decisionReady===false&&Number.isSafeInteger(s.sequence),'STATE_IDENTITY_MISMATCH');const streams=Object.fromEntries(Object.entries(s.streams??{}).map(([k,v])=>[k,{status:v.status,receivedAt:v.receivedAt??null,locallyFresh:Number.isSafeInteger(v.receivedAt)&&v.receivedAt<=now&&now-v.receivedAt<=maxAgeMs,...(k.startsWith('history:')?{historyStatus:v.evidence?.historyStatus??null,repairStatus:v.evidence?.repair?.status??s.history?.[k.slice(8)]?.repair?.status??null,repairCapture:v.evidence?.repairCapture===true,historyComplete:false,gapCount:v.evidence?.gapCount??v.evidence?.decoded?.gaps?.length??null,gapReasons:v.evidence?.gapReasons??[...new Set((v.evidence?.decoded?.gaps??[]).map(g=>g.reason))].slice(0,20),signatureCount:v.evidence?.signatureCount??v.evidence?.decoded?.transactions?.length??null}: {})}]));
 const positions=[];for(const [k,v] of Object.entries(s.streams??{})){const p=v.evidence?.report;if(k.startsWith('position:')&&v.status==='CAPTURED_UNVERIFIED'&&streams[k].locallyFresh&&p?.pool===pool&&p.position===k.slice(9)&&p.status==='POSITION_CALCULATED_UNVERIFIED')positions.push(p)}
 let market=null,marketModel=null,reason=null,reviewGate={status:'BLOCKED',reason:'MARKET_UNAVAILABLE'};try{const m=currentMarket(s,pool,now,maxAgeMs);marketModel=m;market=marketSummary(m);try{const r=await loadReview(m,now);reviewGate={status:'PREFLIGHT_MATCHED_UNVERIFIED',reviewHash:r.reviewHash,expiresAt:r.expiresAt}}catch(e){reviewGate={status:'BLOCKED',reason:e.message}}}catch(e){reason=e.message}
 const monitoring=[];
 const addresses=new Set([...Object.keys(s.streams??{}).filter(k=>k.startsWith('position:')).map(k=>k.slice(9)),...Object.keys(cfg.managementPolicies??{})]);
 for(const address of addresses){
  if(!poolAddress(address))continue;
  const item={position:address,status:'BLOCKED',rangeState:'UNKNOWN',reason:'POSITION_CAPTURE_UNAVAILABLE',managementGate:{status:'BLOCKED',reason:'POSITION_CAPTURE_UNAVAILABLE'}};
  try{
   const p=positionCapture(s,marketModel,address,now,maxAgeMs);
   Object.assign(item,{status:'CAPTURED_UNVERIFIED',rangeState:p.rangeState,slot:p.report.slot,rawHash:p.report.rawHash,expiresAt:p.expiresAt,commonMarketCapture:p.commonMarketCapture,reason:null});
   try{
    assert(marketModel,'MARKET_UNAVAILABLE');const v=await managementContext(s,marketModel,address,now);
    item.managementGate={status:'PREFLIGHT_MATCHED_UNVERIFIED',policyHash:v.policyHash,reviewHash:v.reviewHash,expiresAt:v.expiresAt,request:v.request};
   }catch(e){item.managementGate={status:'BLOCKED',reason:e.message}}
  }catch(e){item.reason=e.message;item.managementGate.reason=e.message}
  monitoring.push(item);
 }
 return {pool,sequence:s.sequence??null,monitoring,status:market?'CAPTURED_UNVERIFIED':'BLOCKED',reason,market,reviewGate,positions,streams,decisionReady:false,executionReady:false,freshnessBasis:'LOCAL_RECEIPT_ONLY'};
}
async function preview(body,mode='plans'){
 const now=Date.now(),s=await loadState(),m=currentMarket(s,pool,now,maxAgeMs);
 assert(body?.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 let ctx=null,request,review,reviewBytes,reviewHash,expiresAt;
 if(mode==='management'){
  ctx=await managementContext(s,m,body.position,now);
  assert(body.positionSlot===ctx.p.report.slot&&body.positionRawHash===ctx.p.report.rawHash,'POSITION_CHANGED_REFRESH_REQUIRED');
  assert(body.policyHash===ctx.policyHash,'MANAGEMENT_POLICY_CHANGED_REFRESH_REQUIRED');
  ({request,review,reviewBytes,reviewHash,expiresAt}=ctx);
 }else{request=requestFromDraft(body.draft,m);({review,reviewBytes,reviewHash,expiresAt}=await loadReview(m,now))}
 assert(body.reviewHash===reviewHash,'REVIEW_CHANGED_REFRESH_REQUIRED');
 const base=join(DATA,'terminal');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'analysis-'));
 try{
  const requestJson=JSON.stringify(request),requestHash=sha(requestJson);
  for(const [name,data] of [['state',JSON.stringify(s)],['request',requestJson],['review',reviewBytes]])await writeFile(join(dir,name+'.json'),data,{mode:0o600});
  const r=await run(['--state',join(dir,'state.json'),'--request',join(dir,'request.json'),'--review',join(dir,'review.json'),mode==='management'?'--management':'--plans']);
  assert(r.pool===pool&&r.decisionReady===false&&r.executionReady===false,'ANALYSIS_CONTRACT_MISMATCH');
  if(r.market)assert(r.market.slot===m.slot&&r.market.rawHash===m.rawHash,'ANALYSIS_SNAPSHOT_MISMATCH');
  const latestState=await loadState(),latest=currentMarket(latestState,pool,Date.now(),maxAgeMs);assert(latest.slot===m.slot&&latest.rawHash===m.rawHash,'MARKET_CHANGED_DURING_ANALYSIS');const after=mode==='management'?await managementContext(latestState,latest,body.position,Date.now()):await loadReview(latest,Date.now());assert(after.reviewHash===reviewHash,'REVIEW_CHANGED_DURING_ANALYSIS');
  if(ctx){assert(after.policyHash===ctx.policyHash&&after.p.report.rawHash===ctx.p.report.rawHash&&after.p.report.slot===ctx.p.report.slot&&after.p.report.owner===ctx.p.report.owner,'POSITION_OR_POLICY_CHANGED_DURING_ANALYSIS');if(r.managementPreview?.status==='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED')assert(r.managementPreview.position?.address===body.position&&r.managementPreview.position?.owner===ctx.p.report.owner,'MANAGEMENT_REPORT_IDENTITY_MISMATCH')}
  const finalNow=Date.now(),boundExpiry=Math.min(expiresAt,after.expiresAt,m.receivedAt+maxAgeMs,latest.receivedAt+maxAgeMs);assert(boundExpiry>finalNow,'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
  return {...r,terminalBinding:{requestHash,reviewHash,...(mode==='plans'?{researchBudget:{solRaw:request.solRaw,memeRaw:request.memeRaw,allowDispose:false,minSolReserve:request.riskConfig.minSolReserve,operationCostSol:request.riskConfig.operationCostSol}}:{}),...(ctx?{position:body.position,policyHash:ctx.policyHash,positionSlot:ctx.p.report.slot,positionRawHash:ctx.p.report.rawHash}:{}),expiresAt:boundExpiry,marketSlot:m.slot,marketRawHash:m.rawHash,sequence:s.sequence,generatedAt:Date.now(),scope:'RESEARCH_ONLY'}};
 }finally{await rm(dir,{recursive:true,force:true})}
}
function publicMonitor(){
 const now=Date.now();return {pool,enabled:monitorEnabled,intervalSeconds:monitorSeconds,lastCycleAt:monitorLastCycle,storageError:monitorError,decisionReady:false,executionReady:false,current:Object.fromEntries(Object.entries(ledger.current).map(([k,v])=>[k,visibleObservation(v,now)])),events:ledger.events.slice(-100),historyLimit:500};
}
async function persistMonitor(){
 const tmp=monitorFile+'.tmp';
 await writeFile(tmp,JSON.stringify(ledger)+'\n',{mode:0o600});await rename(tmp,monitorFile);
}
async function monitorCycle(){
 if(stopping||busy||monitorError)return;
 // Share the same bounded analysis slot with manual requests; no parallel runner.
 busy=true;
 try{
  const addresses=Object.keys(cfg.managementPolicies??{}).filter(poolAddress).sort();
  let state;
  try{state=await overview()}catch{
   for(const address of addresses)ledger=record(ledger,address,{status:'BLOCKED',reason:'STATE_UNAVAILABLE',flags:[]},Date.now());
   await persistMonitor();monitorLastCycle=Date.now();return;
  }
  const ready=[];
  for(const address of addresses){
   const x=state.monitoring.find(v=>v.position===address),g=x?.managementGate,m=state.market,now=Date.now();
   if(!m||!x||x.status!=='CAPTURED_UNVERIFIED'||g?.status!=='PREFLIGHT_MATCHED_UNVERIFIED'||g.expiresAt<=now){
    ledger=record(ledger,address,{status:'BLOCKED',reason:g?.reason??x?.reason??'MONITOR_EVIDENCE_UNAVAILABLE',flags:[]},now);continue;
   }
   const body={position:address,positionSlot:x.slot,positionRawHash:x.rawHash,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:g.reviewHash,policyHash:g.policyHash};
   const key=observationKey(body),previous=ledger.current[address];
   if(previous?.key===key&&previous.expiresAt>now)continue;
   if(previous?.status!=='PENDING')ledger=record(ledger,address,{status:'PENDING',reason:'NEW_EVIDENCE_AWAITING_EVALUATION',flags:[]},now);
   ready.push(body);
  }
  // At most one engine evaluation per cycle. Round robin across the full configured set.
  if(ready.length&&!stopping){
   const address=addresses.find((_,i)=>i>=monitorCursor&&ready.some(b=>b.position===addresses[i]))??addresses.find(a=>ready.some(b=>b.position===a));
   const body=ready.find(b=>b.position===address);monitorCursor=(addresses.indexOf(address)+1)%addresses.length;
   try{const report=await preview(body,'management');ledger=record(ledger,address,summarizeRisk(report,body,Date.now()),Date.now())}
   catch(e){const reason=String(e.message);ledger=record(ledger,address,{status:'BLOCKED',reason:/^[A-Z0-9_:-]{1,120}$/.test(reason)?reason:'MONITOR_VALIDATION_FAILED',flags:[]},Date.now())}
  }
  await persistMonitor();monitorLastCycle=Date.now();
 }catch{monitorError='MONITOR_STORAGE_OR_CYCLE_FAILED';ledger={...ledger,current:{}}}
 finally{busy=false}
}
async function startMonitor(){
 if(!monitorEnabled)return;
 const dir=join(DATA,'terminal','monitor',pool);await mkdir(dir,{recursive:true,mode:0o700});monitorFile=join(dir,'ledger.json');monitorLockPath=join(dir,'writer.lock');
 monitorLock=await open(monitorLockPath,'wx',0o600);
 try{await monitorLock.writeFile(String(process.pid));try{ledger=recoverLedger(JSON.parse(await readFile(monitorFile,'utf8')),pool)}catch(e){if(e.code!=='ENOENT')throw e}await persistMonitor()}
 catch(e){await monitorLock.close();await unlink(monitorLockPath);monitorLock=null;throw e}
 const tick=()=>{if(stopping||monitorJob)return;monitorJob=monitorCycle().finally(()=>{monitorJob=null})};
 monitorTimer=setInterval(tick,monitorSeconds*1000);tick();
}
// Short-lived server-owned research reports; no signing material, no persistence.
const reviewReports=new Map();
function rememberReport(r,mode){
 const now=Date.now();for(const [id,v] of reviewReports)if(v.report.terminalBinding.expiresAt<=now)reviewReports.delete(id);
 if(r.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||!r.terminalBinding||r.terminalBinding.expiresAt<=now)return r;
 const id=randomUUID();while(reviewReports.size>=16)reviewReports.delete(reviewReports.keys().next().value);
 reviewReports.set(id,{report:r,mode});return {...r,reviewId:id};
}
let walletEvidenceBusy=false,reviewBusy=false,overviewBusy=false;
async function reviewContext(body){
 const saved=reviewReports.get(body?.reviewId);assert(saved&&saved.mode===body.mode,'RESEARCH_REPORT_UNAVAILABLE');
 const r=saved.report,b=r.terminalBinding,now=Date.now(),s=await loadState(),m=currentMarket(s,pool,now,maxAgeMs);
 let ctx=null,review;
 if(saved.mode==='management'){ctx=await managementContext(s,m,b.position,now);review=ctx}else review=await loadReview(m,now);
 assert(b.expiresAt>now&&m.receivedAt+maxAgeMs>now,'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
 const result=buildReview({report:r,mode:saved.mode,rowIndex:body.rowIndex,wallet:body.wallet,market:m,position:ctx?.p.report,reviewHash:review.reviewHash,policyHash:ctx?.policyHash,now:Date.now()});
 result.expiresAt=Math.min(result.expiresAt,review.expiresAt,m.receivedAt+maxAgeMs,ctx?.expiresAt??Infinity);
 assert(result.expiresAt>Date.now(),'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
 return {saved,r,b,m,result};
}
async function inspectReview(body){
 const {saved,r,b,m,result}=await reviewContext(body);
 const integerAllocation=saved.mode==='plans'?allocationDiagnostic({row:r.planPreview.families[body.rowIndex].best,market:m,budget:b.researchBudget}):{status:'BLOCKED',reason:'MANAGEMENT_INTEGER_MAPPING_PENDING',executionReady:false,signingAvailable:false};
 let captureDirectory=null;if(cfg.weightDiagnostic?.inverseEnabled===true&&typeof m.capture==='string'){try{captureDirectory=await safeDataPath(m.capture)}catch{}}
 const weightDiagnostic=await sdkWeightDiagnostic(integerAllocation,m,cfg.weightDiagnostic,captureDirectory);
 const latest=await reviewContext(body);assert(latest.saved===saved,'RESEARCH_REPORT_UNAVAILABLE');
 const expiry=assertSameReview(result,latest.result,Date.now());
 return {...result,expiresAt:expiry,reviewId:body.reviewId,integerAllocation,weightDiagnostic};
}
async function inspectWalletEvidence(body){
 assert(cfg.walletEvidence?.enabled===true,'WALLET_EVIDENCE_DISABLED');
 const genesis=cfg.walletEvidence.expectedGenesisHash;
 assert(typeof genesis==='string'&&/^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(genesis),'WALLET_EXPECTED_GENESIS_REQUIRED');
 const before=await inspectReview(body),m=currentMarket(await loadState(),pool,Date.now(),maxAgeMs);
 assert(m.slot===before.marketSlot&&m.rawHash===before.marketRawHash&&before.expiresAt>Date.now(),'RESEARCH_MARKET_CHANGED');
 const args=['--wallet',before.wallet,'--mint-x',m.mintX,'--mint-y',m.mintY,'--decimals-x',String(m.decimalsX),'--min-slot',String(m.slot),'--genesis',genesis];
 const e=await run(args,'capture-wallet.mjs');
 if(e.status==='BLOCKED')throw Error(e.reason??'WALLET_CAPTURE_FAILED');
 validateWalletEvidence(e,{wallet:before.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now:Date.now()});
 const raw=await boundedRead(await safeDataPath(join(e.directory,'rpc.json')),8*1024*1024);assert(sha(raw)===e.rawHash,'WALLET_EVIDENCE_HASH_MISMATCH');
 const {result:after}=await reviewContext(body),now=Date.now(),expiry=assertSameReview(before,after,now);
 validateWalletEvidence(e,{wallet:before.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now});
 return {...walletReview(e,{...after,expiresAt:expiry}),reviewId:body.reviewId,mode:after.mode,rowIndex:after.rowIndex,pool:after.pool,position:after.position,marketSlot:after.marketSlot,marketRawHash:after.marketRawHash,reviewHash:after.reviewHash,policyHash:after.policyHash,positionSlot:after.positionSlot,positionRawHash:after.positionRawHash};
}
// Public wallet observation is separate from strategy review; no authorization or spendability claim.
async function observeWallet(body){
 assert(poolAddress(body?.pool)&&poolAddress(body.wallet),'WALLET_CAPTURE_ARGUMENTS_INVALID');
 const scope=validateScope(body.pool),m=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);
 const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 const args=['--wallet',body.wallet,'--mint-x',m.mintX,'--mint-y',m.mintY,'--decimals-x',String(m.decimalsX),'--min-slot',String(m.slot),'--genesis',genesis];
 const e=await run(args,'capture-wallet.mjs');
 if(e.status==='BLOCKED')throw Error(e.reason??'WALLET_CAPTURE_FAILED');
 validateWalletEvidence(e,{wallet:body.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now:Date.now()});
 const raw=await boundedRead(await safeDataPath(join(e.directory,'rpc.json')),8*1024*1024);
 assert(sha(raw)===e.rawHash,'WALLET_EVIDENCE_HASH_MISMATCH');
 validateWalletEvidence(e,{wallet:body.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now:Date.now()});
 return {pool:scope,mintX:m.mintX,mintY:m.mintY,...walletReview(e,{expiresAt:e.receivedAt+30000})};
}
const indexedPool=cachedLoader(getPoolInfo,30000),indexedHistory=cachedLoader(getPriceHistory,60000);
let externalBusy=false,externalLast=null,holderBusy=false,holderLastAttempt=0,snapshotBusy=false,replayBusy=false,builderBusy=false;
const holderCache=new Map(),series=featureSeries(DATA);
async function archivedHolderBaseline(m){
 try{const row=(await series.read(m.pool,m.mintX,'holder')).at(-1);if(!row||Date.now()-row.receivedAt>1800000)return null;
  const dir=await safeDataPath(row.capture),bytes=await boundedRead(await safeDataPath(join(dir,'manifest.json')),256*1024);assert(sha(bytes)===row.sha256,'HOLDER_BASELINE_HASH');const x=JSON.parse(bytes);
  assert(x.pool===m.pool&&x.mint===m.mintX&&x.slot===row.slot&&x.receivedAt===row.receivedAt&&x.scope==='HOLDER_DIAGNOSTIC_ONLY'&&x.distribution?.supplyConserved===true&&Array.isArray(x.distribution.topOwners)&&x.distribution.topOwners.length<=100&&Array.isArray(x.files)&&x.files.length===4,'HOLDER_BASELINE_SCOPE');
  const names=new Set(['genesis.json','mint-before.json','holder-index.json','mint-after.json']);for(const e of x.files){assert(names.delete(e.file)&&sha(await boundedRead(await safeDataPath(join(dir,e.file)),16*1024*1024))===e.sha256,'HOLDER_BASELINE_RAW_HASH')}
  assert(names.size===0,'HOLDER_BASELINE_MISSING');return x;
 }catch{return null}
}
async function holderObservation(body,pinned=null){
 const scope=validateScope(body?.pool),m=pinned??currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs),key=scope+':'+m.mintX,now=Date.now(),old=holderCache.get(key);assert(m.pool===scope,'HOLDER_PINNED_SCOPE');
 if(old&&now-old.public.receivedAt<60000)return old.public;
 if(now-holderLastAttempt<60000)throw Error('HOLDER_RETRY_COOLDOWN');holderLastAttempt=now;
 const base=join(DATA,'raw');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'holder-'));
 const x=await captureHolderFeatures(m,{archive:(name,raw)=>writeFile(join(dir,name),raw,{mode:0o600,flag:'wx'})});
 const prior=old?.internal??await archivedHolderBaseline(m);
 const cohort=cohortChange(prior,x,Date.now());
 const {ownerBalances,topOwners,...distribution}=x.distribution;
 const archived={...x,distribution:{...distribution,topOwners},cohort};const bytes=JSON.stringify(archived,null,2)+'\n';await writeFile(join(dir,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
 const {files,...summary}=x,p={...summary,distribution,cohort,evidenceHash:sha(bytes),capture:relative(ROOT,dir)};
 await series.add({kind:'holder',pool:scope,mint:m.mintX,slot:x.slot,receivedAt:x.receivedAt,capture:p.capture,sha256:p.evidenceHash});
 holderCache.delete(key);holderCache.set(key,{public:p,internal:x});while(holderCache.size>4)holderCache.delete(holderCache.keys().next().value);return p;
}
async function researchInputs(scope){
 const now=Date.now();let state=null,m=null,review=null,reason=null;
 try{state=await loadState(scope);m=currentMarket(state,scope,now,maxAgeMs)}catch{reason='MARKET_CAPTURE_UNAVAILABLE'}
 if(m&&snapshotReviewPath(scope)){try{review=(await loadReview(m,now,snapshotReviewPath(scope))).review}catch(e){reason=e.message}}
 else if(m)reason='POOL_RESEARCH_NOT_CONFIGURED';
 return inputStatus({pool:scope,market:m,history:state?.streams?.['history:'+scope],external:externalLast,holder:m?holderCache.get(scope+':'+m.mintX)?.public:null,review,reviewReason:reason,now,maxAgeMs});
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
 const external=externalLast?.pool===scope&&externalLast.marketSlot===m.slot&&externalLast.marketRawHash===m.rawHash&&externalLast.expiresAt>now?externalLast:null,holder=holderCache.get(scope+':'+m.mintX)?.public??null;
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
 const sourcePaths=['research/engine.mjs','research/integer.mjs','research/live/analyze-state.mjs','research/live/engine-input.mjs','research/live/preview-plans.mjs','research/live/research-replay.mjs','research/live/research-snapshot.mjs','research/live/terminal-core.mjs','research/live/quote-evidence.mjs','research/live/external-market.mjs','research/live/reference-math.mjs','research/live/research-input-status.mjs','research/live/market-features.mjs','research/live/evidence-builder.mjs','research/live/preview-management.mjs','research/live/research-catalog.mjs'];
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
async function externalObservation(body,pinned=null){
 const scope=validateScope(body?.pool),m=pinned??currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs),now=Date.now();assert(m.pool===scope,'EXTERNAL_PINNED_SCOPE');
 if(externalLast&&externalLast.pool===scope&&externalLast.marketRawHash===m.rawHash&&externalLast.expiresAt>now)return externalLast;
 if(externalLast&&now-externalLast.fetchedAt<10000)throw Error('EXTERNAL_RETRY_COOLDOWN');
 const base=join(DATA,'raw');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'external-'));
 const result=await observeExternalMarket(m,{config:cfg.externalMarket??{},archive:(name,raw)=>writeFile(join(dir,name),raw,{mode:0o600,flag:'wx'})});
 const verified=await verifyQuoteEvidence(result,m,async name=>boundedRead(await safeDataPath(join(dir,name)),1024*1024));
 const bytes=JSON.stringify({...result,rawEvidenceCheck:verified},null,2)+'\n';await writeFile(join(dir,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
 const capture=relative(ROOT,dir),evidenceHash=sha(bytes);await series.add({kind:'external',pool:scope,mint:m.mintX,slot:m.slot,receivedAt:result.fetchedAt,capture,sha256:evidenceHash});
 externalLast={...result,rawEvidenceCheck:verified,capture,evidenceHash};return externalLast;
}
async function captureMarketTime(m){
 const endpoint=process.env.SOLANA_RPC_URL;assert(endpoint,'CHAIN_TIME_RPC_REQUIRED');
 const rpc=createReadRpc(endpoint,{maxBytes:128*1024,timeoutMs:4000,totalMs:8000,maxAttempts:2}),base=join(DATA,'raw');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'market-time-'));
 const requests=[{jsonrpc:'2.0',id:1,method:'getGenesisHash',params:[]},{jsonrpc:'2.0',id:2,method:'getSlot',params:[{commitment:'finalized'}]},{jsonrpc:'2.0',id:3,method:'getBlockTime',params:[m.slot]}],names=['genesis.json','slot.json','block-time.json'],files=[],replies=[];
 for(let i=0;i<requests.length;i++){const x=await rpc(requests[i]);await writeFile(join(dir,names[i]),x.raw,{mode:0o600,flag:'wx'});files.push({file:names[i],request:requests[i],sha256:sha(x.raw)});replies.push(x.payload)}
 const fact=chainTimeFact({market:m,genesisReply:replies[0],slotReply:replies[1],timeReply:replies[2],receivedAt:Date.now(),maxAgeSeconds:maxAgeMs/1000});
 const bytes=JSON.stringify({...fact,files},null,2)+'\n';await writeFile(join(dir,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
 return {...fact,capture:relative(ROOT,dir),evidenceHash:sha(bytes)};
}
async function buildResearchCandidate(body){
 const scope=validateScope(body?.pool),state=await loadState(scope),m=currentMarket(state,scope,Date.now(),maxAgeMs);
 assert(body.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 if(body.draft)requestFromDraft(body.draft,m);
 const sourceErrors=[];let clock=null;
 const reason=(name,e)=>sourceErrors.push({source:name,reason:/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'SOURCE_CAPTURE_FAILED'});
 // Read independent sources concurrently; do not silently substitute later market state.
 await Promise.all([
  captureMarketTime(m).then(x=>{clock=x}).catch(e=>reason('CHAIN_TIME',e)),
  (async()=>{try{await externalObservation({pool:scope},m)}catch(e){reason('EXTERNAL',e)}})(),
  (async()=>{try{await holderObservation({pool:scope},m)}catch(e){reason('HOLDER',e)}})()
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
const ledgerStore=incrementalLedgerStore(DATA,async(path,limit)=>boundedRead(await safeDataPath(path),limit));
let positionReadBusy=false,positionAccountingBusy=false,lastAccountingAttempt=0;
const indexes=new Map(),positionObservations=new Map();
async function readPositionIndex(body){
 const scope=validateScope(body?.pool),wallet=validateScope(body?.wallet),key=scope+':'+wallet,old=indexes.get(key);
 if(old&&old.expiresAt>Date.now()&&Date.now()-old.receivedAt<30000)return old;
 const r=await run(['--pool',scope,'--owner',wallet,'--provider',previewCfg.provider??'solana-rpc'],'discover-positions.mjs',40000);
 assert(r.status==='INDEX_CAPTURED_UNVERIFIED','POSITION_INDEX_RPC_FAILED');
 const path=await safeDataPath(r.directory),m=JSON.parse(await boundedRead(await safeDataPath(join(path,'manifest.json')),4*1024*1024));
 const bytes=await boundedRead(await safeDataPath(join(path,'accounts.json')),4*1024*1024);
 assert(sha(bytes)===m.rawHash&&r.slot===m.slot&&r.count===m.positions?.length,'POSITION_INDEX_HASH_MISMATCH');
 const x=positionIndex(m,scope,wallet);indexes.delete(key);indexes.set(key,x);while(indexes.size>8)indexes.delete(indexes.keys().next().value);return x;
}
async function readPositionDetail(body){
 const scope=validateScope(body?.pool),wallet=validateScope(body?.wallet),position=validateScope(body?.position),idx=indexes.get(scope+':'+wallet);
 assert(idx&&idx.expiresAt>Date.now()&&idx.positions.some(p=>p.address===position),'POSITION_INDEX_REFRESH_REQUIRED');
 let addresses=[position];
 for(let attempt=0;attempt<3;attempt++){
  const r=await run(['--pool',scope,'--provider',previewCfg.provider??'solana-rpc',...addresses.flatMap(a=>['--account',a])],'../capture-accounts.mjs',40000);
  const path=await safeDataPath(r.directory),m=JSON.parse(await boundedRead(await safeDataPath(join(path,'manifest.json')),16*1024*1024));
  assert(m.pool===scope&&m.commitment==='finalized'&&Number.isSafeInteger(m.contextSlot)&&m.contextSlot>=idx.slot&&m.contextSlot===r.contextSlot&&typeof m.raw?.sha256==='string','POSITION_CAPTURE_CONTEXT_INVALID');
  const report=await run(['--capture',path,'--idl',previewCfg.idl??'data/raw/dlmm-idl.json','--position',position,'--owner',wallet,'--observe-v2'],'inspect-position.mjs',15000);
  assert(report.pool===scope&&report.position===position&&report.slot===m.contextSlot&&report.rawHash===m.raw.sha256,'POSITION_CAPTURE_MISMATCH');
  if(['POSITION_CALCULATED_UNVERIFIED','V2_POSITION_OBSERVATION_UNVERIFIED'].includes(report.status)||report.reason==='POSITION_BIN_VERSION_UNSUPPORTED'){
   const detail=positionDetail(report,{pool:scope,wallet,position,slot:m.contextSlot,rawHash:m.raw.sha256});
   if(detail.snapshot){
    const market=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs),receivedAt=Date.parse(m.receivedAt);
    assert(Number.isSafeInteger(receivedAt)&&receivedAt<=Date.now()&&Date.now()-receivedAt<180000,'POSITION_CAPTURE_RECEIPT_INVALID');
    const observation=positionObservation(detail,market,receivedAt),key=scope+':'+wallet+':'+position;
    const raw=await boundedRead(await safeDataPath(join(path,'accounts.json')),32*1024*1024);assert(sha(raw)===m.raw.sha256,'POSITION_RAW_HASH_MISMATCH');
    const base=join(DATA,'position-observations',scope,position);await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'obs-'));
    const bytes=JSON.stringify(report);await writeFile(join(dir,'position.json'),bytes,{mode:0o600,flag:'wx'});
    const saved={...observation,reportHash:sha(bytes),capture:relative(ROOT,path),reportPath:relative(ROOT,join(dir,'position.json'))};
    await writeFile(join(dir,'manifest.json'),JSON.stringify(saved,null,2)+'\n',{mode:0o600,flag:'wx'});
    positionObservations.delete(key);positionObservations.set(key,saved);while(positionObservations.size>16)positionObservations.delete(positionObservations.keys().next().value);
    return {...detail,observation:saved};
   }
   return detail;
  }
  assert(Array.isArray(report.requiredAccounts),'POSITION_DETAIL_UNAVAILABLE');
  const next=[...new Set([...addresses,...report.requiredAccounts.map(validateScope)])].filter(a=>a!==scope);assert(next.length>addresses.length&&next.length<=99,'POSITION_DETAIL_INCOMPLETE');addresses=next;
 }
 throw Error('POSITION_CAPTURE_INCOMPLETE');
}
async function positionAccounting(body){
 const scope=validateScope(body?.pool),wallet=validateScope(body?.wallet),position=validateScope(body?.position),key=scope+':'+wallet+':'+position,obs=positionObservations.get(key);
 assert(obs&&obs.slot===body.slot&&obs.rawHash===body.rawHash&&Date.now()-obs.receivedAt<=180000,'POSITION_OBSERVATION_REFRESH_REQUIRED');
 assert(Date.now()-lastAccountingAttempt>=60000,'POSITION_ACCOUNTING_COOLDOWN');lastAccountingAttempt=Date.now();
 const market=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);
 assert(obs.mintX===market.mintX&&obs.mintY===market.mintY&&obs.decimalsX===market.decimalsX,'ACCOUNTING_MARKET_MISMATCH');
 const bytes=await boundedRead(await safeDataPath(obs.reportPath),8*1024*1024);assert(sha(bytes)===obs.reportHash,'POSITION_REPORT_CHANGED');
 const closing=JSON.parse(bytes);
 assert(sha(await boundedRead(await safeDataPath(join(obs.capture,'accounts.json')),32*1024*1024))===obs.rawHash,'POSITION_RAW_HASH_MISMATCH');
 const prior=await ledgerStore.load(obs),plan=nextLedgerPage(prior);
 const raw=await run(['--pool',scope,'--position',position,'--provider',previewCfg.provider??'solana-rpc','--pages','1','--limit','10',...(plan.before?['--before',plan.before]:[])],'capture-swaps.mjs',120000);
 const capture=await safeDataPath(raw.directory),mb=await boundedRead(await safeDataPath(join(capture,'manifest.json')),8*1024*1024),cm=JSON.parse(mb);
 assert(cm.pool===scope&&cm.position===position&&cm.indexAddress===position&&cm.commitment==='finalized'&&cm.before===plan.before&&Array.isArray(cm.signatures)&&cm.signatures.length<=10,'POSITION_HISTORY_SCOPE_INVALID');
 const pointer={capture:relative(ROOT,capture),sha256:sha(mb)},next=appendLedgerPage(prior,obs,cm,pointer,plan);
 const sources=new Map(next.pages.map(p=>[p.capture,p.sha256]));sources.set(pointer.capture,pointer.sha256);
 const args=[];for(const [path,hash] of sources){const p=await safeDataPath(path);assert(sha(await boundedRead(await safeDataPath(join(p,'manifest.json')),8*1024*1024))===hash,'LEDGER_SOURCE_MANIFEST_CHANGED');args.push('--capture',p)}
 const poolCapture=await safeDataPath(market.capture);
 const ledger=await run([...args,'--pool-capture',poolCapture,'--idl',previewCfg.idl??'data/raw/dlmm-idl.json','--owner',wallet,'--position',position],'reconcile-position.mjs',120000);
 // Never treat separately retained but potentially disjoint pages as a clean valuation window.
 const coverage={mode:plan.mode,pages:next.pages.length,gapObserved:next.gapObserved,retentionTruncated:next.retentionTruncated,backfillExhausted:next.backfillExhausted,historyComplete:false};
 if(next.gapObserved||next.retentionTruncated){assert(Array.isArray(ledger.archiveGaps),'LEDGER_ARCHIVE_GAPS_REQUIRED');ledger.archiveGaps.push({reason:next.gapObserved?'INCREMENTAL_HISTORY_GAP_OBSERVED':'INCREMENTAL_RETENTION_TRUNCATED'});ledger.status='PARTIAL_LEDGER'}
 ledger.incrementalCoverage=coverage;
 const summary={...ledgerProjection(ledger,obs),incrementalCoverage:coverage},base=join(DATA,'position-accounting',scope,position);await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'run-'));
 const ledgerBytes=JSON.stringify(ledger);await writeFile(join(dir,'ledger.json'),ledgerBytes,{mode:0o600,flag:'wx'});await writeFile(join(dir,'closing.json'),bytes,{mode:0o600,flag:'wx'});
 let performance={status:'BLOCKED',reason:'WINDOW_OPENING_AND_REVIEWED_MARKS_REQUIRED',decisionReady:false,executionReady:false,pnlReady:false};
 const map=cfg.performanceWindows,policy=map&&Object.hasOwn(map,position)?map[position]:null;
 if(policy&&typeof policy==='object'){
  try{
   assert(policy.pool===scope&&policy.owner===wallet&&policy.position===position&&obs.positionStatus==='POSITION_CALCULATED_UNVERIFIED','WINDOW_POLICY_SCOPE_OR_VERSION');
   const openingPath=await safeDataPath(policy.opening),marksPath=await safeDataPath(policy.marks);
   const openingBytes=await boundedRead(openingPath,8*1024*1024),marksBytes=await boundedRead(marksPath,8*1024*1024);
   assert(sha(openingBytes)===policy.openingHash&&sha(marksBytes)===policy.marksHash,'WINDOW_CONFIG_EVIDENCE_CHANGED');
   const opening=JSON.parse(openingBytes),openingCapture=await safeDataPath(policy.openingCapture);
   assert(sha(await boundedRead(await safeDataPath(join(openingCapture,'accounts.json')),32*1024*1024))===opening.rawHash,'WINDOW_OPENING_RAW_HASH_MISMATCH');
   const om=JSON.parse(await boundedRead(await safeDataPath(join(openingCapture,'manifest.json')),16*1024*1024));
   assert(om.pool===scope&&om.contextSlot===opening.slot&&om.raw?.sha256===opening.rawHash,'WINDOW_OPENING_CAPTURE_MISMATCH');
   const wl=windowLedger(ledger,opening.slot,closing.slot,assembleLedger),lp=join(dir,'window-ledger.json'),op=join(dir,'opening.json'),mp=join(dir,'marks.json');
   await writeFile(lp,JSON.stringify(wl),{mode:0o600,flag:'wx'});await writeFile(op,openingBytes,{mode:0o600,flag:'wx'});await writeFile(mp,marksBytes,{mode:0o600,flag:'wx'});
   const cfgPath=join(dir,'window.json'),config={schemaVersion:1,scope:'EXISTING_POSITION_WINDOW_RETAIN_DISTRIBUTIONS',ledger:lp,opening:op,closing:join(dir,'closing.json'),marks:mp,maxAgeSeconds:policy.maxAgeSeconds,maxSpreadBps:policy.maxSpreadBps};
   await writeFile(cfgPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
   performance=await run(['--input',cfgPath],'calculate-performance.mjs',30000);
   assert(performance.pnlReady===false&&performance.executionReady===false&&performance.decisionReady===false&&['BLOCKED','BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC'].includes(performance.status),'WINDOW_RESULT_INVALID');
   if(performance.status!=='BLOCKED')assert(performance.pool===scope&&performance.owner===wallet&&performance.position===position&&performance.closingRawHash===obs.rawHash&&performance.historyComplete===false,'WINDOW_RESULT_SCOPE');
  }catch(e){performance={status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'WINDOW_EVIDENCE_OR_CALCULATION_FAILED',decisionReady:false,executionReady:false,pnlReady:false}}
 }
 const perfBytes=JSON.stringify(performance);await writeFile(join(dir,'performance.json'),perfBytes,{mode:0o600,flag:'wx'});
 const out={scope:'POSITION_ACCOUNTING_DIAGNOSTIC_ONLY',pool:scope,owner:wallet,position,observation:obs,historyCapture:relative(ROOT,capture),historyManifestHash:sha(mb),ledgerHash:sha(ledgerBytes),performanceHash:sha(perfBytes),ledger:summary,performance,createdAt:Date.now(),historyComplete:false,pnlReady:false,decisionReady:false,executionReady:false};
 await writeFile(join(dir,'manifest.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600,flag:'wx'});
 await ledgerStore.save(obs,prior,next);
 return {...out,capture:relative(ROOT,dir)};
}
const server=createServer(async(req,res)=>{
 const requestId=randomUUID(),startedAt=Date.now();res.setHeader('X-Request-Id',requestId);
 res.once('finish',()=>{if(res.statusCode>=400)diagnosticLog({component:'TERMINAL',event:'HTTP_REQUEST',status:'FAILED',reason:'HTTP_'+res.statusCode,requestId,durationMs:Date.now()-startedAt})});
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin&&req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
 try{
  if(stopping){send(res,503,blocked('SERVICE_STOPPING'));return}
  const scoped=req.method==='GET'?scopedTerminalRequest(req.url,pool):{path:req.url,pool};
  const scope=validateScope(scoped.pool);
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(req.method==='GET'&&req.url==='/health'){send(res,200,{status:'RUNNING',pool,...startup,decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/research-catalog'){send(res,200,{pool:scope,scope:'HISTORICAL_ARCHIVE_INDEX_ONLY',entries:await archives.list(scope),decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/input-status'){send(res,200,await researchInputs(scope));return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/monitor'){send(res,200,scope===pool?publicMonitor():{pool:scope,enabled:false,current:{},events:[],decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/pool-info'){try{const m=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);send(res,200,await indexedPool([m.pool,m.mintX,m.mintY,m.decimalsX,m.decimalsY].join(':'),m))}catch(e){send(res,503,{pool:scope,status:'UNAVAILABLE',reason:/^INDEX_[A-Z_]+$/.test(e.message)?e.message:'POOL_INFO_UNAVAILABLE'})}return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/price-history'){try{send(res,200,await indexedHistory(scope,scope))}catch(e){send(res,503,{pool:scope,status:'UNAVAILABLE',reason:/^(INDEX|HISTORY|INVALID)_[A-Z_]+$/.test(e.message)?e.message:'HISTORY_UNAVAILABLE'})}return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/state'){if(overviewBusy){send(res,409,{...blocked('STATE_READ_BUSY'),pool:scope});return}overviewBusy=true;try{send(res,200,await scopedOverview(scope))}catch{send(res,200,{...blocked('STATE_UNAVAILABLE'),pool:scope,market:null,reviewGate:{status:'BLOCKED',reason:'STATE_UNAVAILABLE'},positions:[],monitoring:[],streams:{}})}finally{overviewBusy=false}return}
  if(req.method==='POST'&&req.url==='/api/terminal/position-accounting'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(positionAccountingBusy){send(res,409,blocked('POSITION_ACCOUNTING_BUSY'));return}positionAccountingBusy=true;
   try{send(res,200,await positionAccounting(await jsonBody(req)))}finally{positionAccountingBusy=false}return
  }
  if(req.method==='POST'&&['/api/terminal/wallet-positions','/api/terminal/wallet-position-detail'].includes(req.url)){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(positionReadBusy){send(res,409,blocked('POSITION_CAPTURE_BUSY'));return}positionReadBusy=true;
   try{const body=await jsonBody(req);send(res,200,await (req.url.endsWith('-detail')?readPositionDetail(body):readPositionIndex(body)))}finally{positionReadBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/research-build'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(builderBusy||busy||replayBusy||snapshotBusy||holderBusy||externalBusy){send(res,409,blocked('RESEARCH_BUILD_BUSY'));return}
   builderBusy=true;replayBusy=true;snapshotBusy=true;holderBusy=true;externalBusy=true;
   try{send(res,200,await buildResearchCandidate(await jsonBody(req)))}finally{builderBusy=false;replayBusy=false;snapshotBusy=false;holderBusy=false;externalBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/research-load'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   const body=await jsonBody(req),scope=validateScope(body.pool),id=body.runId;assert(typeof id==='string'&&/^[0-9a-f]{64}$/.test(id),'INVALID_RUN_ID');
   const dir=await safeDataPath(join(DATA,'research-runs',scope,id)),m=JSON.parse(await boundedRead(await safeDataPath(join(dir,'manifest.json')),128*1024)),{runId,...rest}=m;
   assert(runId===id&&sha(JSON.stringify(rest))===id&&m.pool===scope&&m.scope==='HISTORICAL_RESEARCH_ONLY'&&m.executionReady===false&&m.decisionReady===false&&m.pnlReady===false,'RUN_MANIFEST_INVALID');
   const bytes=await boundedRead(await safeDataPath(join(dir,'report.json')),8*1024*1024),reqBytes=await boundedRead(await safeDataPath(join(dir,'request.json')),32768);
   assert(sha(bytes)===m.reportHash&&sha(reqBytes)===m.requestHash,'RUN_ARTIFACT_HASH_MISMATCH');
   if(m.mode==='management')assert(sha(await boundedRead(await safeDataPath(join(dir,'policy.json')),32768))===m.policyHash,'RUN_POLICY_HASH_MISMATCH');
   const report=JSON.parse(bytes);assert(report.pool===scope&&!report.terminalBinding&&!report.reviewId&&report.decisionReady===false&&report.executionReady===false,'RUN_REPORT_SCOPE');
   send(res,200,{...m,report});return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/research-replay'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(replayBusy||busy){send(res,409,blocked('REPLAY_BUSY'));return}replayBusy=true;
   try{send(res,200,await replayResearchSnapshot(await jsonBody(req)))}finally{replayBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/research-snapshot'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(snapshotBusy){send(res,409,blocked('SNAPSHOT_BUSY'));return}snapshotBusy=true;
   try{send(res,200,await saveResearchSnapshot(await jsonBody(req)))}finally{snapshotBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/holder-features'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(holderBusy){send(res,409,blocked('HOLDER_CAPTURE_BUSY'));return}holderBusy=true;
   try{send(res,200,await holderObservation(await jsonBody(req)))}finally{holderBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/external-market'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(externalBusy){send(res,409,blocked('EXTERNAL_CAPTURE_BUSY'));return}externalBusy=true;
   try{send(res,200,await externalObservation(await jsonBody(req)))}finally{externalBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/wallet-observation'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(walletEvidenceBusy||reviewBusy){send(res,409,blocked('WALLET_EVIDENCE_BUSY'));return}walletEvidenceBusy=true;
   try{send(res,200,await observeWallet(await jsonBody(req)))}finally{walletEvidenceBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/wallet-evidence'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(walletEvidenceBusy||reviewBusy){send(res,409,blocked('WALLET_EVIDENCE_BUSY'));return}walletEvidenceBusy=true;
   try{send(res,200,await inspectWalletEvidence(await jsonBody(req)))}finally{walletEvidenceBusy=false}return
  }
  if(req.method==='POST'&&req.url==='/api/terminal/review'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(reviewBusy||walletEvidenceBusy){send(res,409,blocked('REVIEW_BUSY'));return}reviewBusy=true;try{send(res,200,await inspectReview(await jsonBody(req)))}finally{reviewBusy=false}return
  }
  if(req.method==='POST'&&['/api/terminal/plans','/api/terminal/management'].includes(req.url)){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(busy||replayBusy){send(res,409,blocked('ANALYSIS_BUSY'));return}busy=true;
   try{const mode=req.url.endsWith('/management')?'management':'plans';send(res,200,rememberReport(await preview(await jsonBody(req),mode),mode))}finally{busy=false}return
  }
  send(res,404,blocked('NOT_FOUND'));
 }catch(e){const m=String(e.message),reason=/^[A-Z0-9_]{1,96}$/.test(m)?m:'INPUT_OR_EVIDENCE_VALIDATION_FAILED';diagnosticLog({component:'TERMINAL',event:'REQUEST_VALIDATION',status:'BLOCKED',reason,requestId,durationMs:Date.now()-startedAt});send(res,400,{...blocked(reason),requestId})}
});
server.requestTimeout=45000;server.headersTimeout=10000;server.keepAliveTimeout=2000;server.maxConnections=16;
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)});
try{await startMonitor()}catch{monitorError='MONITOR_RECOVERY_OR_LOCK_FAILED'}
console.log('Read-only Flow Terminal: '+origin);
async function stop(){if(stopping)return;stopping=true;clearInterval(monitorTimer);server.close();previewChild?.kill('SIGTERM');await previewJob?.done;await monitorJob;if(monitorLock){await monitorLock.close();await unlink(monitorLockPath)}}
process.once('SIGINT',()=>{stop().catch(()=>{process.exitCode=1})});process.once('SIGTERM',()=>{stop().catch(()=>{process.exitCode=1})});

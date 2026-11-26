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
import {positionIndex,positionDetail} from './wallet-position-core.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data');
const {values}=parseArgs({options:{config:{type:'string'},port:{type:'string',default:'8790'},help:{type:'boolean'}}});
if(values.help){console.log('node research/live/terminal-server.mjs --config data/terminal-config.json [--port 8790]');process.exit(0)}
const assert=(x,m)=>{if(!x)throw Error(m)},sha=x=>createHash('sha256').update(x).digest('hex');
assert(values.config,'CONFIG_REQUIRED');
const cfg=JSON.parse(await readFile(values.config,'utf8')),pool=cfg.pool,port=Number(values.port),maxAgeMs=(cfg.maxAgeSeconds??180)*1000;
assert(poolAddress(pool)&&Number.isInteger(port)&&port>=1024&&port<=65535&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=15000&&maxAgeMs<=600000,'INVALID_CONFIG');
const statePath=join(DATA,'live',pool,'state.json'),origin='http://127.0.0.1:'+port;
async function safeDataPath(path){const root=await realpath(DATA),p=await realpath(resolve(ROOT,path)),rel=relative(root,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'INVALID_DATA_PATH');return p}
async function boundedRead(path,limit){const h=await open(path,'r');try{const st=await h.stat();assert(st.isFile()&&st.size<=limit,'EVIDENCE_SIZE_EXCEEDED');const bytes=Buffer.alloc(st.size+1);let n=0;while(n<bytes.length){const r=await h.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}assert(n===st.size,'EVIDENCE_SIZE_CHANGED');return bytes.subarray(0,n)}finally{await h.close()}}
async function loadState(scope=pool){
 const path=scope===pool?statePath:join(DATA,'live-preview',scope,'state.json');
 return JSON.parse(await boundedRead(await safeDataPath(path),64*1024*1024));
}
const previewCfg=cfg.dynamicCapture??{};
const previewAttempts=new Map();
let previewJob=null,previewChild=null;
function validateScope(scope){assert(poolAddress(scope)&&new PublicKey(scope).toBase58()===scope,'INVALID_POOL_ADDRESS');return scope}
function startPreviewCapture(scope){
 if(stopping||previewCfg.enabled===false)return 'DISABLED';
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
 try{const s=await loadState(scope),now=Date.now();sequence=s.sequence;const m=currentMarket(s,scope,now,maxAgeMs);market=marketSummary(m);if(now-m.receivedAt>=Math.min(60000,maxAgeMs/2))collection=startPreviewCapture(scope)}
 catch{collection=startPreviewCapture(scope);reason=collection==='DISABLED'?'DYNAMIC_CAPTURE_DISABLED':collection==='COLLECTOR_BUSY'?'POOL_COLLECTOR_BUSY':collection==='RETRY_COOLDOWN'?'POOL_CAPTURE_RETRY_COOLDOWN':'POOL_CAPTURE_PENDING'}
 return {pool:scope,sequence,status:market?'CAPTURED_UNVERIFIED':'BLOCKED',reason:market?null:reason,market,collection,reviewGate:{status:'BLOCKED',reason:'POOL_RESEARCH_NOT_CONFIGURED'},positions:[],monitoring:[],streams:{},decisionReady:false,executionReady:false,freshnessBasis:'LOCAL_RECEIPT_ONLY',scope:'MARKET_PREVIEW_ONLY'};
}
const html=await readFile(join(ROOT,'research/live/terminal.html'));
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
 const s=await loadState(),now=Date.now();assert(s.pool===pool&&s.schemaVersion===1&&s.decisionReady===false&&Number.isSafeInteger(s.sequence),'STATE_IDENTITY_MISMATCH');const streams=Object.fromEntries(Object.entries(s.streams??{}).map(([k,v])=>[k,{status:v.status,receivedAt:v.receivedAt??null,locallyFresh:Number.isSafeInteger(v.receivedAt)&&v.receivedAt<=now&&now-v.receivedAt<=maxAgeMs}]));
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
 const {saved,r,m,result}=await reviewContext(body);
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
let positionReadBusy=false;
const indexes=new Map();
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
  const report=await run(['--capture',path,'--idl',previewCfg.idl??'data/raw/dlmm-idl.json','--position',position,'--owner',wallet],'inspect-position.mjs',15000);
  assert(report.pool===scope&&report.position===position&&report.slot===m.contextSlot&&report.rawHash===m.raw.sha256,'POSITION_CAPTURE_MISMATCH');
  if(report.status==='POSITION_CALCULATED_UNVERIFIED'||report.reason==='POSITION_BIN_VERSION_UNSUPPORTED')return positionDetail(report,{pool:scope,wallet,position,slot:m.contextSlot,rawHash:m.raw.sha256});
  assert(Array.isArray(report.requiredAccounts),'POSITION_DETAIL_UNAVAILABLE');
  const next=[...new Set([...addresses,...report.requiredAccounts.map(validateScope)])].filter(a=>a!==scope);assert(next.length>addresses.length&&next.length<=99,'POSITION_DETAIL_INCOMPLETE');addresses=next;
 }
 throw Error('POSITION_CAPTURE_INCOMPLETE');
}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin&&req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
 try{
  if(stopping){send(res,503,blocked('SERVICE_STOPPING'));return}
  const scoped=req.method==='GET'?scopedTerminalRequest(req.url,pool):{path:req.url,pool};
  const scope=validateScope(scoped.pool);
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/monitor'){send(res,200,scope===pool?publicMonitor():{pool:scope,enabled:false,current:{},events:[],decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/pool-info'){try{const m=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);send(res,200,await indexedPool([m.pool,m.mintX,m.mintY,m.decimalsX,m.decimalsY].join(':'),m))}catch(e){send(res,503,{pool:scope,status:'UNAVAILABLE',reason:/^INDEX_[A-Z_]+$/.test(e.message)?e.message:'POOL_INFO_UNAVAILABLE'})}return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/price-history'){try{send(res,200,await indexedHistory(scope,scope))}catch(e){send(res,503,{pool:scope,status:'UNAVAILABLE',reason:/^(INDEX|HISTORY|INVALID)_[A-Z_]+$/.test(e.message)?e.message:'HISTORY_UNAVAILABLE'})}return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/state'){if(overviewBusy){send(res,409,{...blocked('STATE_READ_BUSY'),pool:scope});return}overviewBusy=true;try{send(res,200,await scopedOverview(scope))}catch{send(res,200,{...blocked('STATE_UNAVAILABLE'),pool:scope,market:null,reviewGate:{status:'BLOCKED',reason:'STATE_UNAVAILABLE'},positions:[],monitoring:[],streams:{}})}finally{overviewBusy=false}return}
  if(req.method==='POST'&&['/api/terminal/wallet-positions','/api/terminal/wallet-position-detail'].includes(req.url)){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(positionReadBusy){send(res,409,blocked('POSITION_CAPTURE_BUSY'));return}positionReadBusy=true;
   try{const body=await jsonBody(req);send(res,200,await (req.url.endsWith('-detail')?readPositionDetail(body):readPositionIndex(body)))}finally{positionReadBusy=false}return
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
   if(busy){send(res,409,blocked('ANALYSIS_BUSY'));return}busy=true;
   try{const mode=req.url.endsWith('/management')?'management':'plans';send(res,200,rememberReport(await preview(await jsonBody(req),mode),mode))}finally{busy=false}return
  }
  send(res,404,blocked('NOT_FOUND'));
 }catch(e){const m=String(e.message);send(res,400,blocked(/^[A-Z0-9_]+$/.test(m)?m:'INPUT_OR_EVIDENCE_VALIDATION_FAILED'))}
});
server.requestTimeout=45000;server.headersTimeout=10000;server.keepAliveTimeout=2000;server.maxConnections=16;
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)});
try{await startMonitor()}catch{monitorError='MONITOR_RECOVERY_OR_LOCK_FAILED'}
console.log('Read-only Flow Terminal: '+origin);
async function stop(){if(stopping)return;stopping=true;clearInterval(monitorTimer);server.close();previewChild?.kill('SIGTERM');await previewJob?.done;await monitorJob;if(monitorLock){await monitorLock.close();await unlink(monitorLockPath)}}
process.once('SIGINT',()=>{stop().catch(()=>{process.exitCode=1})});process.once('SIGTERM',()=>{stop().catch(()=>{process.exitCode=1})});

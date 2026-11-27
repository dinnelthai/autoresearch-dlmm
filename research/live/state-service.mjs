// T07 single-pool, read-only local service. Never submits transactions.
import {mkdir,readFile,writeFile,rename,open,unlink,stat,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {PublicKey} from '@solana/web3.js';
import {decodeMarketCapture} from './inspect-bins.mjs';
import {mergeHistory,streamHealth,pendingStream,historyBatch,completeEmptyEventIndex} from './state-core.mjs';
import {runCollectorLanes,serializedWriter} from './collector-scheduler.mjs';
import {repairPlan,advanceRepair,failedRepair,historyCoverage} from './history-repair.mjs';
import {dependencyPlan,sameAccounts} from './account-dependency-plan.mjs';
import {diagnosticLog} from './diagnostic-log.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const RAW=resolve(ROOT,'data/raw');
const assert=(v,m)=>{if(!v)throw Error(m);};
const key=v=>new PublicKey(v).toBase58();
const {values}=parseArgs({options:{config:{type:'string'},once:{type:'boolean'},'market-only':{type:'boolean'},port:{type:'string',default:'8788'},help:{type:'boolean'}}});
if(values.help){console.log('node research/live/state-service.mjs --config data/live-config.json [--once [--market-only] | --port 8788]');process.exit(0);}
assert(values.config,'config required');
const marketOnly=values['market-only']===true;assert(!marketOnly||values.once===true,'market-only requires --once');
assert((await stat(values.config)).size<=32768,'config too large');
const cfg=JSON.parse(await readFile(values.config,'utf8'));
const pool=key(cfg.pool),positions=(cfg.positions??[]).map(key),references=(cfg.references??[]).map(key);
assert(positions.length<=10&&new Set(positions).size===positions.length&&!positions.includes(pool),'invalid positions');
assert(references.length<=8&&new Set(references).size===references.length&&!references.includes(pool),'invalid references');
const provider=cfg.provider??'solana-rpc';assert(/^[a-zA-Z0-9_-]{1,48}$/.test(provider),'invalid provider label');
const interval=cfg.pollSeconds??60,maxAge=cfg.maxAgeSeconds??180,historyPages=cfg.historyPages??2,historyLimit=cfg.historyLimit??20;
assert(Number.isInteger(interval)&&interval>=15&&interval<=3600&&Number.isInteger(maxAge)&&maxAge>=interval&&maxAge<=86400,'invalid intervals');
assert(Number.isInteger(historyPages)&&historyPages>=1&&historyPages<=20&&Number.isInteger(historyLimit)&&historyLimit>=1&&historyLimit<=100,'invalid history bounds');
const historyRetention=cfg.historyRetention??2000,historyTimeoutSeconds=cfg.historyTimeoutSeconds??120;
assert(Number.isSafeInteger(historyRetention)&&historyRetention>=historyPages*historyLimit&&historyRetention<=20000,'invalid history retention');
assert(Number.isSafeInteger(historyTimeoutSeconds)&&historyTimeoutSeconds>=30&&historyTimeoutSeconds<=900,'invalid history timeout');
const positionSeconds=cfg.positionPollSeconds??interval,referenceSeconds=cfg.referencePollSeconds??Math.max(interval,120),historySeconds=cfg.historyPollSeconds??interval;
assert([positionSeconds,referenceSeconds,historySeconds].every(v=>Number.isInteger(v)&&v>=15&&v<=3600),'invalid stream intervals');
const idl=resolve(ROOT,cfg.idl??'data/raw/dlmm-idl.json');
const dir=join(ROOT,'data',marketOnly?'live-preview':'live',pool);await mkdir(dir,{recursive:true,mode:0o700});
const stateFile=join(dir,'state.json'),lockPath=join(dir,'writer.lock');
const lock=await open(lockPath,'wx',0o600);
let state={schemaVersion:1,pool,sequence:0,streams:{},history:{},decisionReady:false,limitations:['Unverified chain observations only; upstream live acceptance not completed.','Separate stream slots are not a common market snapshot.','Polling is not a websocket subscription or proof of continuous history.']};
let stopping=false,server=null,historyCursor=0,marketHints=[];const positionHints=new Map();const children=new Set(),controller=new AbortController();
try{
 await lock.writeFile(String(process.pid));
 try{assert((await stat(stateFile)).size<=64*1024*1024,'persisted state exceeds size cap');const old=JSON.parse(await readFile(stateFile,'utf8'));assert(old.pool===pool&&old.schemaVersion===1&&Number.isSafeInteger(old.sequence)&&old.streams&&old.history,'invalid persisted state');state={...old,decisionReady:false};historyCursor=Number.isSafeInteger(old.historyCursor)&&old.historyCursor>=0?old.historyCursor:0;
 for(const [k,v] of Object.entries(state.streams))state.streams[k]=pendingStream(v,Date.now());}catch(e){if(e.code!=='ENOENT')throw e;}
 async function capturePath(value){
  assert(typeof value==='string','missing capture directory');
  const p=await realpath(resolve(ROOT,value)),rel=relative(await realpath(RAW),p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&!rel.includes('/')&&!rel.includes('\\'),'invalid capture directory');return p;
 }
 async function run(script,args,timeout=180000){
  assert(!stopping,'service stopping');
  const result=await new Promise((resolve,reject)=>{
   const ch=spawn(process.execPath,[join(ROOT,script),...args],{cwd:ROOT,env:process.env,stdio:['ignore','pipe','pipe']});
   children.add(ch);let chunks=[],size=0,timed=false,overflow=false;
   const kill=setTimeout(()=>{timed=true;ch.kill('SIGKILL');},timeout);
   ch.stdout.on('data',b=>{size+=b.length;if(size>32*1024*1024){overflow=true;ch.kill('SIGKILL');}else chunks.push(b);});
   ch.stderr.resume(); // RPC error output may contain credentials; never store it.
   ch.once('error',e=>{children.delete(ch);clearTimeout(kill);reject(e);});
   ch.once('close',code=>{children.delete(ch);clearTimeout(kill);resolve({code,timed,overflow,stdout:Buffer.concat(chunks).toString('utf8')});});
  });
  assert(!result.timed&&!result.overflow,'child timeout or output cap');
  let report;try{report=JSON.parse(result.stdout);}catch{throw Error('child did not return a JSON report');}
  return {code:result.code,report};
 }
 async function readManifest(p){const file=join(p,'manifest.json');assert((await stat(file)).size<=16*1024*1024,'manifest too large');return JSON.parse(await readFile(file,'utf8'));}
 async function accounts(addresses){
  const unique=[...new Set(addresses)].filter(a=>a!==pool);assert(unique.length<=99,'snapshot exceeds one RPC request; no cross-slot stitching');
  const r=await run('research/capture-accounts.mjs',['--pool',pool,'--provider',provider,...unique.flatMap(a=>['--account',a])]);
  const p=await capturePath(r.report.directory),m=await readManifest(p);assert(m.pool===pool&&m.raw&&Number.isSafeInteger(m.contextSlot),'raw snapshot unavailable');return {p,m};
 }
 async function inspect(script,p,extra=[]){return (await run('research/live/'+script,['--capture',p,'--idl',idl,...extra])).report;}
 async function market(){
  const clock='SysvarC1ock11111111111111111111111111111111';
  const plan=()=>dependencyPlan({pool,market:marketHints,positions,positionHints,clock:cfg.includeClock===true?clock:null});
  let required=plan().accounts,fallback=null;
  for(let attempt=0;attempt<5;attempt++){
   const {p,m}=await accounts(required);
   const {identity,bins}=await decodeMarketCapture(p,idl);
   assert(identity.slot===m.contextSlot&&bins.slot===m.contextSlot&&identity.rawHash===m.raw.sha256&&bins.rawHash===m.raw.sha256,'snapshot evidence mismatch');
   if(identity.status==='UNSUPPORTED_ENGINE_INPUT')throw Error('unsupported market identity');
   const base=[...new Set([...(identity.requiredAccounts??[]),bins.bitmap,...(bins.expected??[]).map(x=>x.address)].filter(Boolean))].filter(a=>a!==pool);
   const marketReady=identity.status==='IDENTITY_CHECKED_UNVERIFIED'&&bins.status==='BITMAP_COVERAGE_CHECKED_UNVERIFIED';
   // Refresh discovered addresses, not account contents; old hints may be evicted.
   if(base.length<=99)marketHints=base;
   const positionReports={};
   if(marketReady){
    for(const address of positions){
     try{
      const report=await inspect('inspect-position.mjs',p,['--position',address]);
      assert(report.slot===m.contextSlot&&report.rawHash===m.raw.sha256&&report.position===address,'position evidence mismatch');
      if(Array.isArray(report.requiredAccounts))positionHints.set(address,report.requiredAccounts);
      if(report.status==='POSITION_CALCULATED_UNVERIFIED')positionReports[address]=report;
     }catch{ /* independent position failure does not invent a common snapshot */ }
    }
    fallback={capture:relative(ROOT,p),slot:m.contextSlot,identity,bins,positionReports,dependencyPlan:{requested:required.length,marketAccounts:marketHints.length,deferred:plan().deferred,positionsMatched:Object.keys(positionReports).length}};
    if(Object.keys(positionReports).length===positions.length||!values.once)return fallback;
   }
   if(base.length>99)throw Error('market snapshot exceeds one RPC request');
   const next=plan().accounts;
   if(sameAccounts(next,required)){if(marketReady)return fallback;throw Error('snapshot remains partial or unsupported');}
   if(marketReady&&attempt===4)return fallback;
   required=next;
  }
  if(fallback)return fallback;
  throw Error('snapshot discovery did not converge');
 }
 async function position(address){
  const commonStream=state.streams.market,common=streamHealth(commonStream,Date.now(),maxAge*1000)==='RECENT_UNVERIFIED'?commonStream.evidence:null;
  const shared=common?.positionReports?.[address];
  if(shared?.status==='POSITION_CALCULATED_UNVERIFIED')return {capture:common.capture,slot:common.slot,report:shared,commonMarketCapture:true,commonReceivedAt:commonStream.receivedAt};
  let required=[...new Set([address,...(positionHints.get(address)??[])])].filter(a=>a!==pool);if(required.length>99)required=[address];
  for(let attempt=0;attempt<3;attempt++){
   const {p,m}=await accounts(required);
   const report=await inspect('inspect-position.mjs',p,['--position',address]);
   assert(report.slot===m.contextSlot&&report.rawHash===m.raw.sha256&&report.position===address,'position evidence mismatch');
   if(Array.isArray(report.requiredAccounts))positionHints.set(address,report.requiredAccounts);
   if(report.status==='POSITION_CALCULATED_UNVERIFIED')return {capture:relative(ROOT,p),slot:m.contextSlot,report,commonMarketCapture:false};
   const next=[...new Set([...required,...(report.requiredAccounts??[])])];
   assert(next.length>required.length,'position missing or unsupported');required=next;
  }
  throw Error('position discovery did not converge');
 }
 async function history(address){
  const args=['--pool',pool,'--provider',provider,'--pages',String(historyPages),'--limit',String(historyLimit)];
  if(address!==pool)args.push('--position',address);
  const previous=state.history[address],turn=(previous?.repairTurn??0)+1,plan=values.once?{repair:false,before:null}:repairPlan(previous,turn);if(plan.before)args.push('--before',plan.before);
  if(previous)state.history[address]={...previous,repairTurn:turn};
  const failRepair=reason=>{if(plan.repair&&previous)state.history[address]={...state.history[address],repair:failedRepair(previous,plan,reason),repairTurn:turn}};
  let r,p,m;try{r=await run('research/live/capture-swaps.mjs',args,historyTimeoutSeconds*1000);p=await capturePath(r.report.directory);m=await readManifest(p)}catch(e){failRepair('CAPTURE_FAILED');throw e}
  assert(m.pool===pool&&m.indexAddress===address&&m.position===(address===pool?null:address)&&m.commitment==='finalized'&&Array.isArray(m.signatures)&&m.before===plan.before,'history identity mismatch');
  if(m.status==='EMPTY_PAGE_OBSERVED_UNVERIFIED'&&m.signatures.length===0&&!m.gaps?.length){failRepair('EMPTY_PAGE');return {capture:relative(ROOT,p),historyStatus:'EMPTY_OR_UNAVAILABLE',repairCapture:plan.repair,repair:state.history[address]?.repair??null,added:0,overlap:0}}
  // Only merge fully captured windows. Partial windows remain archived for later repair.
  if(m.status!=='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED'||m.gaps?.length){failRepair('CAPTURE_PARTIAL');return {capture:relative(ROOT,p),historyStatus:'CAPTURE_PARTIAL',repairCapture:plan.repair,repair:state.history[address]?.repair??null,signatureCount:m.signatures.length,gapCount:m.gaps?.length??0,gapReasons:[...new Set((m.gaps??[]).map(g=>g.reason))].slice(0,20),added:0,overlap:0}}
  let decoded;try{decoded=await inspect('inspect-swaps.mjs',p)}catch(e){failRepair('DECODE_FAILED');throw e}
  assert(decoded.pool===pool&&decoded.position===(address===pool?null:address)&&Array.isArray(decoded.transactions)&&Array.isArray(decoded.gaps),'history report mismatch');
  const emptyIndex=completeEmptyEventIndex(m,decoded);
  if((decoded.status!=='EVENTS_DECODED_UNVERIFIED'&&!emptyIndex)||decoded.gaps.length){failRepair('DECODE_PARTIAL');return {capture:relative(ROOT,p),historyStatus:'DECODE_PARTIAL',repairCapture:plan.repair,repair:state.history[address]?.repair??null,added:0,overlap:0,decoded}}
  // Keep evidence, never convert these aggregate events to per-bin fills.
  const merged=mergeHistory(state.history[address],m.signatures.map(s=>({signature:s.signature,slot:s.slot,capture:relative(ROOT,p)})),historyRetention);
  const repair=advanceRepair(previous,m.signatures,m,plan);
  // Keep provider head order separately from slot-sorted retained rows.
  const headSignatures=plan.repair?previous?.headSignatures??null:m.signatures.map(x=>({signature:x.signature,slot:x.slot}));
  if(!plan.repair&&previous?.headSignatures?.length&&!previous.headSignatures.some(o=>m.signatures.some(n=>n.signature===o.signature))){merged.gapObserved=true;merged.status='OVERLAP_MISSING'}
  const coverage=historyCoverage(merged,repair);
  state.history[address]={...merged,repair,repairTurn:turn,headSignatures,coverage};
  return {capture:relative(ROOT,p),historyStatus:emptyIndex?'DECODE_PARTIAL':coverage,historyGapObserved:merged.gapObserved,historyComplete:false,added:merged.added,overlap:merged.overlap,repair,repairCapture:plan.repair,decoded};
 }
 async function reference(){
  assert(references.length>=2,'manual reference pools not configured');
  assert(typeof cfg.probeSolRaw==='string'&&Array.isArray(cfg.sellRaw),'quote size config missing');
  const r=await run('research/live/capture-references.mjs',['--pool',pool,'--provider',provider,...references.flatMap(a=>['--reference',a]),'--probe-sol-raw',cfg.probeSolRaw,...cfg.sellRaw.flatMap(a=>['--sell-raw',String(a)])]);
  const p=await capturePath(r.report.directory),m=await readManifest(p);
  assert(m.pool===pool&&m.status==='REFERENCE_EVIDENCE_UNVERIFIED','reference evidence partial');
  return {capture:relative(ROOT,p),report:m};
 }
 const writeState=serializedWriter(async data=>{const tmp=stateFile+'.tmp';await writeFile(tmp,data,{mode:0o600});await rename(tmp,stateFile)});
 async function persist(){const data=JSON.stringify(state)+'\n';assert(Buffer.byteLength(data)<=64*1024*1024,'state exceeds size cap');await writeState(data);}
 async function collect(name,fn){
  const startedAt=Date.now(),before=state.streams[name];
  const superseded=()=>name.startsWith('position:')&&state.streams[name]!==before&&state.streams[name]?.status==='CAPTURED_UNVERIFIED'&&state.streams[name].evidence?.commonMarketCapture===true;
  try{const evidence=await fn();if(superseded())return;const partial=['OVERLAP_MISSING','BACKFILL_PENDING','UNRESOLVED_GAP','DECODE_PARTIAL','EMPTY_OR_UNAVAILABLE','CAPTURE_PARTIAL'].includes(evidence.historyStatus)||(evidence.decoded&&evidence.decoded.status!=='EVENTS_DECODED_UNVERIFIED');state.streams[name]={status:partial?'PARTIAL':'CAPTURED_UNVERIFIED',startedAt,receivedAt:evidence.commonMarketCapture===true?Math.min(startedAt,evidence.commonReceivedAt):startedAt,completedAt:Date.now(),evidence};}
  catch(e){if(superseded())return;const reason=/^[A-Z0-9_]{1,96}$/.test(e.message)?e.message:'CAPTURE_OR_VALIDATION_FAILED';state.streams[name]={status:'BLOCKED',startedAt,receivedAt:Date.now(),reason,previousEvidence:state.streams[name]?.evidence??state.streams[name]?.previousEvidence??null};diagnosticLog({component:'COLLECTOR',event:'STREAM_CAPTURE',status:'BLOCKED',reason,stream:name,durationMs:Date.now()-startedAt})}
  if(name==='market'&&state.streams.market.status==='CAPTURED_UNVERIFIED'){
   const m=state.streams.market;for(const [address,report] of Object.entries(m.evidence.positionReports??{})){
    if(report.status!=='POSITION_CALCULATED_UNVERIFIED')continue;
    state.streams['position:'+address]={status:'CAPTURED_UNVERIFIED',startedAt,receivedAt:m.receivedAt,completedAt:Date.now(),evidence:{capture:m.evidence.capture,slot:m.evidence.slot,report,commonMarketCapture:true,commonReceivedAt:m.receivedAt}};
   }
  }
  console.log(JSON.stringify({sequence:state.sequence,stream:name,status:state.streams[name].status,at:new Date().toISOString()}));await persist();
 }
 async function cycle(){
  state.sequence++;state.cycleStartedAt=Date.now();state.cycleCompletedAt=null;
  if(marketOnly){state.streams={market:pendingStream(state.streams.market,Date.now())};state.history={};await persist();await collect('market',market);state.cycleCompletedAt=Date.now();await persist();return;}
  const wanted=new Set(['market',...positions.map(a=>'position:'+a),'history:'+pool,...positions.map(a=>'history:'+a),'references']);for(const k of Object.keys(state.streams))if(!wanted.has(k))delete state.streams[k];
  const batch=historyBatch([pool,...positions],historyCursor,values.once===true);historyCursor=batch.nextCursor;state.historyCursor=historyCursor;
  for(const address of Object.keys(state.history))if(![pool,...positions].includes(address))delete state.history[address];
  // Only invalidate streams being refreshed; skipped history ages naturally.
  for(const name of ['market',...positions.map(a=>'position:'+a),'references',...batch.addresses.map(a=>'history:'+a)])state.streams[name]=pendingStream(state.streams[name],Date.now());
  await persist();
  await collect('market',market);
  for(const a of positions){if(stopping)break;await collect('position:'+a,()=>position(a));}
  if(!stopping)await collect('references',reference);
  for(const a of batch.addresses){if(stopping)break;await collect('history:'+a,()=>history(a));}
  state.cycleCompletedAt=Date.now();await persist();
 }
 async function refreshLane(name,fn){
  if(stopping)return;const old=state.streams[name];
  state.streams[name]=name==='market'&&streamHealth(old,Date.now(),maxAge*1000)==='RECENT_UNVERIFIED'?{...old,refreshing:true,refreshStartedAt:Date.now()}:pendingStream(old,Date.now());
  await persist();if(!stopping)await collect(name,fn);
 }
 async function marketTick(){state.sequence++;state.cycleStartedAt=Date.now();state.cycleCompletedAt=null;await refreshLane('market',market);state.cycleCompletedAt=Date.now();await persist()}
 async function positionTick(){for(const a of positions){if(stopping)break;const m=state.streams.market,p=state.streams['position:'+a];if(streamHealth(m,Date.now(),maxAge*1000)==='RECENT_UNVERIFIED'&&streamHealth(p,Date.now(),maxAge*1000)==='RECENT_UNVERIFIED'&&p.evidence?.commonMarketCapture===true&&p.evidence.slot===m.evidence.slot&&p.evidence.report.rawHash===m.evidence.identity.rawHash)continue;await refreshLane('position:'+a,()=>position(a))}}
 async function historyTick(){const batch=historyBatch([pool,...positions],historyCursor);historyCursor=batch.nextCursor;state.historyCursor=historyCursor;await refreshLane('history:'+batch.addresses[0],()=>history(batch.addresses[0]))}
 function publicState(){
  const now=Date.now();return {...state,decisionReady:false,streamHealth:Object.fromEntries(Object.entries(state.streams).map(([k,v])=>[k,streamHealth(v,now,maxAge*1000)])),freshnessBasis:'CONSERVATIVE_LOCAL_COLLECTION_START; CHAIN FRESHNESS UNVERIFIED'};
 }
 // Persist restart invalidation before exposing the API or accepting prior-cycle snapshots.
 await persist();
 if(!values.once){
  const port=Number(values.port);assert(Number.isInteger(port)&&port>=1024&&port<=65535,'invalid port');
  server=createServer((req,res)=>{
   if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)||req.headers.origin){res.writeHead(403);res.end('{}');return;}
   res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
   if(req.method!=='GET'||!['/health','/api/state'].includes(req.url)){res.writeHead(404);res.end('{}');return;}
   const p=publicState();res.end(JSON.stringify(req.url==='/health'?{pool,sequence:p.sequence,decisionReady:false,streamHealth:p.streamHealth}:p));
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.keepAliveTimeout=2000;server.maxConnections=16;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  console.log('Read-only state API: http://127.0.0.1:'+port);
 }
 function stop(){stopping=true;controller.abort();for(const ch of children)ch.kill('SIGKILL');server?.close();}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 if(values.once){if(!stopping)await cycle()}
 else{
  const wanted=new Set(['market',...positions.map(a=>'position:'+a),'history:'+pool,...positions.map(a=>'history:'+a),'references']);
  for(const k of Object.keys(state.streams))if(!wanted.has(k))delete state.streams[k];
  for(const a of Object.keys(state.history))if(![pool,...positions].includes(a))delete state.history[a];
  const lanes=[{name:'market',intervalMs:interval*1000,run:marketTick},{name:'history',intervalMs:historySeconds*1000,run:historyTick}];
  if(positions.length)lanes.push({name:'positions',intervalMs:positionSeconds*1000,run:positionTick});
  if(references.length>=2)lanes.push({name:'references',intervalMs:referenceSeconds*1000,run:()=>refreshLane('references',reference)});
  else state.streams.references={status:'BLOCKED',reason:'REFERENCES_NOT_CONFIGURED'};
  await persist();await runCollectorLanes(lanes,controller,{onFatal:stop});
 }
 if(stopping&&!values.once){for(const [k,v] of Object.entries(state.streams))state.streams[k]={status:'BLOCKED',reason:'SERVICE_STOPPED',previousEvidence:v.evidence??v.previousEvidence??null};await persist();}
 if(values.once&&Object.values(state.streams).some(s=>s.status!=='CAPTURED_UNVERIFIED'))process.exitCode=1;
}finally{
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
 await lock.close();await unlink(lockPath);
}

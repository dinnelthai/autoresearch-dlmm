// T07 single-pool, read-only local service. Never submits transactions.
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {PublicKey} from '@solana/web3.js';
import {mergeHistory,streamHealth} from './state-core.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const RAW=resolve(ROOT,'data/raw');
const assert=(v,m)=>{if(!v)throw Error(m);};
const key=v=>new PublicKey(v).toBase58();
const {values}=parseArgs({options:{config:{type:'string'},once:{type:'boolean'},port:{type:'string',default:'8788'},help:{type:'boolean'}}});
if(values.help){console.log('node research/live/state-service.mjs --config data/live-config.json [--once | --port 8788]');process.exit(0);}
assert(values.config,'config required');
const cfg=JSON.parse(await readFile(values.config,'utf8'));
const pool=key(cfg.pool),positions=(cfg.positions??[]).map(key),references=(cfg.references??[]).map(key);
assert(positions.length<=10&&new Set(positions).size===positions.length&&!positions.includes(pool),'invalid positions');
assert(references.length<=8&&new Set(references).size===references.length&&!references.includes(pool),'invalid references');
const provider=cfg.provider??'solana-rpc';assert(/^[a-zA-Z0-9_-]{1,48}$/.test(provider),'invalid provider label');
const interval=cfg.pollSeconds??60,maxAge=cfg.maxAgeSeconds??180,historyPages=cfg.historyPages??2,historyLimit=cfg.historyLimit??20;
assert(Number.isInteger(interval)&&interval>=15&&interval<=3600&&Number.isInteger(maxAge)&&maxAge>=interval&&maxAge<=86400,'invalid intervals');
assert(Number.isInteger(historyPages)&&historyPages>=1&&historyPages<=20&&Number.isInteger(historyLimit)&&historyLimit>=1&&historyLimit<=100,'invalid history bounds');
const idl=resolve(ROOT,cfg.idl??'data/raw/dlmm-idl.json');
const dir=join(ROOT,'data','live',pool);await mkdir(dir,{recursive:true,mode:0o700});
const stateFile=join(dir,'state.json'),lockPath=join(dir,'writer.lock');
const lock=await open(lockPath,'wx',0o600);
let state={schemaVersion:1,pool,sequence:0,streams:{},history:{},decisionReady:false,limitations:['Unverified chain observations only; upstream live acceptance not completed.','Separate stream slots are not a common market snapshot.','Polling is not a websocket subscription or proof of continuous history.']};
let stopping=false,timer=null,server=null,active=null;
try{
 await lock.writeFile(String(process.pid));
 try{const old=JSON.parse(await readFile(stateFile,'utf8'));assert(old.pool===pool&&old.schemaVersion===1&&Number.isSafeInteger(old.sequence)&&old.streams&&old.history,'invalid persisted state');state={...old,decisionReady:false};}catch(e){if(e.code!=='ENOENT')throw e;}
 function capturePath(value){
  assert(typeof value==='string','missing capture directory');
  const p=resolve(ROOT,value),rel=relative(RAW,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&!rel.includes('/')&&!rel.includes('\\'),'invalid capture directory');return p;
 }
 async function run(script,args,timeout=180000){
  const result=await new Promise((resolve,reject)=>{
   const ch=spawn(process.execPath,[join(ROOT,script),...args],{cwd:ROOT,env:process.env,stdio:['ignore','pipe','pipe']});
   let chunks=[],size=0,timed=false,overflow=false;
   const kill=setTimeout(()=>{timed=true;ch.kill('SIGKILL');},timeout);
   ch.stdout.on('data',b=>{size+=b.length;if(size>32*1024*1024){overflow=true;ch.kill('SIGKILL');}else chunks.push(b);});
   ch.stderr.resume(); // RPC error output may contain credentials; never store it.
   ch.once('error',e=>{clearTimeout(kill);reject(e);});
   ch.once('close',code=>{clearTimeout(kill);resolve({code,timed,overflow,stdout:Buffer.concat(chunks).toString('utf8')});});
  });
  assert(!result.timed&&!result.overflow,'child timeout or output cap');
  let report;try{report=JSON.parse(result.stdout);}catch{throw Error('child did not return a JSON report');}
  return {code:result.code,report};
 }
 async function readManifest(p){return JSON.parse(await readFile(join(p,'manifest.json'),'utf8'));}
 async function accounts(addresses){
  const unique=[...new Set(addresses)].filter(a=>a!==pool);assert(unique.length<=99,'snapshot exceeds one RPC request; no cross-slot stitching');
  const r=await run('research/capture-accounts.mjs',['--pool',pool,'--provider',provider,...unique.flatMap(a=>['--account',a])]);
  const p=capturePath(r.report.directory),m=await readManifest(p);assert(m.pool===pool&&m.raw&&Number.isSafeInteger(m.contextSlot),'raw snapshot unavailable');return {p,m};
 }
 async function inspect(script,p,extra=[]){return (await run('research/live/'+script,['--capture',p,'--idl',idl,...extra])).report;}
 async function market(){
  let required=positions.slice(),fallback=null;
  for(let attempt=0;attempt<5;attempt++){
   const {p,m}=await accounts(required);
   const identity=await inspect('inspect-pool.mjs',p);
   const bins=await inspect('inspect-bins.mjs',p);
   assert(identity.slot===m.contextSlot&&bins.slot===m.contextSlot&&identity.rawHash===m.raw.sha256&&bins.rawHash===m.raw.sha256,'snapshot evidence mismatch');
   if(identity.status==='UNSUPPORTED_ENGINE_INPUT')throw Error('unsupported market identity');
   const base=[...new Set([...(identity.requiredAccounts??[]),bins.bitmap,...(bins.expected??[]).map(x=>x.address)].filter(Boolean))].filter(a=>a!==pool);
   const marketReady=identity.status==='IDENTITY_CHECKED_UNVERIFIED'&&bins.status==='BITMAP_COVERAGE_CHECKED_UNVERIFIED';
   const positionReports={},extra=[];
   if(marketReady){
    for(const address of positions){
     try{
      const report=await inspect('inspect-position.mjs',p,['--position',address]);
      assert(report.slot===m.contextSlot&&report.rawHash===m.raw.sha256&&report.position===address,'position evidence mismatch');
      if(report.status==='POSITION_CALCULATED_UNVERIFIED')positionReports[address]=report;
      else extra.push(...(report.requiredAccounts??[]));
     }catch{ /* independent position failure does not invent a common snapshot */ }
    }
    fallback={capture:relative(ROOT,p),slot:m.contextSlot,identity,bins,positionReports};
    if(Object.keys(positionReports).length===positions.length)return fallback;
   }
   let next=[...new Set([...required,...base,...extra].filter(a=>a!==pool))];
   if(next.length>99){if(marketReady)return fallback;next=base;}
   if(next.length>99)throw Error('market snapshot exceeds one RPC request');
   if(next.length===required.length&&next.every(a=>required.includes(a))){if(marketReady)return fallback;throw Error('snapshot remains partial or unsupported');}
   if(marketReady&&attempt===4)return fallback;
   required=next;
  }
  if(fallback)return fallback;
  throw Error('snapshot discovery did not converge');
 }
 async function position(address){
  const common=state.streams.market?.status==='CAPTURED_UNVERIFIED'?state.streams.market.evidence:null;
  const shared=common?.positionReports?.[address];
  if(shared?.status==='POSITION_CALCULATED_UNVERIFIED')return {capture:common.capture,slot:common.slot,report:shared,commonMarketCapture:true};
  let required=[address];
  for(let attempt=0;attempt<3;attempt++){
   const {p,m}=await accounts(required);
   const report=await inspect('inspect-position.mjs',p,['--position',address]);
   assert(report.slot===m.contextSlot&&report.rawHash===m.raw.sha256&&report.position===address,'position evidence mismatch');
   if(report.status==='POSITION_CALCULATED_UNVERIFIED')return {capture:relative(ROOT,p),slot:m.contextSlot,report,commonMarketCapture:false};
   const next=[...new Set([...required,...(report.requiredAccounts??[])])];
   assert(next.length>required.length,'position missing or unsupported');required=next;
  }
  throw Error('position discovery did not converge');
 }
 async function history(address){
  const args=['--pool',pool,'--provider',provider,'--pages',String(historyPages),'--limit',String(historyLimit)];
  if(address!==pool)args.push('--position',address);
  const r=await run('research/live/capture-swaps.mjs',args,900000),p=capturePath(r.report.directory),m=await readManifest(p);
  assert(m.pool===pool&&(m.indexAddress??m.pool)===address&&Array.isArray(m.signatures),'history identity mismatch');
  // Only merge fully captured windows. Partial windows remain archived for later repair.
  assert(m.status==='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED'&&!m.gaps?.length,'history window partial');
  const decoded=await inspect('inspect-swaps.mjs',p);
  assert(decoded.pool===pool&&Array.isArray(decoded.transactions),'history report mismatch');
  // Keep evidence, never convert these aggregate events to per-bin fills.
  const merged=mergeHistory(state.history[address],m.signatures.map(s=>({signature:s.signature,slot:s.slot,capture:relative(ROOT,p)})));
  state.history[address]=merged;
  return {capture:relative(ROOT,p),historyStatus:merged.status,added:merged.added,overlap:merged.overlap,decoded};
 }
 async function reference(){
  assert(references.length>=2,'manual reference pools not configured');
  assert(typeof cfg.probeSolRaw==='string'&&Array.isArray(cfg.sellRaw),'quote size config missing');
  const r=await run('research/live/capture-references.mjs',['--pool',pool,'--provider',provider,...references.flatMap(a=>['--reference',a]),'--probe-sol-raw',cfg.probeSolRaw,...cfg.sellRaw.flatMap(a=>['--sell-raw',String(a)])]);
  const p=capturePath(r.report.directory),m=await readManifest(p);
  assert(m.pool===pool&&m.status==='REFERENCE_EVIDENCE_UNVERIFIED','reference evidence partial');
  return {capture:relative(ROOT,p),report:m};
 }
 async function persist(){const tmp=stateFile+'.tmp';await writeFile(tmp,JSON.stringify(state)+'\n',{mode:0o600});await rename(tmp,stateFile);}
 async function collect(name,fn){
  const startedAt=Date.now();
  try{const evidence=await fn();const partial=evidence.historyStatus==='OVERLAP_MISSING'||(evidence.decoded&&evidence.decoded.status!=='EVENTS_DECODED_UNVERIFIED');state.streams[name]={status:partial?'PARTIAL':'CAPTURED_UNVERIFIED',startedAt,receivedAt:Date.now(),evidence};}
  catch{state.streams[name]={status:'BLOCKED',startedAt,receivedAt:Date.now(),reason:'CAPTURE_OR_VALIDATION_FAILED',previousEvidence:state.streams[name]?.evidence??state.streams[name]?.previousEvidence??null};}
  console.log(JSON.stringify({sequence:state.sequence,stream:name,status:state.streams[name].status,at:new Date().toISOString()}));await persist();
 }
 async function cycle(){
  state.sequence++;state.cycleStartedAt=Date.now();state.cycleCompletedAt=null;
  const wanted=new Set(['market',...positions.map(a=>'position:'+a),'history:'+pool,...positions.map(a=>'history:'+a),'references']);for(const k of Object.keys(state.streams))if(!wanted.has(k))delete state.streams[k];
  // Never display prior-cycle values as fresh while their replacement is running.
  for(const name of ['market',...positions.map(a=>'position:'+a),'history:'+pool,...positions.map(a=>'history:'+a),'references']){const old=state.streams[name];state.streams[name]={status:'PENDING',previousEvidence:old?.evidence??old?.previousEvidence??null};}
  await persist();
  await collect('market',market);
  for(const a of positions){if(stopping)break;await collect('position:'+a,()=>position(a));}
  if(!stopping)await collect('history:'+pool,()=>history(pool));
  for(const a of positions){if(stopping)break;await collect('history:'+a,()=>history(a));}
  if(!stopping)await collect('references',reference);
  state.cycleCompletedAt=Date.now();await persist();
 }
 function publicState(){
  const now=Date.now();return {...state,decisionReady:false,streamHealth:Object.fromEntries(Object.entries(state.streams).map(([k,v])=>[k,streamHealth(v,now,maxAge*1000)])),freshnessBasis:'LOCAL_RECEIPT_ONLY; CHAIN FRESHNESS UNVERIFIED'};
 }
 if(!values.once){
  const port=Number(values.port);assert(Number.isInteger(port)&&port>=1024&&port<=65535,'invalid port');
  server=createServer((req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
   if(req.method!=='GET'||!['/health','/api/state'].includes(req.url)){res.writeHead(404);res.end('{}');return;}
   const p=publicState();res.end(JSON.stringify(req.url==='/health'?{pool,sequence:p.sequence,decisionReady:false,streamHealth:p.streamHealth}:p));
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  console.log('Read-only state API: http://127.0.0.1:'+port);
 }
 function stop(){stopping=true;if(timer){clearTimeout(timer.id);timer.resolve();timer=null;}server?.close();}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 do{if(stopping)break;active=cycle();await active;active=null;if(values.once||stopping)break;await new Promise(resolve=>{timer={id:setTimeout(()=>{timer=null;resolve();},interval*1000),resolve};});}while(!stopping);
 if(values.once&&Object.values(state.streams).some(s=>s.status!=='CAPTURED_UNVERIFIED'))process.exitCode=1;
}finally{
 if(server)await new Promise(resolve=>server.close(()=>resolve()));
 await lock.close();await unlink(lockPath);
}

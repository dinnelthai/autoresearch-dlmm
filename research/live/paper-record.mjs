// Read-only companion to state-service. Records verified raw capture pointers and re-decodes history.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime,atomicJson,watchLocked} from './terminal-runtime.mjs';
import {extractMarket} from './engine-input.mjs';
import {captureObservation,nextJournal,PAPER_JOURNAL_MAX_BYTES} from './paper-event-core.mjs';
import {assert,poolAddress,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const read=async(p,max)=>io.boundedRead(await io.safeDataPath(p),max);
const {values}=parseArgs({options:{pool:{type:'string'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},watch:{type:'boolean'},interval:{type:'string',default:'30'},help:{type:'boolean'}}});
async function main(){
 if(values.help){console.log('node research/live/paper-record.mjs --pool ADDRESS [--watch --interval 30]');return}
 assert(poolAddress(values.pool),'PAPER_POOL_REQUIRED');const pool=values.pool,interval=Number(values.interval);assert(Number.isInteger(interval)&&interval>=10&&interval<=600,'PAPER_INTERVAL_INVALID');
 const dir=join(DATA,'paper-captures',pool);await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);
 const idl=await io.safeDataPath(values.idl);
 const target=join(dir,'index.json');
 await watchLocked(dir,{watch:values.watch,interval,step:async()=>{
    const bytes=await read(join(DATA,'live',pool,'state.json'),64*1024*1024),state=JSON.parse(bytes);assert(state.pool===pool,'PAPER_STATE_SCOPE');
    let previous=null;try{previous=JSON.parse(await read(target,PAPER_JOURNAL_MAX_BYTES))}catch(e){if(e.code!=='ENOENT')throw e}
    const stateHash=sha(bytes);
    if(previous?.lastStateHash===stateHash){console.log(JSON.stringify({status:'PAPER_CAPTURE_UNCHANGED',pool,modelEligible:false}));}
    else{
     let market=null,marketProof=null,history=null,historyProof=null,decoded=null,manifest=null;
     try{market=extractMarket(state);const p=await io.safeDataPath(market.capture),mb=await read(join(p,'manifest.json'),16*1024*1024),ab=await read(join(p,'accounts.json'),32*1024*1024);const manifest=JSON.parse(mb);assert(sha(ab)===market.rawHash&&manifest.pool===pool&&manifest.contextSlot===market.slot&&manifest.commitment==='finalized'&&manifest.raw?.file==='accounts.json'&&manifest.raw.sha256===market.rawHash,'PAPER_MARKET_RAW_HASH');marketProof={path:relative(ROOT,join(p,'manifest.json')),sha256:sha(mb),accountsHash:sha(ab)};}catch{market=null;marketProof=null}
     const stream=state.streams?.['history:'+pool];
     if(stream?.evidence?.capture){
      try{const p=await io.safeDataPath(stream.evidence.capture),mb=await read(join(p,'manifest.json'),16*1024*1024);manifest=JSON.parse(mb);assert(manifest.pool===pool&&manifest.position===null,'PAPER_HISTORY_SCOPE');
       decoded=await io.run(['--capture',p,'--idl',idl],'inspect-swaps.mjs',120000);assert(sha(await read(join(p,'manifest.json'),16*1024*1024))===sha(mb),'PAPER_CAPTURE_CHANGED');history=stream.evidence;historyProof={path:relative(ROOT,join(p,'manifest.json')),sha256:sha(mb)};
      }catch{manifest=null;decoded=null;history=null;historyProof=null}
     }
     const obs=captureObservation({pool,market,marketProof,history,historyProof,decoded,manifest,observedAt:Date.now()});
     // Keep the exact collector snapshot and independently decoded evidence in a content-addressed bundle.
     const payload=JSON.stringify({...obs,stateHash,state,decoded}),id=sha(payload),file=join(dir,id+'.json');
     assert(Buffer.byteLength(payload)<=72*1024*1024,'PAPER_CAPTURE_BUNDLE_SIZE');
     try{await writeFile(file,payload,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e;assert(sha(await read(file,72*1024*1024))===id,'PAPER_CAPTURE_CONFLICT')}
     const next={...nextJournal(previous,obs,{path:relative(ROOT,file),sha256:id}),lastStateHash:stateHash};
     const indexBytes=JSON.stringify(next);assert(Buffer.byteLength(indexBytes)<=PAPER_JOURNAL_MAX_BYTES,'PAPER_JOURNAL_SIZE');await atomicJson(target,next);
     console.log(JSON.stringify({status:'PAPER_CAPTURE_RECORDED_UNVERIFIED',pool,marketSlot:obs.market?.slot??null,swapCandidates:obs.candidates.length,singleBinCandidates:obs.candidates.filter(x=>x.status==='SINGLE_BIN_FEE_CANDIDATE_ONLY').length,gaps:obs.gaps,gapObserved:next.gapObserved,modelEligible:false,pnlReady:false}));
    }
 },onError:e=>console.error(JSON.stringify({status:'PAPER_CAPTURE_BLOCKED',reason:errorCode(e,'PAPER_CAPTURE_FAILED'),modelEligible:false}))});
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_CAPTURE_BLOCKED',reason:errorCode(e,'PAPER_CAPTURE_STARTUP_FAILED')}));process.exitCode=1});

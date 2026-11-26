// Read-only companion to state-service. Records verified raw capture pointers and re-decodes history.
import {mkdir,open,writeFile,rename,unlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {extractMarket} from './engine-input.mjs';
import {captureObservation,nextJournal} from './paper-event-core.mjs';
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
 const lock=join(dir,'writer.lock'),h=await open(lock,'wx',0o600),target=join(dir,'index.json');let stop=false;const cancel=()=>{stop=true};process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try{
  await h.writeFile(String(process.pid));
  do{
   try{
    const bytes=await read(join(DATA,'live',pool,'state.json'),64*1024*1024),state=JSON.parse(bytes);assert(state.pool===pool,'PAPER_STATE_SCOPE');
    let previous=null;try{previous=JSON.parse(await read(target,512*1024))}catch(e){if(e.code!=='ENOENT')throw e}
    const stateHash=sha(bytes);
    if(previous?.lastStateHash===stateHash){console.log(JSON.stringify({status:'PAPER_CAPTURE_UNCHANGED',pool,modelEligible:false}));}
    else{
     let market=null,marketProof=null,history=null,historyProof=null,decoded=null,manifest=null;
     try{market=extractMarket(state);const p=await io.safeDataPath(market.capture),mb=await read(join(p,'manifest.json'),16*1024*1024),ab=await read(join(p,'accounts.json'),32*1024*1024);assert(sha(ab)===market.rawHash,'PAPER_MARKET_RAW_HASH');marketProof={path:relative(ROOT,join(p,'manifest.json')),sha256:sha(mb),accountsHash:sha(ab)};}catch{market=null;marketProof=null}
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
     await writeFile(join(dir,'index.tmp'),JSON.stringify(next),{mode:0o600});await rename(join(dir,'index.tmp'),target);
     console.log(JSON.stringify({status:'PAPER_CAPTURE_RECORDED_UNVERIFIED',pool,marketSlot:obs.market?.slot??null,swapCandidates:obs.candidates.length,singleBinCandidates:obs.candidates.filter(x=>x.status==='SINGLE_BIN_FEE_CANDIDATE_ONLY').length,gaps:obs.gaps,gapObserved:next.gapObserved,modelEligible:false,pnlReady:false}));
    }
   }catch(e){console.error(JSON.stringify({status:'PAPER_CAPTURE_BLOCKED',reason:errorCode(e,'PAPER_CAPTURE_FAILED'),modelEligible:false}));if(!values.watch){process.exitCode=1;break}}
   if(values.watch&&!stop)await new Promise(r=>{const t=setInterval(()=>{if(stop){clearInterval(t);clearTimeout(d);r()}},250),d=setTimeout(()=>{clearInterval(t);r()},interval*1000)});
  }while(values.watch&&!stop);
 }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);try{await h.close()}finally{await unlink(lock)}}
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_CAPTURE_BLOCKED',reason:errorCode(e,'PAPER_CAPTURE_STARTUP_FAILED')}));process.exitCode=1});

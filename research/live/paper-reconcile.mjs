// Re-decode two raw account captures and a later raw history capture; no RPC or signing.
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {reconcileInterval} from './paper-interval-core.mjs';
import {createPaperSnapshotReader} from './paper-snapshot.mjs';
import {historyHeadEligible,PAPER_JOURNAL_MAX_BYTES} from './paper-event-core.mjs';
import {assert,errorCode,hash,poolAddress} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{pool:{type:'string'},before:{type:'string'},after:{type:'string'},history:{type:'string'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},help:{type:'boolean'}}});
const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
async function selectRecent(pool){
 assert(poolAddress(pool),'PAPER_POOL_INVALID');
 const index=JSON.parse(await read(join(DATA,'paper-captures',pool,'index.json'),PAPER_JOURNAL_MAX_BYTES));
 assert(index.pool===pool&&Array.isArray(index.entries)&&index.entries.length<=256,'PAPER_JOURNAL_INVALID');
 const distinct=[];for(const e of [...index.entries].reverse()){if(Number.isSafeInteger(e.marketSlot)&&!distinct.some(x=>x.marketSlot===e.marketSlot))distinct.push(e);if(distinct.length===3)break}
 assert(distinct.length===3&&distinct[0].marketSlot>distinct[1].marketSlot&&distinct[1].marketSlot>distinct[2].marketSlot,'PAPER_THREE_DISTINCT_MARKET_SLOTS_REQUIRED');
 async function bundle(e){assert(hash(e.sha256)&&typeof e.path==='string','PAPER_BUNDLE_POINTER');const b=await read(e.path,72*1024*1024);assert(sha(b)===e.sha256,'PAPER_BUNDLE_HASH_MISMATCH');const r=JSON.parse(b);assert(r.pool===pool&&r.market?.slot===e.marketSlot,'PAPER_BUNDLE_SCOPE');return r}
 const latest=await bundle(distinct[0]),after=await bundle(distinct[1]),before=await bundle(distinct[2]);
 assert(historyHeadEligible(latest.history)&&Array.isArray(latest.gaps)&&latest.gaps.length===0,'PAPER_RECENT_HISTORY_HEAD_REQUIRED');
 const proofs=[before.market.evidence,after.market.evidence,latest.history.evidence];
 for(const e of proofs){assert(e&&hash(e.sha256)&&typeof e.path==='string'&&e.path.endsWith('/manifest.json'),'PAPER_MANIFEST_POINTER');assert(sha(await read(e.path,16*1024*1024))===e.sha256,'PAPER_MANIFEST_HASH_MISMATCH')}
 return proofs.map(e=>dirname(e.path));
}
async function main(){
 if(values.help){console.log('node research/live/paper-reconcile.mjs --pool ADDRESS | --before data/raw/accounts-... --after data/raw/accounts-... --history data/raw/swaps-...');return}
 const explicit=!!(values.before||values.after||values.history);
 assert(values.pool?!explicit:values.before&&values.after&&values.history,'PAPER_CAPTURE_PATHS_REQUIRED');
 const paths=values.pool?await selectRecent(values.pool):[values.before,values.after,values.history];
 const [beforePath,afterPath,historyPath,idl]=await Promise.all([...paths,values.idl].map(io.safeDataPath));
 const dir=join(DATA,'paper-intervals');await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);const tmp=await mkdtemp(join(dir,'.pending-'));
 try{
  const snapshot=createPaperSnapshotReader({ROOT,io,idl});
  const before=await snapshot(beforePath),after=await snapshot(afterPath);if(values.pool)assert(before.identity.pool===values.pool&&after.identity.pool===values.pool,'PAPER_RECENT_POOL_MISMATCH');const mb=await read(join(historyPath,'manifest.json'),16*1024*1024),manifest=JSON.parse(mb),identityPath=join(tmp,'identity.json');await writeFile(identityPath,JSON.stringify(before.identity),{flag:'wx',mode:0o600});
  const history=await io.run(['--capture',historyPath,'--idl',idl,'--identity',identityPath],'inspect-swaps.mjs',120000);
  assert(sha(await read(join(historyPath,'manifest.json'),16*1024*1024))===sha(mb),'PAPER_HISTORY_CHANGED');
  const report={...reconcileInterval({before,after,history,manifest}),sources:{before:before.proof,after:after.proof,history:{path:relative(ROOT,historyPath),manifestHash:sha(mb)}},generatedAt:Date.now()};
  const bytes=JSON.stringify(report),id=sha(bytes),path=join(dir,id+'.json');await writeFile(path,bytes,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:report.status,reason:report.reason,changedBins:report.changedBins.length,report:relative(ROOT,path),modelEligible:false,pnlReady:false},null,2));if(report.status==='BLOCKED')process.exitCode=1;
 }finally{await rm(tmp,{recursive:true,force:true})}
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_INTERVAL_BLOCKED',reason:errorCode(e,'PAPER_INTERVAL_FAILED'),modelEligible:false}));process.exitCode=1});

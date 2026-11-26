// Re-decode two raw account captures and a later raw history capture; no RPC or signing.
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {reconcileInterval} from './paper-interval-core.mjs';
import {assert,errorCode,hash} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{before:{type:'string'},after:{type:'string'},history:{type:'string'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},help:{type:'boolean'}}});
const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
async function main(){
 if(values.help){console.log('node research/live/paper-reconcile.mjs --before data/raw/accounts-... --after data/raw/accounts-... --history data/raw/swaps-...');return}
 assert(values.before&&values.after&&values.history,'PAPER_CAPTURE_PATHS_REQUIRED');
 const [beforePath,afterPath,historyPath,idl]=await Promise.all([values.before,values.after,values.history,values.idl].map(io.safeDataPath));
 const dir=join(DATA,'paper-intervals');await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);const tmp=await mkdtemp(join(dir,'.pending-'));
 try{
  async function snapshot(p){
   const mb=await read(join(p,'manifest.json'),16*1024*1024),ab=await read(join(p,'accounts.json'),32*1024*1024),args=['--capture',p,'--idl',idl];
   const identity=await io.run(args,'inspect-pool.mjs',30000),bins=await io.run(args,'inspect-bins.mjs',30000);
   assert(identity.rawHash===sha(ab)&&bins.rawHash===sha(ab)&&sha(await read(join(p,'manifest.json'),16*1024*1024))===sha(mb)&&sha(await read(join(p,'accounts.json'),32*1024*1024))===sha(ab),'PAPER_CAPTURE_CHANGED');
   return {identity,bins,proof:{path:relative(ROOT,p),manifestHash:sha(mb),accountsHash:sha(ab)}};
  }
  const before=await snapshot(beforePath),after=await snapshot(afterPath),mb=await read(join(historyPath,'manifest.json'),16*1024*1024),manifest=JSON.parse(mb),identityPath=join(tmp,'identity.json');await writeFile(identityPath,JSON.stringify(before.identity),{flag:'wx',mode:0o600});
  const history=await io.run(['--capture',historyPath,'--idl',idl,'--identity',identityPath],'inspect-swaps.mjs',120000);
  assert(sha(await read(join(historyPath,'manifest.json'),16*1024*1024))===sha(mb),'PAPER_HISTORY_CHANGED');
  const report={...reconcileInterval({before,after,history,manifest}),sources:{before:before.proof,after:after.proof,history:{path:relative(ROOT,historyPath),manifestHash:sha(mb)}},generatedAt:Date.now()};
  const bytes=JSON.stringify(report),id=sha(bytes),path=join(dir,id+'.json');await writeFile(path,bytes,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:report.status,reason:report.reason,changedBins:report.changedBins.length,report:relative(ROOT,path),modelEligible:false,pnlReady:false},null,2));if(report.status==='BLOCKED')process.exitCode=1;
 }finally{await rm(tmp,{recursive:true,force:true})}
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_INTERVAL_BLOCKED',reason:errorCode(e,'PAPER_INTERVAL_FAILED'),modelEligible:false}));process.exitCode=1});

// Read-only evidence consumer. Explicit local config/sample; never calls an RPC or signs.
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime,atomicJson,watchLocked} from './terminal-runtime.mjs';
import {sourceInventory} from './source-inventory.mjs';
import {paperConfig,preparePaper,calculatePaper} from './paper-core.mjs';
import {assert,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{config:{type:'string'},sample:{type:'string'},watch:{type:'boolean'},interval:{type:'string',default:'30'},help:{type:'boolean'}}});
const read=async(path,limit)=>io.boundedRead(await io.safeDataPath(path),limit);
async function main(){
 if(values.help){console.log('node research/live/paper-run.mjs --config data/paper/config.json --sample data/paper/sample.json [--watch --interval 30]');return}
 assert(values.config&&values.sample,'PAPER_CONFIG_AND_SAMPLE_REQUIRED');
 const interval=Number(values.interval);assert(Number.isInteger(interval)&&interval>=10&&interval<=600,'PAPER_INTERVAL_INVALID');
 const config=JSON.parse(await read(values.config,128*1024));paperConfig(config);
 const {backendHash}=await sourceInventory(ROOT),dir=join(DATA,'paper',config.id);await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);
 const target=join(dir,'checkpoint.json');
 await watchLocked(dir,{watch:values.watch,interval,step:async()=>{
    assert(JSON.stringify(JSON.parse(await read(values.config,128*1024)))===JSON.stringify(config),'PAPER_CONFIG_CHANGED_RESTART_REQUIRED');
    const sample=JSON.parse(await read(values.sample,32*1024*1024));let previous=null;
    try{previous=JSON.parse(await read(target,64*1024*1024))}catch(e){if(e.code!=='ENOENT')throw e}
    const plan=preparePaper(config,sample,{previous,backendHash});let budget=128*1024*1024;
    for(const r of plan.refs){const b=await read(r.path,Math.min(8*1024*1024,budget));assert(sha(b)===r.sha256,'PAPER_EVIDENCE_HASH_MISMATCH');budget-=b.length}
    if(plan.unchanged){console.log(JSON.stringify({status:'PAPER_PREFIX_UNCHANGED',id:config.id,end:previous.end,executionReady:false,pnlReady:false}));}
    else{
     const checkpoint=calculatePaper(plan,sample),bytes=JSON.stringify(checkpoint);
     assert(Buffer.byteLength(bytes)<=64*1024*1024,'PAPER_CHECKPOINT_SIZE');
     await atomicJson(target,checkpoint);
     console.log(JSON.stringify({status:checkpoint.report.status,id:config.id,end:checkpoint.end,report:target,rows:checkpoint.report.rows.map(({mode,status,virtualNavSol,pnlSol,excessVsHoldSol,feesSol,maxDrawdown})=>({mode,status,virtualNavSol,pnlSol,excessVsHoldSol,feesSol,maxDrawdown})),executionReady:false,pnlReady:false},null,2));
    }
 },onError:e=>console.error(JSON.stringify({status:'PAPER_BLOCKED',reason:errorCode(e,'PAPER_INPUT_OR_EVIDENCE_FAILED'),lastCheckpointNotCurrent:true,executionReady:false,pnlReady:false}))});
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_BLOCKED',reason:errorCode(e,'PAPER_STARTUP_FAILED'),executionReady:false,pnlReady:false}));process.exitCode=1});

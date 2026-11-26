// Estimate virtual fee entitlement across two raw mainnet captures; no network/wallet.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {createPaperSnapshotReader} from './paper-snapshot.mjs';
import {estimateFeeGrowth} from './paper-fee-core.mjs';
import {assert,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{before:{type:'string'},after:{type:'string'},allocation:{type:'string'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},help:{type:'boolean'}}});
async function main(){
 if(values.help){console.log('node research/live/paper-fee-growth.mjs --before data/raw/accounts-... --after data/raw/accounts-... --allocation data/paper/fee-allocation.json');return}
 assert(values.before&&values.after&&values.allocation,'PAPER_FEE_ARGUMENTS_REQUIRED');
 const [a,b,p,idl]=await Promise.all([values.before,values.after,values.allocation,values.idl].map(io.safeDataPath)),snapshot=createPaperSnapshotReader({ROOT,io,idl});
 const bytes=await io.boundedRead(p,128*1024),allocation=JSON.parse(bytes),before=await snapshot(a),after=await snapshot(b);
 const report={...estimateFeeGrowth({before,after,allocation}),generatedAt:Date.now(),sources:{before:before.proof,after:after.proof,allocation:{path:relative(ROOT,p),sha256:sha(bytes)}}};
 const dir=join(DATA,'paper-fees');await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);
 const out=JSON.stringify(report),id=sha(out),path=join(dir,id+'.json');await writeFile(path,out,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:report.status,reason:report.reason,totals:report.totals,report:relative(ROOT,path),modelEligible:false,pnlReady:false},null,2));if(report.status==='BLOCKED')process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_FEE_BLOCKED',reason:errorCode(e,'PAPER_FEE_FAILED'),modelEligible:false}));process.exitCode=1});

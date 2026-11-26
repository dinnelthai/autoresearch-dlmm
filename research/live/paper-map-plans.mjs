// Re-read opening raw snapshot and research plan; optionally compare fees to a later snapshot.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {createPaperSnapshotReader} from './paper-snapshot.mjs';
import {mapPaperPlans,mappedFeeDiagnostics} from './paper-share-core.mjs';
import {assert,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{before:{type:'string'},after:{type:'string'},report:{type:'string'},budget:{type:'string'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},help:{type:'boolean'}}});
async function main(){
 if(values.help){console.log('node research/live/paper-map-plans.mjs --before data/raw/accounts-... --report data/research-report.json [--budget data/paper/budget.json --after data/raw/accounts-...]');return}
 assert(values.before&&values.report,'PAPER_SHARE_ARGUMENTS_REQUIRED');
 const [a,r,idl]=await Promise.all([values.before,values.report,values.idl].map(io.safeDataPath)),snapshot=createPaperSnapshotReader({ROOT,io,idl});
 const bytes=await io.boundedRead(r,8*1024*1024),report=JSON.parse(bytes),before=await snapshot(a);
 const budgetBytes=values.budget?await io.boundedRead(await io.safeDataPath(values.budget),128*1024):null;
 const budget=budgetBytes?JSON.parse(budgetBytes):report.terminalBinding?.researchBudget;
 const mapping=mapPaperPlans({snapshot:before,report,budget});
 const after=values.after&&mapping.status!=='BLOCKED'?await snapshot(await io.safeDataPath(values.after)):null;
 const fees=after?mappedFeeDiagnostics({before,after,mapping}):null;
 const output={...mapping,generatedAt:Date.now(),sources:{before:before.proof,after:after?.proof??null,report:{path:relative(ROOT,r),sha256:sha(bytes)},budgetHash:sha(JSON.stringify(budget??null)),budget},feeDiagnostics:fees};
 const dir=join(DATA,'paper-shares');await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);
 const body=JSON.stringify(output),path=join(dir,sha(body)+'.json');await writeFile(path,body,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:output.status,reason:output.reason,report:relative(ROOT,path),rows:output.rows.map(r=>({mode:r.mode,status:r.status,reason:r.reason,bins:r.rows.length})),feeDiagnostics:fees?.map(r=>({mode:r.mode,status:r.fee?.status??r.status,totals:r.fee?.totals??null})),pnlReady:false,executionReady:false},null,2));if(output.status==='BLOCKED')process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_SHARE_BLOCKED',reason:errorCode(e,'PAPER_SHARE_FAILED')}));process.exitCode=1});

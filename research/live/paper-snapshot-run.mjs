// Local frozen experiment checkpoint; explicit open/step, no RPC, signing or transaction route.
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime,atomicJson,withWriterLock} from './terminal-runtime.mjs';
import {createPaperSnapshotReader,readSnapshotCheckpoint,snapshotCheckpoint,advancePaperCapture} from './paper-snapshot.mjs';
import {openSnapshotExperiment} from './paper-snapshot-run-core.mjs';
import {sourceInventory} from './source-inventory.mjs';
import {assert,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{id:{type:'string'},snapshot:{type:'string'},report:{type:'string'},policy:{type:'string'},budget:{type:'string'},exit:{type:'boolean'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},help:{type:'boolean'}}});
const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
async function main(){
 if(values.help){console.log('Open: --id ID --snapshot CAPTURE --report REPORT --policy POLICY [--budget BUDGET]; Step: --id ID --snapshot CAPTURE [--exit]');return}
 assert(typeof values.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(values.id)&&values.snapshot,'PAPER_SNAPSHOT_ARGUMENTS');
 const idl=await io.safeDataPath(values.idl),reader=createPaperSnapshotReader({ROOT,io,idl}),{backendHash}=await sourceInventory(ROOT),dir=join(DATA,'paper-snapshot-runs',values.id);
 await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);
 const target=join(dir,'checkpoint.json');
 await withWriterLock(dir,async()=>{
  let prior=null;try{prior=JSON.parse(await read(target,32*1024*1024))}catch(e){if(e.code!=='ENOENT')throw e}
  const snapshot=await reader(await io.safeDataPath(values.snapshot));let state;
  if(!prior){
   assert(values.report&&values.policy&&!values.exit,'PAPER_SNAPSHOT_OPEN_REQUIRES_REPORT_POLICY');
   const reportBytes=await read(values.report,8*1024*1024),report=JSON.parse(reportBytes),policy=JSON.parse(await read(values.policy,128*1024)),budget=values.budget?JSON.parse(await read(values.budget,128*1024)):report.terminalBinding?.researchBudget;
   state=openSnapshotExperiment({id:values.id,snapshot,report,budget,policy,backendHash,frozenAt:Date.now()});state.reportHash=sha(reportBytes);
  }else{
   assert(!values.report&&!values.policy&&!values.budget,'PAPER_SNAPSHOT_CANNOT_CHANGE_FROZEN_CONFIG');
   const body=readSnapshotCheckpoint(prior,values.id);
   state=await advancePaperCapture(body,{load:reader,snapshot,backendHash,now:Date.now(),exit:values.exit===true});
  }
  await atomicJson(target,snapshotCheckpoint(state));
  console.log(JSON.stringify({status:state.status,slot:state.last.slot,snapshotCount:state.snapshotCount,checkpoint:target,rows:state.rows.map(r=>({mode:r.mode,status:r.status,reason:r.reason,latest:r.status==='BLOCKED'?null:r.points.at(-1)})),executionReady:false,pnlReady:false},null,2));
 });
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_SNAPSHOT_BLOCKED',reason:errorCode(e,'PAPER_SNAPSHOT_FAILED'),lastCheckpointNotCurrent:true,pnlReady:false}));process.exitCode=1});

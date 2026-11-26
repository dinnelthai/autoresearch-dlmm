// Local frozen experiment checkpoint; explicit open/step, no RPC, signing or transaction route.
import {mkdir,open,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {createPaperSnapshotReader} from './paper-snapshot.mjs';
import {openSnapshotExperiment,advanceSnapshotExperiment} from './paper-snapshot-run-core.mjs';
import {sourceInventory} from './source-inventory.mjs';
import {assert,errorCode,hash} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{id:{type:'string'},snapshot:{type:'string'},report:{type:'string'},policy:{type:'string'},budget:{type:'string'},exit:{type:'boolean'},idl:{type:'string',default:'data/raw/dlmm-idl.json'},help:{type:'boolean'}}});
const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
async function main(){
 if(values.help){console.log('Open: --id ID --snapshot CAPTURE --report REPORT --policy POLICY [--budget BUDGET]; Step: --id ID --snapshot CAPTURE [--exit]');return}
 assert(typeof values.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(values.id)&&values.snapshot,'PAPER_SNAPSHOT_ARGUMENTS');
 const idl=await io.safeDataPath(values.idl),reader=createPaperSnapshotReader({ROOT,io,idl}),{backendHash}=await sourceInventory(ROOT),dir=join(DATA,'paper-snapshot-runs',values.id);
 await mkdir(dir,{recursive:true,mode:0o700});await io.safeDataPath(dir);
 const target=join(dir,'checkpoint.json'),lock=join(dir,'writer.lock'),h=await open(lock,'wx',0o600);
 try{
  let prior=null;try{prior=JSON.parse(await read(target,32*1024*1024))}catch(e){if(e.code!=='ENOENT')throw e}
  const snapshot=await reader(await io.safeDataPath(values.snapshot));let state;
  if(!prior){
   assert(values.report&&values.policy&&!values.exit,'PAPER_SNAPSHOT_OPEN_REQUIRES_REPORT_POLICY');
   const reportBytes=await read(values.report,8*1024*1024),report=JSON.parse(reportBytes),policy=JSON.parse(await read(values.policy,128*1024)),budget=values.budget?JSON.parse(await read(values.budget,128*1024)):report.terminalBinding?.researchBudget;
   state=openSnapshotExperiment({id:values.id,snapshot,report,budget,policy,backendHash,frozenAt:Date.now()});state.reportHash=sha(reportBytes);
  }else{
   assert(!values.report&&!values.policy&&!values.budget,'PAPER_SNAPSHOT_CANNOT_CHANGE_FROZEN_CONFIG');
   const {checkpointHash,...body}=prior;assert(hash(checkpointHash)&&sha(JSON.stringify(body))===checkpointHash&&body.id===values.id,'PAPER_SNAPSHOT_CHECKPOINT_HASH');
   const opening=await reader(await io.safeDataPath(body.opening.proof.path)),previous=body.opening.slot===body.last.slot?opening:await reader(await io.safeDataPath(body.last.proof.path));
   state=advanceSnapshotExperiment(body,{opening,previous,snapshot,backendHash,now:Date.now(),exit:values.exit===true});
  }
  assert((await sourceInventory(ROOT)).backendHash===backendHash,'PAPER_SNAPSHOT_CODE_CHANGED');
  const payload={...state,checkpointHash:sha(JSON.stringify(state))},bytes=JSON.stringify(payload);assert(Buffer.byteLength(bytes)<=32*1024*1024,'PAPER_SNAPSHOT_CHECKPOINT_SIZE');
  await writeFile(join(dir,'checkpoint.tmp'),bytes,{mode:0o600});await rename(join(dir,'checkpoint.tmp'),target);
  console.log(JSON.stringify({status:state.status,slot:state.last.slot,snapshotCount:state.snapshotCount,checkpoint:target,rows:state.rows.map(r=>({mode:r.mode,status:r.status,reason:r.reason,latest:r.status==='BLOCKED'?null:r.points.at(-1)})),executionReady:false,pnlReady:false},null,2));
 }finally{try{await h.close()}finally{await unlink(lock)}}
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_SNAPSHOT_BLOCKED',reason:errorCode(e,'PAPER_SNAPSHOT_FAILED'),lastCheckpointNotCurrent:true,pnlReady:false}));process.exitCode=1});

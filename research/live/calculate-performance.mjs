// T16 offline existing-position window diagnostic, not accepted live PnL.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {calculateWindow} from './performance-core.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)},sha=v=>createHash('sha256').update(v).digest('hex');
async function main(){
 const {values}=parseArgs({options:{input:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/calculate-performance.mjs --input data/performance-window.json');return}
 const root=await realpath(resolve('data'));
 async function bytes(path,max=32*1024*1024){const p=await realpath(resolve(path)),r=relative(root,p);assert(r&&!r.startsWith('..')&&!isAbsolute(r),'PERF_DATA_PATH_REQUIRED');const b=await readFile(p);assert(b.length<=max,'PERF_FILE_TOO_LARGE');return b}
 const cfg=JSON.parse(await bytes(values.input,32768));
 assert(cfg.schemaVersion===1&&cfg.scope==='EXISTING_POSITION_WINDOW_RETAIN_DISTRIBUTIONS','PERF_SCOPE_REQUIRED');
 const files={};for(const k of ['ledger','opening','closing','marks']){const b=await bytes(cfg[k]);files[k]={data:JSON.parse(b),hash:sha(b)}}
 const marks=files.marks.data;
 assert(Array.isArray(marks.flows)&&marks.flows.length<=20000,'PERF_FLOW_MARKS');
 for(const m of [marks.opening,marks.closing,...marks.flows]){
  assert(m&&Array.isArray(m.references)&&m.references.length===2,'PERF_MARK_REQUIRED');
  for(const r of [m,...m.references])assert(sha(await bytes(r.evidencePath))===r.evidenceHash,'PERF_MARK_EVIDENCE_HASH_MISMATCH');
 }
 const result=calculateWindow({ledger:files.ledger.data,opening:files.opening.data,closing:files.closing.data,marks,policy:cfg,bindings:Object.fromEntries(Object.entries(files).map(([k,v])=>[k+'Hash',v.hash]))});
 console.log(JSON.stringify(result,null,2));if(result.status==='BLOCKED')process.exitCode=1;
}
main().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'PERF_INPUT_FAILED',decisionReady:false,executionReady:false,pnlReady:false}));process.exitCode=1});

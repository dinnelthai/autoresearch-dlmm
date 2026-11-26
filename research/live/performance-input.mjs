import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const assert=(v,m)=>{if(!v)throw Error(m)},sha=v=>createHash('sha256').update(v).digest('hex');
export async function loadPerformanceWindow(inputPath){
 const root=await realpath(resolve('data'));
 async function bytes(path,max=32*1024*1024){const p=await realpath(resolve(path)),r=relative(root,p);assert(r&&!r.startsWith('..')&&!isAbsolute(r),'PERF_DATA_PATH_REQUIRED');const b=await readFile(p);assert(b.length<=max,'PERF_FILE_TOO_LARGE');return b}
 const configBytes=await bytes(inputPath,32768),cfg=JSON.parse(configBytes);
 assert(cfg.schemaVersion===1&&cfg.scope==='EXISTING_POSITION_WINDOW_RETAIN_DISTRIBUTIONS','PERF_SCOPE_REQUIRED');
 const files={};for(const k of ['ledger','opening','closing','marks']){const b=await bytes(cfg[k]);files[k]={data:JSON.parse(b),hash:sha(b)}}
 const marks=files.marks.data;
 assert(Array.isArray(marks.flows)&&marks.flows.length<=20000,'PERF_FLOW_MARKS');
 for(const m of [marks.opening,marks.closing,...marks.flows]){
  assert(m&&Array.isArray(m.references)&&m.references.length===2,'PERF_MARK_REQUIRED');
  for(const r of [m,...m.references])assert(sha(await bytes(r.evidencePath))===r.evidenceHash,'PERF_MARK_EVIDENCE_HASH_MISMATCH');
 }

 return {ledger:files.ledger.data,opening:files.opening.data,closing:files.closing.data,marks,policy:cfg,bindings:{...Object.fromEntries(Object.entries(files).map(([k,v])=>[k+'Hash',v.hash])),configHash:sha(configBytes)}};
}

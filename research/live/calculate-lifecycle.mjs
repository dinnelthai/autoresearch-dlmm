// T16 B2 offline closed-position lifecycle; hash-bound local evidence only.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {calculateLifecycle} from './performance-lifecycle.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)},sha=v=>createHash('sha256').update(v).digest('hex');
async function main(){
 const {values}=parseArgs({options:{input:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/calculate-lifecycle.mjs --input data/performance-lifecycle.json');return}
 const root=await realpath(resolve('data'));
 async function bytes(path,max=32*1024*1024){const p=await realpath(resolve(path)),r=relative(root,p);assert(r&&!r.startsWith('..')&&!isAbsolute(r),'LIFE_DATA_PATH_REQUIRED');const b=await readFile(p);assert(b.length<=max,'LIFE_FILE_TOO_LARGE');return b}
 const cb=await bytes(values.input,32768),cfg=JSON.parse(cb);
 assert(cfg.schemaVersion===1&&cfg.scope==='CLOSED_POSITION_RETAIN_DISTRIBUTIONS','LIFE_SCOPE_REQUIRED');
 const lb=await bytes(cfg.ledger),mb=await bytes(cfg.marks),ledger=JSON.parse(lb),marks=JSON.parse(mb);
 assert(Array.isArray(ledger.sources)&&ledger.sources.length>=1&&ledger.sources.length<=20,'LIFE_SOURCES_REQUIRED');
 const archives=[];
 for(const source of ledger.sources){
  const b=await bytes(join(source.directory,'manifest.json')),m=JSON.parse(b);assert(sha(b)===source.manifestHash,'LIFE_MANIFEST_HASH_MISMATCH');
  assert(Array.isArray(m.files)&&m.files.length<=50000,'LIFE_MANIFEST_FILES');
  const files=m.files.filter(f=>f.method==='getSignaturesForAddress');
  assert(files.length>=1&&files.length<=20,'LIFE_PAGE_FILES');
  const pages=[];
  for(const [i,f] of files.entries()){
   assert(f.file==='signatures-'+i+'.json'&&f.params?.length===2&&f.params[0]===ledger.position&&f.params[1]?.commitment==='finalized'&&f.params[1]?.until==null,'LIFE_PAGE_REQUEST_MISMATCH');
   const p=await bytes(join(source.directory,f.file)),r=JSON.parse(p);
   assert(sha(p)===f.sha256&&r.jsonrpc==='2.0'&&r.id===f.requestId&&!r.error&&Array.isArray(r.result),'LIFE_PAGE_HASH_OR_ENVELOPE');
   pages.push({before:f.params[1].before??null,limit:f.params[1].limit,rows:r.result});
  }
  archives.push({manifest:m,manifestHash:sha(b),pages});
 }
 assert(Array.isArray(marks.flows)&&marks.flows.length<=20000,'LIFE_MARKS_REQUIRED');
 for(const m of [marks.closing,...marks.flows]){
  assert(m&&Array.isArray(m.references)&&m.references.length===2,'LIFE_MARK_REQUIRED');
  for(const r of [m,...m.references])assert(sha(await bytes(r.evidencePath))===r.evidenceHash,'LIFE_MARK_EVIDENCE_HASH_MISMATCH');
 }
 const result=calculateLifecycle({ledger,archives,marks,policy:cfg,bindings:{ledgerHash:sha(lb),marksHash:sha(mb),configHash:sha(cb)}});
 console.log(JSON.stringify(result,null,2));if(result.status==='BLOCKED')process.exitCode=1;
}
main().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'LIFE_INPUT_FAILED',decisionReady:false,executionReady:false,pnlReady:false,historyComplete:false}));process.exitCode=1});

// T11 runner: explicit offline evidence, no network or transactions.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {Engine} from '../engine.mjs';
import {validateFreeze,validateSample} from './shadow-contract.mjs';
import {replayWindow} from './shadow-policy.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(HERE,'../..'),DATA=resolve(ROOT,'data');
const assert=(ok,m)=>{if(!ok)throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const files={engine:'../engine.mjs',plans:'preview-plans.mjs',management:'preview-management.mjs',contract:'shadow-contract.mjs',policy:'shadow-policy.mjs',runner:'shadow-run.mjs'};
async function codeHashes(){return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([k,v])=>[k,sha(await readFile(resolve(HERE,v)))])));}
function safePath(p){
 assert(typeof p==='string','evidence path missing');
 const v=resolve(ROOT,p),r=relative(DATA,v);
 assert(r&&!r.startsWith('..')&&!isAbsolute(r),'evidence must be under data/');
 return v;
}
const cache=new Map();
async function checked(p){
 const file=safePath(p.path);
 if(!cache.has(file))cache.set(file,await readFile(file));
 const b=cache.get(file);assert(sha(b)===p.sha256,'evidence hash mismatch');
 return b;
}
function summarize(rows,split,baseline){
 const all=rows.filter(r=>r.split===split),groups=new Map();
 let valid=0;
 for(const row of all){
  const a=row.runs?.find(r=>r.mode==='adaptive'),b=row.runs?.find(r=>r.mode===baseline);
  if(a?.status!=='HYPOTHETICAL_REPLAY'||b?.status!=='HYPOTHETICAL_REPLAY')continue;
  valid++;const g=groups.get(row.group)??[];g.push(a.pnlSol-b.pnlSol);groups.set(row.group,g);
 }
 const deltas=[...groups.values()].map(v=>v.reduce((a,b)=>a+b,0)/v.length).sort((a,b)=>a-b),n=deltas.length;
 return {baseline,plannedWindows:all.length,validPairs:valid,invalidOrMissing:all.length-valid,declaredGroups: n,meanGroupDeltaSol:n?deltas.reduce((a,b)=>a+b,0)/n:null,medianGroupDeltaSol:n?(deltas[Math.floor((n-1)/2)]+deltas[Math.floor(n/2)])/2:null,worstGroupDeltaSol:n?deltas[0]:null,positiveGroupFraction:n?deltas.filter(v=>v>0).length/n:null,conclusion:'INCONCLUSIVE_UNVERIFIED_FROZEN_PATH'};
}
async function main(){
 const {values}=parseArgs({options:{freeze:{type:'string'},samples:{type:'string'},'freeze-hash':{type:'string'},'code-hashes':{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/shadow-run.mjs --code-hashes | --freeze data/shadow/freeze.json --freeze-hash SHA256 --samples data/shadow/samples.json');return;}
 const actual=await codeHashes();
 if(values['code-hashes']){console.log(JSON.stringify(actual,null,2));return;}
 assert(values.freeze&&values.samples&&values['freeze-hash'],'frozen plan, prior hash and sample index required');
 const frozenRaw=await readFile(safePath(values.freeze));assert(sha(frozenRaw)===values['freeze-hash'],'freeze hash mismatch');
 const frozen=validateFreeze(JSON.parse(frozenRaw));
 for(const [k,v] of Object.entries(actual))assert(frozen.codeHashes[k]===v,'frozen code changed: '+k);
 const index=JSON.parse(await readFile(safePath(values.samples)));
 assert(Array.isArray(index.samples),'sample index required');
 const ids=new Set(frozen.windows.map(w=>w.id)),byId=new Map();
 for(const x of index.samples){assert(ids.has(x.id)&&!byId.has(x.id),'unexpected/duplicate sample');byId.set(x.id,x);}
 const rows=[];
 for(const w of frozen.windows){
  try{
   const entry=byId.get(w.id);assert(entry,'missing frozen window');
   assert(w.end<=Math.floor(Date.now()/1000),'window not completed');
   const cfg=Engine.requestConfig(w.request,w.config);
   assert(Object.keys(Engine.DEFAULTS).every(k=>Object.hasOwn(w.config,k)),'all engine parameters must be frozen explicitly');
   const sample=JSON.parse(await checked(entry));
   const counts=validateSample(w,sample,cfg);
   await checked(sample.coverage.evidence);
   for(const e of sample.events){await checked(e.evidence);for(const r of e.references??[])await checked(r.evidence);}
   rows.push({...replayWindow(w,sample),counts});
  }catch(e){rows.push({id:w.id,group:w.group,split:w.split,status:'BLOCKED',reason:String(e.message).slice(0,220),runs:[]});}
 }
 const report={status:'SHADOW_RESEARCH_ONLY',policy:frozen.policy,freezeHash:values['freeze-hash'],codeHashes:actual,decisionReady:false,executionReady:false,protocolExact:false,calibrated:false,rows,summaries:Object.fromEntries(['train','validation','test'].map(split=>[split,['hodl','spot','curve','bid_ask','hybrid'].map(b=>summarize(rows,split,b))])),limitations:['Hash verification is archive integrity, not proof of causal collection, semantic reconciliation or prior freeze timestamp.','No policy tuning or profitability verdict. Virtual LP participation and execution use model approximations; not on-chain PnL.','Independent review of event decoding, fees, costs, source independence, complete coverage and risk calibration remains mandatory.','All frozen windows remain in denominators, including missing or invalid windows.']};
 console.log(JSON.stringify(report,null,2));if(rows.some(r=>r.status==='BLOCKED'||r.runs.some(x=>x.status!=='HYPOTHETICAL_REPLAY')))process.exitCode=1;
}
main().catch(e=>{console.error('T11 blocked: '+String(e.message).slice(0,240));process.exitCode=1;});

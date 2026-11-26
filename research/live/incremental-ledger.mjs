// Bounded position-history archive pointers. Reconcile originals each time, never add cached totals.
import {mkdir,open,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const assert=(v,m)=>{if(!v)throw Error(m)},key=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),sig=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v),hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const LIMIT=8;
const scopeFields=['pool','owner','position','mintX','mintY'];
export function validateLedgerIndex(x,scope){
 assert(scopeFields.every(k=>key(scope[k])&&x?.[k]===scope[k])&&x.schemaVersion===1&&Array.isArray(x.pages)&&x.pages.length<=LIMIT&&Number.isSafeInteger(x.turn)&&x.turn>=0&&typeof x.gapObserved==='boolean'&&typeof x.retentionTruncated==='boolean'&&typeof x.backfillExhausted==='boolean'&&Array.isArray(x.head)&&x.head.length<=10&&x.head.every(sig)&&new Set(x.head).size===x.head.length&&(x.cursor===null||sig(x.cursor)),'LEDGER_INDEX_INVALID');
 const paths=new Set();for(const p of x.pages){assert(typeof p.capture==='string'&&/^data\/raw\/swaps-[A-Za-z0-9_-]+$/.test(p.capture)&&!paths.has(p.capture)&&hash(p.sha256)&&Array.isArray(p.signatures)&&p.signatures.length>=1&&p.signatures.length<=10&&p.signatures.every(sig)&&new Set(p.signatures).size===p.signatures.length,'LEDGER_INDEX_PAGE_INVALID');paths.add(p.capture)}
 assert(x.head.every(s=>x.pages.some(p=>p.signatures.includes(s)))&&(x.cursor===null||x.pages.some(p=>p.signatures.includes(x.cursor))),'LEDGER_INDEX_ANCHOR_INVALID');
 return x;
}
export function emptyLedgerIndex(scope){return validateLedgerIndex({schemaVersion:1,...Object.fromEntries(scopeFields.map(k=>[k,scope[k]])),pages:[],head:[],turn:0,cursor:null,gapObserved:false,retentionTruncated:false,backfillExhausted:false},scope)}
export function nextLedgerPage(x){
 const backfill=x.pages.length>0&&x.pages.length<LIMIT&&!x.backfillExhausted&&x.cursor!==null&&x.turn%2===1;
 return {before:backfill?x.cursor:null,mode:backfill?'BACKFILL':'HEAD'};
}
export function appendLedgerPage(previous,scope,manifest,pointer,plan){
 const x=validateLedgerIndex(previous,scope);
 assert(plan.before===nextLedgerPage(x).before&&manifest?.pool===scope.pool&&manifest.position===scope.position&&manifest.indexAddress===scope.position&&manifest.commitment==='finalized'&&manifest.before===plan.before&&Array.isArray(manifest.signatures)&&manifest.signatures.length<=10,'LEDGER_PAGE_SCOPE');
 const rows=manifest.signatures.map(r=>r.signature);
 assert(rows.every(sig)&&new Set(rows).size===rows.length&&manifest.signatures.every((r,i)=>Number.isSafeInteger(r.slot)&&r.slot>=0&&(i===0||r.slot<=manifest.signatures[i-1].slot)),'LEDGER_PAGE_ORDER');
 const out={...x,turn:x.turn+1};
 if(manifest.status==='EMPTY_PAGE_OBSERVED_UNVERIFIED'&&!rows.length&&!manifest.gaps?.length){if(plan.mode==='BACKFILL')out.backfillExhausted=true;return out}
 if(manifest.status!=='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED'||manifest.gaps?.length||!rows.length){out.gapObserved=true;return out}
 assert(manifest.nextBefore===rows.at(-1)&&!rows.includes(plan.before),'LEDGER_PAGE_CURSOR');
 const overlap=x.head.some(s=>rows.includes(s));
 if(plan.mode==='HEAD'&&x.head.length&&!overlap)out.gapObserved=true;
 const pages=x.pages.filter(p=>!p.signatures.every(s=>rows.includes(s)));
 pages.push({...pointer,signatures:rows});
 if(pages.length>LIMIT){pages.shift();out.retentionTruncated=true;out.backfillExhausted=true}
 out.pages=pages;
 if(plan.mode==='HEAD')out.head=rows;
 if(plan.mode==='BACKFILL'||!x.cursor){out.cursor=rows.at(-1);if(manifest.stopReason==='SHORT_PAGE')out.backfillExhausted=true}
 if(out.cursor&&!pages.some(p=>p.signatures.includes(out.cursor)))out.cursor=null;
 return validateLedgerIndex(out,scope);
}
export function incrementalLedgerStore(data,read){
 const dir=s=>{assert(scopeFields.every(k=>key(s[k])),'LEDGER_INDEX_SCOPE');return join(data,'position-ledger-index',s.pool,s.owner,s.position)};
 async function load(scope){try{return validateLedgerIndex(JSON.parse(await read(join(dir(scope),'index.json'),256*1024)),scope)}catch(e){if(e.code==='ENOENT')return emptyLedgerIndex(scope);throw e}}
 async function save(scope,prior,next){
  validateLedgerIndex(next,scope);const d=dir(scope);await mkdir(d,{recursive:true,mode:0o700});const lock=join(d,'writer.lock'),h=await open(lock,'wx',0o600);
  try{assert(JSON.stringify(await load(scope))===JSON.stringify(prior),'LEDGER_INDEX_CHANGED');await writeFile(join(d,'index.tmp'),JSON.stringify(next),{mode:0o600});await rename(join(d,'index.tmp'),join(d,'index.json'))}finally{try{await h.close()}finally{await unlink(lock)}}
 }
 return {load,save};
}

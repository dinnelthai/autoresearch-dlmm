// Read-only T04 raw history capture. No wallet, signing or transaction submission.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {PublicKey} from '@solana/web3.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m);};
async function main(){
 const {values}=parseArgs({options:{pool:{type:'string'},pages:{type:'string',default:'1'},limit:{type:'string',default:'50'},before:{type:'string'},provider:{type:'string',default:'solana-rpc'},help:{type:'boolean'}}});
 if(values.help){console.log('SOLANA_RPC_URL=... node research/live/capture-swaps.mjs --pool ADDRESS [--pages 1 --limit 50 --before SIGNATURE]');return;}
 const pool=new PublicKey(values.pool).toBase58();assert(pool===values.pool,'invalid pool');
 const pages=Number(values.pages),limit=Number(values.limit);
 assert(Number.isInteger(pages)&&pages>=1&&pages<=20&&Number.isInteger(limit)&&limit>=1&&limit<=1000,'invalid capture bounds');
 assert(/^[a-zA-Z0-9_-]{1,48}$/.test(values.provider),'provider must be a non-secret label');
 const endpoint=new URL(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
 assert(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)),'RPC requires HTTPS or local HTTP');
 const root=join('data','raw');await mkdir(root,{recursive:true,mode:0o700});const dir=await mkdtemp(join(root,'swaps-'));
 const manifest={schemaVersion:1,pool,provider:values.provider,commitment:'finalized',requestedAt:new Date().toISOString(),pagesRequested:pages,pageLimit:limit,before:values.before??null,files:[],gaps:[],signatures:[],blocks:[],status:'PARTIAL',limitations:['Address-indexed bounded sample only; no historical completeness claim.','Block signature lists supply transaction order, not per-bin state.']};
 let id=0;
 async function rpc(method,params,file){
  const requestedAt=new Date().toISOString(),rid=++id;
  try{
   const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:rid,method,params}),signal:AbortSignal.timeout(30000),redirect:'error'});
   const raw=await res.text(),receivedAt=new Date().toISOString();
   if(!res.ok){manifest.gaps.push({method,file,reason:'HTTP_'+res.status});return null;}
   let p;try{p=JSON.parse(raw);}catch{manifest.gaps.push({method,file,reason:'INVALID_JSON'});return null;}
   if(p.jsonrpc!=='2.0'||p.id!==rid||p.error||!('result'in p)){manifest.gaps.push({method,file,reason:'RPC_ERROR_OR_BAD_ENVELOPE'});return null;}
   await writeFile(join(dir,file),raw,{mode:0o600,flag:'wx'});
   manifest.files.push({file,method,params,requestId:rid,requestedAt,receivedAt,sha256:sha(raw)});
   if(p.result===null)manifest.gaps.push({method,file,reason:'NULL_RESULT'});
   return p.result;
  }catch{manifest.gaps.push({method,file,reason:'NETWORK_OR_STORAGE_FAILURE'});return null;}
 }
 let cursor=values.before;const seen=new Set(),slots=new Set();
 for(let i=0;i<pages;i++){
  const cfg={commitment:'finalized',limit,...(cursor?{before:cursor}:{})};
  const rows=await rpc('getSignaturesForAddress',[pool,cfg],'signatures-'+i+'.json');
  if(!Array.isArray(rows)){manifest.gaps.push({reason:'SIGNATURE_PAGE_UNAVAILABLE',page:i});break;}
  if(rows.length===0){manifest.stopReason='EMPTY_PAGE';break;}
  for(const row of rows){
   if(typeof row.signature!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)||!Number.isSafeInteger(row.slot)||row.slot<0||seen.has(row.signature)){manifest.gaps.push({reason:'INVALID_OR_DUPLICATE_SIGNATURE',page:i});continue;}
   seen.add(row.signature);slots.add(row.slot);manifest.signatures.push({signature:row.signature,slot:row.slot,err:row.err,blockTime:row.blockTime});
   const tx=await rpc('getTransaction',[row.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}],'tx-'+row.signature+'.json');
   if(!tx||tx.slot!==row.slot||tx.transaction?.signatures?.[0]!==row.signature)manifest.gaps.push({signature:row.signature,reason:'TRANSACTION_IDENTITY_OR_AVAILABILITY'});
  }
  const next=rows.at(-1)?.signature;if(!next||next===cursor){manifest.gaps.push({reason:'CURSOR_DID_NOT_ADVANCE',page:i});break;}
  cursor=next;manifest.nextBefore=cursor;
  if(rows.length<limit){manifest.stopReason='SHORT_PAGE';break;}
 }
 for(const slot of [...slots].sort((a,b)=>a-b)){
  const b=await rpc('getBlock',[slot,{commitment:'finalized',transactionDetails:'signatures',rewards:false,maxSupportedTransactionVersion:0}],'block-'+slot+'.json');
  if(!Array.isArray(b?.signatures)||new Set(b.signatures).size!==b.signatures.length){manifest.gaps.push({slot,reason:'BLOCK_ORDER_UNAVAILABLE'});continue;}
  manifest.blocks.push({slot,file:'block-'+slot+'.json'});
  for(const s of manifest.signatures.filter(s=>s.slot===slot))if(!b.signatures.includes(s.signature))manifest.gaps.push({signature:s.signature,slot,reason:'SIGNATURE_NOT_IN_BLOCK'});
 }
 manifest.stopReason??='PAGE_BUDGET_OR_ERROR';
 manifest.status=manifest.signatures.length&&!manifest.gaps.length?'BOUNDED_SAMPLE_CAPTURED_UNVERIFIED':'PARTIAL';
 manifest.completedAt=new Date().toISOString();
 await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({directory:dir,status:manifest.status,signatures:manifest.signatures.length,gaps:manifest.gaps.length,nextBefore:manifest.nextBefore}));
 if(manifest.status!=='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED')process.exitCode=1;
}
main().catch(()=>{console.error('T04 capture blocked: check configuration or local storage.');process.exitCode=1;});

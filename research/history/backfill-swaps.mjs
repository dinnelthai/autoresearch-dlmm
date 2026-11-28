// Resumable, bounded RPC backfill. Reuse the pinned native capture implementation.
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {advance} from './core.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),exec=promisify(execFile);
const {values:v}=parseArgs({options:{pool:{type:'string'},since:{type:'string'},batches:{type:'string',default:'1'},limit:{type:'string',default:'50'},provider:{type:'string',default:'solana-rpc'}}});
const since=Date.parse(v.since)/1000,batches=Number(v.batches),limit=Number(v.limit);
if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.pool??'')||!/^\d{4}-\d{2}-\d{2}$/.test(v.since??'')||!Number.isSafeInteger(since)||new Date(since*1000).toISOString().slice(0,10)!==v.since||since>=Date.now()/1000||!Number.isInteger(batches)||batches<1||batches>20||!Number.isInteger(limit)||limit<1||limit>100||!/^[a-zA-Z0-9_-]{1,48}$/.test(v.provider))throw Error('usage: --pool ADDRESS --since YYYY-MM-DD [--batches 1 --limit 50 --provider LABEL]');
const dir=join(root,'data','historical',v.pool,'swaps-'+v.since+'-'+v.provider);
await mkdir(dir,{recursive:true,mode:0o700});
const lock=join(dir,'run.lock'),file=join(dir,'checkpoint.json');
const handle=await open(lock,'wx',0o600);
const save=async s=>{const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(s,null,2)+'\n',{mode:0o600});await rename(tmp,file);};
try{
 let s;try{s=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;s={schemaVersion:1,pool:v.pool,provider:v.provider,since,cursor:null,lastSlot:null,oldestObserved:null,signatures:0,status:'READY',batches:[]};}
 if(s.schemaVersion!==1||s.pool!==v.pool||s.since!==since||s.provider!==v.provider||!Array.isArray(s.batches))throw Error('CHECKPOINT_IDENTITY');
 for(let i=0;i<batches&&s.status==='READY';i++){
  const args=['research/live/capture-swaps.mjs','--pool',v.pool,'--pages','1','--limit',String(limit),'--provider',v.provider,...(s.cursor?['--before',s.cursor]:[])];
  let stdout,failed=false;
  try{({stdout}=await exec(process.execPath,args,{cwd:root,maxBuffer:1024*1024}));}catch(e){stdout=e.stdout;failed=true;}
  let result;try{result=JSON.parse(stdout?.trim());}catch{throw Error('CAPTURE_PROCESS_FAILED_NO_MANIFEST');}
  const raw=resolve(root,result.directory??'');
  if(dirname(raw)!==join(root,'data','raw')||!basename(raw).startsWith('swaps-'))throw Error('CAPTURE_PATH_INVALID');
  const bytes=await readFile(join(raw,'manifest.json')),m=JSON.parse(bytes);
  const evidence={directory:result.directory,sha256:createHash('sha256').update(bytes).digest('hex'),before:s.cursor,status:m.status,gaps:m.gaps?.length??null};
  if(failed){await save({...s,lastFailure:evidence});throw Error('CAPTURE_PARTIAL_CURSOR_NOT_ADVANCED');}
  let next;try{next=advance(s,m);}catch(e){await save({...s,lastFailure:evidence});throw e;}
  s={...next,batches:[...s.batches,evidence],lastFailure:null};await save(s);
  console.log(JSON.stringify({status:s.status,signatures:s.signatures,oldestObserved:s.oldestObserved,cursor:s.cursor}));
 }
 console.log(JSON.stringify({checkpoint:file,status:s.status,historyComplete:false}));
}finally{await handle.close();await unlink(lock);}

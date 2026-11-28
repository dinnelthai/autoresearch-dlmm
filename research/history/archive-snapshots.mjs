// Scan existing raw account captures; no RPC, no second collector, no mutation of original evidence.
import {readdir,readFile,mkdir,writeFile,rename,open,unlink,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {snapshotRow,coverage} from './archive-core.mjs';
import {decodeMarketCapture} from '../live/inspect-bins.mjs';
const {values:v}=parseArgs({options:{pool:{type:'string'},day:{type:'string'},idl:{type:'string'},cadence:{type:'string',default:'60'},'max-dirs':{type:'string',default:'50000'}}});
const start=Date.parse(v.day),end=start+86400000,cadence=Number(v.cadence)*1000,max=Number(v['max-dirs']);
if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.pool??'')||!/^\d{4}-\d{2}-\d{2}$/.test(v.day??'')||!Number.isSafeInteger(start)||new Date(start).toISOString().slice(0,10)!==v.day||!v.idl||!Number.isSafeInteger(cadence)||cadence<1000||cadence>3600000||!Number.isSafeInteger(max)||max<1||max>200000)throw Error('usage: --pool ADDRESS --day YYYY-MM-DD --idl FILE [--cadence 60 --max-dirs 50000]');
const root=fileURLToPath(new URL('../../',import.meta.url)),raw=join(root,'data','raw'),dir=join(root,'data','historical',v.pool,'snapshots',v.day);
await mkdir(dir,{recursive:true,mode:0o700});
const lock=join(dir,'run.lock'),handle=await open(lock,'wx',0o600);
const sha=b=>createHash('sha256').update(b).digest('hex');
const atomic=async(p,b)=>{await writeFile(p+'.tmp',b,{mode:0o600});await rename(p+'.tmp',p);};
try{
 const candidates=(await readdir(raw,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^accounts-[a-zA-Z0-9]+$/.test(e.name)).map(e=>e.name).sort();
 if(candidates.length>max)throw Error('SCAN_BUDGET_EXCEEDED_NO_PARTIAL_EXPORT');
 const rows=[],issues=[],hashes=new Set(),bySlot=new Map(),conflicts=new Set();
 let inspected=0,other=0,duplicate=0;
 for(const name of candidates){
  const path=join(raw,name);let m;
  try{const s=await lstat(join(path,'manifest.json'));if(!s.isFile()||s.size>1024*1024)throw Error();m=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'));}
  catch{issues.push({capture:name,reason:'MANIFEST_UNREADABLE_UNKNOWN_SCOPE'});continue;}
  if(m.pool!==v.pool){other++;continue;}
  const observed=Date.parse(m.receivedAt);
  if(!Number.isSafeInteger(observed)){issues.push({capture:name,reason:'OBSERVATION_TIME_INVALID'});continue;}
  if(observed<start||observed>=end)continue;
  inspected++;
  try{
   if(!(await lstat(join(path,'accounts.json'))).isFile())throw Error();
   const {identity,bins}=await decodeMarketCapture(path,resolve(v.idl));
   const row=snapshotRow(m,identity,bins);
   if(hashes.has(row.rawHash)){duplicate++;continue;}hashes.add(row.rawHash);
   if(row.status!=='OBSERVED_SNAPSHOT_UNVERIFIED'){issues.push({capture:name,reason:row.status});continue;}
   const fingerprint=sha(JSON.stringify([row.sdkCommit,row.idlBlob,row.mintX,row.mintY,row.decimalsX,row.decimalsY,row.activeId,row.binStep,row.arrays]));
   const prev=bySlot.get(row.slot);
   if(prev){if(prev!==fingerprint){conflicts.add(row.slot);issues.push({capture:name,reason:'SAME_SLOT_CONFLICT',slot:row.slot});}else duplicate++;continue;}
   bySlot.set(row.slot,fingerprint);rows.push({...row,capture:'data/raw/'+name});
  }catch{issues.push({capture:name,reason:'CAPTURE_DECODE_OR_EVIDENCE_INVALID'});}
 }
 const clean=rows.filter(r=>!conflicts.has(r.slot)).sort((a,b)=>a.observedAtMs-b.observedAtMs||a.slot-b.slot);
 // Bounded daily export. Preserve raw decimal strings; no fee differencing or imputed samples.
 const bytes=gzipSync(clean.map(r=>JSON.stringify(r)+'\n').join(''));
 const file='snapshots-'+sha(bytes)+'.ndjson.gz';
 await atomic(join(dir,file),bytes);
 const report={schemaVersion:1,pool:v.pool,day:v.day,clock:'LOCAL_RPC_RECEIPT_UTC_NOT_CHAIN_TIME',source:'EXISTING_FINALIZED_ACCOUNT_CAPTURES',status:issues.length?'GAPS_OR_REJECTED_EVIDENCE':'SCANNED_UNVERIFIED',candidateDirectories:candidates.length,otherPoolCaptures:other,inspected,duplicates:duplicate,conflictSlots:[...conflicts],issues,coverage:coverage(clean,start,end,cadence),file,sha256:sha(bytes),bytes:bytes.length,originalEvidenceRetained:true};
 await atomic(join(dir,'manifest.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({directory:dir,rows:clean.length,issues:issues.length,coverage:report.coverage,status:report.status}));
}finally{await handle.close();await unlink(lock);}

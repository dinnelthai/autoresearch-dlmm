// Bounded persistent index of immutable archived observation pointers, not reviewed observations.
import {mkdir,open,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
const key=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const assert=(v,m)=>{if(!v)throw Error(m)};
export function appendFeature(rows,entry,limit=128){
 assert(Array.isArray(rows)&&rows.length<=128&&Number.isInteger(limit)&&limit>=1&&limit<=128,'FEATURE_INDEX_INVALID');
 const valid=x=>x&&key(x.pool)&&key(x.mint)&&['holder','external'].includes(x.kind)&&Number.isSafeInteger(x.slot)&&x.slot>=0&&Number.isSafeInteger(x.receivedAt)&&x.receivedAt>=0&&typeof x.capture==='string'&&/^data\/raw\/(holder|external)-[A-Za-z0-9_-]+$/.test(x.capture)&&x.capture.startsWith('data/raw/'+x.kind+'-')&&hash(x.sha256);
 assert(valid(entry)&&rows.every(x=>valid(x)&&x.pool===entry.pool&&x.mint===entry.mint&&x.kind===entry.kind),'FEATURE_INDEX_SCOPE');
 const last=rows.at(-1);if(last?.sha256===entry.sha256)return rows;
 assert(!last||entry.receivedAt>last.receivedAt&&entry.slot>=last.slot,'FEATURE_INDEX_ORDER');
 return [...rows,entry].slice(-limit);
}
export function featureSeries(data){
 function path(pool,mint,kind){assert(key(pool)&&key(mint)&&['holder','external'].includes(kind),'FEATURE_INDEX_SCOPE');return join(data,'feature-series',pool,mint,kind)}
 async function read(pool,mint,kind){
  try{const raw=await readFile(join(path(pool,mint,kind),'index.json'),'utf8');assert(raw.length<=128*1024,'FEATURE_INDEX_SIZE');const rows=JSON.parse(raw);assert(Array.isArray(rows)&&rows.length<=128,'FEATURE_INDEX_INVALID');let checked=[];for(const row of rows)checked=appendFeature(checked,row);assert(checked.every(x=>x.pool===pool&&x.mint===mint&&x.kind===kind),'FEATURE_INDEX_SCOPE');return checked}catch(e){if(e.code==='ENOENT')return [];throw e}
 }
 async function add(entry){
  const dir=path(entry.pool,entry.mint,entry.kind);await mkdir(dir,{recursive:true,mode:0o700});const lock=join(dir,'writer.lock'),h=await open(lock,'wx',0o600);
  try{const rows=appendFeature(await read(entry.pool,entry.mint,entry.kind),entry);await writeFile(join(dir,'index.tmp'),JSON.stringify(rows),{mode:0o600});await rename(join(dir,'index.tmp'),join(dir,'index.json'));return rows.length}finally{try{await h.close()}finally{await unlink(lock)}}
 }
 return {read,add};
}

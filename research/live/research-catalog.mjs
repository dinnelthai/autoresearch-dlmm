// Scoped archive pointer index; never represents a current strategy or live readiness.
import {mkdir,open,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const key=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const assert=(v,m)=>{if(!v)throw Error(m)};
export function catalogEntry(x,pool){
 assert(key(pool)&&x?.pool===pool&&['snapshot','candidate','run'].includes(x.kind)&&hash(x.id)&&hash(x.snapshotId)&&Number.isSafeInteger(x.marketSlot)&&x.marketSlot>=0&&hash(x.marketRawHash)&&Number.isSafeInteger(x.createdAt)&&x.createdAt>=0&&typeof x.status==='string'&&/^[A-Z0-9_]{1,100}$/.test(x.status),'RESEARCH_CATALOG_ENTRY_INVALID');
 assert(x.kind!=='snapshot'||x.id===x.snapshotId,'RESEARCH_CATALOG_SNAPSHOT_INVALID');
 assert(x.kind==='run'?['plans','management'].includes(x.mode):x.mode==null,'RESEARCH_CATALOG_MODE_INVALID');
 assert(x.mode==='management'?key(x.position):x.position==null,'RESEARCH_CATALOG_POSITION_INVALID');
 return {pool,kind:x.kind,id:x.id,snapshotId:x.snapshotId,marketSlot:x.marketSlot,marketRawHash:x.marketRawHash,createdAt:x.createdAt,status:x.status,mode:x.mode??null,position:x.position??null};
}
export function addCatalog(rows,entry,limit=64){
 assert(Array.isArray(rows)&&rows.length<=64&&Number.isInteger(limit)&&limit>=1&&limit<=64,'RESEARCH_CATALOG_LIMIT');
 const e=catalogEntry(entry,entry.pool),valid=rows.map(x=>catalogEntry(x,e.pool));
 const same=valid.find(x=>x.kind===e.kind&&x.id===e.id);if(same){assert(JSON.stringify(same)===JSON.stringify(e),'RESEARCH_CATALOG_CONFLICT');return valid}
 return [...valid,e].sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id)).slice(0,limit);
}
export function researchCatalog(data,readBounded){
 const dir=p=>{assert(key(p),'RESEARCH_CATALOG_SCOPE');return join(data,'research-catalog',p)};
 async function list(pool){
  try{const bytes=await readBounded(join(dir(pool),'index.json'),128*1024),rows=JSON.parse(bytes);assert(Array.isArray(rows)&&rows.length<=64,'RESEARCH_CATALOG_LIMIT');return rows.map(x=>catalogEntry(x,pool))}catch(e){if(e.code==='ENOENT')return [];throw e}
 }
 async function add(entry){
  const d=dir(entry.pool);await mkdir(d,{recursive:true,mode:0o700});const lock=join(d,'writer.lock'),h=await open(lock,'wx',0o600);
  try{const rows=addCatalog(await list(entry.pool),entry);await writeFile(join(d,'index.tmp'),JSON.stringify(rows),{mode:0o600});await rename(join(d,'index.tmp'),join(d,'index.json'))}finally{try{await h.close()}finally{await unlink(lock)}}
 }
 return {list,add};
}

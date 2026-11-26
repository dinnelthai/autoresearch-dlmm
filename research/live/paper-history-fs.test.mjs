import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPaperHistoryStore} from './paper-history-store.mjs';
const state=n=>({id:'fixture',pool:'pool',snapshotCount:n,last:{slot:n,proof:{}},rows:Array.from({length:8},(_,i)=>({mode:String(i),status:'HOLD_ONLY',points:[{slot:n,navYRaw:'100'}]}))});
const read=async(p,max)=>{assert.ok((await stat(p)).size<=max);return readFile(p)};
const atomic=async(p,v)=>{await writeFile(p+'.tmp',JSON.stringify(v),{flag:'wx'});await rename(p+'.tmp',p)};
test('real filesystem shard boundary and interrupted checkpoint retry after reopening',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'paper-history-fs-'));
 try{
  let store=createPaperHistoryStore({read,atomic}),cp=null;
  for(let n=1;n<=128;n++)cp=await store.append(dir,state(n),cp);
  await atomic(join(dir,'checkpoint.json'),cp);
  const orphan=await store.append(dir,state(129),cp);
  // Simulate interruption after archive replacement, before checkpoint replacement.
  store=createPaperHistoryStore({read,atomic});
  const restored=JSON.parse(await readFile(join(dir,'checkpoint.json')));
  await assert.rejects(()=>store.verify(dir,restored),/PAPER_HISTORY_MISSING_OR_EXTRA/);
  await assert.rejects(()=>store.append(dir,{...state(129),gapCount:1},restored),/PAPER_HISTORY_ORPHAN_CONFLICT/);
  const retried=await store.append(dir,state(129),restored);
  assert.equal(retried.historyHead.recordHash,orphan.historyHead.recordHash);
  await atomic(join(dir,'checkpoint.json'),retried);
  assert.equal((await store.verify(dir,retried)).records,129);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('real filesystem read failure or corrupt shard does not replace existing archive',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'paper-history-fs-'));
 try{
  const store=createPaperHistoryStore({read,atomic}),a=await store.append(dir,state(1),null);
  const shard=join(dir,'history-000000.json');await writeFile(shard,'invalid json');
  await assert.rejects(()=>store.append(dir,state(2),a),SyntaxError);
  assert.equal(await readFile(shard,'utf8'),'invalid json');
 }finally{await rm(dir,{recursive:true,force:true})}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {createTerminalPaperService} from './terminal-paper-service.mjs';
import {sourceInventory} from './source-inventory.mjs';
import {sha} from './evidence-digest.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const A='A'.repeat(32),B='B'.repeat(32);
async function fixture(t){
 const DATA=await mkdtemp(join(tmpdir(),'paper-service-native-'));
 const {backendHash}=await sourceInventory(ROOT);
 const io=createTerminalRuntime({ROOT,DATA}),services=[];
 t.after(async()=>{try{await Promise.all(services.map(s=>s.stop()))}finally{await rm(DATA,{recursive:true,force:true})}});
 const service=(pool)=>{const s=createTerminalPaperService({ROOT,DATA,pool,maxAgeMs:60000,backendHash,io,loadState:async()=>{throw Error('RPC_UNAVAILABLE')},preview:async()=>{throw Error('UNEXPECTED_PREVIEW')},loadReview:async()=>{throw Error('UNEXPECTED_REVIEW')},isStopping:()=>false});services.push(s);return s};
 async function seed(pool,{expired=false,endpoint=false,corrupt=false}={}){
  const now=Date.now(),id='native-fixture',dir=join(DATA,'paper-auto',pool),dst=join(dir,id);
  const endAt=expired?now-120000:now+86400000;
  const state={id,pool,scope:'PAPER_SNAPSHOT_FIXED_SHARE_ONLY',backendHash,executionReady:false,pnlReady:false,policy:{maxGapSeconds:60},window:{days:7,startAt:endAt-7*86400000,endAt,graceMs:60000,status:endpoint?'ENDPOINT_OBSERVED':'OBSERVING'},snapshotCount:1,gapCount:0,opening:{slot:1},last:{slot:1,proof:{receivedAt:new Date(now).toISOString(),accountsHash:'a'.repeat(64)}},rows:[]};
  await mkdir(dst,{recursive:true});
  await writeFile(join(dst,'checkpoint.json'),JSON.stringify({...state,checkpointHash:corrupt?'0'.repeat(64):sha(JSON.stringify(state))}));
  await writeFile(join(dir,'active.json'),JSON.stringify({pool,id,running:true}));
  return {id,dir,dst};
 }
 return {DATA,service,seed};
}
test('real service status and pause are pool scoped and survive service recreation',async t=>{
 const f=await fixture(t),a=f.service(A),b=f.service(B);
 assert.equal((await a.get()).status,'NO_EXPERIMENT');
 const x=await f.seed(A),y=await f.seed(B);
 assert.equal((await a.get()).status,'WAITING_FOR_OBSERVATION');
 await assert.rejects(a.get(B),/PAPER_AUTO_POOL_SCOPE/);
 await assert.rejects(a.pause({pool:B,id:x.id}),/PAPER_AUTO_EXPERIMENT_CHANGED/);
 const paused=await a.pause({pool:A,id:x.id});
 assert.equal(paused.status,'PAUSED');assert.equal(paused.running,false);
 assert.equal((await b.get()).running,true);
 await a.stop();
 const restarted=f.service(A);
 assert.equal((await restarted.get()).status,'PAUSED');
 await restarted.tick();
 assert.equal((await restarted.get()).status,'PAUSED');
 assert.equal(JSON.parse(await readFile(join(y.dir,'active.json'),'utf8')).running,true);
 await assert.rejects(restarted.pause({pool:A,id:x.id}),/PAPER_AUTO_EXPERIMENT_CHANGED/);
 await assert.rejects(stat(join(x.dir,'writer.lock')),{code:'ENOENT'});
});
test('real tick reports RPC failure and closes expired experiment without claiming observed endpoint',async t=>{
 const f=await fixture(t),a=f.service(A),b=f.service(B),x=await f.seed(A),y=await f.seed(B,{expired:true});
 const original=await readFile(join(y.dst,'checkpoint.json'));
 await Promise.all([a.tick(),b.tick()]);
 const blocked=await a.get(),expired=await b.get();
 assert.equal(blocked.status,'BLOCKED');assert.equal(blocked.reason,'RPC_UNAVAILABLE');assert.equal(blocked.running,true);assert.equal(blocked.checkpointFresh,false);
 assert.equal(expired.status,'MISSED_ENDPOINT');assert.equal(expired.running,false);assert.equal(expired.endpointObserved,false);assert.equal(expired.pnlReady,false);
 assert.deepEqual(await readFile(join(y.dst,'checkpoint.json')),original);
 assert.equal(JSON.parse(await readFile(join(x.dir,'active.json'),'utf8')).running,true);
 await b.stop();assert.equal((await f.service(B).get()).status,'MISSED_ENDPOINT');
});
test('real tick repairs terminal pointer after committed endpoint and rejects checkpoint corruption',async t=>{
 const f=await fixture(t),a=f.service(A),b=f.service(B),x=await f.seed(A,{endpoint:true}),y=await f.seed(B,{corrupt:true});
 await a.tick();const ended=await a.get();
 assert.equal(ended.status,'ENDPOINT_OBSERVED');assert.equal(ended.running,false);assert.equal(ended.endpointObserved,true);assert.equal(ended.pnlReady,false);
 await assert.rejects(a.pause({pool:A,id:x.id}),/PAPER_AUTO_EXPERIMENT_CHANGED/);
 await assert.rejects(b.get(),/PAPER_AUTO_CHECKPOINT_HASH/);await b.tick();
 await assert.rejects(b.get(),/PAPER_AUTO_CHECKPOINT_HASH/);
 assert.equal(JSON.parse(await readFile(join(y.dir,'active.json'),'utf8')).running,true);
 await assert.rejects(stat(join(y.dir,'writer.lock')),{code:'ENOENT'});
});

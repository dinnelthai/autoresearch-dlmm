import {watchLocked} from './terminal-runtime.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperSnapshotReader,snapshotCheckpoint,readSnapshotCheckpoint} from './paper-snapshot.mjs';
import {sha} from './evidence-digest.mjs';
const ROOT='/research',pool='A'.repeat(32);
function fixture(){
 const files=new Map([['/research/idl','pinned']]);let calls=0;
 function set(p,raw='raw'){files.set(p+'/accounts.json',raw);files.set(p+'/manifest.json',JSON.stringify({commitment:'finalized',pool,contextSlot:1,raw:{file:'accounts.json',sha256:sha(raw)}}))}
 const p='/research/data/capture';set(p);
 const io={safeDataPath:async p=>p,boundedRead:async p=>{if(!files.has(p))throw Error('MISSING');return files.get(p)},run:async(args,script)=>{calls++;return {pool,slot:1,rawHash:sha(files.get(args[1]+'/accounts.json')),status:script==='inspect-pool.mjs'?'IDENTITY_CHECKED_UNVERIFIED':'BITMAP_COVERAGE_CHECKED_UNVERIFIED'}}};
 return {p,files,set,io,calls:()=>calls};
}
test('cached decode still checks raw and manifest bytes and is isolated from caller mutation',async()=>{const x=fixture(),read=createPaperSnapshotReader({ROOT,io:x.io,idl:'/research/idl'});const a=await read(x.p);a.identity.pool='other';assert.equal((await read(x.p)).identity.pool,pool);assert.equal(x.calls(),2);x.files.set(x.p+'/accounts.json','tampered');await assert.rejects(()=>read(x.p),/PAPER_SNAPSHOT_MANIFEST/);assert.equal(x.calls(),2);x.set(x.p,'new raw');await read(x.p);assert.equal(x.calls(),4);x.files.set('/research/idl','changed');await read(x.p);assert.equal(x.calls(),6)});
test('cache bounded by entries; missing archive still blocks',async()=>{const x=fixture(),read=createPaperSnapshotReader({ROOT,io:x.io,idl:'/research/idl',cacheLimit:1});await read(x.p);const q=x.p+'2';x.set(q);await read(q);await read(x.p);assert.equal(x.calls(),6);x.files.delete(x.p+'/manifest.json');await assert.rejects(()=>read(x.p),/MISSING/)});

test('shared snapshot checkpoint binds identity and detects alteration',()=>{const s={id:'fixture',pool,scope:'PAPER_SNAPSHOT_FIXED_SHARE_ONLY',executionReady:false,pnlReady:false};const cp=snapshotCheckpoint(s);assert.deepEqual(readSnapshotCheckpoint(cp,s.id,pool),s);assert.throws(()=>readSnapshotCheckpoint({...cp,pnlReady:true},s.id,pool));assert.throws(()=>readSnapshotCheckpoint(cp,'other'));});

test('offline command shares writer lifecycle and releases lock after a step',async()=>{const dir=await mkdtemp(join(tmpdir(),'paper-watch-'));try{let calls=0;await watchLocked(dir,{step:async()=>{calls++},onError:e=>{throw e}});await watchLocked(dir,{step:async()=>{calls++},onError:e=>{throw e}});assert.equal(calls,2);await assert.rejects(()=>watchLocked(dir,{step:async()=>{throw Error('STEP')},onError:e=>{throw e}}),/STEP/);await watchLocked(dir,{step:async()=>{calls++},onError:e=>{throw e}});assert.equal(calls,3)}finally{await rm(dir,{recursive:true,force:true})}});

test('combined decoder replaces two child calls and retains raw hash checking',async()=>{const x=fixture();let combined=0;const read=createPaperSnapshotReader({ROOT,io:{...x.io,decodeMarket:async p=>{combined++;const rawHash=sha(x.files.get(p+'/accounts.json'));return {identity:{pool,slot:1,rawHash,status:'IDENTITY_CHECKED_UNVERIFIED'},bins:{pool,slot:1,rawHash,status:'BITMAP_COVERAGE_CHECKED_UNVERIFIED'}}}},idl:'/research/idl'});await read(x.p);await read(x.p);assert.equal(combined,1);assert.equal(x.calls(),0);x.files.set(x.p+'/accounts.json','changed');await assert.rejects(()=>read(x.p),/PAPER_SNAPSHOT_MANIFEST/);assert.equal(combined,1)});

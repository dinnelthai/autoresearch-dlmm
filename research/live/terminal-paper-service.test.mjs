import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
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

test('real service starts, advances twice, archives and resumes from disk with injected decoded captures',async t=>{
 const {IntegerKernel:K}=await import('../integer.mjs');
 const {createPaperHistoryStore}=await import('./paper-history-store.mjs');
 const DATA=await realpath(await mkdtemp(join(tmpdir(),'paper-service-forward-')));
 const {backendHash}=await sourceInventory(ROOT);
 const io=createTerminalRuntime({ROOT,DATA}),captures=new Map(),services=[];
 t.after(async()=>{try{await Promise.all(services.map(s=>s.stop()))}finally{await rm(DATA,{recursive:true,force:true})}});
 let now=1800000000000,current;
 t.mock.method(Date,'now',()=>now);
 const mintX='C'.repeat(32),mintY='D'.repeat(32),idl=join(DATA,'idl.json');
 await writeFile(idl,'{}');
 async function capture(slot,fee,requested,received){
  const dir=join(DATA,'capture-'+slot),raw=JSON.stringify({synthetic:true,slot}),rawHash=sha(raw);
  await mkdir(dir);await writeFile(join(dir,'accounts.json'),raw);
  await writeFile(join(dir,'manifest.json'),JSON.stringify({commitment:'finalized',pool:A,contextSlot:slot,raw:{file:'accounts.json',sha256:rawHash},requestedAt:new Date(requested).toISOString(),receivedAt:new Date(received).toISOString()}));
  const identity={pool:A,mintX,mintY,slot,rawHash,sdkCommit:K.SDK_COMMIT,idlBlob:'synthetic-idl',activeId:0,binStep:100,orientation:'MEME_X_SOL_Y',status:'IDENTITY_CHECKED_UNVERIFIED',sides:[{mint:mintX,decimals:6},{mint:mintY,decimals:9}]};
  const bins={...identity,status:'BITMAP_COVERAGE_CHECKED_UNVERIFIED',coverage:{expected:1,decoded:1,missing:0,unsupported:0},arrays:[{version:3,bins:Array.from({length:70},(_,binId)=>({binId,version:3,amountXRaw:'10000000',amountYRaw:'0',liquiditySupplyRaw:String(100n*K.Q),priceQ64Raw:String(K.Q),feeXPerTokenRaw:String(fee*K.Q),feeYPerTokenRaw:'0',openOrderAmountRaw:'0',totalProcessingOrderAmountRaw:'0',processedOrderRemainingAmountRaw:'0'}))}]};
  captures.set(dir,{identity,bins});current={schemaVersion:1,pool:A,sequence:slot,decisionReady:false,streams:{market:{status:'CAPTURED_UNVERIFIED',receivedAt:received,evidence:{capture:dir,slot,identity,bins}}}};
  return identity;
 }
 const first=await capture(1,0n,now-2000,now-1000),row={family:'spot',feasible:true,action:{type:'OPEN'},allocation:{lowerBinId:1,upperBinId:1,bins:[{binId:1,meme:1,sol:0}]}};
 const report={schemaVersion:1,pool:A,status:'RESEARCH_DIAGNOSTIC_UNVERIFIED',executionReady:false,decisionReady:false,protocolExact:false,calibrated:false,market:{...first,decimalsX:6,decimalsY:9},planPreview:{status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',scope:'NEW_POSITION_ONLY',executionReady:false,decisionReady:false,families:['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'].map(family=>({family,best:family==='spot'?row:family==='NO_LP'?{family,feasible:true,action:{type:'NO_LP'}}:null})),selected:row},terminalBinding:{scope:'RESEARCH_ONLY',expiresAt:now+60000,marketSlot:first.slot,marketRawHash:first.rawHash,requestHash:'a'.repeat(64),reviewHash:'b'.repeat(64),researchBudget:{memeRaw:'2000000',solRaw:'1000000000',allowDispose:false,minSolReserve:0,operationCostSol:0,maxBinShare:.1}}};
 const make=()=>{const service=createTerminalPaperService({ROOT,DATA,pool:A,maxAgeMs:60000,backendHash,idlPath:idl,io:{...io,run:async(args,script)=>{assert.equal(args[2],'--idl');assert.equal(args[3],idl);const fixture=captures.get(args[1]);assert.ok(fixture);assert.ok(['inspect-pool.mjs','inspect-bins.mjs'].includes(script));return structuredClone(script==='inspect-pool.mjs'?fixture.identity:fixture.bins)}},loadState:async()=>structuredClone(current),preview:async()=>structuredClone(report),loadReview:async()=>{throw Error('UNEXPECTED_REVIEW')},isStopping:()=>false});services.push(service);return service};
 const service=make(),draft={schemaVersion:1,kind:'UX_DRAFT_NOT_ENGINE_REQUEST',pool:A,entry:'holding',goal:'balanced',horizonSeconds:3600,capitalScope:'USER_DECLARED_ALLOCATION',allowDispose:false,solHuman:'1',memeHuman:'2',riskConfig:{maxInventoryRatio:.65,maxInventoryTokens:200000,minSolReserve:0,maxLossSol:.1,stressDrop:.6,maxBinShare:.1,operationCostSol:0,feeBps:30,protocolShare:.05,slippageBps:50}},body={draft,reviewHash:'b'.repeat(64),marketSlot:first.slot,marketRawHash:first.rawHash,policy:{evaluationDays:7,maxDrawdownBps:1000,maxLossSolRaw:'100000000',maxGapSeconds:180,exitCostSolRaw:'1'}};
 const started=await service.start(body);assert.equal(started.snapshotCount,1);assert.equal(started.rows.length,8);assert.equal(started.running,true);
 await service.tick();assert.equal((await service.get()).snapshotCount,1);
 now+=10000;await capture(2,1n,now-1000,now);await service.tick();
 const second=await service.get();assert.equal(second.status,'UPDATED_UNVERIFIED');assert.equal(second.snapshotCount,2);assert.equal(second.rows.find(r=>r.mode==='spot').latest.totalFeeXRaw,'9');
 await service.stop();const resumed=make();
 now+=10000;await capture(3,2n,now-1000,now);await resumed.tick();
 const third=await resumed.get();assert.equal(third.snapshotCount,3);assert.equal(third.rows.find(r=>r.mode==='spot').latest.totalFeeXRaw,'18');assert.equal(third.rows.find(r=>r.mode==='NO_LP').latest.pnlYRaw,'0');assert.equal(third.pnlReady,false);
 const dir=join(DATA,'paper-auto',A,started.id),{checkpointHash,...state}=JSON.parse(await readFile(join(dir,'checkpoint.json'),'utf8'));assert.equal(checkpointHash,sha(JSON.stringify(state)));
 const history=createPaperHistoryStore({read:(p,n)=>io.safeDataPath(p).then(path=>io.boundedRead(path,n)),atomic:async()=>{throw Error('UNEXPECTED_WRITE')}});
 assert.equal((await history.verify(dir,state)).records,3);
 assert.equal((await resumed.pause({pool:A,id:started.id})).running,false);
 const ctx=await resumed.context();assert.equal(ctx.reviewHash,null);
 const fixed=await resumed.start({draft,policy:body.policy});
 assert.equal(fixed.planBasis,'FIXED_OBSERVED_BIN_CONTROL');
 assert.equal(fixed.rows.find(r=>r.mode==='spot').status,'OPEN_PROXY');
 assert.equal(fixed.rows.find(r=>r.mode==='adaptive').reason,'ADAPTIVE_RESEARCH_INPUT_REQUIRED');
 now+=10000;await capture(4,100n,now-1000,now);await resumed.tick();
 const next=await resumed.get();assert.equal(next.snapshotCount,2);
 assert.ok(BigInt(next.rows.find(r=>r.mode==='spot').latest.totalFeeXRaw)>0n);
 assert.equal(next.rows.find(r=>r.mode==='NO_LP').latest.pnlYRaw,'0');
});

// Shared raw snapshot re-decoder. No RPC or signing. Cache only decoded data, never skip evidence reads.
import {join,relative} from 'node:path';
import {assert,hash} from './research-contract.mjs';
import {advanceSnapshotExperiment} from './paper-snapshot-run-core.mjs';
import {sha} from './evidence-digest.mjs';
export function createPaperSnapshotReader({ROOT,io,idl,cacheLimit=4}){
 assert(Number.isSafeInteger(cacheLimit)&&cacheLimit>=0&&cacheLimit<=4,'PAPER_SNAPSHOT_CACHE_LIMIT');
 const cache=new Map(),read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
 async function snapshot(p){
  p=await io.safeDataPath(p);
  const manifestPath=join(p,'manifest.json'),accountsPath=join(p,'accounts.json');
  const mb=await read(manifestPath,16*1024*1024),ab=await read(accountsPath,32*1024*1024),ib=await read(idl,8*1024*1024);
  const manifest=JSON.parse(mb),manifestHash=sha(mb),accountsHash=sha(ab),idlHash=sha(ib);
  assert(manifest.commitment==='finalized'&&manifest.raw?.file==='accounts.json'&&manifest.raw.sha256===accountsHash,'PAPER_SNAPSHOT_MANIFEST');
  const key=JSON.stringify([p,manifestHash,accountsHash,idlHash]),hit=cache.get(key);
  if(hit){cache.delete(key);cache.set(key,hit);return structuredClone(hit)}
  const args=['--capture',p,'--idl',idl];
  const identity=await io.run(args,'inspect-pool.mjs',30000),bins=await io.run(args,'inspect-bins.mjs',30000);
  assert(identity.status==='IDENTITY_CHECKED_UNVERIFIED'&&bins.status==='BITMAP_COVERAGE_CHECKED_UNVERIFIED'&&identity.pool===manifest.pool&&bins.pool===manifest.pool&&identity.slot===manifest.contextSlot&&bins.slot===manifest.contextSlot&&identity.rawHash===accountsHash&&bins.rawHash===accountsHash&&sha(await read(manifestPath,16*1024*1024))===manifestHash&&sha(await read(accountsPath,32*1024*1024))===accountsHash&&sha(await read(idl,8*1024*1024))===idlHash,'PAPER_CAPTURE_CHANGED');
  const out={identity,bins,proof:{path:relative(ROOT,p),manifestHash,accountsHash,requestedAt:manifest.requestedAt??null,receivedAt:manifest.receivedAt??null}};
  if(cacheLimit){cache.set(key,structuredClone(out));while(cache.size>cacheLimit)cache.delete(cache.keys().next().value)}
  return out;
 }
 return snapshot;
}

export function snapshotCheckpoint(state){
 const cp={...state,checkpointHash:sha(JSON.stringify(state))};
 assert(Buffer.byteLength(JSON.stringify(cp))<=32*1024*1024,'PAPER_SNAPSHOT_CHECKPOINT_SIZE');
 return cp;
}
export function readSnapshotCheckpoint(cp,id,pool=null){
 const {checkpointHash,...state}=cp??{};
 assert(hash(checkpointHash)&&sha(JSON.stringify(state))===checkpointHash&&state.id===id&&(!pool||state.pool===pool)&&state.scope==='PAPER_SNAPSHOT_FIXED_SHARE_ONLY'&&state.executionReady===false&&state.pnlReady===false,'PAPER_SNAPSHOT_CHECKPOINT_HASH');
 return state;
}
// Both manual and scheduled runs consume the same opening and prior snapshots.
export async function advancePaperCapture(state,{load,snapshot,backendHash,now,exit=false}){
 const opening=await load(state.opening.proof.path);
 const previous=state.opening.slot===state.last.slot?opening:await load(state.last.proof.path);
 return advanceSnapshotExperiment(state,{opening,previous,snapshot,backendHash,now,exit});
}

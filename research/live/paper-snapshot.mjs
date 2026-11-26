// Shared raw snapshot re-decoder. No RPC or signing.
import {join,relative} from 'node:path';
import {assert} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
export function createPaperSnapshotReader({ROOT,io,idl}){
 const read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n);
  async function snapshot(p){
   const mb=await read(join(p,'manifest.json'),16*1024*1024),ab=await read(join(p,'accounts.json'),32*1024*1024),args=['--capture',p,'--idl',idl];
   const identity=await io.run(args,'inspect-pool.mjs',30000),bins=await io.run(args,'inspect-bins.mjs',30000);
   assert(identity.rawHash===sha(ab)&&bins.rawHash===sha(ab)&&sha(await read(join(p,'manifest.json'),16*1024*1024))===sha(mb)&&sha(await read(join(p,'accounts.json'),32*1024*1024))===sha(ab),'PAPER_CAPTURE_CHANGED');
   return {identity,bins,proof:{path:relative(ROOT,p),manifestHash:sha(mb),accountsHash:sha(ab)}};
  }

 return snapshot;
}

// Shared process-local leases. A builder owns the same resources as its component requests.
const resources=Object.freeze({
 overview:['overview'], positionRead:['positionRead'], positionAccounting:['positionAccounting'],
 analysis:['analysis'], replay:['analysis','replay'], snapshot:['snapshot'],holder:['holder'],external:['external'],
 builder:['analysis','replay','snapshot','holder','external','builder'],
 walletEvidence:['walletReview'],review:['walletReview']
});
export function createTerminalLocks(){
 const active=new Set();
 function acquire(name){
  if(!Object.hasOwn(resources,name))throw Error('UNKNOWN_TERMINAL_LOCK');
  const keys=resources[name];if(keys.some(k=>active.has(k)))return null;
  for(const k of keys)active.add(k);
  let released=false;return ()=>{if(released)return;released=true;for(const k of keys)active.delete(k)};
 }
 return {acquire};
}

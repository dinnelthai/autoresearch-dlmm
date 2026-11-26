// Bounded independent read-only collection lanes. No overlapping job per lane.
export function waitInterval(ms,signal){
 if(signal.aborted)return Promise.resolve();
 return new Promise(resolve=>{
  const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};
  const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});
 });
}
export async function runCollectorLanes(lanes,controller,{wait=waitInterval,onFatal=()=>{}}={}){
 if(!Array.isArray(lanes)||!lanes.length||lanes.length>4||new Set(lanes.map(l=>l.name)).size!==lanes.length||lanes.some(l=>typeof l.run!=='function'||!Number.isInteger(l.intervalMs)||l.intervalMs<15000||l.intervalMs>3600000))throw Error('INVALID_COLLECTOR_LANES');
 let fatal=null;
 const jobs=lanes.map(async lane=>{
  try{while(!controller.signal.aborted){const began=Date.now();await lane.run();if(!controller.signal.aborted)await wait(Math.max(1000,lane.intervalMs-(Date.now()-began)),controller.signal)}}
  catch(e){if(!fatal){fatal=e;controller.abort();onFatal()}}
 });
 await Promise.allSettled(jobs);if(fatal)throw fatal;
}
export function serializedWriter(write){let tail=Promise.resolve();return value=>{const next=tail.then(()=>write(value));tail=next;return next}}

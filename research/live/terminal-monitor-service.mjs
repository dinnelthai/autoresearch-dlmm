// Risk monitoring lifecycle; shares the analysis lease with manual research.
import {readFile,mkdir,writeFile,rename,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {poolAddress} from './terminal-core.mjs';
import {observationKey,summarizeRisk,emptyLedger,recoverLedger,record,visibleObservation} from './monitor-core.mjs';
import {assert} from './terminal-runtime.mjs';
export function createMonitorService({DATA,cfg,pool,locks,isStopping,overview,preview}){
 let monitorTimer=null,monitorJob=null,monitorLock=null,monitorLockPath=null,monitorFile=null,monitorCursor=0,monitorError=null,monitorLastCycle=null;
 const monitorEnabled=cfg.monitoring?.enabled===true,monitorSeconds=cfg.monitoring?.intervalSeconds??30;
 assert(Number.isInteger(monitorSeconds)&&monitorSeconds>=15&&monitorSeconds<=600,'INVALID_MONITOR_INTERVAL');
 let ledger=emptyLedger(pool);
function publicMonitor(){
 const now=Date.now();return {pool,enabled:monitorEnabled,intervalSeconds:monitorSeconds,lastCycleAt:monitorLastCycle,storageError:monitorError,decisionReady:false,executionReady:false,current:Object.fromEntries(Object.entries(ledger.current).map(([k,v])=>[k,visibleObservation(v,now)])),events:ledger.events.slice(-100),historyLimit:500};
}
async function persistMonitor(){
 const tmp=monitorFile+'.tmp';
 await writeFile(tmp,JSON.stringify(ledger)+'\n',{mode:0o600});await rename(tmp,monitorFile);
}
async function monitorCycle(){
 if(isStopping()||monitorError)return;
 const release=locks.acquire('analysis');if(!release)return;
 try{
  const addresses=Object.keys(cfg.managementPolicies??{}).filter(poolAddress).sort();
  let state;
  try{state=await overview()}catch{
   for(const address of addresses)ledger=record(ledger,address,{status:'BLOCKED',reason:'STATE_UNAVAILABLE',flags:[]},Date.now());
   await persistMonitor();monitorLastCycle=Date.now();return;
  }
  const ready=[];
  for(const address of addresses){
   const x=state.monitoring.find(v=>v.position===address),g=x?.managementGate,m=state.market,now=Date.now();
   if(!m||!x||x.status!=='CAPTURED_UNVERIFIED'||g?.status!=='PREFLIGHT_MATCHED_UNVERIFIED'||g.expiresAt<=now){
    ledger=record(ledger,address,{status:'BLOCKED',reason:g?.reason??x?.reason??'MONITOR_EVIDENCE_UNAVAILABLE',flags:[]},now);continue;
   }
   const body={position:address,positionSlot:x.slot,positionRawHash:x.rawHash,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:g.reviewHash,policyHash:g.policyHash};
   const key=observationKey(body),previous=ledger.current[address];
   if(previous?.key===key&&previous.expiresAt>now)continue;
   if(previous?.status!=='PENDING')ledger=record(ledger,address,{status:'PENDING',reason:'NEW_EVIDENCE_AWAITING_EVALUATION',flags:[]},now);
   ready.push(body);
  }
  // At most one engine evaluation per cycle. Round robin across the full configured set.
  if(ready.length&&!isStopping()){
   const address=addresses.find((_,i)=>i>=monitorCursor&&ready.some(b=>b.position===addresses[i]))??addresses.find(a=>ready.some(b=>b.position===a));
   const body=ready.find(b=>b.position===address);monitorCursor=(addresses.indexOf(address)+1)%addresses.length;
   try{const report=await preview(body,'management');ledger=record(ledger,address,summarizeRisk(report,body,Date.now()),Date.now())}
   catch(e){const reason=String(e.message);ledger=record(ledger,address,{status:'BLOCKED',reason:/^[A-Z0-9_:-]{1,120}$/.test(reason)?reason:'MONITOR_VALIDATION_FAILED',flags:[]},Date.now())}
  }
  await persistMonitor();monitorLastCycle=Date.now();
 }catch{monitorError='MONITOR_STORAGE_OR_CYCLE_FAILED';ledger={...ledger,current:{}}}
 finally{release()}
}
async function startMonitor(){
 if(!monitorEnabled)return;
 const dir=join(DATA,'terminal','monitor',pool);await mkdir(dir,{recursive:true,mode:0o700});monitorFile=join(dir,'ledger.json');monitorLockPath=join(dir,'writer.lock');
 monitorLock=await open(monitorLockPath,'wx',0o600);
 try{await monitorLock.writeFile(String(process.pid));try{ledger=recoverLedger(JSON.parse(await readFile(monitorFile,'utf8')),pool)}catch(e){if(e.code!=='ENOENT')throw e}await persistMonitor()}
 catch(e){await monitorLock.close();await unlink(monitorLockPath);monitorLock=null;throw e}
 const tick=()=>{if(isStopping()||monitorJob)return;monitorJob=monitorCycle().finally(()=>{monitorJob=null})};
 monitorTimer=setInterval(tick,monitorSeconds*1000);tick();
}

 async function start(){try{await startMonitor()}catch{monitorError='MONITOR_RECOVERY_OR_LOCK_FAILED'}}
 async function stop(){clearInterval(monitorTimer);await monitorJob;if(monitorLock){await monitorLock.close();await unlink(monitorLockPath);monitorLock=null}}
 return {start,stop,publicMonitor};
}

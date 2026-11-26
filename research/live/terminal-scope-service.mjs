// Scoped state and bounded market-only preview child lifecycle.
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {PublicKey} from '@solana/web3.js';
import {poolAddress,currentMarket,marketDisplay} from './terminal-core.mjs';
import {assert} from './terminal-runtime.mjs';
export function createScopeService({ROOT,DATA,pool,configuredPools,previewCfg,maxAgeMs,safeDataPath,boundedRead,isStopping,primaryOverview}){
async function loadState(scope=pool){
 const path=join(DATA,configuredPools.has(scope)?'live':'live-preview',scope,'state.json');
 return JSON.parse(await boundedRead(await safeDataPath(path),64*1024*1024));
}
const previewAttempts=new Map();
let previewJob=null,previewChild=null;
function validateScope(scope){assert(poolAddress(scope)&&new PublicKey(scope).toBase58()===scope,'INVALID_POOL_ADDRESS');return scope}
function startPreviewCapture(scope){
 if(isStopping()||configuredPools.has(scope)||previewCfg.enabled===false)return 'DISABLED';
 if(previewJob)return previewJob.pool===scope?'COLLECTING':'COLLECTOR_BUSY';
 const now=Date.now(),last=previewAttempts.get(scope);
 if(last!==undefined&&now-last<30000)return 'RETRY_COOLDOWN';
 previewAttempts.delete(scope);previewAttempts.set(scope,now);while(previewAttempts.size>8)previewAttempts.delete(previewAttempts.keys().next().value);
 const job={pool:scope};previewJob=job;
 job.done=(async()=>{
  const base=join(DATA,'terminal');await mkdir(base,{recursive:true,mode:0o700});
  const dir=await mkdtemp(join(base,'preview-'));
  try{
   const path=join(dir,'config.json');
   await writeFile(path,JSON.stringify({pool:scope,positions:[],references:[],provider:previewCfg.provider??'solana-rpc',idl:previewCfg.idl??'data/raw/dlmm-idl.json',pollSeconds:60,maxAgeSeconds:180,historyPages:1,historyLimit:1}),{mode:0o600});
   if(isStopping())return;
   await new Promise((ok,fail)=>{
    const child=spawn(process.execPath,[join(ROOT,'research/live/state-service.mjs'),'--config',path,'--once','--market-only'],{cwd:ROOT,env:process.env,stdio:'ignore'});
    previewChild=child;let hard=null;
    const terminate=()=>{child.kill('SIGTERM');hard=setTimeout(()=>child.kill('SIGKILL'),10000)};
    const timer=setTimeout(terminate,180000);
    const cleanup=()=>{clearTimeout(timer);if(hard)clearTimeout(hard);if(previewChild===child)previewChild=null};
    child.once('error',e=>{cleanup();fail(e)});child.once('close',()=>{cleanup();ok()});
   });
  }finally{await rm(dir,{recursive:true,force:true})}
 })().catch(()=>{}).finally(()=>{if(previewJob===job)previewJob=null});
 return 'COLLECTING';
}
function marketSummary(m){return {slot:m.slot,rawHash:m.rawHash,activeId:m.activeId,binStep:m.binStep,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,decimalsY:m.decimalsY,receivedAt:m.receivedAt,binCount:m.bins.length,expiresAt:m.receivedAt+maxAgeMs,display:marketDisplay(m)}}
async function scopedOverview(scope){
 if(scope===pool)return primaryOverview();
 validateScope(scope);
 let market=null,sequence=null,reason='POOL_CAPTURE_PENDING',collection='IDLE';
 try{const s=await loadState(scope),now=Date.now();sequence=s.sequence;const m=currentMarket(s,scope,now,maxAgeMs);market=marketSummary(m);if(!configuredPools.has(scope)&&now-m.receivedAt>=Math.min(60000,maxAgeMs/2))collection=startPreviewCapture(scope)}
 catch{collection=startPreviewCapture(scope);reason=configuredPools.has(scope)?'RESEARCH_COLLECTOR_UNAVAILABLE':collection==='DISABLED'?'DYNAMIC_CAPTURE_DISABLED':collection==='COLLECTOR_BUSY'?'POOL_COLLECTOR_BUSY':collection==='RETRY_COOLDOWN'?'POOL_CAPTURE_RETRY_COOLDOWN':'POOL_CAPTURE_PENDING'}
 return {pool:scope,sequence,status:market?'CAPTURED_UNVERIFIED':'BLOCKED',reason:market?null:reason,market,collection,reviewGate:{status:'BLOCKED',reason:'POOL_RESEARCH_NOT_CONFIGURED'},positions:[],monitoring:[],streams:{},decisionReady:false,executionReady:false,freshnessBasis:'LOCAL_RECEIPT_ONLY',scope:configuredPools.has(scope)?'SCOPED_RESEARCH_ONLY':'MARKET_PREVIEW_ONLY'};
}

 async function stop(){previewChild?.kill('SIGTERM');await previewJob?.done}
 return {loadState,validateScope,marketSummary,scopedOverview,stop};
}

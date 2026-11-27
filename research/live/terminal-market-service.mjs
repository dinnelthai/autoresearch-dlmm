// Market observations and scoped caches. All returned data remains unverified research diagnostics.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {currentMarket} from './terminal-core.mjs';
import {observeExternalMarket} from './external-market.mjs';
import {captureHolderFeatures} from './capture-holder-features.mjs';
import {cohortChange} from './market-features.mjs';
import {featureSeries} from './feature-series.mjs';
import {verifyQuoteEvidence} from './quote-evidence.mjs';
import {createReadRpc} from './rpc-read.mjs';
import {chainTimeFact} from './evidence-builder.mjs';
import {assert,sha} from './terminal-runtime.mjs';
export function createMarketObservationService({ROOT,DATA,cfg,maxAgeMs,validateScope,loadState,safeDataPath,boundedRead}){
 const externalCache=new Map(),externalAttempts=new Map(),holderAttempts=new Map(),holderCache=new Map(),series=featureSeries(DATA);
async function archivedHolderBaseline(m){
 try{const row=(await series.read(m.pool,m.mintX,'holder')).at(-1);if(!row||Date.now()-row.receivedAt>1800000)return null;
  const dir=await safeDataPath(row.capture),bytes=await boundedRead(await safeDataPath(join(dir,'manifest.json')),256*1024);assert(sha(bytes)===row.sha256,'HOLDER_BASELINE_HASH');const x=JSON.parse(bytes);
  assert(x.pool===m.pool&&x.mint===m.mintX&&x.slot===row.slot&&x.receivedAt===row.receivedAt&&x.scope==='HOLDER_DIAGNOSTIC_ONLY'&&x.distribution?.supplyConserved===true&&Array.isArray(x.distribution.topOwners)&&x.distribution.topOwners.length<=100&&Array.isArray(x.files)&&x.files.length===4,'HOLDER_BASELINE_SCOPE');
  const names=new Set(['genesis.json','mint-before.json','holder-index.json','mint-after.json']);for(const e of x.files){assert(names.delete(e.file)&&sha(await boundedRead(await safeDataPath(join(dir,e.file)),16*1024*1024))===e.sha256,'HOLDER_BASELINE_RAW_HASH')}
  assert(names.size===0,'HOLDER_BASELINE_MISSING');return x;
 }catch{return null}
}
async function holderObservation(body,pinned=null){
 const scope=validateScope(body?.pool),m=pinned??currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs),key=scope+':'+m.mintX,now=Date.now(),old=holderCache.get(key);assert(m.pool===scope,'HOLDER_PINNED_SCOPE');
 if(old&&now-old.public.receivedAt<60000)return old.public;
 if(now-(holderAttempts.get(key)??-Infinity)<60000)throw Error('HOLDER_RETRY_COOLDOWN');holderAttempts.set(key,now);
 const base=join(DATA,'raw');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'holder-'));
 const x=await captureHolderFeatures(m,{archive:(name,raw)=>writeFile(join(dir,name),raw,{mode:0o600,flag:'wx'})});
 const prior=old?.internal??await archivedHolderBaseline(m);
 const cohort=cohortChange(prior,x,Date.now());
 const {ownerBalances,topOwners,...distribution}=x.distribution;
 const archived={...x,distribution:{...distribution,topOwners},cohort};const bytes=JSON.stringify(archived,null,2)+'\n';await writeFile(join(dir,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
 const {files,...summary}=x,p={...summary,distribution,cohort,evidenceHash:sha(bytes),capture:relative(ROOT,dir)};
 await series.add({kind:'holder',pool:scope,mint:m.mintX,slot:x.slot,receivedAt:x.receivedAt,capture:p.capture,sha256:p.evidenceHash});
 holderCache.delete(key);holderCache.set(key,{public:p,internal:x});while(holderCache.size>4)holderCache.delete(holderCache.keys().next().value);return p;
}
async function externalObservation(body,pinned=null){
 const scope=validateScope(body?.pool),m=pinned??currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs),now=Date.now();assert(m.pool===scope,'EXTERNAL_PINNED_SCOPE');
 const cached=externalCache.get(scope);
 if(cached?.marketRawHash===m.rawHash&&cached.expiresAt>now)return cached;
 if(now-(externalAttempts.get(scope)??-Infinity)<10000)throw Error('EXTERNAL_RETRY_COOLDOWN');externalAttempts.set(scope,now);
 const base=join(DATA,'raw');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'external-'));
 const result=await observeExternalMarket(m,{config:cfg.externalMarket??{},archive:(name,raw)=>writeFile(join(dir,name),raw,{mode:0o600,flag:'wx'})});
 const verified=await verifyQuoteEvidence(result,m,async name=>boundedRead(await safeDataPath(join(dir,name)),1024*1024));
 const bytes=JSON.stringify({...result,rawEvidenceCheck:verified},null,2)+'\n';await writeFile(join(dir,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
 const capture=relative(ROOT,dir),evidenceHash=sha(bytes);await series.add({kind:'external',pool:scope,mint:m.mintX,slot:m.slot,receivedAt:result.fetchedAt,capture,sha256:evidenceHash});
 const observed={...result,rawEvidenceCheck:verified,capture,evidenceHash};externalCache.set(scope,observed);return observed;
}
async function captureMarketTime(m){
 const endpoint=process.env.SOLANA_RPC_URL;assert(endpoint,'CHAIN_TIME_RPC_REQUIRED');
 const rpc=createReadRpc(endpoint,{maxBytes:128*1024,timeoutMs:4000,totalMs:8000,maxAttempts:2}),base=join(DATA,'raw');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'market-time-'));
 const requests=[{jsonrpc:'2.0',id:1,method:'getGenesisHash',params:[]},{jsonrpc:'2.0',id:2,method:'getSlot',params:[{commitment:'finalized'}]},{jsonrpc:'2.0',id:3,method:'getBlockTime',params:[m.slot]}],names=['genesis.json','slot.json','block-time.json'],files=[],replies=[];
 for(let i=0;i<requests.length;i++){const x=await rpc(requests[i]);await writeFile(join(dir,names[i]),x.raw,{mode:0o600,flag:'wx'});files.push({file:names[i],request:requests[i],sha256:sha(x.raw)});replies.push(x.payload)}
 const fact=chainTimeFact({market:m,genesisReply:replies[0],slotReply:replies[1],timeReply:replies[2],receivedAt:Date.now(),maxAgeSeconds:maxAgeMs/1000});
 const bytes=JSON.stringify({...fact,files},null,2)+'\n';await writeFile(join(dir,'manifest.json'),bytes,{mode:0o600,flag:'wx'});
 return {...fact,capture:relative(ROOT,dir),evidenceHash:sha(bytes)};
}

 async function refreshPaperFeatures(m){
  const names=['external','holder','chainTime'];
  const results=await Promise.allSettled([externalObservation({pool:m.pool},m),holderObservation({pool:m.pool},m),captureMarketTime(m)]);
  return {slot:m.slot,observedAt:Date.now(),sources:Object.fromEntries(results.map((r,i)=>[names[i],r.status==='fulfilled'?{status:'OBSERVED',capture:r.value.capture,evidenceHash:r.value.evidenceHash}:{status:'UNAVAILABLE',reason:typeof r.reason?.message==='string'&&/^[A-Z0-9_]{1,96}$/.test(r.reason.message)?r.reason.message:'FEATURE_COLLECTION_FAILED'}]))};
 }
 return {holderObservation,externalObservation,captureMarketTime,refreshPaperFeatures,external:scope=>scope?externalCache.get(scope)??null:[...externalCache.values()].at(-1)??null,holder:(scope,mint)=>holderCache.get(scope+':'+mint)?.public??null};
}

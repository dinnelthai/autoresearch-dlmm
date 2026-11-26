// Indexed display-only data, not independent reference evidence.
const BASE='https://dlmm.datapi.meteora.ag';
const assert=(v,m)=>{if(!v)throw Error(m)};
const addr=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const metric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export async function fetchIndexedJson(path,{fetcher=fetch,limit=256*1024}={}){
 assert(/^\/pools\/[1-9A-HJ-NP-Za-km-z]{32,44}(\/ohlcv\?[a-z0-9_=&]+)?$/.test(path),'INDEX_PATH_INVALID');
 const res=await fetcher(BASE+path,{signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!res.ok)throw Error(res.status===429?'INDEX_RATE_LIMITED':res.status===404?'INDEX_NOT_FOUND':'INDEX_HTTP_ERROR');
 const reader=res.body?.getReader();assert(reader,'INDEX_EMPTY_BODY');
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;assert(size<=limit,'INDEX_RESPONSE_TOO_LARGE');chunks.push(value)}}
 catch(e){await reader.cancel().catch(()=>{});throw e}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.byteLength}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw Error('INDEX_INVALID_JSON')}
}
export function normalizePoolInfo(p,m,now=Date.now()){
 assert(addr(m.pool)&&p?.address===m.pool,'INDEX_POOL_MISMATCH');
 function token(t,mint,decimals){
  assert(addr(mint)&&t?.address===mint&&Number.isInteger(decimals)&&decimals>=0&&decimals<=18&&t.decimals===decimals,'INDEX_TOKEN_MISMATCH');
  const safe=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n?v.trim():null;
  return {mint,decimals,symbol:safe(t.symbol,32),name:safe(t.name,120)};
 }
 return {pool:m.pool,scope:'INDEXED_DISPLAY_ONLY',source:'Meteora DLMM Data API',fetchedAt:now,tokenX:token(p.token_x,m.mintX,m.decimalsX),tokenY:token(p.token_y,m.mintY,m.decimalsY),tvl:metric(p.tvl),volume24h:metric(p.volume?.['24h']),fees24h:metric(p.fees?.['24h']),dynamicFeePct:metric(p.dynamic_fee_pct)};
}
export async function getPoolInfo(m){return normalizePoolInfo(await fetchIndexedJson('/pools/'+m.pool),m)}
export function cachedLoader(loader,ttl=30000,clock=Date.now){
 let entry=null,pending=null;
 return async(key,arg)=>{
  if(entry?.key===key&&clock()-entry.at<ttl)return entry.value;
  if(pending?.key===key)return pending.promise;
  const job={key};job.promise=Promise.resolve().then(()=>loader(arg)).then(value=>{if(pending===job)entry={key,at:clock(),value};return value}).finally(()=>{if(pending===job)pending=null});pending=job;return job.promise;
 };
}

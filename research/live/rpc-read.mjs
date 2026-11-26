// Read-only RPC transport; same provider retries only. No endpoint URLs or remote error messages in diagnostics.
const allowed=new Set(['getMultipleAccounts','getProgramAccounts','getGenesisHash','getMinimumBalanceForRentExemption','getSignaturesForAddress','getTransaction','getBlock','getAccountInfo','getSlot','getBlockTime','getEpochInfo']);
const retryHttp=new Set([408,429,500,502,503,504]);
const retryRpc=new Set([-32005,-32016]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function failure(code,attempts,httpStatus=null,rpcCode=null){return Object.assign(new Error(code),{attempts,httpStatus,rpcCode})}
async function bounded(response,maxBytes){
 const reader=response.body?.getReader();if(!reader)throw failure('RPC_EMPTY_BODY',0);
 let size=0,parts=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw failure('RPC_RESPONSE_TOO_LARGE',0);parts.push(Buffer.from(value))}}
 catch(e){await reader.cancel().catch(()=>{});throw e}finally{reader.releaseLock()}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
}
export function createReadRpc(endpoint,{fetcher=fetch,sleep=wait,timeoutMs=8000,totalMs=18000,maxAttempts=3,spacingMs=250,maxBytes=8*1024*1024,clock=Date.now}={}){
 const url=new URL(endpoint);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('RPC_SCHEME_INVALID');
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3||![timeoutMs,totalMs,spacingMs,maxBytes].every(Number.isSafeInteger)||timeoutMs<1||totalMs<timeoutMs||totalMs>60000||spacingMs<0||spacingMs>5000||maxBytes<1||maxBytes>64*1024*1024)throw Error('RPC_CONFIG_INVALID');
 let tail=Promise.resolve(),nextAt=0;
 async function execute(request){
  if(request?.jsonrpc!=='2.0'||!allowed.has(request.method)||!Array.isArray(request.params)||!Number.isSafeInteger(request.id))throw Error('RPC_READ_METHOD_REQUIRED');
  const start=clock();let last=null;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   const pause=Math.max(0,nextAt-clock());if(clock()-start+pause>=totalMs)break;if(pause)await sleep(pause);
   const remaining=totalMs-(clock()-start);if(remaining<=0)break;
   nextAt=clock()+spacingMs;let response,raw,p;
   try{response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,remaining))),redirect:'error'});}
   catch{last=failure('RPC_NETWORK_OR_TIMEOUT',attempt)}
   if(response){
    if(!response.ok){await response.body?.cancel().catch(()=>{});last=failure('RPC_HTTP_'+response.status,attempt,response.status);if(!retryHttp.has(response.status))throw last}
    else{
     try{raw=await bounded(response,maxBytes)}catch(e){throw failure(e.message==='RPC_RESPONSE_TOO_LARGE'?'RPC_RESPONSE_TOO_LARGE':'RPC_BODY_READ_FAILED',attempt,response.status)}
     try{p=JSON.parse(raw)}catch{throw failure('RPC_INVALID_JSON',attempt,response.status)}
     if(p?.jsonrpc!=='2.0'||p.id!==request.id||(!p.error&&!Object.hasOwn(p,'result')))throw failure('RPC_BAD_ENVELOPE',attempt,response.status);
     if(!p.error)return {raw,payload:p,httpStatus:response.status,attempts:attempt};
     const code=Number.isSafeInteger(p.error.code)?p.error.code:null;
     last=failure(code===-32015?'RPC_TRANSACTION_VERSION_UNSUPPORTED':'RPC_REMOTE_ERROR',attempt,response.status,code);
     if(!retryRpc.has(code))throw last;
    }
   }
   if(attempt===maxAttempts)break;
   const retryHeader=response?.headers.get('retry-after'),seconds=retryHeader&&/^\d+$/.test(retryHeader)?Number(retryHeader):0;
   const delay=Math.max(250*2**(attempt-1),seconds*1000);
   if(!Number.isFinite(delay)||clock()-start+delay>=totalMs)break;
   nextAt=Math.max(nextAt,clock()+delay);
  }
  throw last??failure('RPC_RETRY_BUDGET_EXHAUSTED',0);
 }
 return request=>{const job=tail.then(()=>execute(request));tail=job.catch(()=>{});return job};
}

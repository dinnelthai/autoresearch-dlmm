// Localhost-only diagnostic: do not log response bodies or raw exception messages.
const codes=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
export async function localHttpProbe(port,path,{timeoutMs=12000,maxBytes=8*1024*1024}={}){
 if(!Number.isInteger(port)||port<1024||port>65535||!/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(path))throw Error('INVALID_LOCAL_PROBE_TARGET');
 const start=Date.now(),base={port,path};
 const done=value=>({...base,...value,elapsedMs:Date.now()-start});
 let response;
 try{
  response=await fetch('http://127.0.0.1:'+port+path,{signal:AbortSignal.timeout(timeoutMs),redirect:'manual'});
  if(!response.ok){await response.body?.cancel().catch(()=>{});return done({ok:false,httpStatus:response.status,reason:response.status>=300&&response.status<400?'LOCAL_REDIRECT_REJECTED':'LOCAL_HTTP_ERROR'})}
  const reader=response.body?.getReader();if(!reader)return done({ok:false,httpStatus:response.status,reason:'LOCAL_EMPTY_BODY'});
  let total=0,parts=[];
  try{while(true){const {done:finished,value}=await reader.read();if(finished)break;total+=value.byteLength;if(total>maxBytes)return done({ok:false,httpStatus:response.status,reason:'LOCAL_RESPONSE_TOO_LARGE'});parts.push(Buffer.from(value))}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  try{return done({ok:true,httpStatus:response.status,data:JSON.parse(Buffer.concat(parts).toString('utf8'))})}
  catch{return done({ok:false,httpStatus:response.status,reason:total?'LOCAL_INVALID_JSON':'LOCAL_EMPTY_BODY'})}
 }catch(e){
  const code=e?.cause?.code??e?.code;
  const reason=e?.name==='TimeoutError'||e?.name==='AbortError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)?'LOCAL_TIMEOUT':code==='ECONNREFUSED'?'LOCAL_CONNECTION_REFUSED':codes.has(code)?'LOCAL_TRANSPORT_ERROR':'LOCAL_FETCH_FAILED';
  return done({ok:false,httpStatus:response?.status??null,reason,...(codes.has(code)?{errorCode:code}:{})});
 }
}

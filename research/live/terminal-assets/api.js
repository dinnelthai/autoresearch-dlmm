'use strict';
// Same-origin read and diagnostic POST transport. Endpoint-specific response checks remain in the caller.
function scopedEndpoint(path,scope){return scope?path+'?pool='+encodeURIComponent(scope):path}
function terminalGet(path,scope,timeout=10000){return fetch(scopedEndpoint(path,scope),{cache:'no-store',signal:AbortSignal.timeout(timeout)})}
function terminalPost(path,body,timeout){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)})}

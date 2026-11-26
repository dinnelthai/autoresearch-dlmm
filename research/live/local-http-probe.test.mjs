import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {localHttpProbe} from './local-http-probe.mjs';
async function serve(t,handler){
 const server=createServer(handler);
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});
 t.after(()=>new Promise(ok=>{server.closeAllConnections();server.close(ok)}));
 return server.address().port;
}
test('local HTTP probe distinguishes healthy JSON, bad JSON, HTTP errors and redirects',async t=>{
 const port=await serve(t,(req,res)=>{
  if(req.url==='/health'){res.end('{"status":"RUNNING"}');return}
  if(req.url==='/invalid'){res.end('secret-not-json');return}
  if(req.url==='/empty'){res.end();return}
  if(req.url==='/redirect'){res.writeHead(302,{location:'http://example.invalid/'});res.end();return}
  res.writeHead(503);res.end('secret-error-body');
 });
 const good=await localHttpProbe(port,'/health');assert.equal(good.ok,true);assert.equal(good.data.status,'RUNNING');assert.equal(good.port,port);assert.ok(good.elapsedMs>=0);
 for(const [path,reason,status] of [['/invalid','LOCAL_INVALID_JSON',200],['/empty','LOCAL_EMPTY_BODY',200],['/redirect','LOCAL_REDIRECT_REJECTED',302],['/down','LOCAL_HTTP_ERROR',503]]){
  const r=await localHttpProbe(port,path);assert.equal(r.ok,false);assert.equal(r.reason,reason);assert.equal(r.httpStatus,status);assert.ok(!JSON.stringify(r).includes('secret'));
 }
});
test('local probe rejects oversized responses and reports timeout',async t=>{
 const port=await serve(t,(req,res)=>{if(req.url==='/large')res.end('x'.repeat(1024));});
 assert.equal((await localHttpProbe(port,'/large',{maxBytes:64})).reason,'LOCAL_RESPONSE_TOO_LARGE');
 assert.equal((await localHttpProbe(port,'/slow',{timeoutMs:50})).reason,'LOCAL_TIMEOUT');
});
test('local probe distinguishes closed port and rejects non-local targets',async t=>{
 const server=createServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;await new Promise(ok=>server.close(ok));
 const r=await localHttpProbe(port,'/health');assert.equal(r.reason,'LOCAL_CONNECTION_REFUSED');
 for(const [p,path] of [[port,'//evil.invalid'],[port,'/../health'],[1,'/health']])await assert.rejects(localHttpProbe(p,path),/INVALID_LOCAL_PROBE_TARGET/);
});

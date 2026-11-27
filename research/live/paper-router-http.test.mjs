import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createTerminalHandler} from './terminal-router.mjs';
import {createTerminalLocks} from './terminal-locks.mjs';
import {createPaperPoolManager,paperPoolConfig} from './paper-pool-manager.mjs';
const a='A'.repeat(32),b='B'.repeat(32),c='C'.repeat(32);
test('loopback HTTP routes isolate virtual paper pool scope and reject unavailable operations',async()=>{
 const calls=[],locks=createTerminalLocks();
 const manager=createPaperPoolManager({entries:paperPoolConfig(a,[b]),makeService:({pool})=>({get:async()=>({pool,running:false,pnlReady:false,executionReady:false}),context:async()=>({pool,executionReady:false}),reportCatalog:async()=>({pool,ids:['fixture']}),report:async body=>({pool,id:body.id,scope:'PAPER_OBSERVED_RESEARCH_REPORT'}),start:async()=>{calls.push(['start',pool]);return {pool,pnlReady:false,executionReady:false}},pause:async()=>{calls.push(['pause',pool]);return {pool,pnlReady:false,executionReady:false}},tick:async()=>{},stop:async()=>{}})});
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port,origin='http://127.0.0.1:'+port;
 try{
  server.on('request',createTerminalHandler({pool:a,port,origin,html:'',startup:{},isStopping:()=>false,validateScope:p=>{assert.ok([a,b].includes(p));return p},locks,paperService:manager,jsonBody:async req=>{let body='';for await(const chunk of req)body+=chunk;return JSON.parse(body)},send:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}}));
  const get=path=>fetch(origin+'/api/terminal/'+path,{signal:AbortSignal.timeout(5000)});
  const post=(path,body,requestOrigin=origin)=>fetch(origin+'/api/terminal/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(requestOrigin?{Origin:requestOrigin}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  assert.equal((await (await get('paper-status?pool='+b)).json()).pool,b);
  assert.equal((await (await get('paper-context?pool='+a)).json()).executionReady,false);
  assert.equal((await (await get('paper-pools')).json()).pools.length,2);
  assert.equal((await get('paper-pools?pool='+b)).status,400);
  assert.equal((await get('paper-status?pool='+c)).status,400);
  assert.deepEqual((await (await get('paper-reports?pool='+b)).json()).ids,['fixture']);assert.equal((await (await post('paper-report',{pool:b,id:'fixture'})).json()).pool,b);assert.equal((await post('paper-report',{pool:c,id:'fixture'})).status,400);
  assert.equal((await post('paper-start',{draft:{pool:b}},null)).status,403);
  assert.equal((await post('paper-start',{draft:{pool:b}},'https://example.invalid')).status,403);
  const release=locks.acquire('analysis');try{const started=await post('paper-start',{draft:{pool:b}});assert.equal(started.status,200);assert.equal((await started.json()).pool,b)}finally{release()}
  const paused=await post('paper-pause',{pool:b,id:'fixture'});assert.equal(paused.status,200);assert.equal((await paused.json()).pnlReady,false);
  assert.equal((await post('execute',{})).status,404);
  assert.deepEqual(calls,[['start',b],['pause',b]]);
 }finally{await manager.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});

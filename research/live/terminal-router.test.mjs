import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalHandler} from './terminal-router.mjs';
import {createTerminalLocks} from './terminal-locks.mjs';
const pool='A'.repeat(32),origin='http://127.0.0.1:8790';
function setup(overrides={}){
 const locks=createTerminalLocks(),calls=[];
 const handler=createTerminalHandler({pool,port:8790,origin,html:'',startup:{},isStopping:()=>false,validateScope:x=>x,locks,jsonBody:async req=>req.body,send:(res,status,value)=>{res.statusCode=status;res.body=value},preview:async(body,mode)=>{calls.push(mode);return {mode}},rememberReport:r=>r,holderObservation:async()=>{throw Error('HOLDER_CAPTURE_FAILED')},...overrides});
 async function post(path,{host='127.0.0.1:8790',requestOrigin=origin,body={}}={}){
  const res={setHeader(){},once(){}};await handler({method:'POST',url:'/api/terminal/'+path,headers:{host,origin:requestOrigin},body},res);return res;
 }
 return {locks,calls,post};
}
test('registered analysis endpoints keep distinct modes and deny foreign or absent origins',async()=>{const x=setup();assert.equal((await x.post('plans',{requestOrigin:null})).statusCode,403);assert.equal((await x.post('plans',{host:'evil.example'})).statusCode,403);assert.equal((await x.post('plans')).body.mode,'plans');assert.equal((await x.post('management')).body.mode,'management');assert.deepEqual(x.calls,['plans','management']);assert.equal((await x.post('execute')).statusCode,404)});
test('router returns busy without invoking handler and releases after exceptions',async()=>{const x=setup();const release=x.locks.acquire('builder');assert.equal((await x.post('plans')).statusCode,409);assert.equal((await x.post('holder-features')).body.gaps[0],'HOLDER_CAPTURE_BUSY');release();assert.equal((await x.post('holder-features')).statusCode,400);assert.equal((await x.post('holder-features')).body.gaps[0],'HOLDER_CAPTURE_FAILED');assert.equal((await x.post('plans')).statusCode,200)});

test('unstructured service failures are not disclosed',async()=>{const x=setup({holderObservation:async()=>{throw Error('ENOENT /home/private/config.json')}});const r=await x.post('holder-features');assert.equal(r.statusCode,400);assert.equal(r.body.gaps[0],'INPUT_OR_EVIDENCE_VALIDATION_FAILED');assert.equal(JSON.stringify(r.body).includes('/home/private'),false)});

test('paper start is independent of analysis lease and retains local origin',async()=>{const calls=[],x=setup({paperService:{start:async b=>{calls.push('start');return {executionReady:false,pnlReady:false}},pause:async b=>{calls.push('pause');return {executionReady:false,pnlReady:false}}}});assert.equal((await x.post('paper-start',{requestOrigin:null})).statusCode,403);const release=x.locks.acquire('analysis');try{assert.equal((await x.post('paper-start')).body.executionReady,false)}finally{release()}assert.equal((await x.post('paper-pause')).body.pnlReady,false);assert.deepEqual(calls,['start','pause'])});

test('paper status and context preserve configured scope; pool overview is read-only',async()=>{
 const a='A'.repeat(32),b='B'.repeat(32),seen=[];
 const handler=createTerminalHandler({pool:a,port:8790,origin,html:'',startup:{},isStopping:()=>false,validateScope:x=>x,locks:createTerminalLocks(),send:(res,status,value)=>{res.statusCode=status;res.body=value},paperService:{get:async p=>{seen.push(p);return {pool:p,pnlReady:false}},context:async p=>({pool:p,executionReady:false}),list:async()=>({pools:[a,b],pnlReady:false})}});
 async function get(path){const res={setHeader(){},once(){}};await handler({method:'GET',url:path,headers:{host:'127.0.0.1:8790'}},res);return res}
 assert.equal((await get('/api/terminal/paper-status?pool='+b)).body.pool,b);
 assert.equal((await get('/api/terminal/paper-context?pool='+b)).body.executionReady,false);
 assert.deepEqual((await get('/api/terminal/paper-pools')).body.pools,[a,b]);assert.deepEqual(seen,[b]);
 assert.equal((await get('/api/terminal/paper-pools?pool='+b)).statusCode,400);
});

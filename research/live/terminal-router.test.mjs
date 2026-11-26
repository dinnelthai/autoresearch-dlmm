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

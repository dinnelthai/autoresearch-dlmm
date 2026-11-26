import test from 'node:test';import assert from 'node:assert/strict';import {runCollectorLanes,serializedWriter,waitInterval} from './collector-scheduler.mjs';
test('slow history does not prevent market refresh',async()=>{const c=new AbortController();let release;const slow=new Promise(r=>release=r);let market=0,history=0;
 await runCollectorLanes([{name:'market',intervalMs:15000,run:async()=>{if(++market===2){c.abort();release()}}},{name:'history',intervalMs:15000,run:async()=>{history++;await slow}}],c,{wait:async()=>{}});assert.equal(market,2);assert.equal(history,1)});
test('writes are ordered and failed writes stop the queue',async()=>{const rows=[],w=serializedWriter(async x=>{rows.push(x);if(x===2)throw Error('disk')});const a=w(1),b=w(2),c=w(3);await a;await assert.rejects(b,/disk/);await assert.rejects(c,/disk/);assert.deepEqual(rows,[1,2])});
test('abort wakes sleeping lane',async()=>{const c=new AbortController();const p=waitInterval(30000,c.signal);c.abort();await p});

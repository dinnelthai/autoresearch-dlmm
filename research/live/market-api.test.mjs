import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePoolInfo,fetchIndexedJson,cachedLoader} from './market-api.mjs';
const m={pool:'A'.repeat(32),mintX:'B'.repeat(32),mintY:'C'.repeat(32),decimalsX:6,decimalsY:9};
const p={address:m.pool,token_x:{address:m.mintX,decimals:6,symbol:'MEME'},token_y:{address:m.mintY,decimals:9,symbol:'SOL'},tvl:20,volume:{'24h':0}};
test('indexed identity matches both mints, missing metrics remain null',()=>{const x=normalizePoolInfo(p,m,100);assert.equal(x.tvl,20);assert.equal(x.volume24h,0);assert.equal(x.fees24h,null);assert.throws(()=>normalizePoolInfo({...p,address:m.mintX},m));assert.throws(()=>normalizePoolInfo({...p,token_x:p.token_y},m))});
test('bounded fetch handles rate limits and oversized responses',async()=>{await assert.rejects(fetchIndexedJson('/evil'));await assert.rejects(fetchIndexedJson('/pools/'+m.pool,{fetcher:async()=>new Response('{}',{status:429})}),/INDEX_RATE_LIMITED/);await assert.rejects(fetchIndexedJson('/pools/'+m.pool,{limit:1,fetcher:async()=>new Response('{}')}),/INDEX_RESPONSE_TOO_LARGE/)});
test('cache coalesces, expires and does not cache failure',async()=>{let n=0,now=0;const f=cachedLoader(async a=>{n++;if(a==='bad')throw Error('bad');return a},10,()=>now);assert.deepEqual(await Promise.all([f('a',1),f('a',2)]),[1,1]);now=11;await assert.rejects(f('a','bad'));assert.equal(await f('a',3),3);assert.equal(n,3)});

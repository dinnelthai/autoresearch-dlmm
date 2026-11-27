import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from '../engine.mjs';
import {targetPoolReference} from './review-observations.mjs';
const cfg=E.config(),q=1n<<64n,now=100000;
const m={pool:'target',receivedAt:now,rawHash:'a'.repeat(64),activeId:0,decimalsX:9,decimalsY:9,bins:[
 {binId:0,priceQ64Raw:String(q),amountYRaw:'1000000000'},
 {binId:-1,priceQ64Raw:String(q*99n/100n),amountYRaw:'3000000000'},
 {binId:-2,priceQ64Raw:String(q*97n/100n),amountYRaw:'9000000000'},
 {binId:1,priceQ64Raw:String(q*101n/100n),amountYRaw:'9000000000'}]};
test('target fallback marks active price and contiguous observed SOL depth',()=>{
 const targetReference=targetPoolReference(m,now);
 assert.equal(targetReference.price,1);assert.equal(targetReference.depth,4);
 const e={pool:m.pool,t:100,references:[],targetReference};
 const r=E.reference(e,cfg);
 assert.equal(r.valid,true);assert.equal(r.basis,'TARGET_POOL');assert.equal(r.divergence,null);
 assert.equal(E.reference({...e,t:221},cfg).valid,false);
 assert.equal(E.reference({...e,targetReference:{...targetReference,depth:0}},cfg).valid,false);
 assert.equal(E.reference({...e,targetReference:{...targetReference,pool:'wrong'}},cfg).valid,false);
});
test('single and multi reference preference, divergence and confidence margins',()=>{
 const a={pool:'a',price:1,depth:10,availableAt:100},b={...a,pool:'b',price:1.01};
 const e={pool:m.pool,t:100,targetReference:targetPoolReference(m,now)};
 const single=E.reference({...e,references:[a]},cfg),multi=E.reference({...e,references:[a,b]},cfg);
 assert.equal(single.basis,'SINGLE_POOL');assert.equal(multi.basis,'MULTI_POOL');
 assert.equal(E.reference({...e,references:[a,{...b,price:2}]},cfg).reason,'REFERENCE_DIVERGENCE');
 assert.equal(E.referenceUncertainty({market:{ref:single}},cfg),cfg.uncertaintySol*1.5);
 assert.equal(E.referenceUncertainty({market:{ref:multi}},cfg),cfg.uncertaintySol);
 assert.equal(E.referenceUncertainty({market:{ref:{confidence:'LOW'}}},cfg),cfg.uncertaintySol*2);
});

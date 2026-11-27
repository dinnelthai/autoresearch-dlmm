import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from '../engine.mjs';
import {paperTickObservation,collectedPaperInputs} from './review-observations.mjs';
const now=100000,q=1n<<64n,m={pool:'p',slot:1,rawHash:'a'.repeat(64),receivedAt:now,activeId:0,binStep:100,decimalsX:9,decimalsY:9,bins:[{binId:0,priceQ64Raw:String(q),amountYRaw:'10000000000'}]};
test('fresh target snapshot reaches model without holder, trades or reference pools',()=>{
 const sample=paperTickObservation(m,now,null);
 assert.equal(sample.event.flowSol,null);
 assert.equal(sample.event.holderShare,null);
 assert.equal(sample.event.tokenSafe,null);
 const {latest,cfg,observations,asOf}=collectedPaperInputs({m,req:{goal:'balanced',horizonSeconds:480,riskConfig:{}},samples:[sample],asOf:100});
 assert.equal(latest.ref.price,1);
 const s=E.newState({pool:'p',sol:10,meme:0,entry:'sol',initialPrice:1},cfg);
 E.event(s,cfg,latest);
 const g=E.classify(s,cfg);
 assert.equal(g.regime,'HEALTHY_RANGE');
 assert.ok(g.flags.includes('REGIME_WARMUP_PROVISIONAL'));
 assert.ok(g.flags.includes('HOLDER_UNKNOWN'));
 assert.ok(E.forecast(s,cfg).every(v=>v.volumeDiagnostic.projectedVolumeSol===0));
});
test('target mark is the placement price even when optional reference differs',()=>{
 const sample=paperTickObservation(m,now,null);
 sample.event.references=[{pool:'other',price:2,depth:10,availableAt:100}];
 assert.equal(E.reference(sample.event,E.config()).price,1);
 assert.equal(E.classify({market:{...sample.event,tokenSafe:false,ref:E.reference(sample.event,E.config())},lastTime:100,history:[],marks:[],fills:[]},E.config()).regime,'STRESS');
});

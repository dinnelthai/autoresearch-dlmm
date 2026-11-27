import assert from 'node:assert/strict';
import {quoteMath} from './reference-math.mjs';
const bid={inRaw:'100',outRaw:'1000'},ask={inRaw:'1100',outRaw:'100'};
const full=(inRaw,outRaw,minOutRaw)=>({inRaw,outRaw,minOutRaw,status:'FULL_QUOTE'});
const result=quoteMath(bid,ask,[full('100','1000','990'),full('200','1800','1750')],1000);
assert.equal(result.bestTestedExit.inRaw,'100');
assert.equal(result.samples[1].withinBudget,false);
assert.equal(quoteMath(bid,ask,[{inRaw:'100',status:'QUOTE_UNAVAILABLE'}],100).bestTestedExit,null);
assert.throws(()=>quoteMath({...bid,outRaw:'1200'},ask,[],100));
assert.throws(()=>quoteMath(bid,ask,[full('100','10','20')],100));
assert.throws(()=>quoteMath(bid,ask,[full('100','1000','990'),full('100','1000','990')],1000));
console.log('Quote math fixtures passed; no live quote acceptance.');

import {referenceProbeSizes} from './reference-math.mjs';
test('reference probes scale in raw units with price and keep explicit ladder',()=>{const m={activeId:1,bins:[{binId:1,priceQ64Raw:String(1n<<64n)}]};assert.deepEqual(referenceProbeSizes(m).sellRaw,['10000000','1505000000','3000000000']);assert.deepEqual(referenceProbeSizes({...m,bins:[{binId:1,priceQ64Raw:String(1n<<63n)}]}).sellRaw,['20000000','3010000000','6000000000']);assert.deepEqual(referenceProbeSizes(m,{sellRaw:['1','2']}).sellRaw,['1','2']);assert.throws(()=>referenceProbeSizes({...m,bins:[]}),/REFERENCE_ACTIVE_PRICE_MISSING/)});

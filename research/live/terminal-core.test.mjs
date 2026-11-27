import test from 'node:test';
import assert from 'node:assert/strict';
import {toRaw,requestFromDraft,currentMarket,reviewMatches,marketDisplay,scopedTerminalRequest} from './terminal-core.mjs';
const pool='A'.repeat(32),rawHash='0'.repeat(64),mintX='B'.repeat(32),mintY='C'.repeat(32);
const m={pool,slot:10,rawHash,mintX,mintY,decimalsX:6,decimalsY:9};
const d={kind:'UX_DRAFT_NOT_ENGINE_REQUEST',schemaVersion:1,pool,capitalScope:'USER_DECLARED_ALLOCATION',allowDispose:false,entry:'sol',goal:'balanced',horizonSeconds:3600,solHuman:'1.000000001',memeHuman:'0',riskConfig:{maxInventoryRatio:.5,maxInventoryTokens:100,minSolReserve:.1,maxLossSol:.1,stressDrop:.3,maxBinShare:.02,operationCostSol:.001,feeBps:30,protocolShare:.1,slippageBps:50}};
test('decimal conversion uses integer precision and refuses rounding',()=>{assert.equal(toRaw('1.000000001',9),'1000000001');assert.equal(toRaw('000.001',6),'1000');assert.throws(()=>toRaw('0.0000001',6));assert.throws(()=>toRaw('9007199254740993',0));assert.throws(()=>toRaw('1e3',9))});
test('request matches explicit capital and discards extra model parameters',()=>{const r=requestFromDraft({...d,riskConfig:{...d.riskConfig,unexpected:123}},m);assert.equal(r.solRaw,'1000000001');assert.equal(r.memeRaw,'0');assert.equal(r.allowDispose,false);assert.equal(r.riskConfig.unexpected,undefined)});
test('wrong pool, implicit disposal, missing risk and insufficient reserve fail',()=>{for(const x of [{...d,pool:mintX},{...d,allowDispose:true},{...d,riskConfig:{}},{...d,riskConfig:{...d.riskConfig,minSolReserve:2}},{...d,memeHuman:'1'},{...d,horizonSeconds:0}])assert.throws(()=>requestFromDraft(x,m))});
test('review is bound to current market and observations are not stale',()=>{const now=1000000,r={pool,marketSlot:10,marketRawHash:rawHash,mintX,mintY,asOf:990,maxAgeSeconds:30,marketObservedAt:980,observations:[{t:990}]};reviewMatches(r,m,now);for(const x of [{...r,marketSlot:11},{...r,marketRawHash:'1'.repeat(64)},{...r,asOf:900},{...r,marketObservedAt:960},{...r,observations:[{t:960}]}])assert.throws(()=>reviewMatches(x,m,now))});
test('unavailable state cannot produce a market',()=>{assert.throws(()=>currentMarket({pool,schemaVersion:1,sequence:1,decisionReady:false,streams:{market:{status:'BLOCKED'}}},pool,1000000,30000))});

test('read-only pool display preserves raw quantities, clips by active bin and separates reference price',()=>{
 const a={decimalsX:6,decimalsY:9,activeId:0,bins:[{binId:5,amountXRaw:'9007199254740993',amountYRaw:'2',priceQ64Raw:'18446744073709551616'},{binId:0,amountXRaw:'1',amountYRaw:'3',priceQ64Raw:'18446744073709551616'}]};
 const d=marketDisplay(a,1);assert.equal(d.kind,'POOL_OBSERVATION_ONLY');assert.equal(d.totalXRaw,'9007199254740994');assert.equal(d.totalYRaw,'5');assert.equal(d.rows[0].binId,0);assert.equal(d.activeBinPriceSolPerMeme,.001);assert.equal(d.totalBins,2);assert.equal(d.referencePriceSolPerMeme,undefined);assert.throws(()=>marketDisplay({...a,bins:[{...a.bins[0],amountXRaw:'-1'}]}));
});

test('pool scoping is only available on observation endpoints and rejects duplicate or unknown parameters',()=>{
 const a='A'.repeat(32),b='B'.repeat(32);
 assert.deepEqual(scopedTerminalRequest('/api/terminal/state',a),{path:'/api/terminal/state',pool:a});
 assert.deepEqual(scopedTerminalRequest('/api/terminal/state?pool='+b,a),{path:'/api/terminal/state',pool:b});
 for(const url of ['/api/terminal/plans?pool='+b,'/api/terminal/state?pool='+b+'&pool='+a,'/api/terminal/state?pool=bad','/api/terminal/state?other='+b,'//example.org/api/terminal/state'])assert.throws(()=>scopedTerminalRequest(url,a));
});

test('market model overrides survive the business request boundary',()=>{
 const req=requestFromDraft({...d,marketModel:{regimeLookback:30,regimeMinObservations:5,trendLogReturnThreshold:.08}},m);
 assert.equal(req.riskConfig.regimeLookback,30);
 assert.equal(req.riskConfig.regimeMinObservations,5);
 assert.equal(req.riskConfig.trendLogReturnThreshold,.08);
 assert.throws(()=>requestFromDraft({...d,marketModel:{regimeLookback:2}},m));
 assert.throws(()=>requestFromDraft({...d,marketModel:{maxLossSol:999}},m));
});

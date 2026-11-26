import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
const cfg=E.config({executionDelaySeconds:0}),req={entry:'holding',meme:50000,sol:5,initialPrice:.0001,pool:'P'};
function sample(){const s=E.newState(req,cfg);for(const e of E.demo('range',cfg).filter(e=>e.type==='MARKET').slice(0,3)){const {syntheticFixture,...m}=e;E.event(s,cfg,{...m,pool:'P'})}E.event(s,cfg,{id:'pool',type:'POOL_STATE',t:s.lastTime,bins:Array.from({length:201},(_,i)=>({id:i-100,externalLiquiditySol:80}))});return s}
test('missing crossed bin blocks deployment even when endpoints are present',()=>{
 const s=sample(),full=E.forecast(s,cfg)[0],endpoints=new Set(full.events.filter(e=>e.type==='SWAP').map(e=>e.bin));
 const candidates=[];let prev=E.binId(cfg,s.market.ref.price);
 for(const e of full.events.filter(e=>e.type==='SWAP')){for(let i=Math.min(prev,e.bin)+1;i<Math.max(prev,e.bin);i++)if(!endpoints.has(i))candidates.push(i);prev=e.bin}
 assert.ok(candidates.length>0);const missing=candidates[0];delete s.poolBins[missing];
 const sc=E.forecast(s,cfg)[0];assert.equal(sc.volumeDiagnostic.missingLiquiditySteps,0);assert.ok(sc.volumeDiagnostic.missingCrossedBins>0);assert.ok(sc.volumeDiagnostic.missingBinIds.includes(missing));assert.equal(sc.volumeDiagnostic.modeledVolumeSol,sc.volumeDiagnostic.projectedVolumeSol);
 const action=E.candidatePlans(s,cfg).find(a=>a.type==='OPEN'&&!a.acquireSol);
 assert.equal(E.evaluate(s,cfg,action,[sc]).reason,'FORECAST_LIQUIDITY_COVERAGE_INCOMPLETE');assert.equal(E.evaluate(s,cfg,{type:'NO_LP'},[sc]).feasible,true);
});
test('missing endpoint does not synthesize volume or score deployment',()=>{
 const s=sample(),full=E.forecast(s,cfg)[0],first=full.events.find(e=>e.type==='SWAP');delete s.poolBins[first.bin];const sc=E.forecast(s,cfg)[0];assert.ok(sc.volumeDiagnostic.missingLiquiditySteps>0);assert.ok(sc.volumeDiagnostic.modeledVolumeSol<sc.volumeDiagnostic.projectedVolumeSol);assert.ok(sc.events.every(e=>e.type!=='SWAP'||e.bin!==first.bin));const a=E.candidatePlans(s,cfg).find(a=>a.type==='OPEN'&&!a.acquireSol);assert.equal(E.evaluate(s,cfg,a,[sc]).reason,'FORECAST_LIQUIDITY_COVERAGE_INCOMPLETE');
});
test('inventory exhaustion is not a second fill or second fee',()=>{
 const s=sample(),p=E.price(cfg,0);s.bins=[{id:0,x:1,y:0,liquidity:p}];
 const e={id:'fill',type:'SWAP',t:s.lastTime,bin:0,side:'LP_SELL',baseQty:1e8,externalLiquiditySol:80,mmFeeX:0,mmFeeY:100};
 const first=E.event(s,cfg,e),before=s.feesEarned.y,second=E.event(s,cfg,{...e,id:'exhausted'});assert.equal(first.status,'INVENTORY_LIMITED');assert.equal(first.filledBaseQty,1);assert.ok(first.requestedBaseQty>1);assert.equal(second.status,'INVENTORY_UNAVAILABLE');assert.equal(second.filledBaseQty,0);assert.equal(s.feesEarned.y,before);assert.equal(s.fills.length,1);assert.equal(s.fills[0].inventoryLimited,true);
});
test('scenario exposes modeled fill diagnostic, not probability',()=>{
 const s=sample();const p=E.price(cfg,0);s.wallet.x-=1;s.bins=[{id:0,x:1,y:0,liquidity:p}];s.status='OPEN';
 const e={id:'s1',type:'SWAP',t:s.lastTime,bin:0,side:'LP_SELL',baseQty:1e8,externalLiquiditySol:80,mmFeeX:0,mmFeeY:100};const r=E.evaluate(s,cfg,{type:'HOLD'},[{name:'cap',events:[e,{...e,id:'s2'}]}]);assert.equal(r.feasible,true);const d=r.fillDiagnostics[0];assert.equal(d.eligibleCount,2);assert.equal(d.filledCount,1);assert.equal(d.inventoryLimitedCount,2);assert.ok(d.filledNotionalFraction>0&&d.filledNotionalFraction<1);assert.equal(d.basis,'SYNTHETIC_PARTICIPATION_NOT_PROBABILITY');
});

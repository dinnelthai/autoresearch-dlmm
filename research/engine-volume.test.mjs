import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
const req={entry:'holding',meme:50000,sol:5,initialPrice:.0001,pool:'P'};
function sample(steps=8,window=240,withDepth=true){
 const c=E.config({forecastSteps:steps,forecastHorizonSeconds:480,executionDelaySeconds:0}),s=E.newState(req,c);
 for(const e of E.demo('range',c).filter(e=>e.type==='MARKET').slice(0,3)){const {syntheticFixture,...m}=e;E.event(s,c,{...m,pool:'P',flowWindowSeconds:window})}
 if(withDepth)E.event(s,c,{type:'POOL_STATE',id:'pool',t:s.lastTime,bins:Array.from({length:201},(_,i)=>({id:i-100,externalLiquiditySol:37}))});
 return {c,s};
}
test('volume projection is invariant to step count and uses target bin liquidity',()=>{
 for(const steps of [4,8,16]){
  const {s,c}=sample(steps);for(const sc of E.forecast(s,c)){assert.equal(sc.volumeDiagnostic.projectedVolumeSol,64);assert.equal(sc.volumeDiagnostic.modeledVolumeSol,64);const swaps=sc.events.filter(e=>e.type==='SWAP');assert.equal(swaps.length,steps);assert.ok(swaps.every(e=>e.externalLiquiditySol===37));const volume=swaps.reduce((n,e)=>n+E.price(c,e.bin)*e.baseQty,0);assert.ok(Math.abs(volume-64)<1e-8);const fee=swaps.reduce((n,e)=>n+e.mmFeeX*E.price(c,e.bin)+e.mmFeeY,0);assert.ok(Math.abs(fee-64*c.feeBps/10000*(1-c.protocolShare))<1e-8)}
 }
});
test('unknown flow window or target liquidity cannot fabricate trades',()=>{
 for(const [window,depth] of [[null,true],[240,false]]){const {s,c}=sample(8,window,depth),sc=E.forecast(s,c);assert.ok(sc.every(x=>x.events.every(e=>e.type!=='SWAP')&&x.volumeDiagnostic.modeledVolumeSol===0));const a=E.candidatePlans(s,c).find(a=>a.type==='OPEN'&&!a.acquireSol);assert.equal(E.evaluate(s,c,a,sc).reason,'FORECAST_VOLUME_EVIDENCE_UNAVAILABLE');assert.equal(E.evaluate(s,c,{type:'NO_LP'},sc).feasible,true)}
});
test('fee allocation is capped by actual filled inventory, not intended swap size',()=>{
 const {s,c}=sample(),id=0,p=E.price(c,id);s.bins=[{id,x:1,y:0,liquidity:p}];E.swap(s,c,{id:'cap',t:s.lastTime,bin:id,side:'LP_SELL',baseQty:1e8,externalLiquiditySol:37,mmFeeX:0,mmFeeY:100});const f=s.fills.at(-1);assert.equal(f.q,-1);assert.ok(Math.abs(f.feeY-1e-6)<1e-15);assert.equal(s.bins[0].x,0);
});

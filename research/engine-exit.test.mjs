import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
const c=E.config({executionDelaySeconds:0,operationCostSol:.01}),req={entry:'position',meme:1000,sol:1.2,initialPrice:.0001,positionBins:[{id:-1,x:0,y:2},{id:1,x:10000,y:0}],pendingFeeX:100,pendingFeeY:.1};
function sample(depth=1){const s=E.newState(req,c),e=E.demo('range',c)[0];E.event(s,c,{...e,exitDepth:depth});return s}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9);
test('current versus prospective sell depth and residual inventory',()=>{
 const s=sample(1),p=s.market.ref.price,x=E.exitExposure(s,c,p),r=E.risk(s,c,p),q=E.liquidation(s,c);
 near(x.currentInventoryMeme,11100);near(x.prospectiveInventoryMeme,11100+2/E.price(c,-1));near(x.currentHeadroomSol,-.11);assert.ok(x.prospectiveHeadroomSol<x.currentHeadroomSol);assert.ok(r.violations.includes('EXIT_CAPACITY'));
 assert.equal(q.status,'PARTIAL');assert.equal(q.value,null);assert.equal(q.netLiquidationValue,null);near(q.unsoldMeme,1100);near(q.modeledSaleProceedsSol,.995);near(q.grossSolAfterHypotheticalSale,4.295);near(q.unsoldMarkValueSol,.11);assert.equal(q.disposalAllowed,false);assert.equal(q.executionReady,false);near(q.walletSol,1.2);near(q.positionSol,2);near(q.pendingFeesSol,.1);
});
test('withdrawal conserves MEME and removes prospective bids without claiming a sale',()=>{
 const s=sample(.5),p=s.market.ref.price,b=E.balances(s),before=E.nav(s,p),risk=E.risk(s,c,p);E.applyAction(s,c,{type:'REMOVE_AND_HOLD'},s.lastTime);const after=E.risk(s,c,p);near(E.balances(s).x,b.x);near(E.nav(s,p),before-c.operationCostSol);assert.equal(s.bins.length,0);assert.equal(s.fills.length,0);assert.equal(after.bid,0);assert.ok(after.postX<risk.postX);assert.ok(after.violations.includes('EXIT_CAPACITY'));
});
test('full proxy sale is gross only and insufficient upfront wallet cash is disclosed',()=>{
 const s=sample(20);s.wallet.y=0;const r=E.liquidation(s,c);assert.equal(r.status,'ESTIMATE');near(r.value,r.grossSolAfterHypotheticalSale);assert.equal(r.netLiquidationValue,null);assert.equal(r.upfrontWithdrawalCostCoveredByWallet,false);assert.ok(r.walletReserveHeadroomSol<0);
});
test('zero or invalid depth never implies sale of MEME',()=>{
 const s=sample(0),r=E.liquidation(s,c);assert.equal(r.status,'PARTIAL');assert.equal(r.modeledSellMeme,0);near(r.unsoldMeme,E.balances(s).x);s.market.exitDepth=-1;assert.equal(E.liquidation(s,c).status,'UNAVAILABLE');assert.ok(E.risk(s,c,s.market.ref.price).violations.includes('EXIT_CAPACITY'));
});

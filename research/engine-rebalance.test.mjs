import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
const cfg=E.config({executionDelaySeconds:0});
const req={entry:'position',meme:0,sol:5,initialPrice:.0001,positionBins:[{id:-1,x:0,y:1},{id:1,x:1000,y:0}]};
function sample(){const s=E.newState(req,cfg);for(const e of E.demo('range',cfg).filter(e=>e.type==='MARKET').slice(0,3))E.event(s,cfg,e);return s}
function outcome(pnl,cost,utility,fee=0,name='range'){return {feasible:true,utility,scenarios:[{name,pnl,cost,fee}]}}
test('matched HOLD economics deduct aggregate cost only once',()=>{
 const hold=outcome(.02,0,.02),candidate=outcome(.05,.01,.05);
 const r=E.compareWithHold(candidate,hold,cfg);
 assert.equal(r.eligible,true);assert.ok(Math.abs(r.netPnlDeltaSol-.03)<1e-12);assert.ok(Math.abs(r.grossBeforeOperationCostDeltaSol-.04)<1e-12);assert.equal(r.operationCostDeltaSol,.01);
});
test('risk score alone cannot justify negative incremental rebalance PnL',()=>{
 const hold=outcome(.02,0,0);
 assert.equal(E.compareWithHold(outcome(.01,.01,.1),hold,cfg).eligible,false);
 assert.equal(E.compareWithHold(outcome(.03,.001,.001),hold,cfg).eligible,false);
 assert.equal(E.compareWithHold(outcome(.05,.001,.1,0,'other'),hold,cfg).eligible,false);
 assert.equal(E.compareWithHold(outcome(.05,.001,.1),{feasible:false},cfg).eligible,false);
});
test('direct modeled reposition cannot bypass cooldown or consume fee before rejecting',()=>{
 const s=sample();s.lastActionTime=s.lastTime;const before=JSON.stringify(s),action=E.candidatePlans(s,cfg).find(a=>a.type==='REPOSITION');
 assert.throws(()=>E.applyAction(s,cfg,action,s.lastTime),/REPOSITION_COOLDOWN/);assert.equal(JSON.stringify(s),before);
 E.submit(s,cfg,action,s.lastTime);assert.equal(s.receipts.at(-1).status,'REJECTED');assert.equal(s.cost,0);
});
test('confirmed receipt records aggregate operation cost without double deduction',()=>{
 const s=sample(),p=s.market.ref.price,before=E.nav(s,p);E.submit(s,cfg,{type:'REMOVE_AND_HOLD'},s.lastTime);const r=s.receipts.at(-1);
 assert.equal(r.status,'CONFIRMED');assert.ok(Math.abs(r.modeledCostSol-cfg.operationCostSol)<1e-12);assert.ok(Math.abs(E.nav(s,p)-(before-cfg.operationCostSol))<1e-9);assert.equal(r.costBasis,'DECLARED_LOGICAL_OPERATION_AGGREGATE');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
const req={entry:'holding',meme:50000,sol:5,initialPrice:.0001};
const cfg=E.config({executionDelaySeconds:0});
function sample(){const s=E.newState(req,cfg);for(const e of E.demo('range',cfg).slice(0,5))E.event(s,cfg,e);return s}
test('manual disposal is prohibited before any debit or mutation',()=>{const s=sample(),before=JSON.stringify(s);for(const type of ['DISPOSE','REMOVE_AND_DISPOSE']){assert.throws(()=>E.applyAction(s,cfg,{type},s.lastTime),/DISPOSAL_NOT_ALLOWED/);assert.equal(JSON.stringify(s),before)}});
test('scenario score fails closed without samples or fresh final reference',()=>{const s=sample();assert.equal(E.evaluate(s,cfg,{type:'NO_LP'},[]).reason,'SCENARIO_SAMPLE_EMPTY');assert.equal(E.evaluate(s,cfg,{type:'NO_LP'},[{name:'stale',events:[{id:'stale',t:s.lastTime+cfg.maxReferenceAge+1,type:'LIQUIDITY_UPDATE',bin:1,externalLiquiditySol:80}]}]).reason,'SCENARIO_END_REFERENCE_UNAVAILABLE')});
test('reference aggregation avoids product overflow and rejects invalid depth totals',()=>{const e=E.demo('range',cfg)[0];assert.equal(E.reference({...e,references:e.references.map(x=>({...x,depth:Number.MAX_VALUE}))},cfg).valid,false);assert.equal(E.reference({...e,references:e.references.map(x=>({...x,depth:1e200,price:1e200}))},cfg).valid,true)});
test('cannot use future reference for a fund operation',()=>{const s=sample();assert.throws(()=>E.applyAction(s,cfg,{type:'FUND',x:0,y:1},s.market.t-1),/reference required/)});
test('deployment respects existing turnover budget in scoring',()=>{const s=sample();s.turnover=cfg.maxTurnoverSol+1;const a=E.candidatePlans(s,cfg).find(a=>a.type==='OPEN'&&!a.acquireSol);assert.equal(E.evaluate(s,cfg,a,E.forecast(s,cfg)).reason,'REBALANCE_BUDGET')});

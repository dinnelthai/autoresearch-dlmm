// Explicit synthetic unit fixture; not live evidence or profitability validation.
import assert from 'node:assert/strict';
import {Engine} from '../engine.mjs';
import {previewPlans} from './preview-plans.mjs';
const req={entry:'sol',meme:0,sol:10,initialPrice:.0001,goal:'defensive',horizonSeconds:480,pool:'DEMO_POOL'};
const cfg=Engine.requestConfig(req,{anchorPrice:.0001,maxInventoryTokens:1000000,maxLossSol:10,minDepthSol:1,maxBinShare:.1});
assert.equal(cfg.lambda,1);assert.equal(cfg.forecastHorizonSeconds,480);
const s=Engine.newState(req,cfg);
for(const e of Engine.demo('range',cfg).filter(e=>e.type==='MARKET').slice(0,3))Engine.event(s,cfg,e);
const active=Engine.binId(cfg,s.market.ref.price),bins=Array.from({length:21},(_,i)=>({binId:active+i-10}));
Engine.event(s,cfg,{type:'POOL_STATE',id:'fixture-pool',t:s.lastTime,bins:bins.map(b=>({id:b.binId,externalLiquiditySol:100}))});
const before=JSON.stringify(s);
const out=previewPlans(s,cfg,{activeId:active,bins},{asOf:s.lastTime});
assert.equal(out.status,'RESEARCH_PLAN_PREVIEW_UNVERIFIED');
assert.ok(out.candidates.length>0);
assert.ok(out.candidates.every(r=>!r.action.acquireSol));
assert.equal(out.executionReady,false);assert.equal(out.decisionReady,false);
assert.equal(JSON.stringify(s),before);
assert.equal(previewPlans(s,cfg,{activeId:active+1,bins},{asOf:s.lastTime}).reason,'REFERENCE_AND_ACTIVE_BIN_MISMATCH');
assert.equal(previewPlans(s,cfg,{activeId:active,bins},{asOf:s.lastTime+1000}).status,'BLOCKED');
assert.equal(previewPlans({...s,status:'OPEN'},cfg,{activeId:active,bins},{asOf:s.lastTime}).reason,'EXISTING_POSITION_REQUIRES_T10');
console.log('T09 fixture checks passed; no live acceptance.');

 // Deterministic scenario-scoring stub isolates the ordering and exact-mapping gate.
const originalEvaluate=Engine.evaluate;
try{
 Engine.evaluate=(_s,_c,action,_scenarios,options)=>({feasible:true,utility:action.type==='NO_LP'?0:options?.mappedStart?.fixtureScore??(action.label==='spot'?3:action.label==='curve'?2:1),expectedPnl:1,expectedAlpha:1,expectedFee:1,cvar:0,terminalCvar:0,allocation:action.type==='NO_LP'?[]:[{id:active-1,x:0,y:.1,liquidity:.1}]});
 const gated=previewPlans(s,cfg,{activeId:active,bins},{asOf:s.lastTime,checkAllocation:r=>{if(r.family==='spot')throw Error('PAPER_SHARE_NONPROPORTIONAL_DEPOSIT');return {basis:'TEST_MAPPING',binCount:1}}});
 assert.equal(gated.selected.family,'curve');assert.equal(gated.selected.integerMapping.binCount,1);assert.ok(gated.candidates.filter(r=>r.family==='spot').every(r=>!r.feasible&&r.reason==='PAPER_SHARE_NONPROPORTIONAL_DEPOSIT'));assert.equal(gated.families.find(x=>x.family==='spot').feasible,0);
 const reranked=previewPlans(s,cfg,{activeId:active,bins},{asOf:s.lastTime,checkAllocation:r=>({basis:'TEST_MAPPING',binCount:1,modelStart:{fixtureScore:r.family==='curve'?5:1}})});
 assert.equal(reranked.selected.family,'curve');assert.equal(reranked.selected.score,5);assert.equal(Object.hasOwn(reranked.selected.integerMapping,'modelStart'),false);
 const allBlocked=previewPlans(s,cfg,{activeId:active,bins},{asOf:s.lastTime,checkAllocation:()=>{throw Error('PAPER_SHARE_LIMIT_OR_DUST')}});
 assert.equal(allBlocked.selected.family,'NO_LP');assert.ok(allBlocked.candidates.filter(r=>r.family!=='NO_LP').every(r=>!r.feasible));
}finally{Engine.evaluate=originalEvaluate}

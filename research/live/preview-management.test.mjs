// Explicit synthetic unit fixture; not live market evidence.
import assert from 'node:assert/strict';
import {Engine as E} from '../engine.mjs';
import {previewManagement as P} from './preview-management.mjs';
const req={entry:'position',meme:0,sol:5,initialPrice:.0001,goal:'balanced',horizonSeconds:480,pool:'DEMO_POOL',positionBins:[{id:-1,x:0,y:1},{id:1,x:1000,y:0}]};
const c=E.requestConfig(req,{anchorPrice:.0001,maxInventoryTokens:1000000,maxLossSol:10,minDepthSol:1,maxBinShare:.1});
const s=E.newState(req,c);
for(const e of E.demo('range',c).filter(e=>e.type==='MARKET').slice(0,3))E.event(s,c,e);
const active=E.binId(c,s.market.ref.price),bins=Array.from({length:21},(_,i)=>({binId:active+i-10}));
E.event(s,c,{type:'POOL_STATE',id:'fixture-pool',t:s.lastTime,bins:bins.map(b=>({id:b.binId,externalLiquiditySol:100}))});
const market={activeId:active,bins},position={position:'FIXTURE_POSITION'},opts={asOf:s.lastTime,position};
const before=JSON.stringify(s),out=P(s,c,market,opts);
assert.equal(out.status,'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED');
assert.ok(out.alerts.includes('OPERATION_HISTORY_UNVERIFIED'));
assert.ok(out.candidates.filter(r=>r.action.type==='REPOSITION').every(r=>!r.feasible));
assert.equal(out.executionReady,false);assert.equal(out.decisionReady,false);assert.equal(JSON.stringify(s),before);
assert.equal(P(s,c,market,{...opts,asOf:s.lastTime+1000}).status,'BLOCKED');
const risky=P(s,{...c,maxInventoryRatio:0},market,opts);
assert.equal(risky.selected,null);assert.ok(risky.alerts.includes('MANUAL_RISK_REVIEW_REQUIRED'));
const remove=out.candidates.find(r=>r.action.type==='REMOVE_AND_HOLD');
assert.ok(Math.abs(remove.inventoryAfterAction.x-E.balances(s).x)<1e-8);
assert.equal(remove.allocation.bins.length,0);
assert.ok(out.candidates.every(r=>!r.action.acquireSol&&!r.action.type.includes('DISPOSE')));
const operations={position:position.position,asOf:s.lastTime,lastActionTime:s.lastTime,rebalances:0,rebalanceTurnoverSol:0,spotTurnoverSol:0};
const cooling=P(s,c,market,{...opts,operations});
assert.equal(cooling.controls.cooldownElapsed,false);
assert.ok(cooling.candidates.filter(r=>r.action.type==='REPOSITION').every(r=>!r.feasible));
console.log('T10 management fixture checks passed; no live acceptance.');

// Matched HOLD gate must apply even when reviewed counters allow reposition.
const eligibleOps={...operations,lastActionTime:0};
const economic=P(s,c,market,{...opts,operations:eligibleOps});
assert.equal(economic.controls.cooldownElapsed,true);
assert.equal(economic.costBasis,'DECLARED_LOGICAL_OPERATION_AGGREGATE_ALREADY_IN_NET_NAV');
assert.ok(economic.candidates.filter(r=>r.action.type==='REPOSITION'&&r.feasible).every(r=>r.holdComparison?.eligible===true&&r.holdComparison.netPnlDeltaSol>0));
assert.ok(economic.candidates.filter(r=>r.reason==='REPOSITION_NET_ADVANTAGE_NOT_ESTABLISHED').every(r=>r.holdComparison?.eligible===false));
assert.ok(economic.selected?.action.type!=='REPOSITION'||economic.selected.holdComparison?.eligible===true);

// A risk-reducing withdrawal may leave current token exposure unsellable.
const stressed=JSON.parse(JSON.stringify(s));stressed.market.exitDepth=.01;
const protection=P(stressed,c,market,opts),withdraw=protection.protectiveDiagnostics.find(r=>r.action==='REMOVE_AND_HOLD');
assert.equal(protection.selected,null);
assert.equal(withdraw.feasible,false);
assert.ok(withdraw.remainingViolations.includes('EXIT_CAPACITY'));
assert.ok(withdraw.bidExposureReductionSol>0);
assert.ok(withdraw.prospectiveExitHeadroomImprovementSol>0);
assert.equal(withdraw.currentMemeDelta,0);
assert.equal(withdraw.disposal,false);
assert.equal(withdraw.executionReady,false);
assert.equal(protection.currentExitDiagnostic.netLiquidationValue,null);

const virtualProtection=P(stressed,c,market,{...opts,virtualProtection:true});
assert.equal(virtualProtection.selected.action.type,'REMOVE_AND_HOLD');assert.equal(virtualProtection.selected.feasible,false);assert.equal(virtualProtection.selected.protectiveExecution,true);assert.ok(virtualProtection.selected.postRisk.violations.includes('EXIT_CAPACITY'));assert.equal(virtualProtection.executionReady,false);

const mappingBlocked=P(stressed,c,market,{...opts,virtualProtection:true,checkAllocation:()=>{throw Error('PAPER_ADAPTIVE_COST_UNFUNDED')}});
assert.equal(mappingBlocked.selected,null);assert.equal(mappingBlocked.reason,'PAPER_ADAPTIVE_COST_UNFUNDED');assert.ok(mappingBlocked.alerts.includes('VIRTUAL_PROTECTION_MAPPING_BLOCKED'));

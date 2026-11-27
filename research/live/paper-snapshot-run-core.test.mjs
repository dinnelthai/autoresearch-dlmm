import test from 'node:test';
import assert from 'node:assert/strict';
import {IntegerKernel as K} from '../integer.mjs';
import {openSnapshotExperiment,advanceSnapshotExperiment,updateAdaptiveSnapshot} from './paper-snapshot-run-core.mjs';
import {advancePaperCapture} from './paper-snapshot.mjs';
const Q=K.Q,pool='A'.repeat(32),mintX='B'.repeat(32),mintY='C'.repeat(32),backendHash='f'.repeat(64);
function snapshot(slot,fee=0n){
 const rawHash=String(slot).repeat(64),identity={pool,mintX,mintY,slot,rawHash,sdkCommit:K.SDK_COMMIT,idlBlob:'idl',activeId:0,binStep:100,orientation:'MEME_X_SOL_Y',status:'IDENTITY_CHECKED_UNVERIFIED',sides:[{mint:mintX,decimals:6},{mint:mintY,decimals:9}]};
 const b={version:3,amountXRaw:'10000000',amountYRaw:'0',liquiditySupplyRaw:String(100n*Q),priceQ64Raw:String(Q),feeXPerTokenRaw:String(fee*Q),feeYPerTokenRaw:'0',openOrderAmountRaw:'0',totalProcessingOrderAmountRaw:'0',processedOrderRemainingAmountRaw:'0'};
 return {identity,bins:{...identity,status:'BITMAP_COVERAGE_CHECKED_UNVERIFIED',coverage:{expected:1,decoded:1,missing:0,unsupported:0},arrays:[{version:3,bins:Array.from({length:70},(_,binId)=>({...b,binId}))}]},proof:{path:'data/raw/'+slot,manifestHash:rawHash,accountsHash:rawHash,requestedAt:new Date(slot*10000).toISOString(),receivedAt:new Date(slot*10000+1000).toISOString()}};
}
function fixture(){
 const a=snapshot(1),row={family:'spot',feasible:true,action:{type:'OPEN'},allocation:{lowerBinId:1,upperBinId:1,bins:[{binId:1,meme:1,sol:0}]}};
 const report={schemaVersion:1,pool,status:'RESEARCH_DIAGNOSTIC_UNVERIFIED',executionReady:false,decisionReady:false,protocolExact:false,calibrated:false,market:{...a.identity,decimalsX:6,decimalsY:9},planPreview:{status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',scope:'NEW_POSITION_ONLY',executionReady:false,decisionReady:false,families:['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'].map(family=>({family,best:family==='spot'?row:family==='NO_LP'?{family,feasible:true,action:{type:'NO_LP'}}:null})),selected:row}};
 const state=openSnapshotExperiment({id:'fixture',snapshot:a,report,budget:{memeRaw:'2000000',solRaw:'1000000000',allowDispose:false,minSolReserve:0,operationCostSol:0},policy:{maxDrawdownBps:1000,maxLossSolRaw:'100000000',maxGapSeconds:180,exitCostSolRaw:'1'},backendHash,frozenAt:12000});
 return {a,state};
}
const advance=(state,opening,previous,snapshot,exit=false)=>advanceSnapshotExperiment(state,{opening,previous,snapshot,backendHash,now:1000000,exit});
test('equal capital, cumulative fees not double counted, no LP benchmark',()=>{const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n);assert.equal(state.rows[1].status,'OPEN_PROXY');const s2=advance(state,a,a,b),s3=advance(s2,a,b,c);assert.equal(s3.rows[1].points.at(-1).feeXRaw,'18');assert.equal(s3.rows[1].points.at(-1).excessVsHoldYRaw,'18');assert.equal(s3.rows[0].points.at(-1).pnlYRaw,'0');assert.equal(s3.pnlReady,false)});
test('virtual exit books inventory and fees once and then holds wallet',()=>{const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n),s2=advance(state,a,a,b,true),s3=advance(s2,a,b,c);assert.equal(s2.rows[1].status,'EXITED_PROXY');assert.equal(s3.rows[1].points.at(-1).feeXRaw,'0');assert.equal(s3.rows[1].points.at(-1).excessVsHoldYRaw,'8')});
test('normal supply changes continue accounting; actual data gaps still invalidate affected paths',()=>{
 const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n);
 // Proportional external liquidity additions/removals leave principal per share unchanged.
 b.bins.arrays[0].bins[1].liquiditySupplyRaw=String(200n*Q);b.bins.arrays[0].bins[1].amountXRaw='20000000';
 c.bins.arrays[0].bins[1].liquiditySupplyRaw=String(150n*Q);c.bins.arrays[0].bins[1].amountXRaw='15000000';
 const s2=advance(state,a,a,b),s3=advance(s2,a,b,c);
 assert.equal(s2.rows[1].status,'OPEN_PROXY');assert.equal(s3.rows[1].points.length,3);
 assert.equal(s3.rows[1].points.at(-1).principalXRaw,'1000000');assert.equal(s3.rows[1].points.at(-1).feeXRaw,'18');
 assert.equal(s3.rows[0].status,'HOLD_ONLY');
 const gap=snapshot(2,1n);gap.proof.requestedAt=new Date(300000).toISOString();gap.proof.receivedAt=new Date(301000).toISOString();
 assert.equal(advance(state,a,a,gap).rows[1].reason,'PAPER_SNAPSHOT_GAP');
});
test('reject stale or pre-freeze capture and altered checkpoint scope',()=>{const {a,state}=fixture(),b=snapshot(2);assert.throws(()=>advance(state,a,a,a));b.proof.requestedAt=new Date(11000).toISOString();assert.throws(()=>advance(state,a,a,b));assert.throws(()=>advance({...state,backendHash:'e'.repeat(64)},a,a,snapshot(2)))});

test('risk loss triggers proxy exit with one declared cost',()=>{const {a,state}=fixture(),b=snapshot(2);state.policy.maxLossSolRaw='1';b.bins.arrays[0].bins[1].amountXRaw='9000000';const s2=advance(state,a,a,b);assert.equal(s2.rows[1].status,'EXITED_PROXY');assert.equal(s2.rows[1].reason,'RISK_VIRTUAL_EXIT');assert.equal(s2.rows[1].points.at(-1).costYRaw,'1');assert.equal(s2.rows[1].points.at(-1).pnlYRaw,'-100001')});

test('virtual reposition freezes new segment, credits old fees once and preserves original baseline',()=>{
 const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n),d=snapshot(4,3n);
 state.adaptiveRequest={goal:'balanced'};
 const cfg={executionDelaySeconds:1,maxRebalances:8,maxTurnoverSol:30,minSolReserve:0,maxBinShare:.1};
 const preview={status:'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED',selected:{feasible:true,action:{type:'REPOSITION',spec:{width:1}},estimatedOperationCostSol:0,allocation:{bins:[{binId:2,meme:.5,sol:0}]}}};
 const reviewed={cfg,latest:{t:21}},reviewHash='e'.repeat(64);
 let s2=advance(state,a,a,b);s2=updateAdaptiveSnapshot(s2,{snapshot:b,reviewed,preview,reviewHash,now:22000});
 assert.equal(s2.rows[7].pendingAdaptive.action,'REPOSITION');
 let s3=advance(s2,a,b,c);s3=updateAdaptiveSnapshot(s3,{snapshot:c,reviewed:{cfg,latest:{t:31}},preview,reviewHash:'d'.repeat(64),now:32000});
 assert.equal(s3.rows[7].rebalances,1);assert.equal(s3.rows[7].mapping.rows[0].binId,2);assert.equal(s3.rows[7].claimedFeeXRaw,'18');assert.equal(s3.rows[7].points.at(-1).feeXRaw,'0');
 const s4=advanceSnapshotExperiment(s3,{opening:a,previous:c,snapshot:d,backendHash,now:1000000});
 assert.equal(s4.rows[7].points.at(-1).feeXRaw,'4');assert.equal(s4.rows[7].claimedFeeXRaw,'18');assert.equal(s4.rows[7].points.at(-1).excessVsHoldYRaw,'22');assert.equal(s4.rows[1].points.at(-1).feeXRaw,'27');
});

test('long experiment retains bounded recent points and lifetime drawdown',()=>{const {a,state}=fixture(),b=snapshot(2),c=snapshot(3);const row=state.rows[1];row.points=Array.from({length:1000},()=>({...row.points[0]}));row.maxDrawdownBps=777;state.snapshotCount=1000;const s2=advance(state,a,a,b);assert.equal(s2.snapshotCount,1001);assert.equal(s2.rows[1].points.length,1000);assert.equal(s2.rows[1].pointsDropped,1);assert.equal(s2.rows[1].maxDrawdownBps,777);const s3=advance(s2,a,b,c);assert.equal(s3.rows[1].pointsDropped,2);assert.equal(s3.rows[1].maxDrawdownBps,777)});
test('exit retains lifetime fee totals separately from current fee balance',()=>{const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n),s2=advance(state,a,a,b,true),s3=advance(s2,a,b,c);assert.equal(s3.rows[1].claimedFeeXRaw,'9');assert.equal(s3.rows[1].points.at(-1).feeXRaw,'0');assert.equal(s3.rows[1].points.at(-1).excessVsHoldYRaw,'8')});

test('adaptive action cost cannot push a new open segment through frozen risk limit',()=>{const {a,state}=fixture(),b=snapshot(2),c=snapshot(3);state.adaptiveRequest={goal:'balanced'};state.policy.maxLossSolRaw='1';const cfg={executionDelaySeconds:1,maxRebalances:8,maxTurnoverSol:30,minSolReserve:0,maxBinShare:.1},preview={status:'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED',selected:{feasible:true,action:{type:'REPOSITION',spec:{width:1}},estimatedOperationCostSol:.001,allocation:{bins:[{binId:2,meme:.5,sol:0}]}}};let s2=advance(state,a,a,b);s2=updateAdaptiveSnapshot(s2,{snapshot:b,reviewed:{cfg,latest:{t:21}},preview,reviewHash:'e'.repeat(64),now:22000});let s3=advance(s2,a,b,c);s3=updateAdaptiveSnapshot(s3,{snapshot:c,reviewed:{cfg,latest:{t:31}},preview,reviewHash:'d'.repeat(64),now:32000});assert.equal(s3.rows[7].adaptiveReason,'PAPER_ADAPTIVE_POST_ACTION_RISK_LIMIT');assert.equal(s3.rows[7].mapping.rows[0].binId,1);assert.equal(s3.rows[7].points.at(-1).costYRaw,'0')});

test('fee basis is frozen and opening cost alone cannot breach risk limit',()=>{const {a,state}=fixture();assert.equal(state.feeBasis,'MIDPOINT_SUPPLY_INTERVAL_FEE_PROXY_V2');assert.throws(()=>advance({...state,feeBasis:'UNDILUTED'},a,a,snapshot(2)));const r=state.rows[1].mapping;const row={family:'spot',feasible:true,action:{type:'OPEN'},allocation:{lowerBinId:1,upperBinId:1,bins:[{binId:1,meme:1,sol:0}]}},report={schemaVersion:1,pool,status:'RESEARCH_DIAGNOSTIC_UNVERIFIED',executionReady:false,decisionReady:false,protocolExact:false,calibrated:false,market:{...a.identity,decimalsX:6,decimalsY:9},planPreview:{status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',scope:'NEW_POSITION_ONLY',executionReady:false,decisionReady:false,families:['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'].map(family=>({family,best:family==='spot'?row:family==='NO_LP'?{family,feasible:true,action:{type:'NO_LP'}}:null})),selected:row}};const opened=openSnapshotExperiment({id:'risk',snapshot:a,report,budget:{memeRaw:'2000000',solRaw:'1000000000',allowDispose:false,minSolReserve:0,operationCostSol:.001},policy:{...state.policy,maxLossSolRaw:'1'},backendHash,frozenAt:12000});assert.equal(opened.rows[1].reason,'PAPER_SNAPSHOT_OPENING_RISK_LIMIT')});

test('synthetic high/low marks and reversal preserve signed alpha and one exit cost',()=>{
 const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n),d=snapshot(4,3n);
 for(const x of [a,b,c,d]){x.bins.arrays[0].bins[2].priceQ64Raw=String(Q*10n);x.bins.arrays[0].bins[69].binId=-1;x.bins.arrays[0].bins[69].priceQ64Raw=String(Q/100n)}
 b.identity.activeId=b.bins.activeId=2;c.identity.activeId=c.bins.activeId=-1;
 b.bins.arrays[0].bins[1].amountXRaw='0';b.bins.arrays[0].bins[1].amountYRaw='10000000';
 state.policy.maxDrawdownBps=1;state.rows[7].pendingAdaptive={action:'REPOSITION'};
 const s2=advance(state,a,a,b),s3=advance(s2,a,b,c),s4=advance(s3,a,c,d);
 assert.equal(s2.rows[1].points.at(-1).excessVsHoldYRaw,'-8999910');
 assert.equal(s3.rows[1].status,'EXITED_PROXY');assert.equal(s3.rows[7].pendingAdaptive,null);
 assert.equal(s4.rows[1].points.at(-1).costYRaw,'1');assert.equal(s4.rows[1].points.at(-1).feeXRaw,'0');
 assert.equal(s4.rows[0].points.at(-1).pnlYRaw,'0');assert.equal(s4.pnlReady,false)
});
test('fee regression, missing bin, supply collapse and order state block rather than invent returns',()=>{
 for(const kind of ['growth','missing','supply','orders']){
  const {a,state}=fixture(),b=snapshot(2,2n),c=snapshot(3,3n);const s2=advance(state,a,a,b);s2.rows[7].pendingAdaptive={action:'REPOSITION'};
  if(kind==='growth')c.bins.arrays[0].bins[1].feeXPerTokenRaw=String(Q);
  if(kind==='missing')c.bins.arrays[0].bins[1].binId=100;
  if(kind==='supply')c.bins.arrays[0].bins[1].liquiditySupplyRaw=String(Q);
  if(kind==='orders')c.bins.arrays[0].bins[1].openOrderAmountRaw='1';
  const s3=advance(s2,a,b,c);assert.equal(s3.rows[1].status,'BLOCKED');assert.equal(s3.rows[7].pendingAdaptive,null);assert.equal(s3.rows[1].points.length,2);assert.equal(s3.rows[0].points.length,3)
 }
});
test('capture after service gap preserves blocked paths and HODL',()=>{const {a,state}=fixture(),b=snapshot(2),c=snapshot(3);b.proof.requestedAt=new Date(300000).toISOString();b.proof.receivedAt=new Date(301000).toISOString();c.proof.requestedAt=new Date(310000).toISOString();c.proof.receivedAt=new Date(311000).toISOString();const s2=advance(state,a,a,b),s3=advance(s2,a,b,c);assert.equal(s3.gapCount,1);assert.equal(s3.rows[1].status,'BLOCKED');assert.equal(s3.rows[0].points.length,3)});

test('fractional growth survives multiple samples without interval fee rounding loss',()=>{const {a,state}=fixture(),b=snapshot(2),c=snapshot(3);b.bins.arrays[0].bins[1].feeXPerTokenRaw=String(Q/16n);c.bins.arrays[0].bins[1].feeXPerTokenRaw=String(Q/8n);const s2=advance(state,a,a,b),s3=advance(s2,a,b,c);assert.equal(s2.rows[1].points.at(-1).feeXRaw,'0');assert.equal(s3.rows[1].points.at(-1).feeXRaw,'1')});

test('adaptive can start flat and later open from a newer feasible model plan without resetting HODL baseline',()=>{
 const {a,state}=fixture(),b=snapshot(2),c=snapshot(3),d=snapshot(4,1n);
 state.adaptiveRequest={goal:'balanced'};
 state.rows[7]={...structuredClone(state.rows[0]),mode:'adaptive',mapping:null};
 const cfg={executionDelaySeconds:1,operationCostSol:0,maxRebalances:8,maxTurnoverSol:30,minSolReserve:0,maxBinShare:.1};
 const preview={status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',selected:{feasible:true,action:{type:'OPEN'},allocation:{bins:[{binId:1,meme:1,sol:0}]}}};
 let s2=advance(state,a,a,b);s2=updateAdaptiveSnapshot(s2,{snapshot:b,reviewed:{cfg,latest:{t:21}},preview,reviewHash:'e'.repeat(64),now:22000});
 assert.equal(s2.rows[7].status,'HOLD_ONLY');assert.equal(s2.rows[7].pendingAdaptive.action,'OPEN');
 let s3=advance(s2,a,b,c);s3=updateAdaptiveSnapshot(s3,{snapshot:c,reviewed:{cfg,latest:{t:31}},preview,reviewHash:'d'.repeat(64),now:32000});
 assert.equal(s3.rows[7].status,'OPEN_PROXY');assert.equal(s3.rows[7].rebalances,0);assert.equal(s3.rows[7].initialNavYRaw,state.rows[0].initialNavYRaw);assert.equal(s3.rows[7].points.length,3);
 const s4=advance(s3,a,c,d);assert.equal(s4.rows[7].points.at(-1).feeXRaw,'9');assert.equal(s4.rows[7].points.at(-1).excessVsHoldYRaw,'9');
});

test('adaptive voluntary exit settles fees once, observes cooldown, then reenters without resetting capital',()=>{
 const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n),d=snapshot(4,3n),e=snapshot(5,4n),f=snapshot(6,5n),g=snapshot(7,6n);
 state.adaptiveRequest={goal:'balanced'};
 const cfg={executionDelaySeconds:1,operationCostSol:0,cooldownSeconds:15,maxRebalances:8,maxTurnoverSol:30,minSolReserve:0,maxBinShare:.1};
 const remove={status:'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED',selected:{feasible:true,action:{type:'REMOVE_AND_HOLD'},estimatedOperationCostSol:0}};
 const open={status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',selected:{feasible:true,action:{type:'OPEN'},allocation:{bins:[{binId:1,meme:1,sol:0}]}}};
 const update=(s,x,p)=>updateAdaptiveSnapshot(s,{snapshot:x,reviewed:{cfg,latest:{t:x.identity.slot*10+1}},preview:p,reviewHash:'e'.repeat(64),now:x.identity.slot*10000+2000});
 let s2=update(advance(state,a,a,b),b,remove),s3=update(advance(s2,a,b,c),c,remove);
 assert.equal(s3.rows[7].status,'HOLD_ONLY');assert.equal(s3.rows[7].mapping,null);assert.equal(s3.rows[7].claimedFeeXRaw,'18');assert.equal(s3.rows[7].entries,1);
 let s4=update(advance(s3,a,c,d),d,open);assert.equal(s4.rows[7].pendingAdaptive,null);assert.equal(s4.rows[7].adaptiveReason,'PAPER_ADAPTIVE_REENTRY_COOLDOWN');
 let s5=update(advance(s4,a,d,e),e,open),s6=update(advance(s5,a,e,f),f,open);
 assert.equal(s6.rows[7].status,'OPEN_PROXY');assert.equal(s6.rows[7].entries,2);assert.equal(s6.rows[7].rebalances,1);assert.equal(s6.rows[7].claimedFeeXRaw,'18');assert.equal(s6.rows[7].initialNavYRaw,state.rows[0].initialNavYRaw);assert.equal(s6.rows[7].turnoverYRaw,'2000000');
 const s7=advance(s6,a,f,g);assert.equal(s7.rows[7].points.at(-1).feeXRaw,'9');assert.equal(s7.rows[7].points.at(-1).excessVsHoldYRaw,'27');
});
test('adaptive risk exit cannot reenter even with later profitable preview',()=>{
 const {a,state}=fixture(),b=snapshot(2),c=snapshot(3);
 state.adaptiveRequest={goal:'balanced'};state.policy.maxLossSolRaw='1';b.bins.arrays[0].bins[1].amountXRaw='9000000';
 const s2=advance(state,a,a,b);assert.equal(s2.rows[7].status,'EXITED_PROXY');
 const s3=advance(s2,a,b,c);const result=updateAdaptiveSnapshot(s3,{snapshot:c,reviewed:{cfg:{},latest:{t:31}},preview:{},reviewHash:'e'.repeat(64),now:32000});
 assert.equal(result.rows[7].status,'EXITED_PROXY');
});

test('advancing uses only the preceding capture and frozen original baseline',async()=>{const {a,state}=fixture(),b=snapshot(2),c=snapshot(3);const second=advance(state,a,a,b),calls=[];const third=await advancePaperCapture(second,{load:async path=>{calls.push(path);assert.equal(path,b.proof.path);return b},snapshot:c,backendHash,now:1000000});assert.deepEqual(calls,[b.proof.path]);assert.equal(third.rows[0].initialNavYRaw,state.rows[0].initialNavYRaw);assert.equal(third.opening.priceQ64Raw,state.opening.priceQ64Raw);assert.throws(()=>advanceSnapshotExperiment({...second,opening:{...second.opening,priceQ64Raw:String(2n*Q)}},{previous:b,snapshot:c,backendHash,now:1000000}),/PAPER_BASELINE_CHANGED/)});

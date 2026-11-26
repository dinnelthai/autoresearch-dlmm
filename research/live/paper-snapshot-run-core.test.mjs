import test from 'node:test';
import assert from 'node:assert/strict';
import {IntegerKernel as K} from '../integer.mjs';
import {openSnapshotExperiment,advanceSnapshotExperiment} from './paper-snapshot-run-core.mjs';
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
test('equal capital, cumulative fees not double counted, no LP benchmark',()=>{const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n);assert.equal(state.rows[1].status,'OPEN_PROXY');const s2=advance(state,a,a,b),s3=advance(s2,a,b,c);assert.equal(s3.rows[1].points.at(-1).feeXRaw,'20');assert.equal(s3.rows[1].points.at(-1).excessVsHoldYRaw,'20');assert.equal(s3.rows[0].points.at(-1).pnlYRaw,'0');assert.equal(s3.pnlReady,false)});
test('virtual exit books inventory and fees once and then holds wallet',()=>{const {a,state}=fixture(),b=snapshot(2,1n),c=snapshot(3,2n),s2=advance(state,a,a,b,true),s3=advance(s2,a,b,c);assert.equal(s2.rows[1].status,'EXITED_PROXY');assert.equal(s3.rows[1].points.at(-1).feeXRaw,'0');assert.equal(s3.rows[1].points.at(-1).excessVsHoldYRaw,'9')});
test('changed supply or gap blocks affected strategy permanently',()=>{const {a,state}=fixture(),b=snapshot(2,1n);b.bins.arrays[0].bins[1].liquiditySupplyRaw=String(101n*Q);const s2=advance(state,a,a,b),s3=advance(s2,a,b,snapshot(3,2n));assert.equal(s2.rows[1].status,'BLOCKED');assert.equal(s3.rows[1].points.length,1);assert.equal(s3.rows[0].status,'HOLD_ONLY');const c=snapshot(2,1n);c.proof.requestedAt=new Date(300000).toISOString();c.proof.receivedAt=new Date(301000).toISOString();assert.equal(advance(state,a,a,c).rows[1].reason,'PAPER_SNAPSHOT_GAP')});
test('reject stale or pre-freeze capture and altered checkpoint scope',()=>{const {a,state}=fixture(),b=snapshot(2);assert.throws(()=>advance(state,a,a,a));b.proof.requestedAt=new Date(11000).toISOString();assert.throws(()=>advance(state,a,a,b));assert.throws(()=>advance({...state,backendHash:'e'.repeat(64)},a,a,snapshot(2)))});

test('risk loss triggers proxy exit with one declared cost',()=>{const {a,state}=fixture(),b=snapshot(2);state.policy.maxLossSolRaw='1';b.bins.arrays[0].bins[1].amountXRaw='9000000';const s2=advance(state,a,a,b);assert.equal(s2.rows[1].status,'EXITED_PROXY');assert.equal(s2.rows[1].reason,'RISK_VIRTUAL_EXIT');assert.equal(s2.rows[1].points.at(-1).costYRaw,'1');assert.equal(s2.rows[1].points.at(-1).pnlYRaw,'-100001')});

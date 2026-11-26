// Synthetic software test only. Never use this fixture as a real evidence bundle.
import assert from 'node:assert/strict';
import {Engine as E} from '../engine.mjs';
import {validateFreeze,validateSample} from './shadow-contract.mjs';
import {replayWindow} from './shadow-policy.mjs';
const proof={path:'data/test-only',sha256:'0'.repeat(64)},pool='A'.repeat(32),mintX='B'.repeat(32),mintY='C'.repeat(32);
const cfg=E.config({maxInventoryTokens:1e6,maxLossSol:10,minDepthSol:1});
const w={id:'fixture',group:'fixture',split:'test',pool,mintX,mintY,start:100,end:280,request:{entry:'sol',pool,meme:0,sol:10,goal:'balanced',horizonSeconds:480,allowDispose:false},config:cfg};
const market=(t,id)=>({id:'m'+t,type:'MARKET',pool,t,observedAt:t,availableAt:t,activeId:id,evidence:proof,tokenSafe:true,holderShare:.25,holderOutflow:0,buyImbalance:0,flowSol:32,exitDepth:30,references:['D','E'].map((x,i)=>({pool:x.repeat(32),mintX,mintY,venue:'v'+i,source:'s'+i,price:E.price(cfg,id),depth:80,observedAt:t,availableAt:t,evidence:proof}))});
const s={id:w.id,pool,mintX,mintY,start:100,end:280,source:'REVIEWED_CHAIN_EVIDENCE',coverage:{status:'DECLARED_RECONCILED_COMPLETE',evidence:proof,gaps:[]},events:[market(100,0),{id:'p',type:'POOL_STATE',pool,t:100,observedAt:100,availableAt:100,evidence:proof,bins:Array.from({length:21},(_,i)=>({id:i-10,externalLiquiditySol:100}))},market(160,1),{id:'s',type:'SWAP',pool,t:161,observedAt:161,availableAt:161,evidence:proof,granularity:'PER_BIN_RECONCILED',side:'LP_BUY',bin:0,baseQty:100,externalLiquiditySol:100,mmFeeX:1,mmFeeY:0,slot:1,txIndex:0,instructionIndex:0,fillIndex:0,signature:'fixture'},market(220,0),market(280,1)]};
const f={schemaVersion:1,policy:'T09_T10_RESEARCH_PREVIEW_V1',frozenAt:99,codeHashes:Object.fromEntries(['engine','plans','management','contract','policy','runner','summary'].map(k=>[k,'0'.repeat(64)])),windows:[w]};
validateFreeze(f);validateSample(w,s,cfg);
const out=replayWindow(w,s);
assert.equal(out.runs.length,6);
assert.ok(out.runs.every(r=>r.initialNavSol===10));
assert.equal(out.runs.find(r=>r.mode==='hodl').pnlSol,0);
for(const mutate of [x=>x.events[3].granularity='AGGREGATE',x=>x.events[2].references[0].availableAt=999,x=>x.coverage.gaps.push('gap')]){
 const bad=JSON.parse(JSON.stringify(s));mutate(bad);assert.throws(()=>validateSample(w,bad,cfg));
}
assert.throws(()=>validateFreeze({...f,windows:[w,{...w,id:'overlap'}]}));
assert.throws(()=>validateFreeze({...f,windows:[w,{...w,id:'split',split:'train',start:300,end:500}]}));
console.log('T11 synthetic software checks passed; no live acceptance.');

const other={...w,id:'other',pool:'F'.repeat(32),mintX:'G'.repeat(32),group:'other',split:'train',start:100,end:150,request:{...w.request,pool:'F'.repeat(32)}};
assert.throws(()=>validateFreeze({...f,windows:[w,other]}),/chronological split/);
validateFreeze({...f,frozenAt:0,windows:[w,{...other,start:1,end:90}]});
assert.throws(()=>validateFreeze({...f,windows:[{...w,config:{...w.config,forecastHorizonSeconds:999}}]}),/matching horizon/);
assert.throws(()=>validateFreeze({...f,windows:[w,{...other,pool:w.pool,request:{...other.request,pool:w.pool},start:300,end:400}]}),/pool identity/);

// Forward-only research checkpoints; no wallet, signing, funding, or transaction broadcast.
// A cumulative bounded event prefix is replayed deterministically on each update, not patched in place.
import {Engine} from '../engine.mjs';
import {validateSample} from './shadow-contract.mjs';
import {PAPER_MODES,replayWindow} from './shadow-policy.mjs';
import {assert,hash,poolAddress,finite} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
const digest=x=>sha(JSON.stringify(x));
export function paperConfig(c){
 assert(c?.schemaVersion===1&&typeof c.id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(c.id)&&poolAddress(c.pool)&&poolAddress(c.mintX)&&poolAddress(c.mintY)&&c.mintX!==c.mintY&&Number.isSafeInteger(c.start)&&c.start>=0,'PAPER_CONFIG_INVALID');
 const r=c.request;assert(r?.pool===c.pool&&['holding','sol'].includes(r.entry)&&r.allowDispose===false&&finite(r.meme,0)&&finite(r.sol,0)&&(r.entry==='sol'?r.meme===0&&r.sol>0:r.meme>0)&&!Object.hasOwn(r,'initialPrice')&&!Object.hasOwn(r,'positionBins')&&!Object.hasOwn(r,'pendingFeeX')&&!Object.hasOwn(r,'pendingFeeY')&&['balanced','defensive','growth'].includes(r.goal)&&Number.isSafeInteger(r.horizonSeconds)&&r.horizonSeconds>0,'PAPER_CAPITAL_INVALID');
 assert(c.config&&Object.keys(Engine.DEFAULTS).every(k=>Object.hasOwn(c.config,k))&&c.config.forecastHorizonSeconds===r.horizonSeconds,'PAPER_FROZEN_PARAMETERS_REQUIRED');
 const cfg=Engine.requestConfig(r,c.config);assert(cfg.maxBinShare<=.1,'PAPER_SMALL_PARTICIPATION_REQUIRED');
 return {window:{id:c.id,group:c.id,split:'test',pool:c.pool,mintX:c.mintX,mintY:c.mintY,start:c.start,request:r,config:cfg},configHash:digest(c)};
}
export function paperEvidenceRefs(sample){
 const refs=new Map();
 for(const r of [sample.coverage?.evidence,...sample.events.flatMap(e=>[e.evidence,...(e.references??[]).map(r=>r.evidence)])]){
  assert(typeof r?.path==='string'&&r.path.startsWith('data/')&&r.path.length<=1024&&hash(r.sha256)&&(!refs.has(r.path)||refs.get(r.path)===r.sha256),'PAPER_EVIDENCE_CONFLICT');refs.set(r.path,r.sha256);
 }
 assert(refs.size<=5000,'PAPER_EVIDENCE_BUDGET');return [...refs].map(([path,sha256])=>({path,sha256}));
}
export function preparePaper(config,sample,{previous=null,backendHash,now=Math.floor(Date.now()/1000)}={}){
 const {window,configHash}=paperConfig(config);
 assert(hash(backendHash)&&Number.isSafeInteger(sample?.end)&&sample.end<=now&&sample.end>window.start&&Array.isArray(sample.events)&&sample.events.length<=5000,'PAPER_WINDOW_INVALID');
 window.end=sample.end;
 const counts=validateSample(window,sample,window.config);
 // Reference artifacts must be distinct inside each MARKET event; structural checks are not independent review.
 for(const e of sample.events)if(e.type==='MARKET'){
  assert(new Set(e.references.map(r=>r.evidence.path)).size===e.references.length&&new Set(e.references.map(r=>r.evidence.sha256)).size===e.references.length,'PAPER_REFERENCE_ARTIFACT_REUSED');
  assert(Number.isSafeInteger(e.flowWindowSeconds)&&e.flowWindowSeconds>0,'PAPER_FLOW_WINDOW_REQUIRED');
 }
 const eventHashes=sample.events.map(digest),refs=paperEvidenceRefs(sample);
 if(previous){
  const {checkpointHash,...body}=previous;assert(hash(checkpointHash)&&digest(body)===checkpointHash&&previous.scope==='PAPER_RESEARCH_CHECKPOINT'&&previous.configHash===configHash&&previous.backendHash===backendHash&&Array.isArray(previous.eventHashes)&&previous.eventHashes.length<=eventHashes.length&&previous.eventHashes.every((h,i)=>h===eventHashes[i])&&previous.end<=sample.end,'PAPER_CHECKPOINT_PREFIX_OR_CODE_CHANGED');
  assert(previous.eventHashes.length===eventHashes.length?previous.end===sample.end:previous.end<sample.end&&sample.events[previous.eventHashes.length].t>previous.end,'PAPER_WINDOW_BOUNDARY_CHANGED');
 }
 return {window,configHash,eventHashes,refs,counts,backendHash,unchanged:!!previous&&previous.eventHashes.length===eventHashes.length};
}
export function calculatePaper(prepared,sample,{generatedAt=Date.now()}={}){
 const {window,configHash,eventHashes,counts,backendHash}=prepared;
 assert(eventHashes.length===sample.events.length&&eventHashes.every((h,i)=>h===digest(sample.events[i])),'PAPER_SAMPLE_CHANGED');
 const result=replayWindow(window,sample,{modes:PAPER_MODES,paper:true});
 const baseline=result.runs.find(r=>r.mode==='hodl');
 const rows=result.runs.map(r=>({...r,excessVsHoldSol:Number.isFinite(r.pnlSol)&&Number.isFinite(baseline.pnlSol)?r.pnlSol-baseline.pnlSol:null,actualPnl:false}));
 const report={schemaVersion:1,scope:'VIRTUAL_CAPITAL_ONLY',status:'PAPER_REPLAY_UNVERIFIED',pool:window.pool,mintX:window.mintX,mintY:window.mintY,start:window.start,end:window.end,generatedAt,counts,rows,modelInputReady:false,decisionReady:false,executionReady:false,protocolExact:false,calibrated:false,pnlReady:false,coverageIndependentlyVerified:false,limitations:['Declared reviewed cumulative normalized event prefix; hashes verify bytes, not semantic or complete coverage.','Virtual per-bin participation proxy, declared costs, no actual positions or realized PnL.','No signing, transfer, transaction broadcast, implicit spot purchase or disposal.','Bounded to 5000 events per experiment; checkpoints recompute full prefix rather than restoring incremental model state.']};
 const body={schemaVersion:1,scope:'PAPER_RESEARCH_CHECKPOINT',id:window.id,configHash,backendHash,end:window.end,eventHashes,report};return {...body,checkpointHash:digest(body)};
}

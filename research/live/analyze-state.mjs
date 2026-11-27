// T08: read-only research bridge. Never grants live decision or execution readiness.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,verifiedEvidence} from './evidence-digest.mjs';
import {parseArgs} from 'node:util';
import {Engine} from '../engine.mjs';
import {IntegerKernel as K} from '../integer.mjs';
import {rawHuman,extractMarket} from './engine-input.mjs';
import {previewPlans} from './preview-plans.mjs';
import {previewManagement} from './preview-management.mjs';
import {reviewedObservations} from './review-observations.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=resolve(ROOT,'data');
import {assert,blockAnalysis,errorCode,finite} from './research-contract.mjs';
function dataPath(path){assert(typeof path==='string','missing evidence path');const p=resolve(ROOT,path),rel=relative(DATA,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'evidence must be under data/');return p;}
const localRead=path=>readFile(dataPath(path));
async function verifyCapture(m,readData){
 const dir=m.capture,manifest=JSON.parse(await readData(join(dir,'manifest.json')));
 assert(manifest.pool===m.pool&&manifest.contextSlot===m.slot&&manifest.commitment==='finalized'&&manifest.raw?.sha256===m.rawHash&&manifest.raw.file==='accounts.json','capture manifest mismatch');
 const b=await readData(join(dir,'accounts.json'));assert(sha(b)===m.rawHash,'capture raw hash mismatch');
 const rpc=JSON.parse(b);assert(rpc.jsonrpc==='2.0'&&rpc.id===1&&!rpc.error&&rpc.result?.context?.slot===m.slot,'capture context mismatch');
 // This checks archive integrity, not independently decoded fields or chain authenticity.
}
// Shared service and CLI analysis; inputs remain pinned to their captured market.
export async function analyzeState({state,req,review,plans=false,management=false,readData=localRead}){
 const evidence=(path,digest)=>verifiedEvidence(readData,path,digest,'EVIDENCE_HASH_MISMATCH');
 const report={schemaVersion:1,pool:state.pool??null,sequence:state.sequence??null,status:'BLOCKED',decisionReady:false,executionReady:false,calibrated:false,protocolExact:false,limitations:['Read-only research diagnostic; not live recommendation, execution, or actual PnL.','Archive hashes and declared review metadata do not prove real-world correctness.','No synthetic observations or aggregate-Swap-to-bin conversion.'],gaps:[]};
 try{
  const m=extractMarket(state);await verifyCapture(m,readData);
  report.market={slot:m.slot,rawHash:m.rawHash,activeId:m.activeId,binStep:m.binStep,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,decimalsY:m.decimalsY,binCount:m.bins.length,status:'ARCHIVE_INTEGRITY_CHECKED_UNVERIFIED'};
  const active=m.bins.find(b=>b.binId===m.activeId);
  report.market.activeBinPriceQ64Raw=active?.priceQ64Raw??null;
  if(!req||!review){report.gaps.push('REVIEWED_MARKET_EVIDENCE_AND_EXPLICIT_CAPITAL_REQUEST_REQUIRED');return report;}
  const {asOf,cfg,observations,latest}=await reviewedObservations({m,req,review,evidence});
  const request={pool:m.pool,entry:req.entry,meme:rawHuman(req.memeRaw,m.decimalsX),sol:rawHuman(req.solRaw,m.decimalsY),initialPrice:latest.ref.price,goal:req.goal,horizonSeconds:req.horizonSeconds,allowDispose:false};
  const own=new Map();let positionReport=null;
  if(req.entry==='position'){
   const stream=state.streams['position:'+req.position],p=stream?.evidence?.report,snapshot=p?.snapshot;
   assert(stream?.status==='CAPTURED_UNVERIFIED'&&p?.status==='POSITION_CALCULATED_UNVERIFIED'&&p.position===req.position&&p.pool===m.pool&&p.slot===m.slot&&p.rawHash===m.rawHash,'position and market must be same raw capture/slot');
   assert(snapshot?.pool===m.pool&&snapshot.position===req.position&&snapshot.slot===m.slot&&snapshot.decimalsX===m.decimalsX&&snapshot.decimalsY===9&&snapshot.binStep===String(m.binStep)&&snapshot.tokenOrientation==='MEME_X_SOL_Y'&&snapshot.tokenExtensions===false,'position snapshot mismatch');
   positionReport=p;
   const calc=JSON.parse(K.stringify(K.reconcile(snapshot)));
   for(const r of calc.rows)own.set(r.binId,r);
   request.positionBins=calc.rows.map(r=>({id:r.binId,x:rawHuman(r.principalX,m.decimalsX),y:rawHuman(r.principalY,9)}));
   request.pendingFeeX=rawHuman(calc.totals.feeX,m.decimalsX);request.pendingFeeY=rawHuman(calc.totals.feeY,9);
  }
  const model=Engine.newState(request,cfg);
  const external=[];
  for(const b of m.bins){
   const r=own.get(b.binId),x=BigInt(b.amountXRaw)-BigInt(r?.principalX??'0'),y=BigInt(b.amountYRaw)-BigInt(r?.principalY??'0');
   assert(x>=0n&&y>=0n,'own position exceeds observed pool principal');
   if(x===0n&&y===0n)continue;
   const px=Engine.price(cfg,b.binId),liquidity=rawHuman(x.toString(),m.decimalsX)*px+rawHuman(y.toString(),9);
   assert(finite(liquidity,Number.MIN_VALUE),'invalid bin liquidity');external.push({id:b.binId,externalLiquiditySol:liquidity});
  }
  assert([...own.keys()].every(id=>m.bins.some(b=>b.binId===id)),'position bin absent from market coverage');
  // Earlier observations warm up classification only, never replay against current position.
  model.history=observations.slice(0,-1);
  Engine.event(model,cfg,{...latest,id:'market:'+latest.id});
  if(external.length)Engine.event(model,cfg,{type:'POOL_STATE',id:'pool:'+m.rawHash,t:latest.t,bins:external});
  const regime=Engine.classify(model,cfg),risk=Engine.risk(model,cfg,latest.ref.price);
  report.status='RESEARCH_DIAGNOSTIC_UNVERIFIED';report.asOf=asOf;report.observedAt=latest.t;report.capitalScope=req.capitalScope;
  report.referencePriceSolPerMeme=latest.ref.price;report.model={regime,risk,inventory:Engine.balances(model),navEstimateSol:Engine.nav(model,latest.ref.price),externalBins:external.length};
  report.limitations.push('User-declared capital is not verified wallet balance. Prior reference observations are feature warmup, not historical PnL.','Model risk and NAV are floating-point estimates; forecast/fees/risk parameters are not calibrated. No transaction produced.');
  if(plans){
   const required=['maxInventoryRatio','maxInventoryTokens','minSolReserve','maxLossSol','stressDrop','maxBinShare','operationCostSol','feeBps','protocolShare','slippageBps'];
   const missing=required.filter(k=>!Object.hasOwn(req.riskConfig??{},k));
   if(missing.length)report.planPreview={status:'BLOCKED',reason:'EXPLICIT_RISK_AND_COST_PARAMETERS_REQUIRED',missing,decisionReady:false,executionReady:false};
   else report.planPreview=previewPlans(model,cfg,m,{asOf});
  }
  if(management){
   const required=['maxInventoryRatio','maxInventoryTokens','minSolReserve','maxLossSol','stressDrop','maxBinShare','operationCostSol','feeBps','protocolShare','slippageBps','cooldownSeconds','maxRebalances','maxTurnoverSol'];
   const missing=required.filter(k=>!Object.hasOwn(req.riskConfig??{},k));
   if(req.entry!=='position'||!positionReport)report.managementPreview={status:'BLOCKED',reason:'EXISTING_POSITION_REQUIRED',decisionReady:false,executionReady:false};
   else if(missing.length)report.managementPreview={status:'BLOCKED',reason:'EXPLICIT_RISK_AND_COST_PARAMETERS_REQUIRED',missing,decisionReady:false,executionReady:false};
   else{
    let operations=null;
    if(review.operations){const o=review.operations;assert(o.position===req.position&&o.pool===m.pool&&o.asOf===asOf,'operation evidence identity mismatch');await evidence(o.evidence?.path,o.evidence?.sha256);operations=o;}
    report.managementPreview=previewManagement(model,cfg,m,{asOf,operations,position:positionReport});
   }
  }
 }catch(e){blockAnalysis(report,errorCode(e,'RESEARCH_INPUT_OR_CALCULATION_FAILED'));}
 return report;
}
async function main(){
 const {values}=parseArgs({options:{state:{type:'string'},request:{type:'string'},review:{type:'string'},plans:{type:'boolean'},management:{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/analyze-state.mjs --state data/live/POOL/state.json [--request data/analysis-request.json --review data/research-evidence.json --plans | --management]');return;}
 assert(values.state,'state path required');assert(!(values.plans&&values.management),'select one preview mode');
 const state=JSON.parse(await readFile(dataPath(values.state),'utf8'));
 const req=values.request&&values.review?JSON.parse(await localRead(values.request)):null;
 const review=req?JSON.parse(await localRead(values.review)):null;
 const report=await analyzeState({state,req,review,plans:values.plans,management:values.management});
 console.log(JSON.stringify(report,null,2));
 if(report.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||(values.plans&&report.planPreview?.status!=='RESEARCH_PLAN_PREVIEW_UNVERIFIED')||(values.management&&report.managementPreview?.status!=='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED'))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('T08 blocked: check local state and configuration');process.exitCode=1;});

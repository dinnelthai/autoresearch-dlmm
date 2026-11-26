// T08: read-only research bridge. Never grants live decision or execution readiness.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {Engine} from '../engine.mjs';
import {IntegerKernel as K} from '../integer.mjs';
import {rawHuman,checkTime,extractMarket} from './engine-input.mjs';
import {previewPlans} from './preview-plans.mjs';
import {previewManagement} from './preview-management.mjs';
import {distinctReferenceArtifacts} from './quote-evidence.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=resolve(ROOT,'data');
const assert=(v,m)=>{if(!v)throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const finite=(v,min,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function dataPath(path){assert(typeof path==='string','missing evidence path');const p=resolve(ROOT,path),rel=relative(DATA,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'evidence must be under data/');return p;}
async function evidence(path,hash){assert(/^[0-9a-f]{64}$/.test(hash),'evidence hash required');const b=await readFile(dataPath(path));assert(sha(b)===hash,'evidence hash mismatch');return b;}
async function verifyCapture(m){
 const dir=dataPath(m.capture),manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
 assert(manifest.pool===m.pool&&manifest.contextSlot===m.slot&&manifest.commitment==='finalized'&&manifest.raw?.sha256===m.rawHash&&manifest.raw.file==='accounts.json','capture manifest mismatch');
 const b=await readFile(join(dir,'accounts.json'));assert(sha(b)===m.rawHash,'capture raw hash mismatch');
 const rpc=JSON.parse(b);assert(rpc.jsonrpc==='2.0'&&rpc.id===1&&!rpc.error&&rpc.result?.context?.slot===m.slot,'capture context mismatch');
 // This checks archive integrity, not independently decoded fields or chain authenticity.
}
async function main(){
 const {values}=parseArgs({options:{state:{type:'string'},request:{type:'string'},review:{type:'string'},plans:{type:'boolean'},management:{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/analyze-state.mjs --state data/live/POOL/state.json [--request data/analysis-request.json --review data/research-evidence.json --plans | --management]');return;}
 assert(values.state,'state path required');assert(!(values.plans&&values.management),'select one preview mode');
 const state=JSON.parse(await readFile(dataPath(values.state),'utf8'));
 const report={schemaVersion:1,pool:state.pool??null,sequence:state.sequence??null,status:'BLOCKED',decisionReady:false,executionReady:false,calibrated:false,protocolExact:false,limitations:['Read-only research diagnostic; not live recommendation, execution, or actual PnL.','Archive hashes and declared review metadata do not prove real-world correctness.','No synthetic observations or aggregate-Swap-to-bin conversion.'],gaps:[]};
 const output=()=>{console.log(JSON.stringify(report,null,2));if(report.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||(values.plans&&report.planPreview?.status!=='RESEARCH_PLAN_PREVIEW_UNVERIFIED')||(values.management&&report.managementPreview?.status!=='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED'))process.exitCode=1;};
 try{
  const m=extractMarket(state);await verifyCapture(m);
  report.market={slot:m.slot,rawHash:m.rawHash,activeId:m.activeId,binStep:m.binStep,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,decimalsY:m.decimalsY,binCount:m.bins.length,status:'ARCHIVE_INTEGRITY_CHECKED_UNVERIFIED'};
  const active=m.bins.find(b=>b.binId===m.activeId);
  report.market.activeBinPriceQ64Raw=active?.priceQ64Raw??null;
  if(!values.request||!values.review){report.gaps.push('REVIEWED_MARKET_EVIDENCE_AND_EXPLICIT_CAPITAL_REQUEST_REQUIRED');output();return;}
  const req=JSON.parse(await readFile(dataPath(values.request),'utf8')),review=JSON.parse(await readFile(dataPath(values.review),'utf8'));
  assert(req.pool===m.pool&&review.pool===m.pool&&review.marketSlot===m.slot&&review.marketRawHash===m.rawHash&&review.mintX===m.mintX&&review.mintY===m.mintY,'review/request identity mismatch');
  const asOf=review.asOf,maxAge=review.maxAgeSeconds;
  assert(Number.isSafeInteger(asOf)&&asOf<=Math.floor(Date.now()/1000)&&Number.isSafeInteger(maxAge)&&maxAge>0&&maxAge<=600,'invalid research time boundary');
  checkTime(review.marketObservedAt,review.marketAvailableAt,asOf,maxAge);
  await evidence(review.marketTimeEvidence?.path,review.marketTimeEvidence?.sha256);
  assert(Array.isArray(review.observations)&&review.observations.length>=3&&review.observations.length<=1000,'at least three sourced market observations required');
  assert(['sol','holding','position'].includes(req.entry)&&req.capitalScope==='USER_DECLARED_ALLOCATION'&&['balanced','defensive','growth'].includes(req.goal),'invalid explicit capital request');
  assert(Number.isSafeInteger(req.horizonSeconds)&&req.horizonSeconds>0,'explicit horizon required');
  const anchorPrice=10**(m.decimalsX-m.decimalsY);
  const cfg=Engine.requestConfig(req,{...req.riskConfig,binStepBps:m.binStep,anchorPrice,maxReferenceAge:maxAge,forecastHorizonSeconds:req.horizonSeconds});
  const observations=[],ids=new Set();let last=-1;
  for(const o of review.observations){
   assert(typeof o.id==='string'&&o.id&&!ids.has(o.id)&&Number.isSafeInteger(o.t)&&o.t>last&&o.t<=asOf,'duplicate or out-of-order market observation');
   ids.add(o.id);last=o.t;
   // Observations carry independently reviewed raw artifacts; file integrity is not semantic acceptance.
   await evidence(o.evidence?.path,o.evidence?.sha256);
   assert(typeof o.tokenSafe==='boolean'&&finite(o.holderShare,0,1)&&finite(o.holderOutflow,0,1)&&finite(o.buyImbalance,-1,1)&&finite(o.flowSol,0)&&finite(o.exitDepth,0),'missing holder/flow/exit features');
   assert(Array.isArray(o.references)&&o.references.length>=2&&distinctReferenceArtifacts(o.references),'independent reference artifacts missing or reused');
   const pools=new Set(),venues=new Set(),sources=new Set();
   for(const r of o.references){
    assert(typeof r.pool==='string'&&r.pool!==m.pool&&!pools.has(r.pool)&&r.mintX===m.mintX&&r.mintY===m.mintY&&typeof r.venue==='string'&&r.venue&&typeof r.source==='string'&&r.source&&finite(r.price,Number.MIN_VALUE)&&finite(r.depth,cfg.minDepthSol),'invalid reference identity/depth');
    checkTime(r.observedAt,r.availableAt,o.t,maxAge);
    await evidence(r.evidence?.path,r.evidence?.sha256);
    pools.add(r.pool);venues.add(r.venue);sources.add(r.source);
   }
   assert(venues.size>=2&&sources.size>=2,'same-venue or same-source reference set insufficient for this bridge');
   assert(o.flowWindowSeconds==null||(Number.isSafeInteger(o.flowWindowSeconds)&&o.flowWindowSeconds>0&&o.flowWindowSeconds<=86400),'invalid flow observation window');
   const e={type:'MARKET',id:o.id,t:o.t,pool:m.pool,references:o.references.map(r=>({pool:r.pool,price:r.price,depth:r.depth,observedAt:r.observedAt,availableAt:r.availableAt})),tokenSafe:o.tokenSafe,holderShare:o.holderShare,holderOutflow:o.holderOutflow,buyImbalance:o.buyImbalance,flowSol:o.flowSol,flowWindowSeconds:o.flowWindowSeconds??null,exitDepth:o.exitDepth};
   const ref=Engine.reference(e,cfg);assert(ref.valid,'reference quality: '+ref.reason);observations.push({...e,ref});
  }
  const latest=observations.at(-1);checkTime(latest.t,latest.t,asOf,maxAge);
  assert(latest.t>=review.marketAvailableAt,'latest observation predates snapshot availability');
  assert(latest.ref.expiresAt>=asOf,'reference expired at analysis boundary');
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
  if(values.plans){
   const required=['maxInventoryRatio','maxInventoryTokens','minSolReserve','maxLossSol','stressDrop','maxBinShare','operationCostSol','feeBps','protocolShare','slippageBps'];
   const missing=required.filter(k=>!Object.hasOwn(req.riskConfig??{},k));
   if(missing.length)report.planPreview={status:'BLOCKED',reason:'EXPLICIT_RISK_AND_COST_PARAMETERS_REQUIRED',missing,decisionReady:false,executionReady:false};
   else report.planPreview=previewPlans(model,cfg,m,{asOf});
  }
  if(values.management){
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
 }catch(e){report.gaps.push(String(e.message).slice(0,240));}
 output();
}
main().catch(()=>{console.error('T08 blocked: check local state and configuration');process.exitCode=1;});

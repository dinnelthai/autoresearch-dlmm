// Current research binding, preflight and read-only wallet review.
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {poolAddress,currentMarket,requestFromDraft,reviewMatches,positionCapture,managementRequest} from './terminal-core.mjs';
import {buildReview,assertSameReview} from './review-core.mjs';
import {allocationDiagnostic} from './allocation-diagnostic.mjs';
import {sdkWeightDiagnostic} from './sdk-weight-diagnostic.mjs';
import {validateWalletEvidence,walletReview} from './wallet-evidence-core.mjs';
import {assert,sha} from './terminal-runtime.mjs';
export function createReviewService({DATA,cfg,pool,maxAgeMs,loadState,safeDataPath,boundedRead,run,validateScope,marketSummary}){
// Review availability is a preflight, not verification of its underlying evidence.
async function loadReview(m,now,path=cfg.review){
 assert(path,'REVIEW_NOT_CONFIGURED');
 let bytes;try{bytes=await boundedRead(await safeDataPath(path),8*1024*1024)}catch{throw Error('REVIEW_FILE_UNAVAILABLE')}
 let review;try{review=JSON.parse(bytes)}catch{throw Error('REVIEW_JSON_INVALID')}
 reviewMatches(review,m,now);
 const latest=review.observations.at(-1);assert(Array.isArray(latest.references)&&latest.references.length>=2&&latest.references.every(r=>Number.isSafeInteger(r.observedAt)&&r.observedAt<=latest.t&&now/1000-r.observedAt<review.maxAgeSeconds),'REVIEW_REFERENCE_STALE_OR_MISSING');
 const expiry=(Math.min(review.asOf,review.marketObservedAt,latest.t,...latest.references.map(r=>r.observedAt))+review.maxAgeSeconds)*1000;
 return {review,reviewBytes:bytes,reviewHash:sha(bytes),expiresAt:expiry};
}
async function managementContext(s,m,address,now){
 const p=positionCapture(s,m,address,now,maxAgeMs);
 assert(p.commonMarketCapture,'POSITION_MARKET_CAPTURE_MISMATCH');
 const entry=cfg.managementPolicies?.[address];
 assert(entry&&typeof entry.policy==='string','MANAGEMENT_POLICY_NOT_CONFIGURED');
 let bytes;try{bytes=await boundedRead(await safeDataPath(entry.policy),32768)}catch{throw Error('MANAGEMENT_POLICY_UNAVAILABLE')}
 let policy;try{policy=JSON.parse(bytes)}catch{throw Error('MANAGEMENT_POLICY_INVALID')}
 const request=managementRequest(policy,m,p.report);
 const r=await loadReview(m,now,entry.review??cfg.review);
 assert(!r.review.operations||r.review.operations.position===address,'MANAGEMENT_HISTORY_POSITION_MISMATCH');
 return {p,request,policyHash:sha(bytes),...r,expiresAt:Math.min(p.expiresAt,m.receivedAt+maxAgeMs,r.expiresAt)};
}
async function overview(){
 const s=await loadState(),now=Date.now();assert(s.pool===pool&&s.schemaVersion===1&&s.decisionReady===false&&Number.isSafeInteger(s.sequence),'STATE_IDENTITY_MISMATCH');const streams=Object.fromEntries(Object.entries(s.streams??{}).map(([k,v])=>[k,{status:v.status,receivedAt:v.receivedAt??null,locallyFresh:Number.isSafeInteger(v.receivedAt)&&v.receivedAt<=now&&now-v.receivedAt<=maxAgeMs,...(k.startsWith('history:')?{historyStatus:v.evidence?.historyStatus??null,repairStatus:v.evidence?.repair?.status??s.history?.[k.slice(8)]?.repair?.status??null,repairCapture:v.evidence?.repairCapture===true,historyComplete:false,gapCount:v.evidence?.gapCount??v.evidence?.decoded?.gaps?.length??null,gapReasons:v.evidence?.gapReasons??[...new Set((v.evidence?.decoded?.gaps??[]).map(g=>g.reason))].slice(0,20),signatureCount:v.evidence?.signatureCount??v.evidence?.decoded?.transactions?.length??null}: {})}]));
 const positions=[];for(const [k,v] of Object.entries(s.streams??{})){const p=v.evidence?.report;if(k.startsWith('position:')&&v.status==='CAPTURED_UNVERIFIED'&&streams[k].locallyFresh&&p?.pool===pool&&p.position===k.slice(9)&&p.status==='POSITION_CALCULATED_UNVERIFIED')positions.push(p)}
 let market=null,marketModel=null,reason=null,reviewGate={status:'BLOCKED',reason:'MARKET_UNAVAILABLE'};try{const m=currentMarket(s,pool,now,maxAgeMs);marketModel=m;market=marketSummary(m);try{const r=await loadReview(m,now);reviewGate={status:'PREFLIGHT_MATCHED_UNVERIFIED',reviewHash:r.reviewHash,expiresAt:r.expiresAt}}catch(e){reviewGate={status:'BLOCKED',reason:e.message}}}catch(e){reason=e.message}
 const monitoring=[];
 const addresses=new Set([...Object.keys(s.streams??{}).filter(k=>k.startsWith('position:')).map(k=>k.slice(9)),...Object.keys(cfg.managementPolicies??{})]);
 for(const address of addresses){
  if(!poolAddress(address))continue;
  const item={position:address,status:'BLOCKED',rangeState:'UNKNOWN',reason:'POSITION_CAPTURE_UNAVAILABLE',managementGate:{status:'BLOCKED',reason:'POSITION_CAPTURE_UNAVAILABLE'}};
  try{
   const p=positionCapture(s,marketModel,address,now,maxAgeMs);
   Object.assign(item,{status:'CAPTURED_UNVERIFIED',rangeState:p.rangeState,slot:p.report.slot,rawHash:p.report.rawHash,expiresAt:p.expiresAt,commonMarketCapture:p.commonMarketCapture,reason:null});
   try{
    assert(marketModel,'MARKET_UNAVAILABLE');const v=await managementContext(s,marketModel,address,now);
    item.managementGate={status:'PREFLIGHT_MATCHED_UNVERIFIED',policyHash:v.policyHash,reviewHash:v.reviewHash,expiresAt:v.expiresAt,request:v.request};
   }catch(e){item.managementGate={status:'BLOCKED',reason:e.message}}
  }catch(e){item.reason=e.message;item.managementGate.reason=e.message}
  monitoring.push(item);
 }
 return {pool,sequence:s.sequence??null,monitoring,status:market?'CAPTURED_UNVERIFIED':'BLOCKED',reason,market,reviewGate,positions,streams,decisionReady:false,executionReady:false,freshnessBasis:'LOCAL_RECEIPT_ONLY'};
}
async function preview(body,mode='plans'){
 const now=Date.now(),s=await loadState(),m=currentMarket(s,pool,now,maxAgeMs);
 assert(body?.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 let ctx=null,request,review,reviewBytes,reviewHash,expiresAt;
 if(mode==='management'){
  ctx=await managementContext(s,m,body.position,now);
  assert(body.positionSlot===ctx.p.report.slot&&body.positionRawHash===ctx.p.report.rawHash,'POSITION_CHANGED_REFRESH_REQUIRED');
  assert(body.policyHash===ctx.policyHash,'MANAGEMENT_POLICY_CHANGED_REFRESH_REQUIRED');
  ({request,review,reviewBytes,reviewHash,expiresAt}=ctx);
 }else{request=requestFromDraft(body.draft,m);({review,reviewBytes,reviewHash,expiresAt}=await loadReview(m,now))}
 assert(body.reviewHash===reviewHash,'REVIEW_CHANGED_REFRESH_REQUIRED');
 const base=join(DATA,'terminal');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'analysis-'));
 try{
  const requestJson=JSON.stringify(request),requestHash=sha(requestJson);
  for(const [name,data] of [['state',JSON.stringify(s)],['request',requestJson],['review',reviewBytes]])await writeFile(join(dir,name+'.json'),data,{mode:0o600});
  const r=await run(['--state',join(dir,'state.json'),'--request',join(dir,'request.json'),'--review',join(dir,'review.json'),mode==='management'?'--management':'--plans']);
  assert(r.pool===pool&&r.decisionReady===false&&r.executionReady===false,'ANALYSIS_CONTRACT_MISMATCH');
  if(r.market)assert(r.market.slot===m.slot&&r.market.rawHash===m.rawHash,'ANALYSIS_SNAPSHOT_MISMATCH');
  const latestState=await loadState(),latest=currentMarket(latestState,pool,Date.now(),maxAgeMs);assert(latest.slot===m.slot&&latest.rawHash===m.rawHash,'MARKET_CHANGED_DURING_ANALYSIS');const after=mode==='management'?await managementContext(latestState,latest,body.position,Date.now()):await loadReview(latest,Date.now());assert(after.reviewHash===reviewHash,'REVIEW_CHANGED_DURING_ANALYSIS');
  if(ctx){assert(after.policyHash===ctx.policyHash&&after.p.report.rawHash===ctx.p.report.rawHash&&after.p.report.slot===ctx.p.report.slot&&after.p.report.owner===ctx.p.report.owner,'POSITION_OR_POLICY_CHANGED_DURING_ANALYSIS');if(r.managementPreview?.status==='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED')assert(r.managementPreview.position?.address===body.position&&r.managementPreview.position?.owner===ctx.p.report.owner,'MANAGEMENT_REPORT_IDENTITY_MISMATCH')}
  const finalNow=Date.now(),boundExpiry=Math.min(expiresAt,after.expiresAt,m.receivedAt+maxAgeMs,latest.receivedAt+maxAgeMs);assert(boundExpiry>finalNow,'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
  return {...r,terminalBinding:{requestHash,reviewHash,...(mode==='plans'?{researchBudget:{solRaw:request.solRaw,memeRaw:request.memeRaw,allowDispose:false,minSolReserve:request.riskConfig.minSolReserve,operationCostSol:request.riskConfig.operationCostSol}}:{}),...(ctx?{position:body.position,policyHash:ctx.policyHash,positionSlot:ctx.p.report.slot,positionRawHash:ctx.p.report.rawHash}:{}),expiresAt:boundExpiry,marketSlot:m.slot,marketRawHash:m.rawHash,sequence:s.sequence,generatedAt:Date.now(),scope:'RESEARCH_ONLY'}};
 }finally{await rm(dir,{recursive:true,force:true})}
}
// Short-lived server-owned research reports; no signing material, no persistence.
const reviewReports=new Map();
function rememberReport(r,mode){
 const now=Date.now();for(const [id,v] of reviewReports)if(v.report.terminalBinding.expiresAt<=now)reviewReports.delete(id);
 if(r.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||!r.terminalBinding||r.terminalBinding.expiresAt<=now)return r;
 const id=randomUUID();while(reviewReports.size>=16)reviewReports.delete(reviewReports.keys().next().value);
 reviewReports.set(id,{report:r,mode});return {...r,reviewId:id};
}
async function reviewContext(body){
 const saved=reviewReports.get(body?.reviewId);assert(saved&&saved.mode===body.mode,'RESEARCH_REPORT_UNAVAILABLE');
 const r=saved.report,b=r.terminalBinding,now=Date.now(),s=await loadState(),m=currentMarket(s,pool,now,maxAgeMs);
 let ctx=null,review;
 if(saved.mode==='management'){ctx=await managementContext(s,m,b.position,now);review=ctx}else review=await loadReview(m,now);
 assert(b.expiresAt>now&&m.receivedAt+maxAgeMs>now,'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
 const result=buildReview({report:r,mode:saved.mode,rowIndex:body.rowIndex,wallet:body.wallet,market:m,position:ctx?.p.report,reviewHash:review.reviewHash,policyHash:ctx?.policyHash,now:Date.now()});
 result.expiresAt=Math.min(result.expiresAt,review.expiresAt,m.receivedAt+maxAgeMs,ctx?.expiresAt??Infinity);
 assert(result.expiresAt>Date.now(),'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
 return {saved,r,b,m,result};
}
async function inspectReview(body){
 const {saved,r,b,m,result}=await reviewContext(body);
 const integerAllocation=saved.mode==='plans'?allocationDiagnostic({row:r.planPreview.families[body.rowIndex].best,market:m,budget:b.researchBudget}):{status:'BLOCKED',reason:'MANAGEMENT_INTEGER_MAPPING_PENDING',executionReady:false,signingAvailable:false};
 let captureDirectory=null;if(cfg.weightDiagnostic?.inverseEnabled===true&&typeof m.capture==='string'){try{captureDirectory=await safeDataPath(m.capture)}catch{}}
 const weightDiagnostic=await sdkWeightDiagnostic(integerAllocation,m,cfg.weightDiagnostic,captureDirectory);
 const latest=await reviewContext(body);assert(latest.saved===saved,'RESEARCH_REPORT_UNAVAILABLE');
 const expiry=assertSameReview(result,latest.result,Date.now());
 return {...result,expiresAt:expiry,reviewId:body.reviewId,integerAllocation,weightDiagnostic};
}
async function inspectWalletEvidence(body){
 assert(cfg.walletEvidence?.enabled===true,'WALLET_EVIDENCE_DISABLED');
 const genesis=cfg.walletEvidence.expectedGenesisHash;
 assert(typeof genesis==='string'&&/^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(genesis),'WALLET_EXPECTED_GENESIS_REQUIRED');
 const before=await inspectReview(body),m=currentMarket(await loadState(),pool,Date.now(),maxAgeMs);
 assert(m.slot===before.marketSlot&&m.rawHash===before.marketRawHash&&before.expiresAt>Date.now(),'RESEARCH_MARKET_CHANGED');
 const args=['--wallet',before.wallet,'--mint-x',m.mintX,'--mint-y',m.mintY,'--decimals-x',String(m.decimalsX),'--min-slot',String(m.slot),'--genesis',genesis];
 const e=await run(args,'capture-wallet.mjs');
 if(e.status==='BLOCKED')throw Error(e.reason??'WALLET_CAPTURE_FAILED');
 validateWalletEvidence(e,{wallet:before.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now:Date.now()});
 const raw=await boundedRead(await safeDataPath(join(e.directory,'rpc.json')),8*1024*1024);assert(sha(raw)===e.rawHash,'WALLET_EVIDENCE_HASH_MISMATCH');
 const {result:after}=await reviewContext(body),now=Date.now(),expiry=assertSameReview(before,after,now);
 validateWalletEvidence(e,{wallet:before.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now});
 return {...walletReview(e,{...after,expiresAt:expiry}),reviewId:body.reviewId,mode:after.mode,rowIndex:after.rowIndex,pool:after.pool,position:after.position,marketSlot:after.marketSlot,marketRawHash:after.marketRawHash,reviewHash:after.reviewHash,policyHash:after.policyHash,positionSlot:after.positionSlot,positionRawHash:after.positionRawHash};
}
// Public wallet observation is separate from strategy review; no authorization or spendability claim.
async function observeWallet(body){
 assert(poolAddress(body?.pool)&&poolAddress(body.wallet),'WALLET_CAPTURE_ARGUMENTS_INVALID');
 const scope=validateScope(body.pool),m=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);
 const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 const args=['--wallet',body.wallet,'--mint-x',m.mintX,'--mint-y',m.mintY,'--decimals-x',String(m.decimalsX),'--min-slot',String(m.slot),'--genesis',genesis];
 const e=await run(args,'capture-wallet.mjs');
 if(e.status==='BLOCKED')throw Error(e.reason??'WALLET_CAPTURE_FAILED');
 validateWalletEvidence(e,{wallet:body.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now:Date.now()});
 const raw=await boundedRead(await safeDataPath(join(e.directory,'rpc.json')),8*1024*1024);
 assert(sha(raw)===e.rawHash,'WALLET_EVIDENCE_HASH_MISMATCH');
 validateWalletEvidence(e,{wallet:body.wallet,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,genesis,now:Date.now()});
 return {pool:scope,mintX:m.mintX,mintY:m.mintY,...walletReview(e,{expiresAt:e.receivedAt+30000})};
}

 return {loadReview,overview,preview,rememberReport,inspectReview,inspectWalletEvidence,observeWallet};
}

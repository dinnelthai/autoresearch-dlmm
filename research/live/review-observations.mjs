// Shared evidence-backed research observation loader. No independent semantic certification.
import {Engine} from '../engine.mjs';
import {checkTime} from './engine-input.mjs';
import {distinctReferenceArtifacts} from './quote-evidence.mjs';
import {assert,hash,finite} from './research-contract.mjs';
import {boundedSwapObservation} from './research-input-status.mjs';
import {featureProjection} from './market-features.mjs';
import {quoteMath} from './reference-math.mjs';
export async function reviewedObservations({m,req,review,evidence,now=Date.now()}){
 assert(req.pool===m.pool&&review.pool===m.pool&&review.marketSlot===m.slot&&review.marketRawHash===m.rawHash&&review.mintX===m.mintX&&review.mintY===m.mintY,'review/request identity mismatch');
  const asOf=review.asOf,maxAge=review.maxAgeSeconds;
  assert(Number.isSafeInteger(asOf)&&asOf<=Math.floor(now/1000)&&Number.isSafeInteger(maxAge)&&maxAge>0&&maxAge<=600,'invalid research time boundary');
  checkTime(review.marketObservedAt,review.marketAvailableAt,asOf,maxAge);
  const checked=new Map();
  const check=async r=>{if(checked.has(r?.path)){assert(checked.get(r.path)===r.sha256,'REVIEW_EVIDENCE_CONFLICT');return}await evidence(r?.path,r?.sha256);checked.set(r.path,r.sha256)};
  await check(review.marketTimeEvidence);
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
   await check(o.evidence);
   assert(typeof o.tokenSafe==='boolean'&&finite(o.holderShare,0,1)&&finite(o.holderOutflow,0,1)&&finite(o.buyImbalance,-1,1)&&finite(o.flowSol,0)&&finite(o.exitDepth,0),'missing holder/flow/exit features');
   assert(Array.isArray(o.references)&&o.references.length>=2&&distinctReferenceArtifacts(o.references),'independent reference artifacts missing or reused');
   const pools=new Set(),venues=new Set(),sources=new Set();
   for(const r of o.references){
    assert(typeof r.pool==='string'&&r.pool!==m.pool&&!pools.has(r.pool)&&r.mintX===m.mintX&&r.mintY===m.mintY&&typeof r.venue==='string'&&r.venue&&typeof r.source==='string'&&r.source&&finite(r.price,Number.MIN_VALUE)&&finite(r.depth,cfg.minDepthSol),'invalid reference identity/depth');
    checkTime(r.observedAt,r.availableAt,o.t,maxAge);
    await check(r.evidence);
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

 return {asOf,cfg,observations,latest};
}

export const PAPER_OBSERVATION_BASIS='COLLECTED_MARKET_FEATURE_PROXY_V1';
// Paper only. Receipt-time quotes, tested exit notionals, bounded swap samples and
// mint/cohort diagnostics are explicitly distinct from reviewed market evidence.
export function meteoraReferenceInputs({m,reference,now,maxAgeMs=120000}){
 const r=reference?.report,completed=Date.parse(r?.completedAt);
 assert(reference&&hash(reference.manifestHash)&&typeof reference.capture==='string'&&r?.pool===m.pool&&r.mint===m.mintX&&r.decimals===m.decimalsX&&r.commitment==='finalized'&&r.status==='REFERENCE_EVIDENCE_UNVERIFIED'&&Number.isFinite(completed)&&completed<=now&&now-completed<=maxAgeMs&&Array.isArray(r.references),'METEORA_REFERENCE_UNAVAILABLE');
 const refs=r.references.map(v=>{
  const observed=Date.parse(v.before?.receivedAt),available=Date.parse(v.after?.receivedAt);
  assert(v.venue==='METEORA_DLMM'&&v.pool!==m.pool&&typeof v.pool==='string'&&v.status==='QUOTES_CAPTURED_UNVERIFIED'&&Number.isFinite(observed)&&Number.isFinite(available)&&observed<=available&&available<=completed&&now-observed<=maxAgeMs&&Number.isSafeInteger(v.before?.slot)&&Number.isSafeInteger(v.after?.slot)&&v.before.slot<=v.after.slot,'METEORA_REFERENCE_STALE_OR_INVALID');
  const math=quoteMath(v.bid,v.ask,v.samples,r.maxDiscountBps);
  assert(JSON.stringify(math.midRawRatio)===JSON.stringify(v.midRawRatio)&&JSON.stringify(math.bestTestedExit)===JSON.stringify(v.bestTestedExit),'METEORA_REFERENCE_QUOTE_MISMATCH');
  const price=Number(math.midRawRatio.numerator)/Number(math.midRawRatio.denominator)*10**(m.decimalsX-9),depth=Number(math.bestTestedExit?.minOutRaw)/1e9;
  assert(finite(price,Number.MIN_VALUE)&&finite(depth,Number.MIN_VALUE),'METEORA_REFERENCE_DEPTH_UNAVAILABLE');
  return {pool:v.pool,price,depth,observedAt:Math.floor(observed/1000),availableAt:Math.floor(available/1000)};
 });
 assert(refs.length>=2&&new Set(refs.map(v=>v.pool)).size===refs.length,'METEORA_TWO_REFERENCE_POOLS_REQUIRED');
 return refs;
}
export function collectedPaperObservation({m,reference,external,holder,history,now=Date.now(),maxAgeMs=120000}){
 const h=featureProjection(holder,m,now,maxAgeMs),flow=boundedSwapObservation(history,m.pool,now,maxAgeMs);
 assert(h?.distribution?.supplyConserved&&finite(h.distribution.topShare,0,1)&&finite(h.cohort?.netDecreaseShare,0,1)&&Array.isArray(h.safety?.flags),'PAPER_HOLDER_FEATURES_UNAVAILABLE');
 assert(flow?.sampleKind==='RECENT_EVENT_SAMPLE'&&flow.eventCount>0,'PAPER_FLOW_SAMPLE_UNAVAILABLE');
 let refs,referenceEvidence;
 if(reference){refs=meteoraReferenceInputs({m,reference,now,maxAgeMs});referenceEvidence={source:'METEORA_DLMM_SDK',capture:reference.capture,sha256:reference.manifestHash}}
 else{
 assert(external?.marketSlot===m.slot&&external.marketRawHash===m.rawHash&&external.pool===m.pool&&external.mintX===m.mintX&&external.mintY===m.mintY&&external.expiresAt>=now&&hash(external.evidenceHash)&&external.rawEvidenceCheck?.scope==='RAW_QUOTE_RECHECK_ONLY','PAPER_REFERENCE_QUOTES_UNAVAILABLE');
 refs=external.rawEvidenceCheck.venues.map(v=>{
  const q=external[v.venue],records=external.evidence.filter(e=>e.file===(v.venue==='orca'?'orca-':'')+'ask.json'||e.file===(v.venue==='orca'?'orca-':'')+'bid-0.json');
  const depth=Number(v.bestTestedExit?.minOutRaw)/1e9,observedAt=Math.floor(Math.min(...records.map(r=>r.receivedAt))/1000);
  assert(q?.pool===v.pool&&records.length===2&&records.every(r=>hash(r.sha256))&&finite(v.midSolPerMeme,Number.MIN_VALUE)&&finite(depth,Number.MIN_VALUE)&&Number.isSafeInteger(observedAt),'PAPER_REFERENCE_DEPTH_UNAVAILABLE');
  return {pool:v.pool,price:v.midSolPerMeme,depth,observedAt,availableAt:Math.floor(external.fetchedAt/1000)};
 });
 assert(refs.length>=2&&new Set(refs.map(r=>r.pool)).size===refs.length&&refs.every(r=>r.pool!==m.pool),'PAPER_TWO_REFERENCE_QUOTES_REQUIRED');
 referenceEvidence={source:'EXTERNAL_QUOTE_FALLBACK',sha256:external.evidenceHash};}
 const buy=BigInt(flow.buyLamports),sell=BigInt(flow.sellLamports),gross=buy+sell;
 assert(gross>0n,'PAPER_FLOW_SAMPLE_EMPTY');
 const t=Math.floor(now/1000);
 return {basis:PAPER_OBSERVATION_BASIS,slot:m.slot,marketRawHash:m.rawHash,receivedAt:now,evidence:{reference:referenceEvidence,holder:h.evidenceHash,history:flow.capture},event:{type:'MARKET',id:'collected:'+m.rawHash,t,pool:m.pool,references:refs,tokenSafe:h.safety.flags.length===0&&h.safety.mintAuthorityRevoked===true&&h.safety.freezeAuthorityRevoked===true,holderShare:h.distribution.topShare,holderOutflow:h.cohort.netDecreaseShare,buyImbalance:Number((buy-sell)*1000000n/gross)/1000000,flowSol:Number(gross)/1e9,flowWindowSeconds:Math.ceil(maxAgeMs/1000),exitDepth:Math.max(...refs.map(r=>r.depth))}};
}
export function collectedPaperInputs({m,req,samples,asOf}){
 const cfg=Engine.requestConfig(req,{...req.riskConfig,binStepBps:m.binStep,anchorPrice:10**(m.decimalsX-m.decimalsY),maxReferenceAge:120,forecastHorizonSeconds:req.horizonSeconds});
 const seen=new Set(),eligible=samples.filter(s=>s.basis===PAPER_OBSERVATION_BASIS&&s.event.pool===m.pool&&s.slot<=m.slot&&s.event.t<=asOf).filter(s=>{const e=s.evidence?.reference;if(e?.source!=='METEORA_DLMM_SDK')return true;if(seen.has(e.sha256))return false;seen.add(e.sha256);return true});
 const evaluated=eligible.map(s=>({...s.event,ref:Engine.reference(s.event,cfg)})),last=evaluated.at(-1);
 if(last&&!last.ref.valid)throw Error('PAPER_REFERENCE_'+last.ref.reason);
 const observations=evaluated.filter(e=>e.ref.valid);
 const latest=observations.at(-1);
 assert(observations.length>=3&&latest&&latest.ref.expiresAt>=asOf&&asOf-latest.t<=cfg.maxReferenceAge,'PAPER_COLLECTED_MODEL_WARMUP');
 return {asOf,cfg,observations,latest,basis:PAPER_OBSERVATION_BASIS};
}

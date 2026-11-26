// Shared evidence-backed research observation loader. No independent semantic certification.
import {Engine} from '../engine.mjs';
import {checkTime} from './engine-input.mjs';
import {distinctReferenceArtifacts} from './quote-evidence.mjs';
import {assert} from './research-contract.mjs';
const finite=(v,min,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export async function reviewedObservations({m,req,review,evidence,now=Date.now()}){
 assert(req.pool===m.pool&&review.pool===m.pool&&review.marketSlot===m.slot&&review.marketRawHash===m.rawHash&&review.mintX===m.mintX&&review.mintY===m.mintY,'review/request identity mismatch');
  const asOf=review.asOf,maxAge=review.maxAgeSeconds;
  assert(Number.isSafeInteger(asOf)&&asOf<=Math.floor(now/1000)&&Number.isSafeInteger(maxAge)&&maxAge>0&&maxAge<=600,'invalid research time boundary');
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

 return {asOf,cfg,observations,latest};
}

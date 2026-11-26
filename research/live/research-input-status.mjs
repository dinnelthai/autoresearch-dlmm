// Diagnostic projection only. Never manufactures MARKET events or research acceptance.
import {featureProjection} from './market-features.mjs';
import {distinctReferenceArtifacts} from './quote-evidence.mjs';
const positive=v=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<(1n<<64n);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const finite=(v,lo,hi=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const fresh=(v,now,max)=>Number.isSafeInteger(v)&&v<=now&&now-v<=max;
const evidence=v=>typeof v?.path==='string'&&hash(v?.sha256);
export function boundedSwapObservation(stream,pool,now,maxAgeMs){
 const d=stream?.evidence?.decoded;
 if(stream?.status!=='CAPTURED_UNVERIFIED'||!fresh(stream.receivedAt,now,maxAgeMs)||d?.pool!==pool||d.position!=null||d.status!=='EVENTS_DECODED_UNVERIFIED'||!Array.isArray(d.gaps)||d.gaps.length||!Array.isArray(d.events)||!d.events.length||d.events.length>20000||!Array.isArray(d.transactions))return null;
 let buy=0n,sell=0n,buyCount=0,sellCount=0,minTime=Infinity,maxTime=-Infinity;
 const txs=new Map(d.transactions.map(t=>[t.signature,t]));const ids=new Set();
 for(const e of d.events){
  const t=txs.get(e.signature);
  if(e.pool!==pool||typeof e.id!=='string'||ids.has(e.id)||!t||t.success!==true||t.slot!==e.slot||t.blockTime!==e.blockTime||!Number.isSafeInteger(e.blockTime)||e.blockTime<=0||e.blockTime>Math.floor(now/1000)||!positive(e.amountInRaw)||!positive(e.amountOutRaw))return null;
  ids.add(e.id);minTime=Math.min(minTime,e.blockTime);maxTime=Math.max(maxTime,e.blockTime);
  if(e.direction==='Y_TO_X'&&e.swapForY===false){buy+=BigInt(e.amountInRaw);buyCount++}
  else if(e.direction==='X_TO_Y'&&e.swapForY===true){sell+=BigInt(e.amountOutRaw);sellCount++}
  else return null;
 }
 const recent=minTime>=Math.floor((now-maxAgeMs)/1000),sampleKind=stream.evidence.repairCapture===true?'HISTORICAL_BACKFILL':recent?'RECENT_EVENT_SAMPLE':'OLDER_EVENT_SAMPLE';
 return {scope:'BOUNDED_SAMPLE_ONLY',sampleKind,collectionReceivedAt:stream.receivedAt,eventAgeSeconds:Math.floor(now/1000)-maxTime,buyLamports:buy.toString(),sellLamports:sell.toString(),grossLamports:(buy+sell).toString(),buyCount,sellCount,firstEventTime:minTime,lastEventTime:maxTime,eventCount:ids.size,coverageVerified:false,modelFlowEligible:false};
}
export function reviewShape(review,m,now){
 if(!review||!m)return {status:'MISSING',observations:0,missing:['REVIEW_ARTIFACT_REQUIRED']};
 const gaps=[],obs=review.observations,t=Math.floor(now/1000),age=review.maxAgeSeconds;
 if(review.pool!==m.pool||review.marketSlot!==m.slot||review.marketRawHash!==m.rawHash||review.mintX!==m.mintX||review.mintY!==m.mintY)gaps.push('REVIEW_SNAPSHOT_MISMATCH');
 const timed=(a,b,asOf)=>Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&Number.isSafeInteger(asOf)&&Number.isSafeInteger(age)&&age>0&&age<=600&&a>=0&&a<=b&&b<=asOf&&asOf-a<=age;
 if(!timed(review.marketObservedAt,review.marketAvailableAt,review.asOf)||!fresh(review.asOf,t,age)||!evidence(review.marketTimeEvidence))gaps.push('MARKET_TIME_EVIDENCE_REQUIRED');
 if(!Array.isArray(obs)||obs.length<3||obs.length>1000)gaps.push('THREE_MARKET_OBSERVATIONS_REQUIRED');
 else{
  let last=-1;const ids=new Set();
  for(const o of obs){
   if(typeof o?.id!=='string'||!o.id||ids.has(o.id)||!Number.isSafeInteger(o.t)||o.t<=last||o.t>review.asOf||!evidence(o.evidence))gaps.push('OBSERVATION_ID_TIME_OR_EVIDENCE_INVALID');
   if(!o)continue;
   ids.add(o.id);last=o.t;
   if(typeof o.tokenSafe!=='boolean')gaps.push('TOKEN_SAFETY_EVIDENCE_REQUIRED');
   if(!finite(o.holderShare,0,1)||!finite(o.holderOutflow,0,1))gaps.push('HOLDER_EVIDENCE_REQUIRED');
   if(!finite(o.buyImbalance,-1,1)||!finite(o.flowSol,0))gaps.push('FLOW_EVIDENCE_REQUIRED');
   if(!finite(o.exitDepth,0))gaps.push('EXIT_DEPTH_EVIDENCE_REQUIRED');
   const refs=o.references;
   if(!Array.isArray(refs)||refs.length<2||refs.length>16||refs.some(r=>!r||typeof r.pool!=='string'||r.pool===m.pool||r.mintX!==m.mintX||r.mintY!==m.mintY||typeof r.venue!=='string'||!r.venue||typeof r.source!=='string'||!r.source||!finite(r.price,Number.MIN_VALUE)||!finite(r.depth,Number.MIN_VALUE)||!timed(r.observedAt,r.availableAt,o.t)||!evidence(r.evidence))||new Set(refs.map(r=>r.pool)).size!==refs.length||new Set(refs.map(r=>r.venue)).size<2||new Set(refs.map(r=>r.source)).size<2||!distinctReferenceArtifacts(refs))gaps.push('TWO_INDEPENDENT_REFERENCES_REQUIRED');
  }
  if(!Number.isSafeInteger(obs.at(-1)?.t)||obs.at(-1).t<review.marketAvailableAt||!fresh(obs.at(-1).t,t,age))gaps.push('LATEST_OBSERVATION_NOT_FRESH');
 }
 return {status:gaps.length?'STRUCTURE_INCOMPLETE':'STRUCTURE_PRESENT_UNVERIFIED',observations:Array.isArray(obs)?obs.length:0,missing:[...new Set(gaps)]};
}
export function inputStatus({pool,market=null,history=null,external=null,holder=null,review=null,reviewReason=null,now=Date.now(),maxAgeMs=180000}){
 const m=market?.pool===pool&&fresh(market.receivedAt,now,maxAgeMs)?market:null;
 const sample=m?boundedSwapObservation(history,pool,now,maxAgeMs):null;
 const quote=m&&external?.pool===pool&&external.mintX===m.mintX&&external.mintY===m.mintY&&external.marketRawHash===m.rawHash&&external.marketSlot===m.slot&&external.scope==='EXTERNAL_DISPLAY_ONLY'&&external.expiresAt>now&&fresh(external.fetchedAt,now,30000)&&(finite(external.raydium?.midSolPerMeme,Number.MIN_VALUE)||finite(external.orca?.midSolPerMeme,Number.MIN_VALUE))?(external.raydium?.midSolPerMeme>0?external.raydium:external.orca):null;
 const shape=reviewShape(review,m,now),features=featureProjection(holder,m,now,Math.min(maxAgeMs,180000));
 const tasks=[
  {id:'market',state:m?'OBSERVED':'MISSING',reason:m?'MARKET_CAPTURE_UNVERIFIED':'MARKET_CAPTURE_REQUIRED'},
  {id:'history',state:sample?.sampleKind==='RECENT_EVENT_SAMPLE'?'OBSERVED':sample?'HISTORICAL_ONLY':'MISSING',reason:sample?.sampleKind==='HISTORICAL_BACKFILL'?'HISTORY_BACKFILL_NOT_CURRENT_FLOW':sample?.sampleKind==='OLDER_EVENT_SAMPLE'?'EVENT_TIME_OUTSIDE_RECENT_WINDOW':sample?'BOUNDED_SAMPLE_NOT_WINDOW_COVERAGE':'COMPLETE_DECODED_SAMPLE_REQUIRED'},
  {id:'external',state:quote?'OBSERVED':'MISSING',reason:quote?(external.comparison?.status==='TWO_VENUES_OBSERVED_UNVERIFIED'?'TWO_VENUES_OBSERVED_NOT_INDEPENDENTLY_REVIEWED':'ONE_DIRECT_QUOTE_SOURCE_ONLY'):'DIRECT_TWO_SIDED_QUOTE_REQUIRED'},
  {id:'holder',state:features?.distribution?.supplyConserved?'OBSERVED':'REVIEW_REQUIRED',reason:features?.distribution?.supplyConserved?'OWNER_DISTRIBUTION_INCLUDES_VAULTS_NOT_REVIEWED_OUTFLOW':features?.gaps?.[0]??'HOLDER_CONCENTRATION_AND_OUTFLOW_EVIDENCE_REQUIRED'},
  {id:'flow',state:'REVIEW_REQUIRED',reason:'TIME_WINDOW_AND_COVERAGE_EVIDENCE_REQUIRED'},
  {id:'token',state:features?.safety?'OBSERVED':'REVIEW_REQUIRED',reason:features?.safety?'MINT_AUTHORITY_FACTS_NOT_TOKEN_SAFETY':'TOKEN_SAFETY_EVIDENCE_REQUIRED'},
  {id:'review',state:shape.status==='STRUCTURE_PRESENT_UNVERIFIED'?'PREFLIGHT':'MISSING',reason:reviewReason??shape.missing[0]??'ENGINE_EVIDENCE_HASH_CHECK_REQUIRED'}
 ];
 return {pool,marketSlot:m?.slot??null,marketRawHash:m?.rawHash??null,asOf:now,status:'DIAGNOSTIC_ONLY',decisionReady:false,executionReady:false,modelInputReady:false,tasks,review:shape,swapSample:sample,holderFeatures:features,externalQuote:quote?{source:quote.source,pool:quote.pool,midSolPerMeme:quote.midSolPerMeme,bestTestedExit:quote.bestTestedExit??null}:null};
}

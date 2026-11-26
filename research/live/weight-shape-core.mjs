// T14 B3: compare SDK weight shape to captured quote-value shape. No transactions.
const assert=(v,m)=>{if(!v)throw Error(m)};
const uint=(v,bits=64)=>{assert(typeof v==='string'&&/^\d{1,40}$/.test(v),'INVALID_RAW_INTEGER');const n=BigInt(v);assert(n<(1n<<BigInt(bits)),'INVALID_RAW_INTEGER');return n};
const sum=a=>a.reduce((s,n)=>s+n,0n),abs=n=>n<0n?-n:n;
const ceil=(a,b)=>Number((a+b-1n)/b);
// Compare normalized shapes using exact rational arithmetic. Does not imply token debit equivalence.
export function shapeDeviation(target,actual){
 assert(Array.isArray(target)&&Array.isArray(actual)&&target.length>0&&target.length<=1500&&[...target,...actual].every(v=>typeof v==='bigint'&&v>=0n),'INVALID_WEIGHT_SHAPE');
 const t=sum(target),a=sum(actual);assert(t>0n&&a>0n&&target.length===actual.length,'EMPTY_WEIGHT_SHAPE');
 const differences=target.map((v,i)=>abs(v*a-actual[i]*t));
 return {totalVariationBps:ceil(sum(differences)*10000n,2n*t*a),maxBinShareDeltaBps:ceil(differences.reduce((m,v)=>v>m?v:m,0n)*10000n,t*a)};
}
export function inspectWeightShape(d,market,{maxDeviationBps,positionLimit,singleMessageExclusiveLimit,convert}){
 const blocked=(reason,detail={})=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,signingAvailable:false,...detail});
 if(d?.status==='NO_OPERATION')return {...blocked('NO_LP_BASELINE'),status:'NO_OPERATION'};
 try{
  assert(d?.status==='INTEGER_DIAGNOSTIC_ONLY'&&d.executionReady===false&&d.signingAvailable===false,'INTEGER_DIAGNOSTIC_UNAVAILABLE');
  assert(Number.isInteger(maxDeviationBps)&&maxDeviationBps>=0&&maxDeviationBps<=10000,'WEIGHT_TOLERANCE_REQUIRED');
  assert(Number.isInteger(positionLimit)&&positionLimit>0&&Number.isInteger(singleMessageExclusiveLimit)&&singleMessageExclusiveLimit>1,'SDK_LIMITS_UNAVAILABLE');
  assert(Number.isInteger(market.activeId)&&Number.isInteger(market.binStep)&&market.binStep>0&&Array.isArray(market.bins),'MARKET_GRID_INVALID');
  assert(Array.isArray(d.rows)&&d.rows.length>0&&d.rows.length<=1500,'INVALID_INTEGER_ROWS');
  assert(!d.discontinuous&&d.rangeWidth===d.rows.length&&d.rangeWidth<=positionLimit&&d.rows.length<singleMessageExclusiveLimit,'SDK_RANGE_OR_MULTIPLE_MESSAGES_UNSUPPORTED');
  const known=new Map(market.bins.map(b=>[b.binId,b])),seen=new Set();
  assert(known.size===market.bins.length&&Number.isSafeInteger(d.lowerBinId)&&Number.isSafeInteger(d.upperBinId)&&d.upperBinId===d.lowerBinId+d.rows.length-1,'MARKET_OR_RANGE_IDENTITY_INVALID');
  const rows=d.rows.map((b,i)=>{
   assert(Number.isSafeInteger(b.binId)&&b.binId===d.lowerBinId+i&&!seen.has(b.binId)&&known.has(b.binId),'BIN_NOT_OBSERVED_OR_DUPLICATE');seen.add(b.binId);
   const x=uint(b.memeRaw),y=uint(b.solRaw),price=uint(known.get(b.binId).priceQ64Raw,128);
   assert(price>0n&&x+y>0n,'ZERO_BIN_OR_PRICE');assert(!(b.binId<market.activeId&&x>0n)&&!(b.binId>market.activeId&&y>0n),'WRONG_ACTIVE_BIN_SIDE');
   return {binId:b.binId,x,y,quote:x*price+(y<<64n)};
  });
  const x=sum(rows.map(b=>b.x)),y=sum(rows.map(b=>b.y));
  assert(x===uint(d.totalMemeRaw)&&y===uint(d.totalSolRaw)&&x+y>0n,'INTEGER_TOTAL_MISMATCH');
  // Floor each share; residual is reported and never silently assigned to another bin.
  const bps=rows.map(b=>({binId:b.binId,xBps:x?Number(b.x*10000n/x):0,yBps:y?Number(b.y*10000n/y):0}));
  const xResidualBps=x?10000-bps.reduce((n,b)=>n+b.xBps,0):0,yResidualBps=y?10000-bps.reduce((n,b)=>n+b.yBps,0):0;
  const converted=convert(x.toString(),y.toString(),bps,market.binStep);
  assert(Array.isArray(converted)&&converted.length<=rows.length,'SDK_WEIGHT_INVALID');
  const weights=new Map();for(const b of converted){assert(seen.has(b.binId)&&!weights.has(b.binId)&&Number.isInteger(b.weight)&&b.weight>0&&b.weight<=65535,'SDK_WEIGHT_INVALID');weights.set(b.binId,b.weight)}
  const actual=rows.map(b=>BigInt(weights.get(b.binId)??0)),target=rows.map(b=>b.quote),droppedBins=rows.filter(b=>!weights.has(b.binId)).map(b=>b.binId);
  assert(sum(actual)<=65535n,'SDK_WEIGHT_INVALID');
  const detail={distributionBps:bps,sdkWeights:rows.filter(b=>weights.has(b.binId)).map(b=>({binId:b.binId,weight:weights.get(b.binId)})),xResidualBps,yResidualBps,droppedBins,binCount:rows.length,weightSum:Number(sum(actual)),maxDeviationBps,comparison:'NORMALIZED_CAPTURED_Q64_QUOTE_VALUE_VS_SDK_WEIGHT',rows:rows.map((b,i)=>({binId:b.binId,modelQuoteShareBps:Number(target[i]*10000n/sum(target)),sdkWeightShareBps:sum(actual)>0n?Number(actual[i]*10000n/sum(actual)):null}))};
  if(!sum(actual))return blocked('SDK_EMPTY_WEIGHT_SHAPE',detail);
  const metrics=shapeDeviation(target,actual),output={...detail,...metrics};
  if(droppedBins.length)return blocked('SDK_DROPPED_BINS',output);
  if(metrics.totalVariationBps>maxDeviationBps||metrics.maxBinShareDeltaBps>maxDeviationBps)return blocked('SDK_SHAPE_DEVIATION_EXCEEDED',output);
  return {status:'SDK_WEIGHT_SHAPE_DIAGNOSTIC_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,...output,limitations:['Shape comparison only; no inverse per-token allocation or protocol transfer verified.','Active-bin token composition, exact debits, fee/rent, instruction scope and simulation remain unverified.','No transaction is built.']};
 }catch(e){return blocked(/^[A-Z0-9_]+$/.test(e.message)?e.message:'SDK_WEIGHT_DIAGNOSTIC_FAILED')}
}

// Integer quote arithmetic; input quotes are evidence, not guarantees of execution.
function quoteMath(bid,ask,ladder,maxDiscountBps){
 const pos=v=>{if(typeof v!=="string"||!/^[1-9]\d*$/.test(v))throw Error("positive raw decimal required");return BigInt(v);};
 const bi=pos(bid.inRaw),bo=pos(bid.outRaw),ai=pos(ask.inRaw),ao=pos(ask.outRaw);
 if(bo*ao>ai*bi)throw Error("crossed probe quotes");
 if(!Number.isInteger(maxDiscountBps)||maxDiscountBps<0||maxDiscountBps>=10000)throw Error("invalid discount limit");
 const num=bo*ao+ai*bi,den=2n*bi*ao;
 let previous=0n,best=null;const samples=[];
 for(const q of ladder){
  const input=pos(q.inRaw);if(input<=previous)throw Error("ladder must increase");previous=input;
  if(q.status!=="FULL_QUOTE"){samples.push({...q,withinBudget:false});continue;}
  const output=pos(q.outRaw),min=pos(q.minOutRaw);if(min>output)throw Error("minOut exceeds output");
  const within=min*den*10000n>=input*num*BigInt(10000-maxDiscountBps);
  const row={...q,withinBudget:within};samples.push(row);
  if(within)best={inRaw:q.inRaw,outRaw:q.outRaw,minOutRaw:q.minOutRaw};
 }
 return {midRawRatio:{numerator:num.toString(),denominator:den.toString(),unit:"LAMPORTS_PER_MEME_RAW_UNIT"},samples,bestTestedExit:best};
}
export {quoteMath};

 // Price is raw lamports per raw token, Q64. Probe economic notionals instead of token counts.
export function referenceProbeSizes(m,{probeSolRaw='10000000',referenceDepthSolRaw='3000000000',sellRaw}={}){
 const pos=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<1n<<64n;
 if(!pos(probeSolRaw)||!pos(referenceDepthSolRaw))throw Error('REFERENCE_PROBE_CONFIG');
 if(Array.isArray(sellRaw)&&sellRaw.length){if(sellRaw.length>4||!sellRaw.every((v,i)=>pos(v)&&(!i||BigInt(v)>BigInt(sellRaw[i-1]))))throw Error('REFERENCE_PROBE_CONFIG');return {buyRaw:probeSolRaw,sellRaw}}
 const price=m.bins?.find(b=>b.binId===m.activeId)?.priceQ64Raw;
 if(typeof price!=='string'||!/^[1-9]\d{0,80}$/.test(price))throw Error('REFERENCE_ACTIVE_PRICE_MISSING');
 const q=1n<<64n,p=BigInt(price),target=BigInt(referenceDepthSolRaw),small=BigInt(probeSolRaw);
 if(target<=small)throw Error('REFERENCE_PROBE_DEPTH_TOO_SMALL');
 const amounts=[small,(small+target)/2n,target].map(v=>String((v*q+p-1n)/p));
 const ladder=[...new Set(amounts)];if(!ladder.every(pos))throw Error('REFERENCE_PROBE_AMOUNT_RANGE');
 return {buyRaw:probeSolRaw,sellRaw:ladder};
}

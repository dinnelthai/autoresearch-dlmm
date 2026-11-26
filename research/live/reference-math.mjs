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

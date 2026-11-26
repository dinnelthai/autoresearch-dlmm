// B4: exact comparison of SDK helper estimates, not actual protocol transfers.
const assert=(v,m)=>{if(!v)throw Error(m)};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n,'INVERSE_RAW_INVALID');return BigInt(v)};
const sum=a=>a.reduce((s,v)=>s+v,0n),abs=v=>v<0n?-v:v;
function metrics(target,actual){
 const t=sum(target),a=sum(actual),l1=sum(target.map((v,i)=>abs(v-actual[i])));
 assert(a<=t,'INVERSE_BUDGET_EXCEEDED');
 return {targetRaw:t.toString(),estimatedRaw:a.toString(),unusedRaw:(t-a).toString(),absoluteErrorRaw:l1.toString(),absoluteErrorBps:t?Number((l1*10000n+t-1n)/t):0};
}
export function compareInverse(d,market,estimate,maxAmountErrorBps){
 const block=(reason,detail={})=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,signingAvailable:false,...detail});
 try{
  assert(d?.status==='INTEGER_DIAGNOSTIC_ONLY'&&d.executionReady===false&&Array.isArray(d.rows)&&d.rows.length>0&&d.rows.length<=1500,'INTEGER_DIAGNOSTIC_UNAVAILABLE');
  assert(Number.isInteger(maxAmountErrorBps)&&maxAmountErrorBps>=0&&maxAmountErrorBps<=10000,'INVERSE_TOLERANCE_REQUIRED');
  assert(Number.isSafeInteger(market.activeId)&&Array.isArray(estimate)&&estimate.length===d.rows.length,'INVERSE_ROWS_INVALID');
  const map=new Map(estimate.map(b=>[b.binId,b]));assert(map.size===estimate.length,'INVERSE_ROWS_INVALID');
  const rows=d.rows.map(b=>{const s=map.get(b.binId);assert(s&&Number.isSafeInteger(b.binId),'INVERSE_ROWS_INVALID');
   const tx=raw(b.memeRaw),ty=raw(b.solRaw),x=raw(s.memeRaw),y=raw(s.solRaw);
   assert(!(b.binId<market.activeId&&x>0n)&&!(b.binId>market.activeId&&y>0n),'INVERSE_WRONG_SIDE');
   return {binId:b.binId,targetMemeRaw:tx.toString(),targetSolRaw:ty.toString(),estimatedMemeRaw:x.toString(),estimatedSolRaw:y.toString(),deltaMemeRaw:(x-tx).toString(),deltaSolRaw:(y-ty).toString()};
  });
  assert(new Set(rows.map(b=>b.binId)).size===rows.length,'INVERSE_ROWS_INVALID');
  const meme=metrics(rows.map(b=>raw(b.targetMemeRaw)),rows.map(b=>raw(b.estimatedMemeRaw))),sol=metrics(rows.map(b=>raw(b.targetSolRaw)),rows.map(b=>raw(b.estimatedSolRaw)));
  assert(meme.targetRaw===d.totalMemeRaw&&sol.targetRaw===d.totalSolRaw,'INTEGER_TOTAL_MISMATCH');
  const active=rows.find(b=>b.binId===market.activeId)??null;
  const droppedBins=rows.filter(b=>(raw(b.targetMemeRaw)+raw(b.targetSolRaw)>0n)&&(raw(b.estimatedMemeRaw)+raw(b.estimatedSolRaw)===0n)).map(b=>b.binId);
  const detail={meme,sol,active,droppedBins,maxAmountErrorBps,rows,comparison:'SDK_HELPER_ESTIMATE_VS_INTEGER_RESEARCH_TARGET',decimalsX:d.decimalsX,decimalsY:9};
  if(droppedBins.length)return block('INVERSE_DROPPED_BINS',detail);
  if(Math.max(meme.absoluteErrorBps,sol.absoluteErrorBps)>maxAmountErrorBps)return block('INVERSE_AMOUNT_ERROR_EXCEEDED',detail);
  return {status:'SDK_INVERSE_ESTIMATE_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,...detail,limitations:['SDK helper estimate is not an on-chain result.','No instruction, fee, account debit or simulation has been verified.']};
 }catch(e){return block(/^[A-Z0-9_]+$/.test(e.message)?e.message:'INVERSE_DIAGNOSTIC_FAILED')}
}

export function snapshotRow(m,identity,bins){
 const fail=()=>{throw Error('SNAPSHOT_CONTRACT_INVALID')};
 const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 const raw=(v,bits)=>typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v)&&v.length<=39&&BigInt(v)<(1n<<BigInt(bits));
 const time=Date.parse(m?.receivedAt);
 if(!Number.isSafeInteger(time)||!Number.isSafeInteger(m.contextSlot)||m.contextSlot<0||!hex(m.raw?.sha256)||m.commitment!=='finalized')fail();
 for(const r of [identity,bins])if(r?.pool!==m.pool||r.slot!==m.contextSlot||r.rawHash!==m.raw.sha256)fail();
 if(identity.sdkCommit!==bins.sdkCommit||identity.idlBlob!==bins.idlBlob||identity.activeId!==bins.activeId||identity.binStep!==bins.binStep||identity.mintX!==bins.mintX||identity.mintY!==bins.mintY||!Array.isArray(bins.arrays))fail();
 const ids=new Set(),arrays=[];
 for(const a of bins.arrays){
  if(![2,3].includes(a.version)||!Number.isSafeInteger(a.index)||!Array.isArray(a.bins)||a.bins.length!==70||!Number.isSafeInteger(a.lowerBinId)||a.upperBinId!==a.lowerBinId+69)fail();
  for(const [i,b] of a.bins.entries()){
   if(b.binId!==a.lowerBinId+i||ids.has(b.binId)||!raw(b.amountXRaw,64)||!raw(b.amountYRaw,64)||!['priceQ64Raw','liquiditySupplyRaw','feeXPerTokenRaw','feeYPerTokenRaw'].every(k=>raw(b[k],128)))fail();
   ids.add(b.binId);
  }
  arrays.push({index:a.index,address:a.address,version:a.version,lowerBinId:a.lowerBinId,upperBinId:a.upperBinId,bins:a.bins});
 }
 const full=bins.status==='BITMAP_COVERAGE_CHECKED_UNVERIFIED'&&Array.isArray(bins.expected)&&Array.isArray(bins.missing)&&!bins.missing.length&&Array.isArray(bins.unsupported)&&!bins.unsupported.length&&bins.expected.length===arrays.length&&new Set(arrays.map(a=>a.index)).size===arrays.length&&bins.expected.every(e=>arrays.some(a=>a.index===e.index&&a.address===e.address));
 const eligible=full&&identity.status==='IDENTITY_CHECKED_UNVERIFIED'&&ids.has(bins.activeId)&&Array.isArray(identity.sides)&&identity.sides.length===2&&identity.sides.every(s=>Number.isInteger(s.decimals)&&s.decimals>=0&&s.decimals<=18);
 return {pool:m.pool,slot:m.contextSlot,observedAtMs:time,rawHash:m.raw.sha256,sdkCommit:identity.sdkCommit,idlBlob:identity.idlBlob,mintX:identity.mintX,mintY:identity.mintY,decimalsX:identity.sides?.[0]?.decimals??null,decimalsY:identity.sides?.[1]?.decimals??null,activeId:bins.activeId,binStep:bins.binStep,scope:'BITMAP_MARKED_ARRAYS_ONLY',status:eligible?'OBSERVED_SNAPSHOT_UNVERIFIED':'PARTIAL_OR_UNSUPPORTED',coverage:bins.coverage??null,arrays:arrays.sort((a,b)=>a.index-b.index)};
}
export function coverage(rows,start,end,cadence){
 if(![start,end,cadence].every(Number.isSafeInteger)||start>=end||cadence<1)throw Error('COVERAGE_WINDOW_INVALID');
 const times=rows.filter(r=>r.status==='OBSERVED_SNAPSHOT_UNVERIFIED'&&r.observedAtMs>=start&&r.observedAtMs<end).map(r=>r.observedAtMs).sort((a,b)=>a-b);
 const buckets=new Set(times.map(t=>Math.floor((t-start)/cadence))),expected=Math.ceil((end-start)/cadence);
 let largest=0;for(let i=0;i<=times.length;i++)largest=Math.max(largest,(times[i]??end)-(times[i-1]??start));
 return {expectedBuckets:expected,observedBuckets:buckets.size,missingBuckets:expected-buckets.size,bucketCoverage:buckets.size/expected,largestObservationGapMs:largest,eligibleObservations:times.length,historyComplete:false,continuousStateProven:false,exactReplayReady:false};
}

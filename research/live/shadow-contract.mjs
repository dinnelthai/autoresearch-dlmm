// T11 contract only. Declared provenance is not independent chain verification.
const assert=(v,m)=>{if(!v)throw Error(m);};
const num=(v,min=0,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const ts=v=>Number.isSafeInteger(v)&&v>=0;
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const address=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const proof=v=>v&&typeof v.path==='string'&&hash(v.sha256);
export function validateFreeze(f){
 assert(f?.schemaVersion===1&&f.policy==='LEGACY_ENGINE_ADAPTIVE_NO_DISPOSAL'&&ts(f.frozenAt)&&hash(f.engineSha256),'invalid frozen policy');
 assert(Array.isArray(f.windows)&&f.windows.length&&f.windows.length<=100,'invalid windows');
 const ids=new Set(),groups=new Map(),mintSplits=new Map();
 for(const w of f.windows){
  assert(typeof w.id==='string'&&w.id&&!ids.has(w.id)&&typeof w.group==='string'&&w.group,'duplicate/missing window id');ids.add(w.id);
  assert(['train','validation','test'].includes(w.split)&&address(w.pool)&&address(w.mintX)&&address(w.mintY)&&w.mintX!==w.mintY,'invalid window identity');
  assert(ts(w.start)&&ts(w.end)&&w.end>w.start&&w.start>=f.frozenAt,'window precedes declared freeze');
  assert(!groups.has(w.group)||groups.get(w.group)===w.split,'group crosses splits');groups.set(w.group,w.split);
  assert(!mintSplits.has(w.mintX)||mintSplits.get(w.mintX)===w.split,'mint crosses splits');mintSplits.set(w.mintX,w.split);
  assert(w.request?.pool===w.pool&&['sol','holding'].includes(w.request.entry)&&w.request.allowDispose===false&&num(w.request.meme)&&num(w.request.sol)&&num(w.request.initialPrice,Number.MIN_VALUE)&&w.request.meme*w.request.initialPrice+w.request.sol>0&&(w.request.entry!=='sol'||w.request.meme===0),'invalid equal-capital request');
  assert(!w.request.positionBins&&!w.request.pendingFeeX&&!w.request.pendingFeeY,'initial LP unsupported in this cohort');
  assert(w.config&&Object.getPrototypeOf(w.config)===Object.prototype,'explicit frozen config required');
 }
 for(let i=0;i<f.windows.length;i++)for(let j=i+1;j<f.windows.length;j++){
  const a=f.windows[i],b=f.windows[j];
  if(a.mintX===b.mintX||a.pool===b.pool)assert(a.end<b.start||b.end<a.start,'overlapping correlated windows');
 }
 return f;
}
export function validateSample(w,s,cfg){
 assert(s?.id===w.id&&s.pool===w.pool&&s.mintX===w.mintX&&s.mintY===w.mintY&&s.start===w.start&&s.end===w.end,'sample identity mismatch');
 assert(s.source==='REVIEWED_CHAIN_EVIDENCE'&&s.coverage?.status==='DECLARED_RECONCILED_COMPLETE'&&proof(s.coverage.evidence)&&Array.isArray(s.coverage.gaps)&&!s.coverage.gaps.length,'coverage evidence required');
 assert(Array.isArray(s.events)&&s.events.length>=4&&s.events.length<=5000,'event count outside bounded replay');
 const ids=new Set(),venues=new Set();let last=-1,chainOrder=null,marketCount=0,swapCount=0,lastMarket=null;
 for(const e of s.events){
  assert(typeof e.id==='string'&&e.id&&!ids.has(e.id)&&e.pool===w.pool&&proof(e.evidence),'event identity/provenance missing');ids.add(e.id);
  assert(ts(e.t)&&ts(e.observedAt)&&ts(e.availableAt)&&e.observedAt<=e.availableAt&&e.availableAt===e.t&&e.t>=last&&e.t>=w.start&&e.t<=w.end,'event time/order invalid');last=e.t;
  if(e.type==='MARKET'){
   marketCount++;lastMarket=e;
   assert(typeof e.tokenSafe==='boolean'&&num(e.holderShare,0,1)&&num(e.holderOutflow,0,1)&&num(e.buyImbalance,-1,1)&&num(e.flowSol)&&num(e.exitDepth),'market features unavailable');
   assert(Array.isArray(e.references)&&e.references.length>=2,'reference evidence missing');const pools=new Set(),sources=new Set();venues.clear();
   for(const r of e.references){
    assert(address(r.pool)&&r.pool!==w.pool&&!pools.has(r.pool)&&r.mintX===w.mintX&&r.mintY===w.mintY&&typeof r.venue==='string'&&r.venue&&typeof r.source==='string'&&r.source&&proof(r.evidence),'invalid independent reference');
    assert(num(r.price,Number.MIN_VALUE)&&num(r.depth,cfg.minDepthSol)&&ts(r.observedAt)&&ts(r.availableAt)&&r.observedAt<=r.availableAt&&r.availableAt<=e.t&&e.t-r.observedAt<=cfg.maxReferenceAge,'reference lookahead/staleness');
    pools.add(r.pool);sources.add(r.source);venues.add(r.venue);
   }
   assert(venues.size>=2&&sources.size>=2,'reference independence unavailable');
  }else if(e.type==='SWAP'){
   swapCount++;
   assert(e.granularity==='PER_BIN_RECONCILED'&&['LP_BUY','LP_SELL'].includes(e.side)&&Number.isInteger(e.bin)&&num(e.baseQty,Number.MIN_VALUE)&&num(e.externalLiquiditySol,Number.MIN_VALUE)&&num(e.mmFeeX)&&num(e.mmFeeY),'aggregate or unsupported swap');
   assert(ts(e.slot)&&ts(e.txIndex)&&ts(e.instructionIndex)&&ts(e.fillIndex)&&typeof e.signature==='string'&&e.signature,'missing chain order');
   const order=[e.slot,e.txIndex,e.instructionIndex,e.fillIndex];
   if(chainOrder){let i=0;while(i<4&&order[i]===chainOrder[i])i++;assert(i<4&&order[i]>chainOrder[i],'duplicate or reversed chain fill order');}
   chainOrder=order;
   assert(lastMarket&&e.t-lastMarket.t<=cfg.maxReferenceAge,'swap reference unavailable');
  }else if(e.type==='POOL_STATE'){
   assert(Array.isArray(e.bins)&&e.bins.length&&new Set(e.bins.map(b=>b.id)).size===e.bins.length&&e.bins.every(b=>Number.isInteger(b.id)&&num(b.externalLiquiditySol,Number.MIN_VALUE)),'invalid pool state');
  }else if(e.type==='LIQUIDITY_UPDATE'){
   assert(Number.isInteger(e.bin)&&num(e.externalLiquiditySol,Number.MIN_VALUE),'invalid liquidity update');
  }else throw Error('unsupported event type');
 }
 assert(s.events[0].type==='MARKET'&&s.events[0].t===w.start&&lastMarket?.t===w.end&&s.events.at(-1).type==='MARKET'&&marketCount>=3&&swapCount>=1,'missing start/end observations or fills');
 return {marketCount,swapCount};
}

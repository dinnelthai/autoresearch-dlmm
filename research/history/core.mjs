// Historical evidence only. No inference of historical bin state or earnings.
const sig=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v);
export function advance(state,m){
 if(m?.pool!==state.pool||m.indexAddress!==state.pool||m.position!=null||m.commitment!=='finalized'||(m.before??null)!==state.cursor)throw Error('MANIFEST_IDENTITY');
 if(!Array.isArray(m.gaps)||m.gaps.length||!Array.isArray(m.signatures))throw Error('CAPTURE_GAPS');
 if(m.status==='EMPTY_PAGE_OBSERVED_UNVERIFIED'&&m.signatures.length===0)return {...state,status:'SOURCE_EXHAUSTED_UNVERIFIED'};
 if(m.status!=='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED'||!m.signatures.length)throw Error('CAPTURE_INCOMPLETE');
 const seen=new Set();
 let lastSlot=state.lastSlot??Infinity;
 for(const row of m.signatures){
  if(!sig(row.signature)||row.signature===state.cursor||seen.has(row.signature)||!Number.isSafeInteger(row.slot)||row.slot<0||row.slot>lastSlot||!Number.isSafeInteger(row.blockTime)||row.blockTime<0)throw Error('INDEX_ORDER_OR_TIME_INVALID');
  seen.add(row.signature);lastSlot=row.slot;
 }
 const last=m.signatures.at(-1);
 if(m.nextBefore!==last.signature)throw Error('CURSOR_INVALID');
 // Block time can be nonmonotonic: reaching the requested time is not proof of coverage.
 const reached=last.blockTime<=state.since&&m.signatures.every(r=>r.blockTime<=state.since);
 const status=reached?'BOUNDARY_OBSERVED_UNVERIFIED':m.stopReason==='SHORT_PAGE'?'SOURCE_EXHAUSTED_UNVERIFIED':'READY';
 return {...state,cursor:last.signature,lastSlot:last.slot,oldestObserved:Math.min(state.oldestObserved??Infinity,...m.signatures.map(r=>r.blockTime)),signatures:state.signatures+m.signatures.length,status};
}
export function windows(start,end,width=120){
 if(![start,end,width].every(Number.isSafeInteger)||start<0||start>=end||start%3600||end%3600||width<1||width>120||(end-start)>180*86400)throw Error('WINDOW_INVALID');
 const out=[];for(let a=start;a<end;a+=width*3600)out.push({start:a,end:Math.min(end,a+width*3600)});
 return out;
}
export function auditCandles(payload,w){
 if(!Array.isArray(payload?.data)||payload.data.length>200||(payload.timeframe!=null&&payload.timeframe!=='1h'))throw Error('CANDLES_INVALID');
 const seen=new Set(),rows=[];
 for(const r of payload.data){
  const {timestamp:t,open,high,low,close,volume}=r;
  if(!Number.isSafeInteger(t)||t%3600||t<w.start||t>w.end||seen.has(t)||![open,high,low,close,volume].every(Number.isFinite)||low<=0||high<Math.max(open,close)||low>Math.min(open,close)||volume<0)throw Error('CANDLE_INVALID');
  seen.add(t);if(t<w.end)rows.push({timestamp:t,open,high,low,close,volume});
 }
 const missing=[];for(let t=w.start;t<w.end;t+=3600)if(!seen.has(t))missing.push(t);
 return {rows:rows.sort((a,b)=>a.timestamp-b.timestamp),missing};
}

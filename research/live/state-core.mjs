// T07 pure state helpers. An overlap is not evidence of complete chain history.
function mergeHistory(previous,rows,limit=2000){
 if(!Number.isSafeInteger(limit)||limit<1||limit>20000)throw Error("invalid history retention");
 if(!Array.isArray(rows)||rows.length>2000)throw Error("invalid history batch");
 const old=previous?.records??[];
 if(!Array.isArray(old)||old.length>20000)throw Error("invalid retained history");
 const seen=new Map();
 function valid(r){return r&&typeof r.signature==="string"&&r.signature.length>0&&r.signature.length<=128&&Number.isSafeInteger(r.slot)&&r.slot>=0}
 for(const r of old){if(!valid(r)||seen.has(r.signature))throw Error("invalid retained history row");seen.set(r.signature,r)}
 const current=new Set();let added=0,overlap=0;
 for(const r of rows){if(!valid(r)||current.has(r.signature))throw Error("invalid or duplicate history row");current.add(r.signature);const prior=seen.get(r.signature);if(prior){if(prior.slot!==r.slot)throw Error("signature slot conflict");overlap++;}else{seen.set(r.signature,r);added++;}}
 const gap=Boolean(old.length)&&rows.length>0&&overlap===0;
 const ordered=[...seen.values()].sort((a,b)=>b.slot-a.slot||a.signature.localeCompare(b.signature)),records=ordered.slice(0,limit);
 const dropped=ordered.length-records.length;
 const gapObserved=gap||previous?.gapObserved===true||previous?.status==="OVERLAP_MISSING";
 return {records,status:gapObserved?"OVERLAP_MISSING":!rows.length?"EMPTY_OR_UNAVAILABLE":"BOUNDED_HISTORY_UNVERIFIED",added,overlap,gapObserved,retentionLimit:limit,retentionTruncated:previous?.retentionTruncated===true||dropped>0,droppedThisMerge:dropped,historyComplete:false};
}
function streamHealth(stream,now,maxAgeMs){if(!stream||stream.status!=="CAPTURED_UNVERIFIED"||!Number.isFinite(stream.receivedAt)||stream.receivedAt>now||now-stream.receivedAt>maxAgeMs)return "UNAVAILABLE_OR_STALE";return "RECENT_UNVERIFIED";}
function pendingStream(old,startedAt){return {status:"PENDING",startedAt,previousEvidence:old?.evidence??old?.previousEvidence??null};}
// Round robin one history stream per service tick. --once retains full diagnostic sweep.
function historyBatch(addresses,cursor,once=false){if(!Array.isArray(addresses)||!addresses.length||!Number.isSafeInteger(cursor)||cursor<0)throw Error("invalid history scheduler");const i=cursor%addresses.length;return {addresses:once?addresses.slice():[addresses[i]],nextCursor:(i+1)%addresses.length};}
export {mergeHistory,streamHealth,pendingStream,historyBatch};

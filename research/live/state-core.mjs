// T07 pure state helpers. An overlap is not evidence of a complete chain history.
function mergeHistory(previous,rows){
 if(!Array.isArray(rows)||!rows.length)return {...previous,status:"EMPTY_OR_UNAVAILABLE",added:0};
 const seen=new Map((previous?.records??[]).map(r=>[r.signature,r]));
 const current=new Set();let added=0,overlap=0;for(const r of rows){if(typeof r.signature!=="string"||!Number.isSafeInteger(r.slot)||r.slot<0||current.has(r.signature))throw Error("invalid or duplicate history row");current.add(r.signature);const old=seen.get(r.signature);if(old){if(old.slot!==r.slot)throw Error("signature slot conflict");overlap++;}else{seen.set(r.signature,r);added++;}}
 const gap=Boolean(previous?.records?.length)&&overlap===0;
 const records=[...seen.values()].sort((a,b)=>b.slot-a.slot||a.signature.localeCompare(b.signature));
 return {records,status:gap?"OVERLAP_MISSING":previous?.status==="OVERLAP_MISSING"?"OVERLAP_MISSING":"BOUNDED_HISTORY_UNVERIFIED",added,overlap};
}
function streamHealth(stream,now,maxAgeMs){if(!stream||stream.status!=="CAPTURED_UNVERIFIED"||!Number.isFinite(stream.receivedAt)||stream.receivedAt>now||now-stream.receivedAt>maxAgeMs)return "UNAVAILABLE_OR_STALE";return "RECENT_UNVERIFIED";}
export {mergeHistory,streamHealth};

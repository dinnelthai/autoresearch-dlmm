const addr=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const assert=(v,m)=>{if(!v)throw Error(m)};
export function positionIndex(m,pool,wallet,now=Date.now()){
 const time=Date.parse(m?.receivedAt);
 assert(m?.status==='INDEX_CAPTURED_UNVERIFIED'&&m.pool===pool&&m.owner===wallet&&addr(pool)&&addr(wallet)&&hash(m.rawHash)&&Number.isSafeInteger(m.slot)&&m.slot>=0&&Array.isArray(m.positions)&&m.positions.length<=5000&&Number.isFinite(time)&&time<=now&&now-time<120000,'POSITION_INDEX_INVALID');
 const seen=new Set();for(const p of m.positions){assert(addr(p.address)&&p.owner===wallet&&!seen.has(p.address),'POSITION_INDEX_IDENTITY_MISMATCH');seen.add(p.address)}
 return {pool,wallet,status:m.status,slot:m.slot,receivedAt:time,expiresAt:time+120000,total:m.positions.length,truncated:m.positions.length>100,positions:m.positions.slice(0,100).map(p=>({address:p.address,owner:p.owner})),decisionReady:false,executionReady:false};
}
export function positionDetail(r,{pool,wallet,position,slot,rawHash}){
 assert(r?.pool===pool&&r.owner===wallet&&r.position===position&&r.slot===slot&&r.rawHash===rawHash&&hash(rawHash)&&Number.isSafeInteger(r.lowerBinId)&&Number.isSafeInteger(r.upperBinId)&&r.lowerBinId<=r.upperBinId,'POSITION_DETAIL_IDENTITY_MISMATCH');
 const base={pool,wallet,position,slot,lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,status:r.status,decisionReady:false,executionReady:false};
 if(r.status==='POSITION_CALCULATED_UNVERIFIED')return {...base,snapshot:r};
 assert(r.status==='PARTIAL'&&r.reason==='POSITION_BIN_VERSION_UNSUPPORTED','POSITION_DETAIL_UNAVAILABLE');
 return {...base,reason:r.reason,binArrayVersion:r.binArrayVersion};
}

// T08: deterministic input normalization; no RPC or execution.
import {hash} from './research-contract.mjs';
function rawHuman(raw,decimals){
 if(typeof raw!=="string"||!/^\d+$/.test(raw)||!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error("invalid raw amount or decimals");
 const n=BigInt(raw);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error("raw amount exceeds safe float boundary");
 return Number(n)/10**decimals;
}
function checkTime(observedAt,availableAt,asOf,maxAge){
 if(![observedAt,availableAt,asOf,maxAge].every(Number.isSafeInteger)||observedAt<0||observedAt>availableAt||availableAt>asOf||maxAge<=0||asOf-observedAt>maxAge)throw Error("invalid/stale/future observation boundary");
}
function extractMarket(state){
 const m=state?.streams?.market;
 if(m?.status!=="CAPTURED_UNVERIFIED")throw Error("market stream unavailable");
 const e=m.evidence,a=e?.identity,b=e?.bins;
 if(!e||!a||!b||a.status!=="IDENTITY_CHECKED_UNVERIFIED"||b.status!=="BITMAP_COVERAGE_CHECKED_UNVERIFIED"||a.pool!==state.pool||b.pool!==state.pool||a.slot!==e.slot||b.slot!==e.slot||a.rawHash!==b.rawHash||!hash(a.rawHash)||a.mintX!==b.mintX||a.mintY!==b.mintY||a.activeId!==b.activeId||a.binStep!==b.binStep||a.orientation!=="MEME_X_SOL_Y"||a.sides?.length!==2||a.sides[0].mint!==a.mintX||a.sides[1].mint!==a.mintY||a.sides[1].decimals!==9)throw Error("market identity or capture mismatch");
 if(!Number.isSafeInteger(e.slot)||e.slot<0||!Number.isInteger(a.binStep)||a.binStep<=0||!Number.isInteger(a.activeId)||!Array.isArray(b.arrays)||b.coverage?.missing!==0||b.coverage?.unsupported!==0||b.coverage?.expected!==b.arrays.length||b.coverage?.decoded!==b.arrays.length)throw Error("incomplete market coverage");
 const bins=b.arrays.flatMap(x=>{if((x.version!==2&&x.version!==3)||x.bins?.length!==70)throw Error("unsupported array");if(x.version===2&&x.bins.some(r=>r.openOrderAmountRaw!==null||r.totalProcessingOrderAmountRaw!==null||r.processedOrderRemainingAmountRaw!==null))throw Error("v2 order semantics unknown");return x.bins;});
 if(new Set(bins.map(x=>x.binId)).size!==bins.length||!bins.every(x=>Number.isInteger(x.binId)))throw Error("invalid bin ids");
 return {capture:e.capture,slot:e.slot,rawHash:a.rawHash,pool:state.pool,mintX:a.mintX,mintY:a.mintY,decimalsX:a.sides[0].decimals,decimalsY:9,binStep:a.binStep,activeId:a.activeId,bins,receivedAt:m.receivedAt};
}
export {rawHuman,checkTime,extractMarket};

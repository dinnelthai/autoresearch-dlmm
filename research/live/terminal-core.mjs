// T12 local terminal contract. Read-only, no SDK signing or execution.
import {extractMarket} from './engine-input.mjs';
const assert=(x,m)=>{if(!x)throw Error(m)};
export const poolAddress=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const finite=(x,min,max=Infinity)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
export function toRaw(value,decimals){
 assert(typeof value==='string'&&/^\d+(\.\d+)?$/.test(value)&&value.length<=40&&Number.isInteger(decimals)&&decimals>=0&&decimals<=18,'INVALID_AMOUNT');
 const [whole,frac='']=value.split('.');assert(frac.length<=decimals,'AMOUNT_PRECISION_EXCEEDED');
 const raw=BigInt(whole)*10n**BigInt(decimals)+BigInt(frac.padEnd(decimals,'0')||'0');
 assert(raw<=BigInt(Number.MAX_SAFE_INTEGER),'AMOUNT_EXCEEDS_MODEL_PRECISION');return raw.toString();
}
export function currentMarket(state,pool,now,maxAgeMs){
 assert(poolAddress(pool)&&state?.pool===pool&&state.schemaVersion===1&&state.decisionReady===false&&Number.isSafeInteger(state.sequence),'STATE_IDENTITY_MISMATCH');
 const m=extractMarket(state);
 assert(Number.isSafeInteger(m.receivedAt)&&m.receivedAt<=now&&now-m.receivedAt<=maxAgeMs,'MARKET_LOCAL_RECEIPT_STALE');
 assert(Number.isInteger(m.decimalsX)&&m.decimalsX>=0&&m.decimalsX<=18,'MINT_PRECISION_UNSUPPORTED');
 return m;
}
export function requestFromDraft(d,m){
 assert(d?.kind==='UX_DRAFT_NOT_ENGINE_REQUEST'&&d.schemaVersion===1&&d.pool===m.pool&&d.capitalScope==='USER_DECLARED_ALLOCATION'&&d.allowDispose===false,'DRAFT_IDENTITY_MISMATCH');
 assert(['sol','holding'].includes(d.entry)&&['balanced','defensive','growth'].includes(d.goal)&&Number.isSafeInteger(d.horizonSeconds)&&d.horizonSeconds>0&&d.horizonSeconds<=30*86400,'INVALID_REQUEST');
 const solRaw=toRaw(d.solHuman,m.decimalsY),memeRaw=toRaw(d.memeHuman,m.decimalsX);
 assert(d.entry==='sol'?BigInt(solRaw)>0n&&BigInt(memeRaw)===0n:BigInt(memeRaw)>0n,'INVALID_ENTRY_ASSETS');
 const bounds={maxInventoryRatio:[0,1],maxInventoryTokens:[0],minSolReserve:[0],maxLossSol:[0],stressDrop:[0,1],maxBinShare:[Number.MIN_VALUE,1],operationCostSol:[0],feeBps:[0,9999],protocolShare:[0,1],slippageBps:[0,9999]};
 const riskConfig={};for(const [k,[lo,hi]] of Object.entries(bounds)){const v=d.riskConfig?.[k];assert(finite(v,lo,hi),'INVALID_RISK_'+k);riskConfig[k]=v}
 assert(riskConfig.minSolReserve+riskConfig.operationCostSol<=Number(solRaw)/10**m.decimalsY,'SOL_RESERVE_AND_COST_EXCEED_BUDGET');
 return {pool:m.pool,entry:d.entry,goal:d.goal,horizonSeconds:d.horizonSeconds,capitalScope:'USER_DECLARED_ALLOCATION',allowDispose:false,solRaw,memeRaw,riskConfig};
}
export function reviewMatches(review,m,now){
 const t=Math.floor(now/1000);
 assert(review?.pool===m.pool&&review.marketSlot===m.slot&&review.marketRawHash===m.rawHash&&review.mintX===m.mintX&&review.mintY===m.mintY,'REVIEW_SNAPSHOT_MISMATCH');
 assert(Number.isSafeInteger(review.asOf)&&Number.isSafeInteger(review.maxAgeSeconds)&&review.maxAgeSeconds>0&&review.maxAgeSeconds<=600&&review.asOf<=t&&t-review.asOf<=review.maxAgeSeconds,'REVIEW_STALE_OR_INVALID');
 const latest=review.observations?.at(-1);assert(Number.isSafeInteger(review.marketObservedAt)&&review.marketObservedAt<=t&&t-review.marketObservedAt<=review.maxAgeSeconds&&Number.isSafeInteger(latest?.t)&&latest.t<=t&&t-latest.t<=review.maxAgeSeconds,'REVIEW_OBSERVATION_STALE');
}

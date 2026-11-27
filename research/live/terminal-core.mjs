// T12 local terminal contract. Read-only, no SDK signing or execution.
import {config as engineConfig} from '../engine/numeric.mjs';
import {extractMarket} from './engine-input.mjs';
import {assert,poolAddress,finite,hash,sameSnapshot} from './research-contract.mjs';
export {poolAddress} from './research-contract.mjs';
const allocationBounds=Object.freeze({maxInventoryRatio:[0,1],maxInventoryTokens:[0],minSolReserve:[0],maxLossSol:[0],stressDrop:[0,1],maxBinShare:[Number.MIN_VALUE,1],operationCostSol:[0],feeBps:[0,9999],protocolShare:[0,1],slippageBps:[0,9999]});
function parseRiskConfig(input,bounds){const result={};for(const [k,[lo,hi]] of Object.entries(bounds)){const v=input?.[k];assert(finite(v,lo,hi),'INVALID_RISK_'+k);result[k]=v}return result}
// Optional market-model overrides; existing drafts retain the original defaults.
const regimeKeys=['regimeLookback','regimeMinObservations','trendEfficiencyThreshold','trendLogReturnThreshold','stressLogReturnThreshold','holderOutflowThreshold','toxicMarkoutBps','toxicMarkoutMinSamples'];
export function marketModelOverrides(input={}){
 assert(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_MARKET_MODEL_CONFIG');
 assert(Object.keys(input).every(k=>regimeKeys.includes(k)),'INVALID_MARKET_MODEL_KEY');
 const checked=engineConfig(input);
 return Object.fromEntries(Object.keys(input).map(k=>[k,checked[k]]));
}
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
 const riskConfig={...parseRiskConfig(d.riskConfig,allocationBounds),...marketModelOverrides(d.marketModel)};
 assert(riskConfig.minSolReserve+riskConfig.operationCostSol<=Number(solRaw)/10**m.decimalsY,'SOL_RESERVE_AND_COST_EXCEED_BUDGET');
 return {pool:m.pool,entry:d.entry,goal:d.goal,horizonSeconds:d.horizonSeconds,capitalScope:'USER_DECLARED_ALLOCATION',allowDispose:false,solRaw,memeRaw,riskConfig};
}
export function reviewMatches(review,m,now){
 const t=Math.floor(now/1000);
 assert(review?.pool===m.pool&&sameSnapshot({slot:review.marketSlot,rawHash:review.marketRawHash},m)&&review.mintX===m.mintX&&review.mintY===m.mintY,'REVIEW_SNAPSHOT_MISMATCH');
 assert(Number.isSafeInteger(review.asOf)&&Number.isSafeInteger(review.maxAgeSeconds)&&review.maxAgeSeconds>0&&review.maxAgeSeconds<=600&&review.asOf<=t&&t-review.asOf<=review.maxAgeSeconds,'REVIEW_STALE_OR_INVALID');
 const latest=review.observations?.at(-1);assert(Number.isSafeInteger(review.marketObservedAt)&&review.marketObservedAt<=t&&t-review.marketObservedAt<=review.maxAgeSeconds&&Number.isSafeInteger(latest?.t)&&latest.t<=t&&t-latest.t<=review.maxAgeSeconds,'REVIEW_OBSERVATION_STALE');
}

/** Status-only monitoring. No price or action inference from a range alone. */
export function positionCapture(state,m,address,now,maxAgeMs){
 assert(poolAddress(address),'INVALID_POSITION_ADDRESS');
 const stream=state?.streams?.['position:'+address],p=stream?.evidence?.report;
 assert(stream?.status==='CAPTURED_UNVERIFIED'&&p?.status==='POSITION_CALCULATED_UNVERIFIED'&&p.position===address&&p.pool===state.pool,'POSITION_CAPTURE_UNAVAILABLE');
 assert(Number.isSafeInteger(stream.receivedAt)&&stream.receivedAt<=now&&now-stream.receivedAt<maxAgeMs,'POSITION_CAPTURE_STALE');
 const snap=p.snapshot;
 assert(poolAddress(p.owner)&&Number.isSafeInteger(p.slot)&&hash(p.rawHash)&&snap?.position===address&&snap.pool===state.pool&&snap.slot===p.slot&&snap.tokenOrientation==='MEME_X_SOL_Y'&&snap.tokenExtensions===false&&Number.isInteger(snap.decimalsX)&&snap.decimalsX>=0&&snap.decimalsX<=18&&snap.decimalsY===9,'POSITION_IDENTITY_MISMATCH');
 assert(Number.isSafeInteger(p.lowerBinId)&&Number.isSafeInteger(p.upperBinId)&&p.lowerBinId<=p.upperBinId,'POSITION_RANGE_INVALID');
 const common=sameSnapshot(p,m)&&snap.decimalsX===m.decimalsX&&snap.binStep===String(m.binStep)&&stream.evidence.commonMarketCapture===true;
 const rangeState=common?(m.activeId<p.lowerBinId?'BELOW_RANGE':m.activeId>p.upperBinId?'ABOVE_RANGE':'IN_RANGE'):'UNKNOWN';
 return {report:p,commonMarketCapture:common,rangeState,expiresAt:stream.receivedAt+maxAgeMs};
}
export function managementRequest(policy,m,p){
 assert(policy?.schemaVersion===1&&policy.pool===m.pool&&policy.position===p.position&&policy.owner===p.owner&&policy.capitalScope==='USER_DECLARED_ALLOCATION'&&policy.allowDispose===false,'MANAGEMENT_POLICY_IDENTITY_MISMATCH');
 assert(['balanced','defensive','growth'].includes(policy.goal)&&Number.isSafeInteger(policy.horizonSeconds)&&policy.horizonSeconds>0&&policy.horizonSeconds<=30*86400,'INVALID_MANAGEMENT_HORIZON');
 const solRaw=toRaw(policy.extraSolHuman,m.decimalsY),memeRaw=toRaw(policy.extraMemeHuman,m.decimalsX);
 // These are expressly declared additional assets, not current position principal or wallet balance.
 const riskConfig=parseRiskConfig(policy.riskConfig,{...allocationBounds,cooldownSeconds:[0],maxRebalances:[0],maxTurnoverSol:[0]});
 assert(Number.isSafeInteger(riskConfig.cooldownSeconds)&&Number.isSafeInteger(riskConfig.maxRebalances),'INVALID_MANAGEMENT_COUNTER_LIMIT');
 return {pool:m.pool,position:p.position,entry:'position',goal:policy.goal,horizonSeconds:policy.horizonSeconds,capitalScope:'USER_DECLARED_ALLOCATION',allowDispose:false,solRaw,memeRaw,riskConfig};
}

/** Display-only projection, never a reference price or executable quote. */
export function marketDisplay(m,limit=1500){
 assert(Number.isInteger(limit)&&limit>0&&limit<=1500,'INVALID_DISPLAY_LIMIT');
 const raw=(v,bits)=>typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<BigInt(bits));
 assert(Number.isInteger(m.decimalsX)&&m.decimalsX>=0&&m.decimalsX<=18&&m.decimalsY===9&&Number.isInteger(m.activeId)&&Array.isArray(m.bins),'INVALID_DISPLAY_MARKET');
 let x=0n,y=0n;
 const bins=m.bins.map(b=>{
  assert(Number.isInteger(b.binId)&&raw(b.amountXRaw,64)&&raw(b.amountYRaw,64)&&raw(b.priceQ64Raw,128),'INVALID_DISPLAY_BIN');
  x+=BigInt(b.amountXRaw);y+=BigInt(b.amountYRaw);
  const p=Number(b.priceQ64Raw)/2**64*10**(m.decimalsX-m.decimalsY);
  return {binId:b.binId,amountXRaw:b.amountXRaw,amountYRaw:b.amountYRaw,priceSolPerMeme:Number.isFinite(p)&&p>0?p:null};
 });
 const active=bins.find(b=>b.binId===m.activeId);
 const rows=bins.sort((a,b)=>Math.abs(a.binId-m.activeId)-Math.abs(b.binId-m.activeId)||a.binId-b.binId).slice(0,limit).sort((a,b)=>a.binId-b.binId);
 return {kind:'POOL_OBSERVATION_ONLY',activeBinPriceSolPerMeme:active?.priceSolPerMeme??null,totalXRaw:x.toString(),totalYRaw:y.toString(),totalBins:bins.length,rows};
}

/** Only these read-only endpoints accept an explicit pool scope. */
export function scopedTerminalRequest(raw,defaultPool){
 assert(typeof raw==='string'&&raw.startsWith('/')&&!raw.startsWith('//'),'INVALID_TERMINAL_PATH');
 const url=new URL(raw,'http://127.0.0.1'),allowed=new Set(['/api/terminal/state','/api/terminal/pool-info','/api/terminal/price-history','/api/terminal/monitor','/api/terminal/input-status','/api/terminal/research-catalog','/api/terminal/paper-status','/api/terminal/paper-context','/api/terminal/paper-reports']);
 if(!url.search)return {path:url.pathname,pool:defaultPool};
 assert(allowed.has(url.pathname)&&[...url.searchParams].length===1&&url.searchParams.has('pool'),'INVALID_TERMINAL_SCOPE');
 const pool=url.searchParams.get('pool');assert(poolAddress(pool),'INVALID_POOL_ADDRESS');
 return {path:url.pathname,pool};
}

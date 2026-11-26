// Recompute observations from archived source-specific payloads. No independent review or chain-time certification.
import {sha} from './evidence-digest.mjs';
import {assert,hash} from './research-contract.mjs';
import {discoverDirectPairs,normalizeRaydiumQuote,normalizeOrcaQuote,probeConfig} from './external-market.mjs';
import {quoteMath} from './reference-math.mjs';
export function distinctReferenceArtifacts(refs){return Array.isArray(refs)&&refs.length>=2&&refs.every(r=>hash(r?.evidence?.sha256)&&typeof r.evidence.path==='string')&&new Set(refs.map(r=>r.evidence.sha256)).size===refs.length&&new Set(refs.map(r=>r.evidence.path)).size===refs.length}
export async function verifyQuoteEvidence(report,m,read){
 assert(report?.pool===m.pool&&report.mintX===m.mintX&&report.mintY===m.mintY&&report.marketSlot===m.slot&&report.marketRawHash===m.rawHash&&report.decimalsX===m.decimalsX&&report.scope==='EXTERNAL_DISPLAY_ONLY'&&Array.isArray(report.evidence)&&report.evidence.length<=11&&Number.isSafeInteger(report.startedAt)&&Number.isSafeInteger(report.fetchedAt)&&report.startedAt<=report.fetchedAt,'QUOTE_EVIDENCE_SCOPE');
 const probes=probeConfig(m,{probeSolRaw:report.probes?.buyRaw,sellRaw:report.probes?.sellRaw,slippageBps:report.probes?.slippageBps,maxDiscountBps:report.probes?.maxDiscountBps});
 const records=new Map(),digests=new Set();
 for(const e of report.evidence){
  assert(/^(pairs|ask|bid-[0-3]|orca-ask|orca-bid-[0-3])\.json$/.test(e.file)&&!records.has(e.file)&&hash(e.sha256)&&Number.isSafeInteger(e.receivedAt)&&e.receivedAt>=report.startedAt&&e.receivedAt<=report.fetchedAt,'QUOTE_EVIDENCE_RECORD');
  const bytes=await read(e.file);assert(bytes.length<=1024*1024&&sha(bytes)===e.sha256,'QUOTE_EVIDENCE_HASH_MISMATCH');records.set(e.file,{...e,payload:JSON.parse(bytes)});
 }
 const index=records.get('pairs.json');
 if(!index){assert(!report.raydium?.midSolPerMeme&&!report.orca?.midSolPerMeme,'QUOTE_PAIR_EVIDENCE_REQUIRED');return {scope:'RAW_QUOTE_RECHECK_ONLY',venues:[],independentReview:false,modelEligible:false}}
 assert(index.url==='https://api.dexscreener.com/token-pairs/v1/solana/'+m.mintX,'QUOTE_INDEX_SOURCE');
 const candidates=discoverDirectPairs(index.payload,m),venues=[];
 for(const venue of ['raydium','orca']){
  const observed=report[venue];if(!(observed?.midSolPerMeme>0))continue;
  const orca=venue==='orca',prefix=orca?'orca-':'',allowed=new Set(candidates.filter(p=>p.venue===venue).map(p=>p.pool));
  const parse=(name,inputMint,outputMint,amount,required)=>{
   const e=records.get(prefix+name+'.json');if(!e){assert(!required,'QUOTE_RAW_REQUIRED');return {status:'QUOTE_UNAVAILABLE',inRaw:amount}}
   const url=new URL(e.url),expected=orca?'https://api.jup.ag/swap/v1/quote':'https://transaction-v1.raydium.io/compute/swap-base-in';
   assert(url.origin+url.pathname===expected&&!url.username&&!url.password&&!url.hash,'QUOTE_PROVIDER_MISMATCH');
   for(const [k,val] of Object.entries({inputMint,outputMint,amount,slippageBps:String(probes.slippageBps),...(orca?{swapMode:'ExactIn',onlyDirectRoutes:'true',dexes:'Whirlpool',instructionVersion:'V2'}:{txVersion:'V0'})}))assert(url.searchParams.getAll(k).length===1&&url.searchParams.get(k)===val,'QUOTE_REQUEST_MISMATCH');
   const req={inputMint,outputMint,amount,slippageBps:probes.slippageBps,minSlot:m.slot};
   try{const row=(orca?normalizeOrcaQuote:normalizeRaydiumQuote)(e.payload,req,allowed);assert(!digests.has(e.sha256),'QUOTE_REUSED_RESPONSE');digests.add(e.sha256);return row}catch(err){if(required||err.message==='QUOTE_REUSED_RESPONSE')throw err;return {status:'QUOTE_UNAVAILABLE',inRaw:amount}}
  };
  const ask=parse('ask',m.mintY,m.mintX,probes.buyRaw,true),bid=parse('bid-0',m.mintX,m.mintY,probes.sellRaw[0],true);
  assert(ask.pool===bid.pool&&bid.pool===observed.pool&&(!orca||Math.abs(ask.contextSlot-bid.contextSlot)<=40),'QUOTE_POOL_MISMATCH');
  const ladder=probes.sellRaw.map((n,i)=>{const x=i===0?bid:parse('bid-'+i,m.mintX,m.mintY,n,false);return x.status==='FULL_QUOTE'&&(x.pool!==bid.pool||(orca&&Math.abs(x.contextSlot-bid.contextSlot)>40))?{status:'QUOTE_UNAVAILABLE',inRaw:n}:x});
  const math=quoteMath(bid,ask,ladder,probes.maxDiscountBps),mid=Number(math.midRawRatio.numerator)/Number(math.midRawRatio.denominator)*10**(m.decimalsX-9);
  assert(mid===observed.midSolPerMeme&&JSON.stringify(math.bestTestedExit)===JSON.stringify(observed.bestTestedExit),'QUOTE_RECOMPUTATION_MISMATCH');
  venues.push({venue,pool:bid.pool,midSolPerMeme:mid,bestTestedExit:math.bestTestedExit,chainTimeVerified:false});
 }
 assert(new Set(venues.map(x=>x.pool)).size===venues.length,'QUOTE_DUPLICATE_POOL');
 return {scope:'RAW_QUOTE_RECHECK_ONLY',venues,independentReview:false,modelEligible:false};
}

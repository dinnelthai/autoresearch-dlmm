// External market diagnostics: no transaction construction, no wallet, no review promotion.
import {createHash} from 'node:crypto';
import {quoteMath} from './reference-math.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const key=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const pos=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<(1n<<64n);
const metric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const nativePrice=v=>typeof v==='string'&&/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const sha=v=>createHash('sha256').update(v).digest('hex');
export function discoverDirectPairs(payload,m){
 assert(Array.isArray(payload)&&payload.length<=2000,'PAIR_INDEX_INVALID');
 const seen=new Set(),rows=[];
 for(const p of payload){
  if(p?.chainId!=='solana'||!key(p.pairAddress)||p.pairAddress===m.pool||p.baseToken?.address!==m.mintX||p.quoteToken?.address!==m.mintY||typeof p.dexId!=='string'||!/^[a-z0-9_-]{1,40}$/i.test(p.dexId)||seen.has(p.pairAddress))continue;
  seen.add(p.pairAddress);
  rows.push({pool:p.pairAddress,venue:p.dexId,priceSolPerMeme:nativePrice(p.priceNative),liquidityUsd:metric(p.liquidity?.usd),volume24hUsd:metric(p.volume?.h24)});
 }
 return rows.sort((a,b)=>(b.liquidityUsd??-1)-(a.liquidityUsd??-1)).slice(0,20);
}
export function normalizeRaydiumQuote(p,q,allowedPools){
 const d=p?.data,route=d?.routePlan;
 assert(p?.success===true&&d?.swapType==='BaseIn'&&d.inputMint===q.inputMint&&d.outputMint===q.outputMint&&d.inputAmount===q.amount&&d.slippageBps===q.slippageBps&&pos(d.inputAmount)&&pos(d.outputAmount)&&pos(d.otherAmountThreshold),'RAYDIUM_QUOTE_INVALID');
 assert(Array.isArray(route)&&route.length===1&&key(route[0].poolId)&&allowedPools.has(route[0].poolId)&&route[0].inputMint===q.inputMint&&route[0].outputMint===q.outputMint,'RAYDIUM_ROUTE_NOT_DIRECT_OR_UNMATCHED');
 assert(BigInt(d.otherAmountThreshold)<=BigInt(d.outputAmount)&&BigInt(d.otherAmountThreshold)*10000n+10000n>=BigInt(d.outputAmount)*BigInt(10000-q.slippageBps),'RAYDIUM_MIN_OUT_INVALID');
 return {status:'FULL_QUOTE',pool:route[0].poolId,inRaw:d.inputAmount,outRaw:d.outputAmount,minOutRaw:d.otherAmountThreshold,priceImpactProvider:metric(d.priceImpactPct)};
}
export function normalizeOrcaQuote(p,q,allowedPools){
 const route=p?.routePlan,a=route?.[0],i=a?.swapInfo;
 assert(p?.swapMode==='ExactIn'&&p.inputMint===q.inputMint&&p.outputMint===q.outputMint&&p.inAmount===q.amount&&p.slippageBps===q.slippageBps&&pos(p.inAmount)&&pos(p.outAmount)&&pos(p.otherAmountThreshold)&&Number.isSafeInteger(p.contextSlot)&&p.contextSlot>=q.minSlot,'ORCA_QUOTE_INVALID');
 assert(Array.isArray(route)&&route.length===1&&a.percent===100&&(a.bps===undefined||a.bps===10000)&&i?.label==='Whirlpool'&&allowedPools.has(i.ammKey)&&i.inputMint===q.inputMint&&i.outputMint===q.outputMint&&i.inAmount===p.inAmount&&i.outAmount===p.outAmount,'ORCA_ROUTE_NOT_DIRECT_OR_UNMATCHED');
 assert(BigInt(p.otherAmountThreshold)<=BigInt(p.outAmount)&&BigInt(p.otherAmountThreshold)*10000n+10000n>=BigInt(p.outAmount)*BigInt(10000-q.slippageBps),'ORCA_MIN_OUT_INVALID');
 return {status:'FULL_QUOTE',pool:i.ammKey,inRaw:p.inAmount,outRaw:p.outAmount,minOutRaw:p.otherAmountThreshold,contextSlot:p.contextSlot};
}
async function get(url,fetcher,headers={}){
 const r=await fetcher(url,{headers,signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!r.ok)throw Error(r.status===429?'EXTERNAL_RATE_LIMITED':'EXTERNAL_HTTP_ERROR');
 const reader=r.body?.getReader();assert(reader,'EXTERNAL_EMPTY_BODY');let size=0,parts=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;assert(size<=1024*1024,'EXTERNAL_RESPONSE_TOO_LARGE');parts.push(Buffer.from(value))}}
 catch(e){await reader.cancel().catch(()=>{});throw e}finally{reader.releaseLock()}
 const raw=Buffer.concat(parts);let payload;try{payload=JSON.parse(raw)}catch{throw Error('EXTERNAL_INVALID_JSON')}
 return {payload,raw,hash:sha(raw),receivedAt:Date.now()};
}
export function probeConfig(m,cfg={}){
 assert(Number.isInteger(m.decimalsX)&&m.decimalsX>=0&&m.decimalsX<=18,'EXTERNAL_DECIMALS_INVALID');
 const buyRaw=cfg.probeSolRaw??'10000000',sellRaw=cfg.sellRaw??[1n,10n,100n].map(x=>(x*10n**BigInt(m.decimalsX)).toString()),slippageBps=cfg.slippageBps??50,maxDiscountBps=cfg.maxDiscountBps??200;
 assert(pos(buyRaw)&&Array.isArray(sellRaw)&&sellRaw.length>=1&&sellRaw.length<=4&&sellRaw.every((x,i)=>pos(x)&&(i===0||BigInt(x)>BigInt(sellRaw[i-1])))&&Number.isInteger(slippageBps)&&Number.isInteger(maxDiscountBps)&&slippageBps>=0&&maxDiscountBps>=slippageBps&&maxDiscountBps<10000,'EXTERNAL_PROBES_INVALID');
 return {buyRaw,sellRaw,slippageBps,maxDiscountBps};
}
export async function observeExternalMarket(m,{config={},fetcher=fetch,archive=async()=>{},jupiterKey=process.env.JUPITER_API_KEY}={}){
 assert(key(m.pool)&&key(m.mintX)&&m.mintY==='So11111111111111111111111111111111111111112'&&m.mintX!==m.mintY,'EXTERNAL_MARKET_IDENTITY_INVALID');
 const probes=probeConfig(m,config),start=Date.now(),evidence=[],gaps=[];
 async function read(url,name,headers){const r=await get(url,fetcher,headers);await archive(name,r.raw);evidence.push({file:name,sha256:r.hash,receivedAt:r.receivedAt,url});return r.payload}
 const output={pool:m.pool,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,marketSlot:m.slot,marketRawHash:m.rawHash,scope:'EXTERNAL_DISPLAY_ONLY',decisionReady:false,executionReady:false,probes,candidates:[],raydium:null,orca:null,comparison:null,evidence,gaps,startedAt:start};
 try{output.candidates=discoverDirectPairs(await read('https://api.dexscreener.com/token-pairs/v1/solana/'+m.mintX,'pairs.json'),m)}catch(e){gaps.push({source:'DEX_SCREENER',reason:/^[A-Z_]+$/.test(e.message)?e.message:'PAIR_DISCOVERY_FAILED'})}
 const allowed=new Set(output.candidates.filter(p=>p.venue==='raydium').map(p=>p.pool));
 if(!allowed.size)gaps.push({source:'RAYDIUM',reason:'NO_DIRECT_RAYDIUM_CANDIDATE'});
 else{
  async function quote(inputMint,outputMint,amount,name){
   const q={inputMint,outputMint,amount,slippageBps:probes.slippageBps};
   const params=new URLSearchParams({...q,slippageBps:String(q.slippageBps),txVersion:'V0'});
   return normalizeRaydiumQuote(await read('https://transaction-v1.raydium.io/compute/swap-base-in?'+params,name),q,allowed);
  }
  const jobs=[quote(m.mintY,m.mintX,probes.buyRaw,'ask.json'),...probes.sellRaw.map((v,i)=>quote(m.mintX,m.mintY,v,'bid-'+i+'.json'))];
  const result=await Promise.allSettled(jobs);
  const ask=result[0].status==='fulfilled'?result[0].value:null,bid=result[1].status==='fulfilled'?result[1].value:null;
  const ladder=result.slice(1).map((r,i)=>r.status==='fulfilled'?r.value:{status:'QUOTE_UNAVAILABLE',inRaw:probes.sellRaw[i]});
  if(result.some(r=>r.status==='rejected'))gaps.push({source:'RAYDIUM',reason:'ONE_OR_MORE_QUOTES_UNAVAILABLE'});
  output.raydium={source:'RAYDIUM_TRADE_API',ask,bid,ladder,midSolPerMeme:null,bestTestedExit:null,scope:'QUOTES_UNVERIFIED'};
  if(ask&&bid&&ask.pool===bid.pool){
   try{
    const consistent=ladder.map(q=>q.status==='FULL_QUOTE'&&q.pool!==bid.pool?{status:'QUOTE_UNAVAILABLE',inRaw:q.inRaw}:q);
    const math=quoteMath(bid,ask,consistent,probes.maxDiscountBps),ratio=math.midRawRatio;
    const mid=Number(ratio.numerator)/Number(ratio.denominator)*10**(m.decimalsX-9);
    assert(Number.isFinite(mid)&&mid>0,'REFERENCE_MID_INVALID');
    Object.assign(output.raydium,{midSolPerMeme:mid,bestTestedExit:math.bestTestedExit,consistentSamples:math.samples,pool:bid.pool});
   }catch{gaps.push({source:'RAYDIUM',reason:'CROSSED_OR_INVALID_PROBE_QUOTES'})}
  }else gaps.push({source:'RAYDIUM',reason:'NO_MATCHING_TWO_SIDED_DIRECT_POOL'});
 }
 const orcaPools=new Set(output.candidates.filter(p=>p.venue==='orca').map(p=>p.pool));
 if(!orcaPools.size)gaps.push({source:'ORCA',reason:'NO_DIRECT_ORCA_CANDIDATE'});
 else if(typeof jupiterKey!=='string'||!jupiterKey||jupiterKey.length>512)gaps.push({source:'ORCA',reason:'JUPITER_API_KEY_NOT_CONFIGURED'});
 else{
  async function quote(inputMint,outputMint,amount,name){
   const q={inputMint,outputMint,amount,slippageBps:probes.slippageBps,minSlot:m.slot};
   const params=new URLSearchParams({inputMint,outputMint,amount,slippageBps:String(q.slippageBps),swapMode:'ExactIn',onlyDirectRoutes:'true',dexes:'Whirlpool',instructionVersion:'V2'});
   return normalizeOrcaQuote(await read('https://api.jup.ag/swap/v1/quote?'+params,name,{'x-api-key':jupiterKey}),q,orcaPools);
  }
  const result=await Promise.allSettled([quote(m.mintY,m.mintX,probes.buyRaw,'orca-ask.json'),...probes.sellRaw.map((n,i)=>quote(m.mintX,m.mintY,n,'orca-bid-'+i+'.json'))]);
  const ask=result[0].status==='fulfilled'?result[0].value:null,bid=result[1].status==='fulfilled'?result[1].value:null;
  const ladder=result.slice(1).map((x,i)=>x.status==='fulfilled'?x.value:{status:'QUOTE_UNAVAILABLE',inRaw:probes.sellRaw[i]});
  output.orca={source:'JUPITER_METIS_ORCA_QUOTE',ask,bid,ladder,midSolPerMeme:null,bestTestedExit:null,scope:'QUOTES_UNVERIFIED'};
  if(result.some(x=>x.status==='rejected'))gaps.push({source:'ORCA',reason:'ONE_OR_MORE_QUOTES_UNAVAILABLE'});
  if(ask&&bid&&ask.pool===bid.pool&&Math.abs(ask.contextSlot-bid.contextSlot)<=40){
   try{const consistent=ladder.map(q=>q.status==='FULL_QUOTE'&&(q.pool!==bid.pool||Math.abs(q.contextSlot-bid.contextSlot)>40)?{status:'QUOTE_UNAVAILABLE',inRaw:q.inRaw}:q);
    const math=quoteMath(bid,ask,consistent,probes.maxDiscountBps),ratio=math.midRawRatio,mid=Number(ratio.numerator)/Number(ratio.denominator)*10**(m.decimalsX-9);
    assert(Number.isFinite(mid)&&mid>0,'ORCA_MID_INVALID');Object.assign(output.orca,{midSolPerMeme:mid,bestTestedExit:math.bestTestedExit,consistentSamples:math.samples,pool:bid.pool});
   }catch{gaps.push({source:'ORCA',reason:'CROSSED_OR_INVALID_PROBE_QUOTES'})}
  }else gaps.push({source:'ORCA',reason:'NO_MATCHING_TWO_SIDED_DIRECT_POOL'});
 }
 const ray=output.raydium,orca=output.orca;
 if(ray?.midSolPerMeme>0&&orca?.midSolPerMeme>0&&ray.pool!==orca.pool){
  const a=ray.midSolPerMeme,b=orca.midSolPerMeme;
  output.comparison={status:'TWO_VENUES_OBSERVED_UNVERIFIED',relativeDivergence:Math.abs(a-b)/Math.min(a,b),independentReview:false};
 }
 output.fetchedAt=Date.now();output.expiresAt=Math.min(output.fetchedAt+30000,...evidence.map(x=>x.receivedAt+30000));
 output.status=output.comparison?'TWO_VENUES_OBSERVED_UNVERIFIED':ray?.midSolPerMeme>0||orca?.midSolPerMeme>0?'OBSERVED_UNVERIFIED':'PARTIAL';
 return output;
}

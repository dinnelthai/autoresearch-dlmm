// Pure integer subset of Meteora SDK formulas; no RPC or signing.
// SDK reference: MeteoraAg/dlmm-sdk@1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1
// Scope: Q64 price, fee math, ordinary-MM exact-in bin quote, current-position accounting.
// Not a full on-chain replay: no transfer extensions, limit orders, fee growth mutations or bin traversal.
function makeIntegerKernel(){
  const Q=1n<<64n,U128=(1n<<128n)-1n,U64=(1n<<64n)-1n,F=1000000000n,MAX_FEE=100000000n,BPS=10000n;
  const SDK_COMMIT="1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1";
  function uint(v,name,max=U128){if(typeof v!=="bigint"&&(typeof v!=="string"||!/^\d+$/.test(v)))throw Error(name+" must be a decimal integer string or bigint");const n=BigInt(v);if(n<0n||n>max)throw Error(name+" out of range");return n;}
  function id(v){if(!Number.isInteger(v)||Math.abs(v)>=0x80000)throw Error("bin id outside supported Q64 subset");return v}
  function ceil(n,d){if(d<=0n)throw Error("invalid denominator");return (n+d-1n)/d}
  function mulDiv(x,y,d,up=false){if(d<=0n)throw Error("invalid denominator");return up?ceil(x*y,d):x*y/d}
  function qPrice(binId,step){id(binId);const bps=uint(step,"binStep",65535n);if(bps===0n)throw Error("zero bin step");if(binId===0)return Q;let n=Math.abs(binId),base=U128/(Q+(bps*Q/BPS)),res=Q;while(n){if(n%2)res=res*base/Q;n=Math.floor(n/2);if(n)base=base*base/Q;}if(res===0n)throw Error("Q64 underflow");return binId>0?U128/res:res;}
  function feeRate(p){const step=uint(p.binStep,"binStep",65535n),base=uint(p.baseFactor,"baseFactor",65535n),power=uint(p.baseFeePowerFactor,"baseFeePowerFactor",18n),vc=uint(p.variableFeeControl,"variableFeeControl",(1n<<32n)-1n),va=uint(p.volatilityAccumulator,"volatilityAccumulator",(1n<<32n)-1n);if(!step)throw Error("zero bin step");const b=base*step*10n*10n**power,v=ceil(vc*(va*step)**2n,100000000000n);return {base:b,variable:v,total:b+v>MAX_FEE?MAX_FEE:b+v};}
  function exclude(gross,rate){gross=uint(gross,"gross",U64);rate=uint(rate,"fee rate",MAX_FEE);const fee=ceil(gross*rate,F);return {net:gross-fee,fee};}
  function include(net,rate){net=uint(net,"net",U64);rate=uint(rate,"fee rate",MAX_FEE);const gross=ceil(net*F,F-rate);if(gross>U64)throw Error("gross overflow");return {gross,fee:gross-net};}
  function quoteMMExactIn(b,amount,swapForY,parameters){
    if(b.supportLimitOrder!==false||b.feeOnInput!==true||b.tokenExtensions!==false)throw Error("requires explicit ordinary MM, input fee, no token extensions");
    if(typeof swapForY!=="boolean")throw Error("swap direction required");
    const price=uint(b.priceQ64,"priceQ64"),x=uint(b.amountX,"amountX",U64),y=uint(b.amountY,"amountY",U64),rate=feeRate(parameters).total,protocol=uint(parameters.protocolShare,"protocolShare",BPS);
    if(!price)throw Error("zero price");let gross=uint(amount,"amountIn",U64),{net,fee}=exclude(gross,rate);
    const cap=swapForY?y:x,desired=swapForY?net*price/Q:net*Q/price;
    let out=desired;
    if(desired>=cap){out=cap;net=swapForY?ceil(cap*Q,price):ceil(cap*price,Q);({gross,fee}=include(net,rate));}
    if(out===0n)return {amountIn:0n,amountOut:0n,fee:0n,protocolFee:0n,mmFee:0n,remaining: uint(amount,"amountIn",U64),status:"NO_OUTPUT"};
    const protocolFee=fee*protocol/BPS;return {amountIn:gross,amountOut:out,fee,protocolFee,mmFee:fee-protocolFee,remaining:uint(amount,"amountIn",U64)-gross,status:"ORDINARY_MM_QUOTE"};
  }
  function positionBin(b){
    id(b.binId);
    const supply=uint(b.supply,"supply"),share=uint(b.share,"share"),x=uint(b.amountX,"amountX",U64),y=uint(b.amountY,"amountY",U64);
    if(share>supply)throw Error("position share exceeds supply");
    const gx=uint(b.feeGrowthX,"feeGrowthX"),gy=uint(b.feeGrowthY,"feeGrowthY"),cx=uint(b.checkpointX,"checkpointX"),cy=uint(b.checkpointY,"checkpointY");
    if(share&&(gx<cx||gy<cy))throw Error("fee checkpoint exceeds current growth");
    // SDK first shifts the share, then applies Q64 fee-growth multiplication.
    const px=uint(b.pendingX,"pendingX",U64)+(share?((share>>64n)*(gx-cx)>>64n):0n),py=uint(b.pendingY,"pendingY",U64)+(share?((share>>64n)*(gy-cy)>>64n):0n);
    return {binId:b.binId,principalX:supply?share*x/supply:0n,principalY:supply?share*y/supply:0n,feeX:px,feeY:py};
  }
  function reconcile(snapshot){
    if(snapshot.sdkCommit!==SDK_COMMIT)throw Error("SDK commit mismatch");
    if(!Array.isArray(snapshot.bins)||!snapshot.bins.length)throw Error("snapshot bins required");
    if(typeof snapshot.pool!=="string"||!snapshot.pool||typeof snapshot.position!=="string"||!snapshot.position||!Number.isSafeInteger(snapshot.slot)||snapshot.slot<0)throw Error("snapshot identity/slot required");
    const seen=new Set(),totals={principalX:0n,principalY:0n,feeX:0n,feeY:0n},rows=[];
    for(const b of snapshot.bins){if(seen.has(b.binId))throw Error("duplicate bin");seen.add(b.binId);const row=positionBin(b);for(const k of Object.keys(totals))totals[k]+=row[k];rows.push(row);}
    let discrepancies=null;
    if(snapshot.expected){discrepancies={};for(const k of Object.keys(totals))discrepancies[k]=totals[k]-uint(snapshot.expected[k],"expected "+k);}
    return {sdkCommit:SDK_COMMIT,pool:snapshot.pool,position:snapshot.position,slot:snapshot.slot,rows,totals,discrepancies,status:discrepancies===null?"CALCULATED_UNVERIFIED":Object.values(discrepancies).every(n=>n===0n)?"MATCHES_SUPPLIED_EXPECTED":"MISMATCH",protocolReplayVerified:false,tokenTransferExtensionsApplied:false};
  }
  function stringify(value){return JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v,2)}
  return {SDK_COMMIT,Q,F,qPrice,feeRate,exclude,include,quoteMMExactIn,positionBin,reconcile,stringify,mulDiv};
}
export const IntegerKernel=makeIntegerKernel();

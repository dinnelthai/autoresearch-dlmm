// Extracted from the offline research engine; calculations unchanged.
import {clip,assert,finite,price,binId} from './numeric.mjs';
import {classify} from './market.mjs';
function forecast(s,c){
  const m=s.market,p=m.ref.price,mid=binId(c,p),step=1+c.binStepBps/10000;
  const flowWindow=Number.isFinite(m.flowWindowSeconds)&&m.flowWindowSeconds>0?m.flowWindowSeconds:null;
  const stepSeconds=c.forecastHorizonSeconds/c.forecastSteps;
  const stepVolume=flowWindow&&Number.isFinite(m.flowSol)?finite(m.flowSol,"forecast observed flow")*stepSeconds/flowWindow:0;
  assert(Number.isFinite(stepVolume),"FORECAST_VOLUME_NONFINITE");
  const g=classify(s,c),r=g.features,amp=clip(Math.round((r.volatility||.02)/Math.log(step)),2,8);
  const drift=g.regime==="UPTREND"?1:g.regime==="DOWNTREND"?-1:0;
  const patterns=[{name:"range",f:i=>Math.round(amp*Math.sin(i*Math.PI/2))},{name:"up",f:i=>i},{name:"down",f:i=>-i},{name:"whipsaw",f:i=>i<c.forecastSteps/2?i:-i},{name:"stress",f:i=>-Math.round(i*amp/2)}];
  return patterns.map((pat,j)=>{
    const events=[];let modeledVolumeSol=0,missingLiquiditySteps=0,crossedBins=0,missingCrossedBins=0;const missingIds=new Set();
    for(let i=1;i<=c.forecastSteps;i++){
      const id=mid+pat.f(i)+(j===0?drift*i:0),px=price(c,id),t=s.lastTime+c.forecastHorizonSeconds*i/c.forecastSteps;
      events.push({type:"MARKET",id:"f"+j+"m"+i,t,pool:m.pool,references:[{pool:"scenario-a",price:px,depth:Math.max(10,m.ref.depth/2),availableAt:t},{pool:"scenario-b",price:px,depth:Math.max(10,m.ref.depth/2),availableAt:t}],exitDepth:m.exitDepth,tokenSafe:m.tokenSafe,holderShare:m.holderShare,holderOutflow:m.holderOutflow,buyImbalance:m.buyImbalance,flowSol:m.flowSol,flowWindowSeconds:flowWindow,paperTargetMode:m.paperTargetMode===true,targetReference:{pool:m.pool,price:px,depth:m.exitDepth,basis:'TARGET_BIN_SNAPSHOT',observedAt:t,availableAt:t}});
      // Frozen target-bin liquidity, never independent-reference quote depth.
      // Only the explicit built-in demo uses its declared synthetic liquidity proxy.
      const targetLiquidity=k=>s.poolBins[k]??(m.pool==="DEMO_POOL"&&m.syntheticFixture===true?80:null);
      const ext=targetLiquidity(id),previous=mid+pat.f(i-1)+(j===0?drift*(i-1):0);
      // Endpoint fills are only a proxy. Check crossed-bin evidence but never infer their trades.
      for(let k=Math.min(previous,id)+1;k<Math.max(previous,id);k++){crossedBins++;const l=targetLiquidity(k);if(!Number.isFinite(l)||l<=0){missingCrossedBins++;missingIds.add(k)}}
      if(!(stepVolume>0))continue;
      if(!Number.isFinite(ext)||ext<=0){missingLiquiditySteps++;missingIds.add(id);continue;}
      const qty=stepVolume/px,side=pat.f(i)+(j===0?drift*i:0)>=pat.f(i-1)+(j===0?drift*(i-1):0)?"LP_SELL":"LP_BUY",fee=qty*c.feeBps/10000*(1-c.protocolShare);
      events.push({type:"SWAP",id:"f"+j+"s"+i,t,bin:id,side,baseQty:qty,externalLiquiditySol:ext,mmFeeX:side==="LP_BUY"?fee:0,mmFeeY:side==="LP_SELL"?fee*px:0});
      modeledVolumeSol+=stepVolume;
    }
    return {name:pat.name,events,volumeDiagnostic:{flowWindowSeconds:flowWindow,projectedVolumeSol:stepVolume*c.forecastSteps,modeledVolumeSol,missingLiquiditySteps,crossedBins,missingCrossedBins,missingBinIds:[...missingIds].sort((a,b)=>a-b),fillBasis:'ENDPOINT_ONLY_NO_INFERRED_CROSSING_FILLS',liquidityBasis:"FROZEN_TARGET_BIN_VALUE_PROXY",calibrated:false}};
  });
}
export {forecast};

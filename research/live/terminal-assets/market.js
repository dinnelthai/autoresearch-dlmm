'use strict';
function clearIndexedPool(){put('indexedPairName','MEME / SOL');for(const id of ['indexedTvl','indexedVolume','indexedFees','indexedDynamicFee'])put(id,'—');put('indexedPoolStatus','等待行情')}
async function refreshIndexedPool(scope,epoch,m){
 if(!m){clearIndexedPool();return}
 try{const res=await terminalGet('/api/terminal/pool-info',scope,10000),a=await res.json();
  if(!sameScope(epoch,scope,poolEpoch,target))return;
  if(!res.ok)throw Error(a.reason??'POOL_INFO_UNAVAILABLE');
  if(a.pool!==scope||a.scope!=='INDEXED_DISPLAY_ONLY'||a.tokenX?.mint!==m.mintX||a.tokenY?.mint!==m.mintY||!Number.isSafeInteger(a.fetchedAt)||a.fetchedAt>Date.now()||Date.now()-a.fetchedAt>60000)throw Error('索引身份或时效不符');
  put('indexedPairName',(a.tokenX.symbol||'MEME')+' / '+(a.tokenY.symbol||'SOL'));
  const f=v=>Number.isFinite(v)&&v>=0?v.toLocaleString(undefined,{maximumFractionDigits:4}):'—';
  put('indexedTvl',f(a.tvl));put('indexedVolume',f(a.volume24h));put('indexedFees',f(a.fees24h));put('indexedDynamicFee',Number.isFinite(a.dynamicFeePct)&&a.dynamicFeePct>=0?f(a.dynamicFeePct)+'%':'—');put('indexedPoolStatus','Meteora 索引 · '+new Date(a.fetchedAt).toLocaleTimeString());
 }catch(e){if(sameScope(epoch,scope,poolEpoch,target)){clearIndexedPool();put('indexedPoolStatus','不可用：'+e.message)}}
}
async function refreshPriceHistory(scope,epoch){
 try{const r=await terminalGet('/api/terminal/price-history',scope,10000),a=await r.json();if(!sameScope(epoch,scope,poolEpoch,target))return;if(!r.ok)throw Error(a.reason??'HISTORY_UNAVAILABLE');
  if(a.pool!==scope||a.scope!=='INDEXED_DISPLAY_ONLY'||a.timeframe!=='1h'||a.priceUnit!=='PROVIDER_UNIT_UNVERIFIED'||!Array.isArray(a.candles)||a.candles.length>200||!Number.isSafeInteger(a.fetchedAt)||a.fetchedAt>Date.now()||Date.now()-a.fetchedAt>120000||!a.candles.every(c=>Number.isSafeInteger(c.timestamp)&&[c.open,c.high,c.low,c.close].every(x=>Number.isFinite(x)&&x>0)&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)))throw Error('行情格式或时效不符');
  if(!a.candles.length){put('priceHistoryChart','该窗口无索引行情记录');put('priceHistoryLabel','Meteora · 1h · 空窗口（不代表零交易）');return}
  const chart=$('priceHistoryChart'),v=a.candles,min=Math.min(...v.map(c=>c.low)),max=Math.max(...v.map(c=>c.high)),span=max-min||max*.001;chart.replaceChildren();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 800 230');svg.setAttribute('role','img');svg.setAttribute('aria-label','Meteora 每小时 OHLC 行情');
  const t0=v[0].timestamp,t1=v.at(-1).timestamp,scale=Math.max(3600,t1-t0),y=p=>205-(p-min)*180/span;
  const shape=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,z] of Object.entries(attrs))e.setAttribute(k,String(z));svg.append(e)};
  for(const c of v){const x=20+(c.timestamp-t0)*760/scale,col=c.close>=c.open?'#69d8bd':'#e87986',w=Math.min(12,Math.max(2,760*3600/scale*.5));shape('line',{x1:x,x2:x,y1:y(c.high),y2:y(c.low),stroke:col});shape('rect',{x:x-w/2,y:Math.min(y(c.open),y(c.close)),width:w,height:Math.max(1,Math.abs(y(c.open)-y(c.close))),fill:col})}
  chart.append(svg);put('priceHistoryLabel','Meteora · 1h · '+v.length+' 根 · 内部缺口 '+a.missingIntervals+' · 收盘 '+v.at(-1).close.toPrecision(6)+'（计价单位待核对） · '+new Date(v.at(-1).timestamp*1000).toLocaleString());
 }catch(e){if(sameScope(epoch,scope,poolEpoch,target)){put('priceHistoryChart','真实历史行情暂不可用');put('priceHistoryLabel','Meteora 行情读取失败：'+e.message)}}
}
$('poolForm').addEventListener('submit',handleTargetChange);
$('pool').addEventListener('input',handleTargetChange);

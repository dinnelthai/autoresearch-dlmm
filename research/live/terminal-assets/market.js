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
let chartHours=48,priceChartData=null;
function clearPriceChart(){
 priceChartData=null;for(const id of ['chartCandleTime','chartOpen','chartHigh','chartLow','chartClose','chartChange'])put(id,'—');delete $('chartChange').dataset.sign;
}
function renderPriceChart(a){
 const chart=$('priceHistoryChart'),all=[...a.candles].sort((a,b)=>a.timestamp-b.timestamp),last=all.at(-1);
 if(!last){chart.textContent='该窗口无行情记录';put('priceHistoryLabel','Meteora · 空窗口');clearPriceChart();return}
 const v=all.filter(c=>c.timestamp>last.timestamp-chartHours*3600),min=Math.min(...v.map(c=>c.low)),max=Math.max(...v.map(c=>c.high)),span=max-min||max*.001,lo=Math.max(0,min-span*.08),hi=max+span*.08+(max===min?span*.84:0),ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 1000 380');svg.setAttribute('role','img');svg.setAttribute('aria-label','Meteora 每小时 OHLC 行情，索引价格单位待核对');
 const left=18,right=880,top=18,bottom=340,t0=v[0].timestamp,t1=v.at(-1).timestamp,scale=Math.max(3600,t1-t0),x=t=>left+12+(t-t0)*(right-left-24)/scale,y=p=>bottom-(p-lo)*(bottom-top)/(hi-lo);
 const shape=(tag,attrs,txt,parent=svg)=>{const e=document.createElementNS(ns,tag);for(const [k,z] of Object.entries(attrs))e.setAttribute(k,String(z));if(txt!=null)e.textContent=txt;parent.append(e);return e};
 const price=p=>p.toPrecision(7);
 function readout(c){const change=(c.close/c.open-1)*100;put('chartCandleTime',new Date(c.timestamp*1000).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}));for(const [id,key] of [['chartOpen','open'],['chartHigh','high'],['chartLow','low'],['chartClose','close']])put(id,price(c[key]));put('chartChange',(change>0?'+':'')+change.toFixed(2)+'%');$('chartChange').dataset.sign=change>0?'positive':change<0?'negative':'neutral'}
 for(let i=0;i<=5;i++){const p=lo+(hi-lo)*i/5,yy=y(p);shape('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:'#263140'});shape('text',{x:right+10,y:yy+4,fill:'#a3b0c2','font-size':12},price(p))}
 const ticks=Math.min(5,v.length-1);
 for(let i=0;i<=ticks;i++){const c=v[ticks?Math.round(i*(v.length-1)/ticks):0],xx=x(c.timestamp),dt=new Date(c.timestamp*1000);shape('line',{x1:xx,x2:xx,y1:top,y2:bottom,stroke:'#202b38'});shape('text',{x:xx,y:365,'text-anchor':i===0?'start':i===ticks?'end':'middle',fill:'#a3b0c2','font-size':12},dt.toLocaleDateString(undefined,{month:'numeric',day:'numeric'})+' '+dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}))}
 for(const c of v){const xx=x(c.timestamp),col=c.close>=c.open?'#52c6a5':'#e87986',w=Math.min(18,Math.max(2,(right-left-24)*3600/scale*.58)),g=shape('g',{});shape('line',{x1:xx,x2:xx,y1:y(c.high),y2:y(c.low),stroke:col,'stroke-width':1.4},null,g);shape('rect',{x:xx-w/2,y:Math.min(y(c.open),y(c.close)),width:w,height:Math.max(1,Math.abs(y(c.open)-y(c.close))),fill:col},null,g)}
 const close=last.close,yy=y(close);shape('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:'#a491ee','stroke-dasharray':'4 4'});shape('rect',{x:right+2,y:yy-10,width:114,height:20,rx:3,fill:'#51466f'});shape('text',{x:right+9,y:yy+4,fill:'#f2ebff','font-size':12},price(close));
 const cross=shape('g',{visibility:'hidden','pointer-events':'none'}),vertical=shape('line',{y1:top,y2:bottom,stroke:'#8291a5','stroke-dasharray':'3 4'},null,cross),horizontal=shape('line',{x1:left,x2:right,stroke:'#8291a5','stroke-dasharray':'3 4'},null,cross),marker=shape('circle',{r:3.5,fill:'#d2c7ff',stroke:'#101720','stroke-width':1.5},null,cross);
 const hit=shape('rect',{x:left,y:top,width:right-left,height:bottom-top,fill:'transparent','pointer-events':'all'});
 hit.addEventListener('pointermove',e=>{const matrix=svg.getScreenCTM();if(!matrix)return;const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const q=pt.matrixTransform(matrix.inverse());const c=v.reduce((best,item)=>Math.abs(x(item.timestamp)-q.x)<Math.abs(x(best.timestamp)-q.x)?item:best,v[0]),xx=x(c.timestamp),yy=y(c.close);vertical.setAttribute('x1',xx);vertical.setAttribute('x2',xx);horizontal.setAttribute('y1',yy);horizontal.setAttribute('y2',yy);marker.setAttribute('cx',xx);marker.setAttribute('cy',yy);cross.setAttribute('visibility','visible');readout(c)});
 hit.addEventListener('pointerleave',()=>{cross.setAttribute('visibility','hidden');readout(last)});
 chart.replaceChildren(svg);readout(last);put('priceHistoryLabel',v.length+'/'+all.length+' 根 · Meteora 索引价（单位待核对）'+(a.missingIntervals?' · 数据缺口 '+a.missingIntervals:''));
}
for(const button of document.querySelectorAll('[data-chart-hours]'))button.addEventListener('click',()=>{chartHours=Number(button.dataset.chartHours);for(const b of document.querySelectorAll('[data-chart-hours]'))b.setAttribute('aria-pressed',String(b===button));if(priceChartData&&priceChartData.pool===target&&Date.now()-priceChartData.fetchedAt<=120000)renderPriceChart(priceChartData);else if(target)void refreshPriceHistory(target,poolEpoch)});
async function refreshPriceHistory(scope,epoch){
 try{const r=await terminalGet('/api/terminal/price-history',scope,10000),a=await r.json();if(!sameScope(epoch,scope,poolEpoch,target))return;if(!r.ok)throw Error(a.reason??'HISTORY_UNAVAILABLE');
  if(a.pool!==scope||a.scope!=='INDEXED_DISPLAY_ONLY'||a.timeframe!=='1h'||a.priceUnit!=='PROVIDER_UNIT_UNVERIFIED'||!Array.isArray(a.candles)||a.candles.length>200||!Number.isSafeInteger(a.fetchedAt)||a.fetchedAt>Date.now()||Date.now()-a.fetchedAt>120000||!a.candles.every(c=>Number.isSafeInteger(c.timestamp)&&[c.open,c.high,c.low,c.close].every(x=>Number.isFinite(x)&&x>0)&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)))throw Error('行情格式或时效不符');
  priceChartData=a;renderPriceChart(a);
 }catch(e){if(sameScope(epoch,scope,poolEpoch,target)){clearPriceChart();put('priceHistoryChart','真实历史行情暂不可用');put('priceHistoryLabel','Meteora 行情读取失败：'+e.message)}}
}
$('poolForm').addEventListener('submit',handleTargetChange);
$('pool').addEventListener('input',handleTargetChange);

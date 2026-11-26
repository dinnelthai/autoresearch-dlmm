'use strict';
function clearExternalMarket(){externalEpoch++;externalExpiry=0;$('externalRows').replaceChildren();$('externalLadder').replaceChildren();put('externalQuote','—');put('orcaQuote','—');put('externalStatus','等待外部市场观察')}
$('externalRefresh').addEventListener('click',async()=>{
 if(externalReading||!target||!serviceMarket||serviceMarket.expiresAt<=Date.now()){put('externalStatus','需要当前有效链上快照');return}
 clearExternalMarket();const g=externalEpoch,p=target,m=serviceMarket;externalReading=true;$('externalRefresh').disabled=true;put('externalStatus','正在读取公开市场报价…');
 try{
  const res=await terminalPost('/api/terminal/external-market',{pool:p},25000),r=await res.json();
  if(g!==externalEpoch||p!==target||serviceMarket?.rawHash!==m.rawHash||serviceMarket?.slot!==m.slot)return;
  if(!res.ok)throw Error(r.gaps?.[0]??'EXTERNAL_UNAVAILABLE');
  if(r.scope!=='EXTERNAL_DISPLAY_ONLY'||r.pool!==p||r.mintX!==m.mintX||r.mintY!==m.mintY||r.marketRawHash!==m.rawHash||r.marketSlot!==m.slot||r.decisionReady!==false||r.executionReady!==false||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=Date.now()||!Array.isArray(r.candidates)||r.candidates.length>20||!Array.isArray(r.gaps))throw Error('外部观察身份或时效不符');
  for(const a of r.candidates){const tr=document.createElement('tr');cell(tr,a.venue);cell(tr,a.pool.slice(0,8)+'…'+a.pool.slice(-5)).title=a.pool;cell(tr,Number.isFinite(a.priceSolPerMeme)?a.priceSolPerMeme.toPrecision(8):'—');cell(tr,Number.isFinite(a.liquidityUsd)?a.liquidityUsd.toLocaleString(undefined,{maximumFractionDigits:2}):'—');$('externalRows').append(tr)}
  const q=r.raydium,mid=q?.midSolPerMeme,active=m.display?.activeBinPriceSolPerMeme;
  const deviation=Number.isFinite(mid)&&mid>0&&Number.isFinite(active)&&active>0?(active/mid-1)*100:null;
  put('externalQuote',q?'Raydium 直接双向报价中间价：'+(Number.isFinite(mid)?mid.toPrecision(8):'—')+' SOL/MEME'+(deviation===null?'':' · 池内观察偏差 '+deviation.toFixed(2)+'%')+' · 最大通过折价阈值的测试卖出量 '+(q.bestTestedExit?exactAmount(q.bestTestedExit.inRaw,m.decimalsX)+' MEME / 最小 '+exactAmount(q.bestTestedExit.minOutRaw,9)+' SOL':'—'):'未取得 Raydium 直连报价');
  const o=r.orca;put('orcaQuote',o?.midSolPerMeme>0?'Orca 直连中间价 '+o.midSolPerMeme.toPrecision(8)+' SOL/MEME'+(r.comparison?' · 双市场相对偏差 '+(r.comparison.relativeDivergence*100).toFixed(2)+'% · 未独立验收':''):'Orca 直连报价不可用');
  for(const a of q?.consistentSamples??q?.ladder??[]){const tr=document.createElement('tr');cell(tr,exactAmount(a.inRaw,m.decimalsX));cell(tr,exactAmount(a.outRaw,9));cell(tr,exactAmount(a.minOutRaw,9));cell(tr,a.status==='FULL_QUOTE'?(a.withinBudget===true?'通过探测阈值':'未通过或未评价'):'不可用');$('externalLadder').append(tr)}
  put('externalStatus','DEX Screener 索引 '+r.candidates.length+' 个候选 · '+r.status+' · '+(r.gaps.map(x=>x.reason).join('；')||'报价未验收')+' · 不是独立研究证据');externalExpiry=r.expiresAt;
 }catch(e){if(g===externalEpoch)put('externalStatus','观察失败：'+e.message)}finally{externalReading=false;$('externalRefresh').disabled=false}
});

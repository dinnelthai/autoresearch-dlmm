'use strict';
function canAnalyze(now=Date.now()){return !!serviceMarket&&serviceMarket.expiresAt>now&&serviceReview?.status==='PREFLIGHT_MATCHED_UNVERIFIED'&&serviceReview.expiresAt>now&&target===servicePool}
function updatePlanButton(){const b=$('generatePlan');b.disabled=planBusy||managementBusy||!canAnalyze();b.setAttribute('aria-busy',String(planBusy));b.textContent=planBusy?'正在分析…':'✦ 生成研究方案';put('generateGate',planBusy?'正在检查请求、快照和研究证据。':canAnalyze()?'证据预检查通过。生成结果仅供研究。':!target?'请先选择目标 Pool。':target!==servicePool?'当前 Pool 尚未匹配本地服务。':!serviceMarket?'等待有效市场快照。':serviceReview?.reason==='POOL_RESEARCH_NOT_CONFIGURED'?'当前池仅支持实时数据观察，尚未配置独立研究证据':reasonText(serviceReview?.reason??'REVIEW_STALE_OR_INVALID'));}
function renderActualMarket(m){
 const d=m?.display,body=$('actualBinRows'),chart=$('actualLiquidityChart');body.replaceChildren();chart.textContent='等待池子快照';
 put('observedPrice','—');put('actualBinTotals','—');put('actualBinStatus','等待链上快照');
 if(!m||d?.kind!=='POOL_OBSERVATION_ONLY'||!Array.isArray(d.rows)||d.rows.length>1500||m.expiresAt<=Date.now())return;
 const p=d.activeBinPriceSolPerMeme;
 put('observedPrice',Number.isFinite(p)&&p>0?p.toPrecision(8):'—');
 put('actualBinStatus',d.rows.length+'/'+d.totalBins+' Bins · 未验收');$('actualBinStatus').title='Slot '+m.slot;
 const total=(v,dec)=>{if(typeof v!=='string'||!/^\d{1,40}$/.test(v)||!Number.isInteger(dec)||dec<0||dec>18)return '—';let a=v.padStart(dec+1,'0');return dec?a.slice(0,-dec)+'.'+a.slice(-dec):a};
 put('actualBinTotals','MM 本金合计：'+total(d.totalYRaw,9)+' SOL / '+total(d.totalXRaw,m.decimalsX)+' MEME（不含订单流动性及费用）');
 const nearby=d.rows.filter(b=>Math.abs(b.binId-m.activeId)<=40);
 if(nearby.length&&Number.isFinite(p)&&p>0){
  const vals=nearby.map(b=>({id:b.binId,y:Number(b.amountYRaw)/1e9,x:Number(b.amountXRaw)/10**m.decimalsX*p})),max=Math.max(...vals.map(b=>b.x+b.y));
  if(Number.isFinite(max)&&max>0){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 148');svg.setAttribute('role','img');svg.setAttribute('aria-label','Active Bin 附近真实池本金，按当前池价折算 SOL');const add=(tag,attrs,txt)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(txt)e.textContent=txt;svg.append(e);return e};
   const w=670/81;for(const y of [18,50,82,114])add('line',{x1:25,x2:695,y1:y,y2:y,stroke:'#293140'});
   for(const b of vals){let top=114;for(const [value,color] of [[b.y,'#52c6a5'],[b.x,'#a491ee']]){if(!(value>0))continue;const height=96*value/max;top-=height;const e=add('rect',{x:25+(b.id-m.activeId+40)*w,y:top,width:w*.85,height,fill:color});const t=document.createElementNS(ns,'title');t.textContent='Bin '+b.id+' · '+(b.y+b.x).toFixed(4)+' SOL 估值';e.append(t)}}
   const x=25+40.5*w;add('line',{x1:x,x2:x,y1:8,y2:116,stroke:'#e8edf4','stroke-dasharray':'3 3'});add('text',{x:25,y:137,fill:'#99a6b8','font-size':10},String(m.activeId-40));add('text',{x,y:137,fill:'#e8edf4','font-size':10,'text-anchor':'middle'},'Active '+m.activeId);add('text',{x:695,y:137,fill:'#99a6b8','font-size':10,'text-anchor':'end'},String(m.activeId+40));chart.replaceChildren(svg);
  }else chart.textContent='附近没有可绘制本金';
 }
 for(const b of d.rows){const tr=document.createElement('tr');cell(tr,String(b.binId)+(b.binId===m.activeId?' · Active':''));cell(tr,Number.isFinite(b.priceSolPerMeme)&&b.priceSolPerMeme>0?b.priceSolPerMeme.toPrecision(8):'—');cell(tr,exactAmount(b.amountYRaw,9));cell(tr,exactAmount(b.amountXRaw,m.decimalsX));body.append(tr)}
}
function archiveExpiredReport(m,gate){
 if(report?.terminalBinding&&(!m||report.terminalBinding.marketSlot!==m.slot||report.terminalBinding.marketRawHash!==m.rawHash||gate?.reviewHash!==report.terminalBinding.reviewHash||report.terminalBinding.expiresAt<=Date.now())){const {terminalBinding,reviewId,...archive}=report;report=archive;put('reportSource','历史研究 · Slot '+terminalBinding.marketSlot);put('bindingStatus','原快照研究结果保留；当前绑定失效，不可用于当前审阅。');put('generateStatus','已保留上次研究结果，可重新生成。')}
}
function applyServiceMarket(m,gate=null){
 if(!m||serviceMarket?.rawHash!==m.rawHash||serviceMarket?.slot!==m.slot){clearExternalMarket();clearModelInputs()}
 renderActualMarket(m);
 serviceReview=gate;
 archiveExpiredReport(m,gate);
 serviceMarket=m;
 const ready=canAnalyze();$('reviewDot').dataset.ready=String(ready);put('reviewStatus',ready?'证据版本匹配 · 待引擎验证':m?reasonText(gate?.reason??'REVIEW_STALE_OR_INVALID'):'等待可用市场快照');
 if(!report){put('activeBin',m?m.activeId+' / '+m.binStep+' bps':'—');put('slot',m?.slot??'—');put('quality',m?'采集未验收':'采集不可用')}
 updatePlanButton();
}
function clearServicePositions(){for(const id of servicePositions)if(positions.get(id)?.source==='service')positions.delete(id);servicePositions.clear();if(!positions.has(positionSelected)){const next=positions.keys().next().value??null;if(next!==positionSelected)positionGeneration++;positionSelected=next;clearManagementView()}renderPosition()}
async function refreshService({initial=false}={}){
 if(refreshing)return;refreshing=true;$('refreshState').disabled=true;$('refreshState').setAttribute('aria-busy','true');const g=++refreshGeneration,scope=target,epoch=poolEpoch;
 try{
  const res=await terminalGet('/api/terminal/state',scope,10000);if(!res.ok)throw Error('STATE_HTTP_'+res.status);const x=await res.json();
  if(g!==refreshGeneration||!sameScope(epoch,scope,poolEpoch,target))return;
  if(!addr(x.pool)||x.decisionReady!==false||x.executionReady!==false)throw Error('状态接口契约不符');
  servicePool=x.pool;
  if(initial&&!target&&!$('pool').value){$('pool').value=x.pool;$('poolForm').requestSubmit()}
  put('serviceStatus',x.market?'本地采集 · 未验收':'本地服务 · 数据阻塞');
  if(target!==x.pool){clearIndexedPool();applyServiceMarket(null);applyMonitoring([]);clearServicePositions();put('captureStatus','此服务配置的 Pool 与当前选择不一致；请修改本地配置或选择该池。');return}
  const hs=x.streams?.['history:'+target];put('historyStreamStatus',hs?hs.status+(hs.historyStatus?' · '+hs.historyStatus:'')+(hs.repairStatus?' · '+hs.repairStatus:'')+(hs.repairCapture?' · 历史补采':'')+(Number.isSafeInteger(hs.signatureCount)?' · '+hs.signatureCount+' 签名':'')+(Number.isSafeInteger(hs.gapCount)?' · '+hs.gapCount+' 缺口记录':'')+(hs.gapReasons?.length?' · '+hs.gapReasons.join(', '):'')+(hs.locallyFresh?'':' · 已过期或未刷新'):'未配置历史采集');
  const m=x.status==='CAPTURED_UNVERIFIED'&&x.market&&hash(x.market.rawHash)&&Number.isSafeInteger(x.market.slot)&&Number.isSafeInteger(x.market.expiresAt)&&x.market.expiresAt>Date.now()?x.market:null;
  const gate=x.reviewGate?.status==='PREFLIGHT_MATCHED_UNVERIFIED'&&hash(x.reviewGate.reviewHash)&&Number.isSafeInteger(x.reviewGate.expiresAt)?x.reviewGate:{status:'BLOCKED',reason:x.reviewGate?.reason??'REVIEW_NOT_CONFIGURED'};applyServiceMarket(m,gate);put('captureStatus',m?'Slot '+m.slot+' · '+m.binCount+' 个 Bin · 本地采集开始时间 '+new Date(m.receivedAt).toLocaleTimeString():x.reason==='POOL_CAPTURE_PENDING'?'新 Pool 正在采集链上数据':x.reason==='POOL_COLLECTOR_BUSY'?'采集器正在处理另一 Pool，稍后刷新':x.reason==='POOL_CAPTURE_RETRY_COOLDOWN'?'采集暂不可用，等待下一次重试':'采集不可用：'+reasonText(x.reason??x.gaps?.[0]));
  put('poolStatus',m?(x.scope==='MARKET_PREVIEW_ONLY'?'已切换 Pool · 只读观察':x.scope==='SCOPED_RESEARCH_ONLY'?'独立 Pool 研究采集 · 未验收':'目标池已匹配本地采集 · 未验收'):'目标池已选择 · 等待采集');refreshPriceHistory(target,poolEpoch);refreshIndexedPool(target,poolEpoch,m);refreshModelInputs(target,poolEpoch);if(walletAddress&&target)refreshWalletPositions();
  const incoming=new Map();let invalidPositions=0;for(const p of x.positions??[]){try{validatePosition(p,target);incoming.set(p.position,p)}catch{invalidPositions++}}
  let changed=false;for(const id of servicePositions)if(!incoming.has(id)&&positions.get(id)?.source==='service'){positions.delete(id);changed=true;}
  servicePositions.clear();
  for(const [id,p] of incoming){const old=positions.get(id);const same=old?.snapshot.rawHash===p.rawHash&&old.snapshot.slot===p.slot&&old.snapshot.owner===p.owner&&old.snapshot.snapshot.decimalsX===p.snapshot.decimalsX;if(!same||old.source!=='service'){positions.set(id,{snapshot:p,management:same?old.management:null,source:'service'});changed=true}servicePositions.add(id)}
  if(!positions.has(positionSelected)){const next=positions.keys().next().value??null;if(next!==positionSelected)positionGeneration++;positionSelected=next;clearManagementView();changed=true}
  if(managementSelected&&!positions.get(positionSelected)?.management)clearManagementView();
  applyMonitoring(x.monitoring??[]);if(changed)renderPosition();put('positionListStatus',invalidPositions?'有 '+invalidPositions+' 个采集仓位未通过归档结构检查；未显示。':positions.size?'显示采集与归档快照，不代表钱包全部仓位。':'尚无该 Pool 的可查看仓位。');
 }catch(e){if(g!==refreshGeneration||!sameScope(epoch,scope,poolEpoch,target))return;clearModelInputs();clearIndexedPool();put('historyStreamStatus','服务不可用');put('serviceStatus','本地服务不可用');put('captureStatus','状态读取失败：'+e.message);applyServiceMarket(null);applyMonitoring([]);clearServicePositions()}
 finally{refreshing=false;$('refreshState').disabled=false;$('refreshState').setAttribute('aria-busy','false');updatePlanButton()}
}
$('refreshState').addEventListener('click',()=>refreshService().then(()=>refreshAutoMonitor()));
$('poolForm').addEventListener('submit',()=>{if(target&&target===$('pool').value.trim())refreshService()});

$('request').addEventListener('input',updatePlanButton);
$('request').addEventListener('submit',updatePlanButton);

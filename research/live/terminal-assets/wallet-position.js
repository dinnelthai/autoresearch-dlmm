'use strict';
function clearAccounting(){accountingGeneration++;$('positionAccountingFields').replaceChildren();put('positionAccountingStatus','在钱包仓位中点击流水复盘。')}
function clearWalletPositions({preserveAccounting=false}={}){if(!preserveAccounting)clearAccounting();positionReadEpoch++;walletIndex=null;lastPositionRead=0;walletDetails.clear();$('walletPositionRows').replaceChildren();put('walletPositionStatus','等待当前钱包与 Pool')}
function renderWalletPositions(){
 const rows=$('walletPositionRows');rows.replaceChildren();const idx=walletIndex;if(!idx||idx.expiresAt<=Date.now())return;
 for(const p of idx.positions){const d=walletDetails.get(p.address),snap=d?.snapshot,tr=document.createElement('tr');
  cell(tr,p.address.slice(0,7)+'…'+p.address.slice(-5)).title=p.address;
  cell(tr,d?.status==='V2_POSITION_OBSERVATION_UNVERIFIED'?'V2 本金/费用观测 · 未验收':d?.status==='POSITION_CALCULATED_UNVERIFIED'?'已读取 · 未验收':d?.status==='PARTIAL'?'不支持 BinArray V'+d.binArrayVersion:d?.reason??'已发现');
  cell(tr,Number.isSafeInteger(d?.lowerBinId)?d.lowerBinId+' 至 '+d.upperBinId:'—');
  cell(tr,snap?exactAmount(snap.currentPrincipalRaw.y,9)+' / '+exactAmount(snap.currentPrincipalRaw.x,snap.snapshot.decimalsX):'—');
  cell(tr,snap?exactAmount(snap.pendingFeeRaw.y,9)+' / '+exactAmount(snap.pendingFeeRaw.x,snap.snapshot.decimalsX):'—');
  const td=cell(tr,''),b=document.createElement('button');b.type='button';b.textContent='读取详情';b.disabled=walletReadBusy;b.addEventListener('click',()=>loadWalletDetail(p.address));td.append(b);if(snap&&d.observation){const x=document.createElement('button');x.type='button';x.textContent='流水复盘';x.disabled=accountingBusy;x.addEventListener('click',()=>readPositionAccounting(p.address,d));td.append(x)}rows.append(tr)}
 if(!idx.positions.length){const tr=document.createElement('tr');cell(tr,'当前 V2 仓位索引未发现匹配记录').colSpan=6;rows.append(tr)}
}
async function readPositionAccounting(id,d){
 if(accountingBusy||!d?.observation||!walletAddress||!target)return;
 const p=target,w=walletAddress,g=++accountingGeneration,obs=d.observation;
 accountingBusy=true;renderWalletPositions();navigate('performance');$('actualPerformance').hidden=false;$('shadowPerformance').hidden=true;for(const b of document.querySelectorAll('[data-perf]'))b.setAttribute('aria-pressed',String(b.dataset.perf==='actual'));$('positionAccountingFields').replaceChildren();put('positionAccountingStatus','正在读取有限历史并核对链上回执…');
 try{
  const res=await terminalPost('/api/terminal/position-accounting',{pool:p,wallet:w,position:id,slot:obs.slot,rawHash:obs.rawHash},285000),x=await res.json();
  if(g!==accountingGeneration||p!==target||w!==walletAddress)return;
  if(!res.ok)throw Error(x.gaps?.[0]??'ACCOUNTING_UNAVAILABLE');
  if(x.scope!=='POSITION_ACCOUNTING_DIAGNOSTIC_ONLY'||x.pool!==p||x.owner!==w||x.position!==id||x.observation?.rawHash!==obs.rawHash||x.historyComplete!==false||x.pnlReady!==false||x.executionReady!==false||x.decisionReady!==false||!hash(x.ledgerHash))throw Error('流水复盘身份无效');
  const t=x.ledger?.totals,dx=obs.decimalsX;
  if(!t||!['depositXRaw','depositYRaw','withdrawXRaw','withdrawYRaw','claimedXRaw','claimedYRaw','networkFeeRaw','rentLockedRaw','rentRecoveredRaw'].every(k=>raw(t[k])))throw Error('资金流格式无效');
  const fields={'仓位':id,'已观察 / 已对账交易':x.ledger.observedCount+' / '+x.ledger.acceptedCount,'证据缺口':x.ledger.gapCount,'增量归档':x.ledger.incrementalCoverage?x.ledger.incrementalCoverage.pages+' 页 · '+x.ledger.incrementalCoverage.mode+' · '+(x.ledger.incrementalCoverage.gapObserved?'存在未解决断层':x.ledger.incrementalCoverage.retentionTruncated?'保留窗口已截断':'覆盖未验收'):'—','已观察投入 MEME / SOL':exactAmount(t.depositXRaw,dx)+' / '+exactAmount(t.depositYRaw,9),'已观察撤出 MEME / SOL':exactAmount(t.withdrawXRaw,dx)+' / '+exactAmount(t.withdrawYRaw,9),'已观察领取 MEME / SOL':exactAmount(t.claimedXRaw,dx)+' / '+exactAmount(t.claimedYRaw,9),'网络成本 SOL':exactAmount(t.networkFeeRaw,9),'锁定 / 返还租金 SOL':exactAmount(t.rentLockedRaw,9)+' / '+exactAmount(t.rentRecoveredRaw,9)};
  const perf=x.performance;
  if(perf?.status==='BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC'&&perf.pool===p&&perf.owner===w&&perf.position===id&&perf.pnlReady===false&&perf.historyComplete===false&&perf.closingRawHash===obs.rawHash&&Object.keys(perfMetricLabels).every(k=>perfDecimal(perf.metrics?.[k])))for(const [k,label] of Object.entries(perfMetricLabels))fields[label]=perf.metrics[k]+' SOL（条件性）';
  else fields['窗口估值']=perf?.reason??'未验收';
  for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);$('positionAccountingFields').append(dt,dd)}
  put('positionAccountingStatus','Position '+id.slice(0,8)+'…'+id.slice(-5)+' · Slot '+obs.slot+' · '+x.ledger.status+' · '+x.ledger.acceptedCount+' 笔有限对账 · 历史完整性未验证 · 不填实际收益主指标');
 }catch(e){if(g===accountingGeneration)put('positionAccountingStatus','复盘阻塞：'+e.message)}finally{accountingBusy=false;renderWalletPositions()}
}
async function refreshWalletPositions(force=false){
 if(!walletAddress||!target||walletReadBusy||!force&&Date.now()-lastPositionRead<30000)return;
 const e=positionReadEpoch,p=target,w=walletAddress;walletReadBusy=true;lastPositionRead=Date.now();put('walletPositionStatus','查询当前钱包仓位…');
 try{const res=await terminalPost('/api/terminal/wallet-positions',{pool:p,wallet:w},45000),r=await res.json();
  if(e!==positionReadEpoch||p!==target||w!==walletAddress)return;
  if(!res.ok)throw Error(r.gaps?.[0]??'POSITION_INDEX_UNAVAILABLE');
  if(r.status!=='INDEX_CAPTURED_UNVERIFIED'||r.pool!==p||r.wallet!==w||r.decisionReady!==false||r.executionReady!==false||!Number.isSafeInteger(r.slot)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=Date.now()||!Array.isArray(r.positions)||r.positions.length>100||!r.positions.every(x=>addr(x.address)&&x.owner===w)||new Set(r.positions.map(x=>x.address)).size!==r.positions.length)throw Error('仓位索引身份或时效无效');
  walletIndex=r;for(const id of walletDetails.keys())if(!r.positions.some(x=>x.address===id))walletDetails.delete(id);
  put('walletPositionStatus','发现 '+r.total+' 个 V2 仓位 · Slot '+r.slot+(r.truncated?' · 仅显示前 100 个':'')+' · 索引未验收');
 }catch(err){if(e===positionReadEpoch){clearWalletPositions();lastPositionRead=Date.now();put('walletPositionStatus','索引读取失败：'+err.message)}}finally{walletReadBusy=false;renderWalletPositions()}
 if(e===positionReadEpoch&&walletIndex?.positions.length&&!walletDetails.size)loadWalletDetail(walletIndex.positions[0].address);
}
async function loadWalletDetail(id){
 if(walletReadBusy||!walletIndex||walletIndex.expiresAt<=Date.now()||!walletIndex.positions.some(x=>x.address===id))return;
 const e=positionReadEpoch,p=target,w=walletAddress,slot=walletIndex.slot;walletReadBusy=true;walletDetails.set(id,{reason:'采集中'});renderWalletPositions();
 try{const res=await terminalPost('/api/terminal/wallet-position-detail',{pool:p,wallet:w,position:id},175000),r=await res.json();
  if(e!==positionReadEpoch||p!==target||w!==walletAddress)return;
  if(!res.ok)throw Error(r.gaps?.[0]??'POSITION_DETAIL_UNAVAILABLE');
  if(r.pool!==p||r.wallet!==w||r.position!==id||r.decisionReady!==false||r.executionReady!==false||!Number.isSafeInteger(r.slot)||r.slot<slot)throw Error('仓位详情身份无效');
  if(['POSITION_CALCULATED_UNVERIFIED','V2_POSITION_OBSERVATION_UNVERIFIED'].includes(r.status)){const source=r.snapshot;if(r.status==='V2_POSITION_OBSERVATION_UNVERIFIED'&&(source?.status!==r.status||source.scope!=='WALLET_DISPLAY_ONLY'||source.decisionReady!==false||source.executionReady!==false||!Array.isArray(source.binArrayVersions)||!source.binArrayVersions.includes(2)||!source.binArrayVersions.every(v=>v===2||v===3)))throw Error('V2 观察范围无效');const snap=validatePosition(r.status==='V2_POSITION_OBSERVATION_UNVERIFIED'?{...source,status:'POSITION_CALCULATED_UNVERIFIED'}:source,p);if(snap.position!==id||snap.owner!==w||snap.slot!==r.slot)throw Error('仓位快照不符')}
  else if(r.status!=='PARTIAL'||r.reason!=='POSITION_BIN_VERSION_UNSUPPORTED')throw Error('仓位状态无效');
  walletDetails.set(id,{...r,readAt:Date.now()});
 }catch(err){if(e===positionReadEpoch)walletDetails.set(id,{reason:err.message,readAt:Date.now()})}finally{walletReadBusy=false;renderWalletPositions()}
}
$('refreshWalletPositions').addEventListener('click',()=>refreshWalletPositions(true));

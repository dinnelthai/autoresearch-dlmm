'use strict';
const seriesMetricLabels={sampledNavSolHours:'采样 NAV · SOL小时（近似）',contributedSolHours:'投入资本 · SOL小时',sampledMeanNavSol:'采样平均 NAV · SOL',netPnlPerContributedSolHour:'每投入 SOL小时净收益',alphaPerContributedSolHour:'每投入 SOL小时 Alpha',sampledPnlPeakToTroughSol:'采样累计 PnL 峰谷差 · SOL'};
const perfDecimal=v=>typeof v==='string'&&/^-?\d{1,80}(\.\d{1,36})?$/.test(v);
function validPerfBoundary(r){if(r.status==='BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC')return Number.isSafeInteger(r.openingSlot)&&Number.isSafeInteger(r.closingSlot)&&r.openingSlot<r.closingSlot&&['ledgerHash','openingHash','closingHash','marksHash'].every(k=>hash(r.bindings?.[k]));return hash(r.seriesHash)&&Number.isInteger(r.windowCount)&&r.windowCount>=1&&r.windowCount<=100&&Array.isArray(r.points)&&r.points.length===r.windowCount+1&&r.points.every((p,i)=>Number.isSafeInteger(p.slot)&&p.slot>=0&&Number.isSafeInteger(p.asOf)&&p.asOf>=0&&p.asOf<8640000000000&&(!i||p.slot>r.points[i-1].slot&&p.asOf>r.points[i-1].asOf)&&['nav','terminalWealth','hodlTerminal','netPnl','alpha','capitalBasis'].every(k=>perfDecimal(p[k])))&&Object.keys(seriesMetricLabels).every(k=>perfDecimal(r.capitalTime?.[k]))&&['netPnl','alpha','terminalWealth','hodlTerminal','capitalBasis'].every(k=>r.points.at(-1)[k]===r.metrics?.[k])&&r.points.at(-1).nav===r.metrics?.closingNav}
const perfMetricLabels={openingValue:'期初资产价值',depositValue:'新增投入价值（投入时）',capitalBasis:'投入基准',closingNav:'期末 NAV（本金及未领费用）',closingPrincipal:'期末本金',withdrawnValue:'撤出资产期末价值',claimedValue:'已领取费用期末价值',feeContribution:'窗口费用贡献（扣期初待领）',networkCost:'网络成本',failedNetworkCost:'失败交易网络成本（包含于网络成本）',terminalWealth:'期末总资产价值（扣网络成本）',hodlTerminal:'同资金 HODL 期末价值',netPnl:'条件性窗口净 PnL',hodlPnl:'HODL 价格贡献',alpha:'条件性 HODL Alpha',inventoryEffect:'库存结构变化贡献（残差归因）',attributionResidual:'归因算术差额'};
function renderPerfWindow(){
 const d=$('performanceWindowFields');d.replaceChildren();$('performanceSeriesView').hidden=true;$('performanceSeriesFields').replaceChildren();$('performanceSeriesRows').replaceChildren();const r=perfWindow;
 if(!r){put('performanceWindowStatus','导入 T16 本地核算报告。仅供条件性诊断。');return}
 if(r.pool!==target||r.position!==positionSelected){put('performanceWindowStatus','报告不属于当前选中仓位；未展示数值。');return}
 const p=positions.get(positionSelected)?.snapshot;
 if(!p||p.owner!==r.owner){put('performanceWindowStatus','仓位 Owner 尚未匹配；未展示数值。');return}
 const series=r.status==='BOUNDED_SERIES_DIAGNOSTIC';put('performanceWindowStatus',(series?'连续窗口序列 Slot '+r.points[0].slot+' — '+r.points.at(-1).slot:'归档窗口 Slot '+r.openingSlot+' — '+r.closingSlot)+' · '+r.observedCount+' 笔有限对账 · 未验证历史完整性');
 for(const [k,label] of Object.entries(perfMetricLabels)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=r.metrics[k]+' SOL';d.append(dt,dd)}
 if(series){$('performanceSeriesView').hidden=false;for(const [k,label] of Object.entries(seriesMetricLabels)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=r.capitalTime[k];$('performanceSeriesFields').append(dt,dd)}for(const x of r.points){const tr=document.createElement('tr');for(const v of [x.slot,new Date(x.asOf*1000).toISOString(),x.nav,x.terminalWealth,x.hodlTerminal,x.netPnl,x.alpha])cell(tr,v);$('performanceSeriesRows').append(tr)}}
}
$('performanceWindowFile').addEventListener('change',async()=>{
 const g=++perfGeneration,scope=target,id=positionSelected,owner=positions.get(id)?.snapshot.owner;perfWindow=null;renderPerfWindow();
 try{const r=await readJson($('performanceWindowFile').files[0]);
  if(g!==perfGeneration||scope!==target||id!==positionSelected||owner!==positions.get(id)?.snapshot.owner)return;
  if(r.schemaVersion!==1||!['BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC','BOUNDED_SERIES_DIAGNOSTIC'].includes(r.status)||r.pnlReady!==false||r.historyComplete!==false||r.executionReady!==false||r.decisionReady!==false||r.pool!==scope||r.position!==id||!addr(r.owner)||!validPerfBoundary(r)||!Number.isSafeInteger(r.observedCount)||r.observedCount<1||!Object.keys(perfMetricLabels).every(k=>typeof r.metrics?.[k]==='string'&&/^-?\d{1,80}(\.\d{1,36})?$/.test(r.metrics[k])))throw Error('诊断身份、状态或数值格式不符');
  perfWindow=r;renderPerfWindow();
 }catch(e){if(g===perfGeneration)put('performanceWindowStatus','导入失败：'+e.message)}
});
$('clearPerformanceWindow').addEventListener('click',()=>{perfGeneration++;perfWindow=null;$('performanceWindowFile').value='';renderPerfWindow()});
for(const b of document.querySelectorAll('[data-page],[data-go]'))b.addEventListener('click',()=>{if(page==='performance')renderPerfWindow()});

const lifeLabels={depositValue:'累计投入成本',withdrawnValue:'撤出资产关闭时估值',claimedValue:'领取费用关闭时估值',networkCost:'网络成本',failedNetworkCost:'失败交易费用（已含于网络成本）',rentLocked:'锁定租金',rentRecovered:'返还租金',rentNetCost:'租金净成本',closingPositionNav:'条件性关闭仓位 NAV',terminalWealth:'关闭时总资产价值',hodlTerminal:'同投入 HODL',netPnl:'条件性生命周期净收益',hodlPnl:'HODL 价格贡献',alpha:'条件性 HODL Alpha',inventoryEffect:'库存结构贡献',attributionResidual:'归因算术差额',contributedSolHours:'投入 SOL小时',rentLockedSolHours:'租金锁定 SOL小时'};
function renderLifecycle(){
 const dl=$('lifecycleFields');dl.replaceChildren();const r=lifecycleReport;
 if(!r||r.pool!==target){put('lifecycleStatus','导入当前 Pool 的已关闭仓位报告。');return}
 put('lifecycleStatus','归档 Position '+r.position+' · Owner '+r.owner+' · '+r.observedCount+' 笔 · 历史完整性未认证');
 for(const [k,label] of Object.entries(lifeLabels)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=r.metrics[k]+(k.endsWith('Hours')?' SOL·h':' SOL');dl.append(dt,dd)}
}
$('lifecycleFile').addEventListener('change',async()=>{
 const g=++lifecycleGeneration,scope=target;lifecycleReport=null;renderLifecycle();
 try{const r=await readJson($('lifecycleFile').files[0]);if(g!==lifecycleGeneration||scope!==target)return;
 if(!scope||r.schemaVersion!==1||r.status!=='CLOSED_LIFECYCLE_DIAGNOSTIC'||r.pool!==scope||!addr(r.position)||!addr(r.owner)||r.historyComplete!==false||r.pnlReady!==false||r.executionReady!==false||r.decisionReady!==false||r.coverage?.status!=='PROVIDER_PAGE_CHAIN_OBSERVED_UNVERIFIED'||r.coverage.historyComplete!==false||r.coverage.count!==r.observedCount||!Number.isSafeInteger(r.observedCount)||r.observedCount<2||r.observedCount>20000||!Number.isSafeInteger(r.openingSlot)||!Number.isSafeInteger(r.closingSlot)||r.closingSlot<r.openingSlot||!['ledgerHash','marksHash','configHash'].every(k=>hash(r.bindings?.[k]))||!Object.keys(lifeLabels).every(k=>perfDecimal(r.metrics?.[k])))throw Error('报告身份或结构不匹配');
 lifecycleReport=r;renderLifecycle();
 }catch(e){if(g===lifecycleGeneration)put('lifecycleStatus','导入失败：'+e.message)}
});
$('clearLifecycle').addEventListener('click',()=>{lifecycleGeneration++;lifecycleReport=null;$('lifecycleFile').value='';renderLifecycle()});

'use strict';
// Historical file import only. No live binding, wallet or transaction route.
const paperModes=['hodl','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid','adaptive'];
let paperCheckpoint=null,paperGeneration=0;
function validatePaperCheckpoint(cp){
 const r=cp?.report;
 if(cp?.schemaVersion!==1||cp.scope!=='PAPER_RESEARCH_CHECKPOINT'||!hash(cp.checkpointHash)||!hash(cp.configHash)||!hash(cp.backendHash)||!Array.isArray(cp.eventHashes)||!cp.eventHashes.length||cp.eventHashes.length>5000||!cp.eventHashes.every(hash)||r?.schemaVersion!==1||r.scope!=='VIRTUAL_CAPITAL_ONLY'||r.status!=='PAPER_REPLAY_UNVERIFIED'||!addr(r.pool)||!addr(r.mintX)||!addr(r.mintY)||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.end<=r.start||r.end!==cp.end||!Number.isFinite(r.generatedAt)||!['modelInputReady','decisionReady','executionReady','protocolExact','calibrated','pnlReady','coverageIndependentlyVerified'].every(k=>r[k]===false)||!Array.isArray(r.rows)||r.rows.length!==8||r.rows.some((v,i)=>v.mode!==paperModes[i]||v.actualPnl!==false||!['HYPOTHETICAL_REPLAY','VIRTUAL_INTENT_PENDING','INCONCLUSIVE_MODEL_PATH'].includes(v.status)||!Number.isFinite(v.initialNavSol)||v.initialNavSol<=0||v.initialNavSol!==r.rows[0].initialNavSol||!['virtualNavSol','pnlSol','excessVsHoldSol','feesSol','costSol','maxDrawdown'].every(k=>v[k]===null||Number.isFinite(v[k]))||v.status==='INCONCLUSIVE_MODEL_PATH'&&['virtualNavSol','pnlSol','excessVsHoldSol','feesSol','costSol'].some(k=>v[k]!==null)))throw Error('模拟检查点结构或研究范围不符');
 return cp;
}
function renderPaper(){
 const r=paperCheckpoint?.report,body=$('paperRows');body.replaceChildren();
 put('paperPool',r?r.pool.slice(0,8)+'…'+r.pool.slice(-6):'—');put('paperEvents',paperCheckpoint?.eventHashes.length);put('paperEnd',r?new Date(r.end*1000).toLocaleString():'—');put('paperReportState',r?'历史 · 未验证':'未导入');
 for(const mode of paperModes){const row=r?.rows.find(v=>v.mode===mode),tr=document.createElement('tr');cell(tr,mode==='hodl'?'No LP / HODL':mode==='adaptive'?'Adaptive':names[mode]??mode);cell(tr,row?.status??'—');for(const k of ['initialNavSol','virtualNavSol','pnlSol','excessVsHoldSol','feesSol','costSol'])cell(tr,fmt(row?.[k]));cell(tr,Number.isFinite(row?.maxDrawdown)?fmt(row.maxDrawdown*100)+'%':'—');body.append(tr)}
}
$('paperFile').addEventListener('change',async()=>{const g=++paperGeneration;paperCheckpoint=null;renderPaper();try{const file=$('paperFile').files[0];if(!file||file.size>64*1024*1024)throw Error('检查点文件缺失或过大');const cp=validatePaperCheckpoint(JSON.parse(await file.text()));const {checkpointHash,...payload}=cp;const bytes=new TextEncoder().encode(JSON.stringify(payload));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==checkpointHash)throw Error('检查点哈希不匹配');if(g!==paperGeneration)return;paperCheckpoint=cp;renderPaper();put('paperStatus','已导入历史模拟报告，哈希一致；不代表当前行情或独立验证。')}catch(e){if(g===paperGeneration)put('paperStatus','导入失败：'+e.message)}});
$('clearPaper').addEventListener('click',()=>{paperGeneration++;paperCheckpoint=null;$('paperFile').value='';renderPaper();put('paperStatus','请导入已生成的模拟检查点。')});

let paperAutoGeneration=0,paperAutoBusy=false,paperAutoReading=false,paperAutoData=null;
function paperSolRaw(v){if(typeof v!=='string'||!/^\d+(\.\d{1,9})?$/.test(v)||v.length>30)throw Error('请输入最多9位小数的 SOL 金额');const [a,b='']=v.split('.');return (BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0')||'0')).toString()}
function paperSignedSol(v){if(typeof v!=='string'||! /^-?\d{1,80}$/.test(v))return '—';const n=BigInt(v),a=n<0n?-n:n;return (n<0n?'-':'')+(a/1000000000n).toString()+'.'+(a%1000000000n).toString().padStart(9,'0').slice(0,6)}
function renderAutoPaper(r){
 paperAutoData=r;const body=$('paperAutoRows');body.replaceChildren();
 $('paperAutoPause').disabled=paperAutoBusy||!r?.running;$('paperAutoStart').disabled=paperAutoBusy||!!r?.running;
 if(!r)return;
 const summary=[r.status,r.reason,r.checkpointFresh?'最近观察':'非当前观察',r.slot!=null?'Slot '+r.slot+' · '+r.snapshotCount+' 个快照':null,r.window? r.window.days+'天 · '+r.window.status:null,r.adaptiveInputBasis,r.comparison?'配对 '+r.comparison.pairedStrategies+'/'+r.comparison.totalStrategies+' · 缺口 '+r.comparison.gapCount:null,r.comparison?.completedEvaluation?.rows?.length?'最高观察分 '+r.comparison.completedEvaluation.rows[0].mode+' '+fmt(r.comparison.completedEvaluation.rows[0].scoreBps)+' bps':null];
 put('paperAutoStatus',summary.filter(Boolean).join(' · '));
 for(const x of r.rows){const tr=document.createElement('tr');cell(tr,x.mode==='NO_LP'?'No LP / HODL':names[x.mode]??x.mode);cell(tr,x.status+(x.reason?' · '+x.reason:'')+(x.adaptiveReason?' · '+x.adaptiveReason:'')+(x.mode==='adaptive'?' · 开仓 '+(x.entries??'—')+' · 调仓/再入场 '+x.rebalances:''));cell(tr,paperSignedSol(x.initialNavYRaw));for(const k of ['navYRaw','pnlYRaw','excessVsHoldYRaw','costYRaw'])cell(tr,paperSignedSol(x.latest?.[k]));cell(tr,Number.isFinite(x.latest?.maxDrawdownBps)?fmt(x.latest.maxDrawdownBps/100)+'%':'—');body.append(tr)}
}
function validateAutoPaper(r,scope){if(r?.scope!=='PAPER_AUTO_RESEARCH_ONLY'||r.pool!==scope||typeof r.running!=='boolean'||!Array.isArray(r.rows)||r.rows.length>8)throw Error('模拟服务响应不符');return r}
async function refreshPaperAuto(){
 if(paperAutoData&&paperAutoData.pool!==target){paperAutoGeneration++;renderAutoPaper(null);put('paperAutoStatus','Pool 已切换，等待重新读取。')}
 if(paperAutoReading||paperAutoBusy||page!=='performance'||$('paperPerformance').hidden||!target)return;
 paperAutoReading=true;const p=target,g=++paperAutoGeneration;
 try{const res=await terminalGet('/api/terminal/paper-status',p);const r=await res.json();if(g!==paperAutoGeneration||p!==target)return;if(!res.ok)throw Error(r.gaps?.[0]??'服务不可用');renderAutoPaper(validateAutoPaper(r,p))}
 catch(e){if(g===paperAutoGeneration&&p===target){renderAutoPaper(null);put('paperAutoStatus','读取失败：'+e.message+' · 不展示旧值')}}
 finally{paperAutoReading=false}
}
$('paperAutoRefresh').addEventListener('click',refreshPaperAuto);
$('paperAutoStart').addEventListener('click',async()=>{
 if(paperAutoBusy)return;
 const p=target;try{
  if(!draft||draft.pool!==p)throw Error('请先在策略页为当前 Pool 准备虚拟本金草稿');const d=draft;
  const dd=number('paperAutoDrawdown')*100,gap=number('paperAutoGap');if(!Number.isFinite(dd)||Math.abs(dd-Math.round(dd))>1e-8||dd<1||dd>10000||!Number.isInteger(gap))throw Error('风险参数无效');
  const policy={evaluationDays:Number($('paperEvaluationDays').value),maxDrawdownBps:Math.round(dd),maxGapSeconds:gap,maxLossSolRaw:paperSolRaw($('paperAutoLoss').value.trim()),exitCostSolRaw:paperSolRaw($('paperAutoExitCost').value.trim())};
  if($('paperAdaptiveEnabled').checked)policy.adaptive={cooldownSeconds:number('paperAdaptiveCooldown'),maxRebalances:number('paperAdaptiveCount'),maxTurnoverSol:number('paperAdaptiveTurnover')};
  paperAutoBusy=true;paperAutoGeneration++;$('paperAutoStart').disabled=true;put('paperAutoStatus','正在生成并冻结虚拟方案…');
  const res=await terminalPost('/api/terminal/paper-start',{draft:d,policy},45000),r=await res.json();
  if(p!==target)return;if(!res.ok)throw Error(r.gaps?.[0]??'启动失败');renderAutoPaper(validateAutoPaper(r,p))
 }catch(e){if(p===target)put('paperAutoStatus','启动失败：'+e.message)}
 finally{paperAutoBusy=false;$('paperAutoStart').disabled=!!paperAutoData?.running;$('paperAutoPause').disabled=!paperAutoData?.running}
});
$('paperAutoPause').addEventListener('click',async()=>{if(paperAutoBusy||!paperAutoData?.running||paperAutoData.pool!==target)return;const p=target,id=paperAutoData.id;paperAutoBusy=true;paperAutoGeneration++;$('paperAutoPause').disabled=true;try{const res=await terminalPost('/api/terminal/paper-pause',{pool:p,id},10000),r=await res.json();if(p!==target)return;if(!res.ok)throw Error(r.gaps?.[0]??'暂停失败');renderAutoPaper(validateAutoPaper(r,p))}catch(e){if(p===target)put('paperAutoStatus','暂停失败：'+e.message)}finally{paperAutoBusy=false;$('paperAutoStart').disabled=!!paperAutoData?.running;$('paperAutoPause').disabled=!paperAutoData?.running}});

let paperPoolsReading=false;
async function refreshPaperPools(){
 if(paperPoolsReading||page!=='performance'||$('paperPerformance').hidden)return;
 paperPoolsReading=true;const body=$('paperPoolsRows');
 try{
  const res=await terminalGet('/api/terminal/paper-pools',null),r=await res.json();
  if(!res.ok||r.scope!=='PAPER_MULTI_POOL_RESEARCH_ONLY'||!Array.isArray(r.pools)||r.pools.length>9||new Set(r.pools.map(x=>x.pool)).size!==r.pools.length||r.pools.some(x=>!addr(x.pool)||!Array.isArray(x.rows)))throw Error('多池状态无效');
  body.replaceChildren();for(const x of r.pools){const tr=document.createElement('tr');cell(tr,x.pool);cell(tr,x.status+(x.reason?' · '+x.reason:''));cell(tr,x.snapshotCount??'—');cell(tr,paperSignedSol(x.rows.find(v=>v.mode==='adaptive')?.latest?.excessVsHoldYRaw));cell(tr,x.checkpointFresh?'最近观察 · 未验证':'历史或不可用');body.append(tr)}
  put('paperPoolsStatus',r.pools.length+' 个配置池 · '+r.pools.filter(x=>x.running===true).length+' 个活动实验 · 独立观察');
 }catch(e){body.replaceChildren();put('paperPoolsStatus','读取失败：'+e.message)}
 finally{paperPoolsReading=false}
}
$('paperAutoRefresh').addEventListener('click',refreshPaperPools);
setInterval(()=>{refreshPaperAuto();refreshPaperPools()},15000);


// Research reports are read-only projections of committed experiment history.
const reportRegimes={HEALTHY_RANGE:'健康震荡',UPTREND:'上涨',DOWNTREND:'下跌',DISTRIBUTION_RANGE:'分发',DEAD_RANGE:'低活跃',STRESS:'压力',UNKNOWN:'未知'};
const reportColors=['#94a3b8','#38bdf8','#a78bfa','#f59e0b','#14b8a6','#f472b6','#84cc16','#f8fafc'];
const regimeColors=['#16a34a','#0891b2','#ea580c','#ca8a04','#64748b','#dc2626','#9ca3af'];
let researchReport=null,reportGeneration=0,reportBusy=false;
const reportName=m=>m==='NO_LP'?'HODL':m==='adaptive'?'Adaptive':names[m]??m;
const reportDuration=ms=>Number.isFinite(ms)?(ms/3600000).toFixed(2)+' h':'—';
const reportSol=v=>v==null?'—':paperSignedSol(v);
function clearPaperReport(){reportGeneration++;researchReport=null;$('paperReportContent').hidden=true;$('paperReportJSON').disabled=true;$('paperReportCSV').disabled=true;$('paperReportSelect').replaceChildren();const o=document.createElement('option');o.value='';o.textContent='当前实验';$('paperReportSelect').append(o);$('paperReportSelect').value='';$('paperReportId').value='';put('paperReportStatus','选择当前或历史实验生成报告。')}
function reportSvg(tag,attrs,parent){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));parent.append(el);return el}
function renderPaperReportChart(){
 const r=researchReport,host=$('paperReportChart'),legend=$('paperReportLegend');host.replaceChildren();legend.replaceChildren();if(!r)return;
 const metric=$('paperReportMetric').value||'alphaYRaw',pts=r.chart.points,modes=r.strategies.map(x=>x.mode),value=x=>x==null?null:metric==='drawdownBps'?(Number.isFinite(x)?x/100:null):typeof x==='string'&&/^-?\d{1,80}$/.test(x)?Number(x)/1e9:null;
 const all=pts.flatMap(p=>p.rows.map(x=>value(x[metric]))).filter(Number.isFinite);
 if(!all.length){put('paperReportChartNote','没有有效曲线点。');return}
 const lo=Math.min(...all,metric==='alphaYRaw'?0:Infinity),hi=Math.max(...all,metric==='alphaYRaw'?0:-Infinity),span=hi-lo||Math.max(Math.abs(hi)*.01,1e-9),w=840,h=248,left=78,right=18,top=15,bottom=35,x=t=>left+(w-left-right)*(t-r.startAt)/Math.max(1,r.endAt-r.startAt),y=v=>top+(h-top-bottom)*(hi-v)/span;
 const svg=reportSvg('svg',{viewBox:'0 0 '+w+' '+h,role:'img','aria-label':'多策略'+(metric==='drawdownBps'?'回撤':'收益')+'时间曲线'},host);
 for(let i=0;i<=4;i++){const v=hi-span*i/4,yy=y(v);reportSvg('line',{x1:left,x2:w-right,y1:yy,y2:yy,stroke:'currentColor','stroke-opacity':.13},svg);reportSvg('text',{x:left-7,y:yy+4,fill:'currentColor','font-size':11,'text-anchor':'end'},svg).textContent=fmt(v)}
 for(let i=0;i<modes.length;i++){
  const mode=modes[i],color=reportColors[i],label=document.createElement('span');label.style.color=color;label.textContent='● '+reportName(mode);legend.append(label);
  let path='',last=null;for(const p of pts){const v=value(p.rows.find(q=>q.mode===mode)?.[metric]);if(!Number.isFinite(v)){last=null;continue}const link=last&&last.gapCount===p.gapCount&&p.sequence-last.sequence<=r.chart.stride;path+=(link?' L':' M')+x(p.time).toFixed(2)+' '+y(v).toFixed(2);if(!link)reportSvg('circle',{cx:x(p.time),cy:y(v),r:2,fill:color},svg);last=p}
  reportSvg('path',{d:path,fill:'none',stroke:color,'stroke-width':mode==='adaptive'?2.6:1.4,'vector-effect':'non-scaling-stroke'},svg);
 }
 for(const t of [r.startAt,r.endAt])reportSvg('text',{x:x(t),y:h-9,fill:'currentColor','font-size':10,'text-anchor':t===r.startAt?'start':'end'},svg).textContent=new Date(t).toLocaleString();
 put('paperReportChartNote',(metric==='drawdownBps'?'单位 %':'单位 SOL')+' · '+pts.length+' 个展示点 / '+r.observations+' 个观测 · 缺口断线；采样图不代表完整逐点路径。');
}
function renderPaperResearchReport(r){
 researchReport=r;$('paperReportContent').hidden=false;$('paperReportJSON').disabled=false;$('paperReportCSV').disabled=false;
 put('paperReportCapital',reportSol(r.initialNavYRaw));put('paperReportDuration',reportDuration(r.elapsedMs));put('paperReportCount',r.observations);put('paperReportGaps',r.gapIntervals+' / '+r.missingObservationLogs);
 put('paperReportStatus',r.id+' · '+r.experimentStatus+' · 截至 '+new Date(r.endAt).toLocaleString()+' · '+r.historyVerification.records+' 条已提交记录');
 renderPaperReportChart();
 const env=$('paperReportEnvironmentRows'),bar=$('paperReportRegimeBar'),mh=$('paperReportMatrixHead'),mr=$('paperReportMatrixRows'),ar=$('paperReportAttributionRows'),logs=$('paperReportLogRows');for(const b of [env,bar,mh,mr,ar,logs])b.replaceChildren();
 const hdr=document.createElement('tr');for(const t of ['策略',...r.environments.map(e=>reportRegimes[e.regime]??e.regime)]){const th=document.createElement('th');th.textContent=t;hdr.append(th)}mh.append(hdr);
 for(const [i,e] of r.environments.entries()){
  const tr=document.createElement('tr');cell(tr,reportRegimes[e.regime]??e.regime);cell(tr,reportDuration(e.observedMs));cell(tr,e.intervals);cell(tr,Object.entries(e.inputBases??{}).map(([k,v])=>k+' '+v).join(' · ')||'—');env.append(tr);
  if(e.observedMs>0){const seg=document.createElement('span');seg.style.background=regimeColors[i];seg.style.flex=String(e.observedMs);seg.title=(reportRegimes[e.regime]??e.regime)+' '+reportDuration(e.observedMs);bar.append(seg)}
 }
 if(r.gapMs>0){const seg=document.createElement('span');seg.style.flex=String(r.gapMs);seg.className='paper-report-gap';seg.title='缺口 '+reportDuration(r.gapMs);bar.append(seg)}
 for(const s of r.strategies){
  const tr=document.createElement('tr');cell(tr,reportName(s.mode));for(const e of r.environments){const a=e.strategies.find(x=>x.mode===s.mode),td=cell(tr,a?.intervals?reportSol(a.alphaYRaw):'—');if(a?.intervals){const n=BigInt(a.alphaYRaw);td.dataset.pnl=n>0n?'positive':n<0n?'negative':'flat';td.title=a.intervals+' 有效 / '+a.missingIntervals+' 缺失区间'}}mr.append(tr);
  const row=document.createElement('tr'),a=s.intervalAttribution,v=s.latest;cell(row,reportName(s.mode)+' · '+s.status);for(const k of ['navYRaw','pnlYRaw','alphaYRaw','feeMarkYRaw'])cell(row,reportSol(v?.[k]));for(const k of ['feeAccrualYRaw','priorHoldingsRepriceYRaw','inventoryConversionResidualYRaw','operationCostYRaw'])cell(row,a.intervals?reportSol(a[k]):'—');cell(row,a.intervals+' / '+a.missingIntervals);ar.append(row);
 }
 const pg=r.logPage;put('paperReportLogPage',pg.from+'–'+Math.min(pg.from+pg.limit-1,pg.total)+' / '+pg.total);$('paperReportPrev').disabled=pg.from<=1;$('paperReportNext').disabled=pg.from+pg.limit>pg.total;
 put('paperReportDecisionSummary',r.decisionCount+' 条决策记录 · '+Object.entries(r.operations??{}).map(([k,v])=>k+' '+v).join(' · '));
 for(const e of pg.records){const l=e.log,m=l?.market,d=l?.decision,tr=document.createElement('tr');cell(tr,new Date(e.time).toLocaleString()+' / '+e.slot);cell(tr,reportRegimes[m?.regime]??'未知');cell(tr,m?.inputBasis??m?.reason??'历史未记录');cell(tr,d?.selected?.action??'无');cell(tr,[d?.reason,d?.outcome].filter(Boolean).join(' · ')||'—');cell(tr,(l?.operations??[]).map(o=>reportName(o.mode)+': '+o.action).join(' · ')||'—');const td=cell(tr,''),details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='市场 / 候选 / 资产';pre.textContent=JSON.stringify(l,null,2)??'历史未记录';details.append(summary,pre);td.append(details);logs.append(tr)}
 put('paperReportLimits',r.limitations.join(' · '));
}
async function loadPaperReportCatalog(){
 const p=target,e=poolEpoch,g=reportGeneration;if(!p)return;
 try{const res=await terminalGet('/api/terminal/paper-reports',p),r=await res.json();if(!sameScope(e,p,poolEpoch,target)||g!==reportGeneration)return;if(!res.ok||r.scope!=='PAPER_REPORT_CATALOG'||r.pool!==p||!Array.isArray(r.ids)||r.ids.length>100)throw Error('实验列表不可用');const list=$('paperReportSelect'),old=list.value;list.replaceChildren();for(const id of ['',...r.ids]){const o=document.createElement('option');o.value=id;o.textContent=id?(id===r.activeId?'当前 · ':'历史 · ')+id:'当前实验';list.append(o)}list.value=r.ids.includes(old)?old:'';put('paperReportStatus','共 '+r.total+' 个实验；未列出的历史实验可直接输入 ID。')}catch(err){if(sameScope(e,p,poolEpoch,target)&&g===reportGeneration)put('paperReportStatus','列表读取失败：'+err.message)}
}
async function loadPaperResearchReport(from){
 if(reportBusy||!target)return;const p=target,e=poolEpoch,g=++reportGeneration,id=$('paperReportId').value.trim()||$('paperReportSelect').value||undefined;
 reportBusy=true;$('paperReportLoad').disabled=true;put('paperReportStatus','正在读取已提交的历史记录…');
 try{const res=await terminalPost('/api/terminal/paper-report',{pool:p,id,from},60000),r=await res.json();if(g!==reportGeneration||!sameScope(e,p,poolEpoch,target))return;if(!res.ok||r.scope!=='PAPER_OBSERVED_RESEARCH_REPORT'||r.pool!==p||id&&id!==r.id||!Array.isArray(r.strategies)||r.strategies.length!==8||!Array.isArray(r.environments)||!Array.isArray(r.chart?.points)||r.chart.points.length>2000||!Array.isArray(r.logPage?.records)||r.logPage.records.length>30)throw Error(r.gaps?.[0]??'报告数据不可用');renderPaperResearchReport(r)}
 catch(err){if(g===reportGeneration&&sameScope(e,p,poolEpoch,target)){researchReport=null;$('paperReportContent').hidden=true;$('paperReportJSON').disabled=true;$('paperReportCSV').disabled=true;put('paperReportStatus','报告读取失败：'+err.message)}}
 finally{reportBusy=false;$('paperReportLoad').disabled=false}
}
function reportDownload(text,type,ext){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=researchReport.id+'-report.'+ext;a.click();URL.revokeObjectURL(url)}
$('paperReportCatalog').addEventListener('click',loadPaperReportCatalog);
$('paperReportLoad').addEventListener('click',()=>loadPaperResearchReport());
$('paperReportMetric').addEventListener('change',renderPaperReportChart);
$('paperReportSelect').addEventListener('change',()=>{$('paperReportId').value=''});
$('paperReportPrev').addEventListener('click',()=>{if(researchReport){$('paperReportId').value=researchReport.id;loadPaperResearchReport(Math.max(1,researchReport.logPage.from-30))}});
$('paperReportNext').addEventListener('click',()=>{if(researchReport){$('paperReportId').value=researchReport.id;loadPaperResearchReport(researchReport.logPage.from+30)}});
$('paperReportJSON').addEventListener('click',()=>{if(researchReport)reportDownload(JSON.stringify(researchReport,null,2),'application/json','json')});
$('paperReportCSV').addEventListener('click',()=>{if(!researchReport)return;const fields=['mode','intervals','observedMs','missingIntervals','missingMs','netYRaw','alphaYRaw','feeAccrualYRaw','priorHoldingsRepriceYRaw','operationCostYRaw','inventoryConversionResidualYRaw'],rows=[['regime',...fields],...researchReport.environments.flatMap(e=>e.strategies.map(s=>[e.regime,...fields.map(k=>s[k])]))],csv=rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');reportDownload(csv,'text/csv;charset=utf-8','csv')});

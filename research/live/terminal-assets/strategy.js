'use strict';
function resetDraft(){if(report?.terminalBinding)clearReport();if(planBusy)importGeneration++;draft=null;$('export').disabled=true;put('draftStatus','参数已变化，需重新检查。');put('generateStatus','');put('bindingStatus','参数已变化；归档不随草稿更新，不可据此开仓。')}
function rows(){const body=$('families');body.replaceChildren();for(const name of families){const f=report?.planPreview?.families?.find(x=>x.family===name),r=f?.best,tr=document.createElement('tr');const label=cell(tr,names[name]);if(report?.planPreview?.selected?.family===name){label.classList.add('recommended');label.append(' · 模型选中')}if(selected?.family===name)tr.classList.add('viewing');cell(tr,f?String(f.feasible)+' / '+String(f.total):'—');cell(tr,fmt(r?.scenarioEstimates?.pnlSol));cell(tr,fmt(r?.scenarioEstimates?.cvarLossSol));cell(tr,fmt(r?.score));const td=cell(tr,'');const b=document.createElement('button');b.textContent=r?.feasible?'查看':'不可用';b.disabled=!r?.feasible;b.setAttribute('aria-label','查看 '+names[name]+' 归档方案');b.setAttribute('aria-pressed',String(selected?.family===name));b.addEventListener('click',()=>{shapeView=['spot','curve','bid_ask'].includes(name)?name:(report?.planPreview?.selected?.family===name?'dynamic':'other');syncShape();select(r);rows();put('shapeStatus','正在查看 '+names[name]+' 归档方案');});td.append(b);body.append(tr)}}
function select(r){selected=r;put('viewed',r?names[r.family]:'未选择');put('selectedFamily',names[r?.family]??'—');put('bid',fmt(r?.allocation?.bidSol));put('ask',fmt(r?.allocation?.askMeme));put('range',r?.allocation?.lowerBinId==null?'—':r.allocation.lowerBinId+' 至 '+r.allocation.upperBinId);put('risk',fmt(r?.risk?.stressLoss));put('tail',fmt(r?.scenarioEstimates?.cvarLossSol));const ref=report?.referencePriceSolPerMeme;put('deployed',r?.allocation&&Number.isFinite(ref)&&ref>0?fmt(r.allocation.bidSol+r.allocation.askMeme*ref):'—');const body=$('binRows'),chart=$('binChart');body.replaceChildren();chart.replaceChildren();
 const bins=Array.isArray(r?.allocation?.bins)?r.allocation.bins.slice(0,101):[];
 if(!bins.length){chart.textContent=r?'No LP · 无部署分配':'等待方案数据';const tr=document.createElement('tr');cell(tr,'无分配数据').colSpan=4;body.append(tr);return}
 const refPrice=report?.referencePriceSolPerMeme;
 const sorted=[...bins].sort((a,b)=>a.binId-b.binId);
 for(const b of sorted){const tr=document.createElement('tr');[b.binId,fmt(b.priceSolPerMeme),fmt(b.sol),fmt(b.meme)].forEach(t=>cell(tr,t));body.append(tr)}
 if(!Number.isFinite(refPrice)||refPrice<=0){chart.textContent='缺少归档参考价，不能统一估值；请查看数量表';return}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','按实际 Bin 位置，以相同 SOL 估值尺度堆叠展示分配');
 const active=report?.market?.activeId,lo=Math.min(sorted[0].binId,Number.isInteger(active)?active:sorted[0].binId),hi=Math.max(sorted.at(-1).binId,Number.isInteger(active)?active:sorted.at(-1).binId),span=hi-lo+1;
 const max=Math.max(...sorted.map(b=>b.sol+b.meme*refPrice));if(!Number.isFinite(max)||max<=0||span>1000){chart.textContent='区间或估值超出绘图范围；请查看数量表';return}
 const w=560/span,element=(tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el};
 for(const b of sorted){let y=145;for(const [v,color] of [[b.sol,'#64c9b1'],[b.meme*refPrice,'#aa86f6']]){if(v<=0)continue;const h=125*v/max;y-=h;element('rect',{x:20+(b.binId-lo)*w,y,width:Math.max(.5,w*.8),height:h,fill:color})}}
 if(Number.isInteger(active)){const x=20+(active-lo+.4)*w;element('line',{x1:x,x2:x,y1:12,y2:148,stroke:'#e5bc79','stroke-dasharray':'4 3'});element('text',{x:Math.min(520,Math.max(20,x)),y:162,fill:'#e5bc79','font-size':10}).textContent='Active '+active}
 chart.append(svg);const t=document.createElement('small');t.textContent='青绿 SOL / 紫色 MEME 按同一归档参考价折算 SOL · 非当前可变现价值';chart.append(t);
}
function clearReport(){report=null;put('reportSource','未生成 · 未验收');selected=null;shapeView='dynamic';syncShape();put('shapeStatus','等待归档报告');put('insight','等待真实市场报告');put('exitDepth','—');put('inventory','—');put('marketTime','—');$('clearArchive').disabled=true;put('bindingStatus','归档未绑定当前资金；不可据此开仓。');for(const id of ['price','activeBin','regime','slot'])put(id,'—');put('quality','未导入');put('importStatus','尚未导入。报告与草稿独立。');put('decision','尚未生成方案');put('gaps','真实数据未连接；没有可执行报价或钱包余额。');select(null);rows();$('step3').classList.remove('active')}
$('poolForm').addEventListener('submit',e=>{e.preventDefault();const v=$('pool').value.trim();if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)){put('poolStatus','地址格式不符（尚未链上校验）');return}if(v!==target){importGeneration++;target=v;clearReport();resetDraft();$('file').value=''}put('poolStatus','目标池已记录，未链上校验');$('step2').classList.add('active')});
$('pool').addEventListener('input',()=>{if($('pool').value.trim()!==target){importGeneration++;target='';clearReport();resetDraft();$('file').value='';put('poolStatus','需重新设置目标池');$('step2').classList.remove('active')}});
$('entry').addEventListener('change',()=>{$('meme').disabled=$('entry').value==='sol';if($('meme').disabled)$('meme').value='0'});
$('request').addEventListener('input',resetDraft);
$('request').addEventListener('invalid',e=>{if(e.target.closest('details'))$('advanced').open=true;},true);
$('clearArchive').addEventListener('click',()=>{importGeneration++;$('file').value='';clearReport()});
$('request').addEventListener('submit',e=>{e.preventDefault();try{if(!target)throw Error('先设置目标池');const sol=amount('sol'),meme=amount('meme'),horizon=number('horizon')*60;if(!(Number(sol)>0||Number(meme)>0))throw Error('至少一种资产预算大于零');if(number('reserve')+number('cost')>Number(sol))throw Error('SOL 预算不足以覆盖储备与一次模型操作成本');if($('entry').value==='holding'&&Number(meme)<=0)throw Error('已有 MEME 入口需要 MEME 预算');if(!Number.isSafeInteger(horizon))throw Error('周期无效');draft={schemaVersion:1,kind:'UX_DRAFT_NOT_ENGINE_REQUEST',pool:target,entry:$('entry').value,solHuman:sol,memeHuman:meme,goal:$('goal').value,horizonSeconds:horizon,capitalScope:'USER_DECLARED_ALLOCATION',allowDispose:false,riskConfig:{maxInventoryRatio:number('ratio')/100,maxInventoryTokens:number('maxTokens'),minSolReserve:number('reserve'),maxLossSol:number('loss'),stressDrop:number('stress')/100,maxBinShare:number('share')/100,operationCostSol:number('cost'),feeBps:number('fee'),protocolShare:number('protocol')/100,slippageBps:number('slippage')}};put('draftStatus','参数检查通过。服务端将按 Mint 精度转换并校验真实证据。');put('bindingStatus','参数已检查；等待本地服务生成绑定的研究报告。');$('export').disabled=false}catch(err){resetDraft();put('draftStatus',err.message)}});
$('export').addEventListener('click',()=>{if(!draft)return;const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lp-ux-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
function validateArchive(r,target){
 if(!r||r.pool!==target||r.schemaVersion!==1||r.decisionReady!==false||r.executionReady!==false||!['BLOCKED','RESEARCH_DIAGNOSTIC_UNVERIFIED'].includes(r.status))throw Error('归档身份或只读状态不符');
 const p=r.planPreview;if(!p)return;
 if(p.decisionReady!==false||p.executionReady!==false)throw Error('方案不是只读预览');
 if(p.status!=='RESEARCH_PLAN_PREVIEW_UNVERIFIED'){if(p.selected||p.families?.length)throw Error('阻塞方案含可查看分配');return}
 if(r.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||!Array.isArray(p.families)||p.families.length!==families.length||new Set(p.families.map(f=>f.family)).size!==families.length)throw Error('方案策略族不完整或重复');
 const nonneg=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const checkRow=(b,f)=>{
  if(!b||b.feasible!==true||b.family!==f||!Number.isFinite(b.score)||!b.allocation||!nonneg(b.allocation.bidSol)||!nonneg(b.allocation.askMeme)||!Array.isArray(b.allocation.bins)||b.allocation.bins.length>101)throw Error('候选方案格式不符');
  const a=b.allocation,bins=a.bins;
  if(new Set(bins.map(x=>x.binId)).size!==bins.length||!bins.every(x=>Number.isSafeInteger(x.binId)&&nonneg(x.sol)&&nonneg(x.meme)&&nonneg(x.priceSolPerMeme)&&x.priceSolPerMeme>0))throw Error('Bin 数据无效');
  const close=(x,y)=>Math.abs(x-y)<=1e-8*Math.max(1,Math.abs(x),Math.abs(y));
  if(!close(bins.reduce((n,x)=>n+x.sol,0),a.bidSol)||!close(bins.reduce((n,x)=>n+x.meme,0),a.askMeme))throw Error('Bin 合计与预算不符');
  if(bins.length?(a.lowerBinId!==Math.min(...bins.map(x=>x.binId))||a.upperBinId!==Math.max(...bins.map(x=>x.binId))):(a.lowerBinId!==null||a.upperBinId!==null))throw Error('区间与分配不符');
  if(f==='NO_LP'&&(bins.length||a.bidSol||a.askMeme))throw Error('No LP 不允许部署分配');
 };
 for(const f of p.families){if(!families.includes(f.family)||!Number.isSafeInteger(f.total)||!Number.isSafeInteger(f.feasible)||f.total<0||f.feasible<0||f.feasible>f.total||Boolean(f.best)!==(f.feasible>0))throw Error('策略族统计不符');if(f.best)checkRow(f.best,f.family)}
 if(p.selected){checkRow(p.selected,p.selected.family);const match=p.families.find(f=>f.family===p.selected.family);if(!match?.best||JSON.stringify(match.best)!==JSON.stringify(p.selected))throw Error('选中方案与策略族最佳方案不一致')}
}
$('file').addEventListener('change',async()=>{const generation=++importGeneration;clearReport();try{const f=$('file').files[0];if(!f)return;if(!target)throw Error('先设置目标池');if(f.size>8*1024*1024)throw Error('报告超过 8 MB');const r=JSON.parse(await f.text());if(generation!==importGeneration)return;if(!r||typeof r!=='object')throw Error('报告格式无效');
 const {terminalBinding:ignored,reviewId:ignoredId,...archive}=r;renderReport(archive,'archive');}catch(err){if(generation!==importGeneration)return;clearReport();put('importStatus','导入失败：'+err.message)}});


$('diagnostics').addEventListener('toggle',()=>{$('diagnosticToggle').setAttribute('aria-expanded',String($('diagnostics').open))});
$('showBins').addEventListener('click',()=>{const d=$('binDetails');d.open=!d.open;$('showBins').setAttribute('aria-expanded',String(d.open))});
$('binDetails').addEventListener('toggle',()=>{$('showBins').setAttribute('aria-expanded',String($('binDetails').open))});

function syncShape(){
 for(const b of document.querySelectorAll('[data-shape]'))b.setAttribute('aria-pressed',String(b.dataset.shape===shapeView));
 const desc={dynamic:'对比所有候选方案，也允许 No LP。',spot:'均匀形状。仅查看对应归档候选，不重新计算。',curve:'集中形状。仅查看对应归档候选，不重新计算。',bid_ask:'区间边缘形状。仅查看对应归档候选，不重新计算。'};
 put('shapeDescription',desc[shapeView]??'正在查看策略比较表中的其他归档候选。');
}
for(const b of document.querySelectorAll('[data-shape]'))b.addEventListener('click',()=>{
 shapeView=b.dataset.shape;syncShape();
 const p=report?.planPreview;const row=shapeView==='dynamic'?p?.selected:p?.families?.find(f=>f.family===shapeView)?.best;
 select(row?.feasible?row:null);rows();
 put('shapeStatus',row?.feasible?'正在查看归档方案':'该策略暂无可查看的归档方案');
});

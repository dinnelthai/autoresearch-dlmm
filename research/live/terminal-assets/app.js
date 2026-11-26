
'use strict';
const families=['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'],names={NO_LP:'No LP',spot:'Spot',curve:'Curve',bid_ask:'Bid-Ask',hybrid:'Hybrid',asymmetric:'Asymmetric',hybrid_grid:'Hybrid Grid'};
let perfWindow=null,perfGeneration=0,perfPositionScope=null,lifecycleReport=null,lifecycleGeneration=0;
let target='',report=null,draft=null,selected=null,importGeneration=0,shapeView='dynamic',poolEpoch=0;
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
$('file').addEventListener('change',async()=>{const generation=++importGeneration;clearReport();try{const f=$('file').files[0];if(!f)return;if(!target)throw Error('先设置目标池');if(f.size>8*1024*1024)throw Error('报告超过 8 MB');const r=JSON.parse(await f.text());if(generation!==importGeneration)return;if(r.pool!==target||r.decisionReady!==false||r.executionReady!==false||r.schemaVersion!==1)throw Error('报告池地址或只读契约不匹配');if(!['BLOCKED','RESEARCH_DIAGNOSTIC_UNVERIFIED'].includes(r.status))throw Error('未知报告状态');validateArchive(r,target);
 const {terminalBinding:ignored,reviewId:ignoredId,...archive}=r;renderReport(archive,'archive');}catch(err){if(generation!==importGeneration)return;clearReport();put('importStatus','导入失败：'+err.message)}});
rows();


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
syncShape();

let monitoring=new Map(),managementBusy=false,monitorSignature='',page='terminal',positionGeneration=0,positions=new Map(),positionSelected=null,managementSelected=null,shadow=null,shadowGeneration=0;
const screens=['terminal','positions','performance'];
function navigate(p){if(!screens.includes(p))return;page=p;if(p==='performance')put('performanceScope',positionSelected?'Position '+positionSelected.slice(0,8)+'…'+positionSelected.slice(-5):target?'当前 Pool '+target.slice(0,8)+'…':'当前 Pool 未选择');for(const el of document.querySelectorAll('[data-screen]'))el.hidden=el.dataset.screen!==p;for(const b of document.querySelectorAll('[data-page]')){if(b.dataset.page===p)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}$('diagnosticToggle').setAttribute('aria-controls',p==='positions'?'positionDiagnostics':p==='performance'?'shadowDiagnostics':'diagnostics');$('diagnosticToggle').setAttribute('aria-expanded',String(p==='positions'?$('positionDiagnostics').open:p==='performance'?(!$('shadowPerformance').hidden&&$('shadowDiagnostics').open):$('diagnostics').open));if(p==='performance'&&perfWindow)renderPerfWindow();window.scrollTo(0,0)}
for(const b of document.querySelectorAll('[data-page],[data-go]'))b.addEventListener('click',()=>navigate(b.dataset.page??b.dataset.go));
$('diagnosticToggle').addEventListener('click',()=>{if(page==='performance'){$('actualPerformance').hidden=true;$('shadowPerformance').hidden=false;for(const b of document.querySelectorAll('[data-perf]'))b.setAttribute('aria-pressed',String(b.dataset.perf==='shadow'));}const panel=page==='positions'?$('positionDiagnostics'):page==='performance'?$('shadowPerformance').querySelector('details'):$('diagnostics');panel.open=!panel.open;$('diagnosticToggle').setAttribute('aria-expanded',String(panel.open));if(panel.open)panel.scrollIntoView({block:'nearest'})});
$('positionPerformance').addEventListener('click',()=>{if(!positionSelected)return;navigate('performance');$('actualPerformance').hidden=false;$('shadowPerformance').hidden=true;for(const b of document.querySelectorAll('[data-perf]'))b.setAttribute('aria-pressed',String(b.dataset.perf==='actual'))});
const reasonLabels={SDK_INVERSE_DISABLED:'本地 SDK 数量反算尚未开启',INVERSE_TOLERANCE_REQUIRED:'未配置数量反算容许偏差',WEIGHT_SHAPE_UNAVAILABLE:'权重形状诊断未通过',INVERSE_CAPTURE_UNAVAILABLE:'缺少市场原始采集目录',INVERSE_CAPTURE_MISMATCH:'原始采集与市场快照不一致',INVERSE_CLOCK_UNAVAILABLE:'缺少同源 Clock 账户或解码器',INVERSE_CLOCK_SLOT_MISMATCH:'Clock 与市场 Slot 不一致',INVERSE_MINT_UNSUPPORTED:'Mint 不支持或精度不符',INVERSE_ACTIVE_BIN_UNAVAILABLE:'Active Bin 原始资产数量缺失',SDK_INVERSE_HELPER_UNAVAILABLE:'SDK 反算辅助函数不可用',SDK_INVERSE_RUNTIME_UNAVAILABLE:'SDK 反算失败或运行时不可用',INVERSE_DROPPED_BINS:'反算后存在零额目标 Bin',INVERSE_BUDGET_EXCEEDED:'反算超出原始整数资产预算',INVERSE_AMOUNT_ERROR_EXCEEDED:'资产数量偏差超过配置上限',SDK_WEIGHT_DIAGNOSTIC_DISABLED:'本地 SDK 权重诊断未开启',WEIGHT_TOLERANCE_REQUIRED:'必须明确配置可接受的形状偏差',SDK_VERSION_MISMATCH:'SDK 安装版本与固定版本不一致',SDK_WEIGHT_HELPER_UNAVAILABLE:'SDK 权重函数不可用',SDK_WEIGHT_RUNTIME_UNAVAILABLE:'SDK 运行时不可用',SDK_RANGE_OR_MULTIPLE_MESSAGES_UNSUPPORTED:'区间不连续、超限或需要多笔交易',SDK_DROPPED_BINS:'SDK 转换丢失了目标 Bin',SDK_SHAPE_DEVIATION_EXCEEDED:'权重形状偏差超过用户配置上限',SDK_EMPTY_WEIGHT_SHAPE:'SDK 权重全部归零',ZERO_BIN_OR_PRICE:'Bin 数量归零或价格证据缺失',INTEGER_DIAGNOSTIC_UNAVAILABLE:'整数分配预检不可用',MANAGEMENT_INTEGER_MAPPING_PENDING:'已有仓位的增减流动性精确数量映射待验证',OPEN_RESEARCH_ONLY:'仅支持新仓位研究分配预检',NO_LP_BASELINE:'不部署流动性，无交易数量',EXACT_BUDGET_EXCEEDED:'整数化后超过申报资金上限',ALLOCATION_ROUNDS_TO_ZERO:'整数化后无有效数量',BIN_NOT_OBSERVED_OR_DUPLICATE:'Bin 不在采集范围或重复',SDK_WEIGHT_MAPPING_UNVERIFIED:'SDK 权重转换尚未验证',SDK_POSITION_AND_ACCOUNT_COST_UNVERIFIED:'仓位与账户成本尚未验证',EXACT_MESSAGE_FEE_AND_SIMULATION_REQUIRED:'仍需真实交易消息费用与模拟',WALLET_EVIDENCE_DISABLED:'本地钱包余额读取尚未开启',WALLET_EXPECTED_GENESIS_REQUIRED:'需配置 RPC 网络身份',WALLET_RPC_NOT_CONFIGURED:'未配置 SOLANA_RPC_URL',WALLET_RPC_GENESIS_MISMATCH:'RPC 网络身份不匹配',WALLET_CAPTURE_FAILED:'链上账户读取失败',WALLET_EVIDENCE_BUSY:'已有余额读取正在运行',WALLET_CAPTURE_STALE:'链上余额观测已过期',WALLET_MINT_MISMATCH:'Mint 精度或账户不匹配',WALLET_ACCOUNT_UNSUPPORTED:'不支持的钱包账户类型',UPSTREAM_LIVE_ACCEPTANCE_REQUIRED:'上游真实链上数据与策略验收尚未完成',SDK_TRANSACTION_QUOTE_UNAVAILABLE:'缺少 SDK 实际交易报价及精确数量',WALLET_BALANCE_AND_FEE_CHECK_UNAVAILABLE:'钱包余额、手续费与租金未核验',TRANSACTION_SIMULATION_UNAVAILABLE:'没有真实链上交易模拟结果',NO_SIGNING_OR_SUBMISSION_ENDPOINT:'签名与提交接口尚未开放',WALLET_POSITION_OWNER_MISMATCH:'当前钱包不是仓位 Owner',RESEARCH_BINDING_EXPIRED_OR_CHANGED:'研究证据过期或已改变',RESEARCH_REPORT_UNAVAILABLE:'当前研究报告不可用，请重新生成',RESEARCH_MARKET_CHANGED:'市场快照已改变',RESEARCH_POSITION_OR_POLICY_CHANGED:'仓位或风险配置已改变',POSITION_CAPTURE_UNAVAILABLE:'仓位采集不可用',POSITION_CAPTURE_STALE:'仓位采集已过期',POSITION_MARKET_CAPTURE_MISMATCH:'仓位与市场不是同一份快照',MANAGEMENT_POLICY_NOT_CONFIGURED:'未配置该仓位管理参数',MANAGEMENT_POLICY_UNAVAILABLE:'仓位管理配置文件不可用',MANAGEMENT_POLICY_INVALID:'仓位管理配置格式无效',MANAGEMENT_POLICY_IDENTITY_MISMATCH:'管理配置与仓位或 Owner 不匹配',MANAGEMENT_POLICY_CHANGED_REFRESH_REQUIRED:'管理配置已改变，请刷新',POSITION_CHANGED_REFRESH_REQUIRED:'仓位快照已改变，请刷新',POSITION_OR_POLICY_CHANGED_DURING_ANALYSIS:'分析期间仓位或配置改变',MANAGEMENT_HISTORY_POSITION_MISMATCH:'操作历史不属于该仓位',REVIEW_REFERENCE_STALE_OR_MISSING:'独立参考价格缺失或过期',MARKET_UNAVAILABLE:'市场快照不可用',STATE_UNAVAILABLE:'采集服务尚无有效状态文件',MARKET_LOCAL_RECEIPT_STALE:'市场快照本地接收已过期',REVIEW_NOT_CONFIGURED:'未配置独立参考价证据',REVIEW_FILE_UNAVAILABLE:'找不到研究证据文件',REVIEW_JSON_INVALID:'研究证据文件格式无效',REVIEW_SNAPSHOT_MISMATCH:'研究证据与当前快照不匹配',REVIEW_STALE_OR_INVALID:'研究证据时间无效或已过期',REVIEW_OBSERVATION_STALE:'市场观测已过期',REVIEW_CHANGED_REFRESH_REQUIRED:'研究证据已更新，请刷新',REVIEW_CHANGED_DURING_ANALYSIS:'分析期间证据改变，请重新生成',MARKET_CHANGED_REFRESH_REQUIRED:'市场快照改变，请刷新',MARKET_CHANGED_DURING_ANALYSIS:'分析期间快照改变，请重新生成',ANALYSIS_BUSY:'已有分析正在运行',AMOUNT_PRECISION_EXCEEDED:'数量小数位超过 Mint 精度',AMOUNT_EXCEEDS_MODEL_PRECISION:'数量超过当前模型精度范围',SOL_RESERVE_AND_COST_EXCEED_BUDGET:'SOL 预算不足以覆盖储备与成本',INPUT_OR_EVIDENCE_VALIDATION_FAILED:'输入或证据校验未通过',REPOSITION_GATE:'调仓门槛未满足',OPERATION_HISTORY_UNVERIFIED:'操作历史未验收',WITHDRAWAL_PERMISSION_AND_LOCK_UNVERIFIED:'撤池权限与锁定未验收',REFERENCE_AND_ACTIVE_BIN_MISMATCH:'参考价与 Active Bin 不一致',REFERENCE_UNAVAILABLE_OR_STALE:'参考价格缺失或过期',MANUAL_RISK_REVIEW_REQUIRED:'需要人工风险复核',HARD_RISK_REVIEW_NO_AUTOMATIC_SELECTION:'触发硬风控，不自动选择动作',HOLD_BASELINE_OR_UNCERTAINTY_MARGIN:'未超过保持仓位的改善门槛',RESEARCH_SCENARIO_IMPROVEMENT:'模型场景改善',HOLD_BASELINE_UNAVAILABLE:'保持仓位基线不可用',EXIT_CAPACITY:'退出容量不足',SOL_RESERVE:'SOL 储备不足',INVENTORY_QUANTITY:'库存数量超限',INVENTORY_RATIO:'库存比例超限',STRESS_LOSS:'压力损失超限',OBSERVED_BIN_SHARE_LIMIT:'Bin 参与比例超限或深度不足',WRONG_ACTIVE_BIN_SIDE:'资金分布与 Active Bin 不符',NO_LP_BASELINE_OR_UNCERTAINTY_MARGIN:'不部署基线或改善不足',BASELINE_UNAVAILABLE_NO_DEPLOYMENT:'基线不可用，不部署',HIGHEST_FEASIBLE_SCENARIO_SCORE:'模型可行方案中评分最高'};
function reasonText(v){if(typeof v!=='string'||!v)return '原因未提供';return reasonLabels[v]?reasonLabels[v]+' ('+v+')':v}
function clearManagementView(){managementSelected=null;for(const id of ['manageAction','manageMeme','manageSol','manageStress','manageScore','manageRange','manageDelta'])put(id,'—')}
function viewManagement(row){managementSelected=row??null;put('manageAction',actionNames[row?.action?.type]??'—');put('manageMeme',fmt(row?.inventoryAfterAction?.x));put('manageSol',fmt(row?.inventoryAfterAction?.y));put('manageStress',fmt(row?.postRisk?.stressLoss));put('manageScore',fmt(row?.score));const bins=row?.allocation?.bins;put('manageRange',Array.isArray(bins)?bins.length?Math.min(...bins.map(b=>b.binId))+' 至 '+Math.max(...bins.map(b=>b.binId)):'无 LP':'—');const before=positions.get(positionSelected)?.management?.managementPreview?.currentRisk?.stressLoss;put('manageDelta',Number.isFinite(before)&&Number.isFinite(row?.postRisk?.stressLoss)?fmt(row.postRisk.stressLoss-before):'—');renderManageRows()}
function renderManageRows(){
 const body=$('manageRows');body.replaceChildren();const m=positions.get(positionSelected)?.management?.managementPreview;
 for(const type of posActions){const tr=document.createElement('tr'),rows=(m?.candidates??[]).filter(x=>x.action.type===type),ok=rows.filter(x=>x.feasible).sort((a,b)=>b.score-a.score),best=ok[0];cell(tr,actionNames[type]);cell(tr,m?ok.length+' / '+rows.length:'—');cell(tr,fmt(best?.scenarioEstimates?.pnlSol));cell(tr,fmt(best?.postRisk?.stressLoss));cell(tr,fmt(best?.estimatedOperationCostSol));const failures=[...new Set(rows.filter(x=>!x.feasible).map(x=>reasonText(x.reason)))];const reason=cell(tr,failures.length?failures.slice(0,2).join('；'):'—');reason.title=failures.join('；');reason.style.whiteSpace='normal';reason.style.maxWidth='180px';const td=cell(tr,'');const b=document.createElement('button');b.textContent=best?'查看':'不可用';b.disabled=!best;b.setAttribute('aria-pressed',String(managementSelected===best));b.addEventListener('click',()=>viewManagement(best));td.append(b);body.append(tr)}
}
function drawPositionBins(chart,p,r,ref,val){
 const rows=p.accounting.rows.map(b=>({id:b.binId,y:approx(b.principalY,9),x:approx(b.principalX,p.snapshot.decimalsX)}));
 if(rows.some(b=>b.x===null||b.y===null)){chart.textContent='金额超出安全估值精度；请查看整数数量表';return}
 const active=r.market?.activeId,lo=Math.min(p.lowerBinId,Number.isInteger(active)?active:p.lowerBinId),hi=Math.max(p.upperBinId,Number.isInteger(active)?active:p.upperBinId),span=hi-lo+1,max=Math.max(...rows.map(b=>b.y+b.x*ref));
 if(span>1500||!Number.isFinite(max)||max<=0){chart.textContent='分布超出绘图范围；请查看数量表';return}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 185');svg.setAttribute('role','img');svg.setAttribute('aria-label','仓位逐 Bin 本金 SOL 估值');
 const element=(name,attrs)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);svg.append(e);return e},w=560/span;
 for(const b of rows){let y=145;for(const [v,color] of [[b.y,'#64c9b1'],[b.x*ref,'#ac8af8']]){if(v<=0)continue;const h=125*v/max;y-=h;const rect=element('rect',{x:20+(b.id-lo)*w,y,width:Math.max(.3,w*.82),height:h,fill:color});const title=document.createElementNS(ns,'title');title.textContent='Bin '+b.id+' · '+fmt(v)+' SOL';rect.append(title)}}
 if(Number.isInteger(active)){const x=20+(active-lo+.4)*w;element('line',{x1:x,x2:x,y1:10,y2:150,stroke:'#e7c289','stroke-dasharray':'4 3'});element('text',{x:Math.min(510,Math.max(20,x)),y:163,fill:'#e7c289','font-size':10}).textContent='Active '+active}
 chart.append(svg);const note=document.createElement('small');note.textContent='青绿 SOL / 紫色 MEME · 本金估值 '+fmt(val)+' SOL · 非实际退出价值';chart.append(note);
}
function renderPosition(){
 const body=$('positionRows');body.replaceChildren();put('positionCount',String(positions.size));for(const [id,o] of positions){const p=o.snapshot,tr=document.createElement('tr');if(id===positionSelected)tr.classList.add('viewing');cell(tr,id.slice(0,7)+'…'+id.slice(-5)).title=id;cell(tr,o.source==='service'?'本地采集':'手动归档');cell(tr,p.slot);cell(tr,p.lowerBinId+' 至 '+p.upperBinId);cell(tr,exactAmount(p.currentPrincipalRaw.y,9));cell(tr,exactAmount(p.currentPrincipalRaw.x,p.snapshot.decimalsX));const td=cell(tr,'');const b=document.createElement('button');b.textContent='查看';b.setAttribute('aria-pressed',String(id===positionSelected));b.addEventListener('click',()=>{if(positionSelected===id)return;positionGeneration++;positionSelected=id;put('managementStatus','');clearManagementView();renderPosition()});td.append(b);body.append(tr)}
 if(!positions.size){const tr=document.createElement('tr');cell(tr,'尚无该 Pool 的可查看仓位').colSpan=7;body.append(tr)}
 put('positionListStatus',positions.size?'显示采集与导入的快照，不代表钱包全部仓位。':'尚未导入仓位快照。');
 const o=positions.get(positionSelected),p=o?.snapshot,r=o?.management,m=r?.managementPreview;
 for(const [id,v] of Object.entries({posAddress:p?.position,posOwner:p?.owner,posSlot:p?.slot,posActive:r?.market?.activeId??(o?.source==='service'&&monitoring.get(positionSelected)?.commonMarketCapture?monitoring.get(positionSelected)?.activeId:null),posRatio:fmt(m?.currentRisk?.worstRatio==null?null:m.currentRisk.worstRatio*100),posStress:fmt(m?.currentRisk?.stressLoss),posHistory:m?m.controls?.operationHistorySupplied?'已提供（未验收）':'缺失':'—',posCooldown:m?m.controls?.cooldownElapsed?'模型满足':'未满足或未知':'—',posBudget:m?m.controls?.rebalanceBudgetAvailable?'模型满足':'未满足或未知':'—'}))put(id,v);
 put('posAlerts',m?[...new Set([...m.alerts,...m.currentRisk.violations])].map(reasonText).join('；')||'模型未报告风险标志（未验收）':'尚未获得匹配风险报告');put('manageReason',m?((r.terminalBinding?'本地研究结果：':'归档结果：')+(m.selected?actionNames[m.selected.action.type]:'无选中动作')+' · '+reasonText(m.reason)):'等待 T10 同源仓位分析报告。');
 const assets=$('posAssets');assets.replaceChildren();for(const [label,k,d] of [['SOL','y',9],['MEME','x',p?.snapshot.decimalsX]]){const tr=document.createElement('tr');cell(tr,label);for(const field of ['currentPrincipalRaw','pendingFeeRaw','claimedLifetimeRaw'])cell(tr,exactAmount(p?.[field]?.[k],d));assets.append(tr)}
 const chart=$('posChart');chart.replaceChildren();const binBody=$('posBinRows');binBody.replaceChildren();const accountingRows=p?.accounting?.rows??[];for(const b of accountingRows){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,exactAmount(b.principalY,9));cell(tr,exactAmount(b.principalX,p.snapshot.decimalsX));cell(tr,exactAmount(b.feeY,9));cell(tr,exactAmount(b.feeX,p.snapshot.decimalsX));binBody.append(tr)}$('positionPerformance').disabled=!p;const ref=r?.referencePriceSolPerMeme,sol=approx(p?.currentPrincipalRaw.y,9),meme=approx(p?.currentPrincipalRaw.x,p?.snapshot.decimalsX),fs=approx(p?.pendingFeeRaw.y,9),fm=approx(p?.pendingFeeRaw.x,p?.snapshot.decimalsX);
 const val=Number.isFinite(ref)&&sol!==null&&meme!==null?sol+meme*ref:null,fee=Number.isFinite(ref)&&fs!==null&&fm!==null?fs+fm*ref:null;
 put('positionValue',fmt(val));put('positionFee',fmt(fee));
 if(!p||!Number.isFinite(val)||val<=0){chart.textContent=p?'缺少匹配估值或本金为空；查看数量表':'选择仓位快照'}else{
 drawPositionBins(chart,p,r,ref,val)}
 renderManageRows();renderMonitorSelection();
 if(page==='performance')put('performanceScope',p?'Position '+p.position.slice(0,8)+'…'+p.position.slice(-5):target?'当前 Pool '+target.slice(0,8)+'…':'当前 Pool 未选择');
 const perfScope=JSON.stringify([positionSelected,p?.owner??null]);if(perfPositionScope!==perfScope){perfPositionScope=perfScope;perfGeneration++;perfWindow=null;$('performanceWindowFile').value='';$('performanceWindowFields').replaceChildren();$('performanceSeriesView').hidden=true;$('performanceSeriesFields').replaceChildren();$('performanceSeriesRows').replaceChildren();put('performanceWindowStatus','仓位已切换，请导入当前仓位的核算报告。')}
 else if(perfWindow)renderPerfWindow();
}
function resetPositions(){lifecycleGeneration++;lifecycleReport=null;$('lifecycleFile').value='';$('lifecycleFields').replaceChildren();put('lifecycleStatus','导入当前 Pool 的已关闭仓位报告。');perfGeneration++;perfWindow=null;$('performanceWindowFile').value='';$('performanceWindowFields').replaceChildren();$('performanceSeriesView').hidden=true;$('performanceSeriesFields').replaceChildren();$('performanceSeriesRows').replaceChildren();put('performanceWindowStatus','导入当前仓位的 T16 诊断报告。');monitoring.clear();monitorSignature='';renderMonitorRows();put('managementStatus','');put('performanceScope',target?'当前 Pool '+target.slice(0,8)+'…':'当前 Pool 未选择');positionGeneration++;positions.clear();positionSelected=null;clearManagementView();$('positionFile').value='';$('managementFile').value='';put('positionImportStatus','先选择 Pool，再导入快照。');renderPosition()}
$('clearPositions').addEventListener('click',resetPositions);
async function readJson(file){if(!file)throw Error('未选择文件');if(file.size>8*1024*1024)throw Error('文件超过 8 MB');return JSON.parse(await file.text())}
$('positionFile').addEventListener('change',async()=>{const g=++positionGeneration;try{if(!target)throw Error('先设置目标池');const p=validatePosition(await readJson($('positionFile').files[0]),target);if(g!==positionGeneration)return;const previous=positions.get(p.position);if(previous?.source==='service')throw Error('该仓位正在由本地服务采集；请使用采集快照，避免覆盖');positions.set(p.position,{source:'archive',snapshot:p,management:previous?.snapshot.rawHash===p.rawHash&&previous.snapshot.slot===p.slot&&previous.snapshot.owner===p.owner&&previous.snapshot.snapshot.decimalsX===p.snapshot.decimalsX?previous.management:null});positionSelected=p.position;clearManagementView();renderPosition();put('positionImportStatus','已导入未验收的仓位快照。')}catch(e){if(g===positionGeneration)put('positionImportStatus','导入失败：'+e.message)}});
$('managementFile').addEventListener('change',async()=>{const g=++positionGeneration;try{const {terminalBinding:ignored,reviewId:ignoredId,...r}=await readJson($('managementFile').files[0]);if(g!==positionGeneration)return;const id=r?.managementPreview?.position?.address,o=positions.get(id);if(!o)throw Error('先导入同一仓位的 T05 快照');validateManagement(r,target,o.snapshot);o.management=r;positionSelected=id;clearManagementView();renderPosition();if(r.managementPreview.selected){const best=r.managementPreview.candidates.find(x=>JSON.stringify(x)===JSON.stringify(r.managementPreview.selected));viewManagement(best)}put('positionImportStatus','管理报告已匹配仓位快照，仅供归档审阅。')}catch(e){if(g===positionGeneration)put('positionImportStatus','导入失败：'+e.message)}});
const shadowBaselines=['hodl','spot','curve','bid_ask','hybrid'];
function validateShadow(r){
 if(!r||r.status!=='SHADOW_RESEARCH_ONLY'||r.policy!=='T09_T10_RESEARCH_PREVIEW_V1'||r.executionReady!==false||r.decisionReady!==false||r.protocolExact!==false||r.calibrated!==false||!hash(r.freezeHash)||!Array.isArray(r.rows)||r.rows.length>100||new Set(r.rows.map(x=>x.id)).size!==r.rows.length||!r.rows.every(x=>typeof x.id==='string'&&typeof x.group==='string'&&['train','validation','test'].includes(x.split)&&Array.isArray(x.runs)&&x.runs.length<=6&&new Set(x.runs.map(y=>y.mode)).size===x.runs.length))throw Error('不支持的 Shadow 报告');
 if(!['train','validation','test'].includes(r.evaluatedSplit)||!r.rows.length||r.rows.some(x=>x.split!==r.evaluatedSplit)||Object.keys(r.summaries??{}).length!==1)throw Error('须导入单一数据集新版报告');
 for(const split of [r.evaluatedSplit]){const rows=r.summaries?.[split],n=r.rows.filter(x=>x.split===split).length,groups=new Set(r.rows.filter(x=>x.split===split).map(x=>x.group)).size;if(!Array.isArray(rows)||rows.length!==5||new Set(rows.map(x=>x.baseline)).size!==5)throw Error('对照组不完整');for(const x of rows){if(!shadowBaselines.includes(x.baseline)||x.conclusion!=='INCONCLUSIVE_UNVERIFIED_FROZEN_PATH'||x.plannedWindows!==n||!Number.isSafeInteger(x.validPairs)||x.validPairs<0||x.validPairs>n||x.invalidOrMissing!==n-x.validPairs||!Number.isSafeInteger(x.declaredGroups)||x.declaredGroups!==groups||!Number.isSafeInteger(x.completeGroups)||x.completeGroups<0||x.completeGroups>Math.min(groups,x.validPairs)||x.incompleteGroups!==groups-x.completeGroups)throw Error('配对统计不一致');for(const k of ['meanGroupDeltaSol','worstGroupDeltaSol','positiveGroupFraction'])if(x[k]!==null&&!Number.isFinite(x[k]))throw Error('无效统计');if(x.positiveGroupFraction!==null&&(x.positiveGroupFraction<0||x.positiveGroupFraction>1))throw Error('比例无效');if(!x.completeGroups&&['meanGroupDeltaSol','worstGroupDeltaSol','positiveGroupFraction'].some(k=>x[k]!==null))throw Error('无配对却存在统计')}}
 return r;
}
function renderShadowWindows(){
 const body=$('shadowWindowRows');body.replaceChildren();
 const rows=shadow?.rows.filter(x=>x.split===$('shadowSplit').value)??[];
 if(!rows.length){const tr=document.createElement('tr');cell(tr,'没有该分组的窗口').colSpan=5;body.append(tr);return}
 for(const x of rows){const tr=document.createElement('tr'),a=x.runs?.find(y=>y.mode==='adaptive'),h=x.runs?.find(y=>y.mode==='hodl');cell(tr,x.id);cell(tr,x.group??'—');cell(tr,a?.status??'—');cell(tr,h?.status??'—');cell(tr,x.status==='BLOCKED'?reasonText(x.reason):a?.status==='HYPOTHETICAL_REPLAY'&&h?.status==='HYPOTHETICAL_REPLAY'?'研究回放有效（未验证）':'无效或未决回放');body.append(tr)}
}
function renderShadow(){renderShadowWindows();const body=$('shadowRows');body.replaceChildren();put('shadowWindows',shadow?shadow.rows.length:'—');put('shadowTests',shadow?.evaluatedSplit==='test'?shadow.rows.length:'—');put('shadowPairs',shadow?.summaries?.[shadow.evaluatedSplit]?.find(x=>x.baseline==='hodl')?.validPairs??'—');for(const mode of shadowBaselines){const tr=document.createElement('tr'),x=shadow?.summaries[$('shadowSplit').value]?.find(x=>x.baseline===mode);cell(tr,mode==='hodl'?'HODL':names[mode]);cell(tr,x?x.validPairs+' / '+x.plannedWindows+' · 组 '+x.completeGroups+'/'+x.declaredGroups:'—');cell(tr,fmt(x?.meanGroupDeltaSol));cell(tr,fmt(x?.worstGroupDeltaSol));cell(tr,x?.positiveGroupFraction==null?'—':fmt(x.positiveGroupFraction*100)+'%');body.append(tr)}}
for(const b of document.querySelectorAll('[data-perf]'))b.addEventListener('click',()=>{const actual=b.dataset.perf==='actual';$('actualPerformance').hidden=!actual;$('shadowPerformance').hidden=actual;for(const x of document.querySelectorAll('[data-perf]'))x.setAttribute('aria-pressed',String(x===b))});
$('shadowSplit').addEventListener('change',renderShadow);
$('shadowFile').addEventListener('change',async()=>{const g=++shadowGeneration;shadow=null;renderShadow();try{const r=validateShadow(await readJson($('shadowFile').files[0]));if(g!==shadowGeneration)return;shadow=r;$('shadowSplit').value=r.evaluatedSplit;renderShadow();put('shadowStatus','已导入未验证的研究报告；与当前 Pool 独立。')}catch(e){if(g===shadowGeneration)put('shadowStatus','导入失败：'+e.message)}});
$('clearShadow').addEventListener('click',()=>{shadowGeneration++;shadow=null;$('shadowFile').value='';renderShadow();put('shadowStatus','尚未导入。')});
let previousTarget=target;
function handleTargetChange(){if(target!==previousTarget){put('historyStreamStatus','等待采集');put('holderFeatureStatus','Holder 未读取');put('researchSnapshotStatus','尚未保存研究快照');put('researchBuilderStatus','等待当前 Pool 的证据收集');$('replaySnapshotId').value='';$('replayRows').replaceChildren();$('researchCatalogSelect').replaceChildren();$('managementReplayPosition').value='';$('managementReplayRows').replaceChildren();put('managementReplayStatus','等待本池历史仓位研究');put('replayStatus','先检查当前 Pool 的研究预算及风险参数。');clearModelInputs();clearExternalMarket();clearIndexedPool();clearWalletObservation();clearWalletPositions();previousTarget=target;poolEpoch++;put('priceHistoryChart','等待真实价格序列');put('priceHistoryLabel','等待历史行情');resetPositions();applyServiceMarket(null);servicePositions.clear();autoMonitor=null;autoRenderSignature='';renderAutoMonitor();closeResearchReview();if(page==='performance')put('performanceScope',target?'当前 Pool '+target.slice(0,8)+'…':'当前 Pool 未选择')}}
let holderRequestBusy=false,snapshotRequestBusy=false,replayRequestBusy=false,builderRequestBusy=false;
let modelInputGeneration=0;
function clearModelInputs(){modelInputGeneration++;$('modelInputRows').replaceChildren();put('modelInputStatus','等待当前 Pool 数据');put('modelInputFlow','—');put('holderFeatureFacts','—')}
async function refreshModelInputs(scope,epoch){
 const g=++modelInputGeneration,m=serviceMarket;
 try{const res=await terminalGet('/api/terminal/input-status',scope,10000),r=await res.json();if(g!==modelInputGeneration||!sameScope(epoch,scope,poolEpoch,target))return;
 if((serviceMarket?.slot??null)!==(m?.slot??null)||(serviceMarket?.rawHash??null)!==(m?.rawHash??null)||serviceMarket&&serviceMarket.expiresAt<=Date.now()||r.marketSlot!==(m?.slot??null)||r.marketRawHash!==(m?.rawHash??null)){clearModelInputs();put('modelInputStatus','行情快照已变化，等待下一轮诊断');return}
 if(!res.ok||r.pool!==scope||r.status!=='DIAGNOSTIC_ONLY'||r.decisionReady!==false||r.executionReady!==false||r.modelInputReady!==false||!Array.isArray(r.tasks)||r.tasks.length>20)throw Error('模型输入诊断不可用');
 const rows=$('modelInputRows'),labels={market:'链上 Pool/Bin',history:'链上 Swap 样本',external:'外部直接报价',holder:'Holder 集中度与流出',flow:'完整窗口资金流',token:'Token 安全证据',review:'独立研究观察'},states={OBSERVED:'已观察 · 未验收',HISTORICAL_ONLY:'历史样本 · 非实时',MISSING:'缺失',REVIEW_REQUIRED:'待证据',PREFLIGHT:'结构预检查'};rows.replaceChildren();
 for(const a of r.tasks){const tr=document.createElement('tr');cell(tr,labels[a.id]??a.id);cell(tr,states[a.state]??a.state);cell(tr,a.reason);rows.append(tr)}
 const holder=r.holderFeatures;const dist=holder?.distribution;const pct=n=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'—';put('holderFeatureFacts',holder?'Slot '+holder.slot+' · 账户 '+dist.accountCount+' · 正余额 Owner '+dist.positiveOwnerCount+' · Top '+dist.topN+' '+pct(dist.topShare)+'（含池/托管账户） · 前序 Top 群体净减持 '+pct(holder.cohort?.netDecreaseShare)+'（非卖出量） · Mint/Freeze 权限 '+(holder.safety?.mintAuthorityRevoked?'已撤销':'未撤销')+' / '+(holder.safety?.freezeAuthorityRevoked?'已撤销':'未撤销')+' · '+(holder.gaps?.join('；')||'未独立验收'):'无有效 Holder 观察');
  const sample=r.swapSample;put('modelInputFlow',sample?(sample.sampleKind==='HISTORICAL_BACKFILL'?'历史补采':sample.sampleKind==='OLDER_EVENT_SAMPLE'?'旧交易样本':'近期交易样本')+' · '+new Date(sample.firstEventTime*1000).toLocaleString()+' – '+new Date(sample.lastEventTime*1000).toLocaleString()+' · '+sample.eventCount+' 个 Swap · 买入 '+exactAmount(sample.buyLamports,9)+' SOL · 卖出 '+exactAmount(sample.sellLamports,9)+' SOL · 非完整窗口':'尚无可展示的完整解码样本');
 put('modelInputStatus','诊断 · '+r.review.observations+' 条审阅观察 · '+(r.review.missing.length?'缺少证据':'仍需引擎校验'));
 }catch(e){if(g===modelInputGeneration&&sameScope(epoch,scope,poolEpoch,target)){clearModelInputs();put('modelInputStatus','诊断读取失败')}}
}
let catalogGeneration=0,archiveBusy=false;
async function refreshResearchCatalog(){
 const p=target,e=poolEpoch,g=++catalogGeneration;if(!p)return;
 try{const res=await terminalGet('/api/terminal/research-catalog',p,10000),x=await res.json();
  if(g!==catalogGeneration||!sameScope(e,p,poolEpoch,target))return;
  if(!res.ok||x.scope!=='HISTORICAL_ARCHIVE_INDEX_ONLY'||x.pool!==p||x.decisionReady!==false||x.executionReady!==false||!Array.isArray(x.entries)||x.entries.length>64)throw Error('归档索引不可用');
  const list=$('researchCatalogSelect');list.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='选择本池历史归档';list.append(empty);
  for(const a of x.entries){if(a.pool!==p||!hash(a.id)||!hash(a.snapshotId)||!['snapshot','candidate','run'].includes(a.kind))continue;const o=document.createElement('option');o.value=a.kind==='run'?'run:'+a.id:'snapshot:'+a.snapshotId;o.textContent=a.kind+' · Slot '+a.marketSlot+' · '+a.id.slice(0,10)+' · '+a.status;list.append(o)}
 }catch(e2){if(sameScope(e,p,poolEpoch,target)&&g===catalogGeneration)put('researchSnapshotStatus','归档索引不可用')}
}
function showHistoricalRun(x,p){
 if(x.scope!=='HISTORICAL_RESEARCH_ONLY'||x.pool!==p||!hash(x.runId)||!hash(x.snapshotId)||x.decisionReady!==false||x.executionReady!==false||x.pnlReady!==false||x.report?.pool!==p||x.report?.terminalBinding||x.report?.reviewId)throw Error('历史研究身份无效');
 $('replaySnapshotId').value=x.snapshotId;
 if(x.mode==='management'){
  const rows=x.report.managementPreview?.candidates??[];if(!Array.isArray(rows)||rows.length>100||!addr(x.position))throw Error('历史仓位研究结构无效');
  $('managementReplayRows').replaceChildren();$('managementReplayPosition').value=x.position;
  for(const a of rows){const tr=document.createElement('tr');cell(tr,a.action?.type??'—');cell(tr,a.feasible?'模型可行 · 未验收':a.reason??'阻塞');cell(tr,fmt(a.scenarioEstimates?.pnlSol));cell(tr,fmt(a.scenarioEstimates?.cvarLossSol));$('managementReplayRows').append(tr)}
  put('managementReplayStatus','历史仓位研究 '+x.runId.slice(0,12)+' · Slot '+x.marketSlot+' · '+x.status+' · '+(x.report.managementPreview?.reason??x.report.gaps?.[0]??'未验收')+' · 非当前管理建议');
 }else{
  const rows=x.report.planPreview?.families??[];if(!Array.isArray(rows)||rows.length>7||rows.some(a=>!Object.hasOwn(names,a.family)&&a.family!=='NO_LP'))throw Error('历史策略结构无效');
  $('replayRows').replaceChildren();for(const a of rows){const tr=document.createElement('tr');cell(tr,names[a.family]??a.family);cell(tr,String(a.feasible)+' / '+String(a.total));cell(tr,fmt(a.best?.scenarioEstimates?.pnlSol));cell(tr,fmt(a.best?.scenarioEstimates?.cvarLossSol));$('replayRows').append(tr)}
  put('replayStatus','已载入历史研究 '+x.runId.slice(0,12)+' · Slot '+x.marketSlot+' · '+x.status+' · 非当前方案');
 }
}
$('refreshResearchCatalog').addEventListener('click',refreshResearchCatalog);
$('loadResearchArchive').addEventListener('click',async()=>{
 const p=target,e=poolEpoch,selected=$('researchCatalogSelect').value;if(archiveBusy||!selected)return;
 const [kind,id]=selected.split(':');if(!hash(id))return;
 if(kind==='snapshot'){$('replaySnapshotId').value=id;put('researchSnapshotStatus','已选择历史快照 '+id.slice(0,12)+' · 非当前快照');return}
 if(kind!=='run')return;archiveBusy=true;
 try{const res=await terminalPost('/api/terminal/research-load',{pool:p,runId:id},10000),x=await res.json();if(!sameScope(e,p,poolEpoch,target)||$('researchCatalogSelect').value!==selected)return;if(!res.ok||x.runId!==id)throw Error('归档校验失败');showHistoricalRun(x,p)}catch(err){if(sameScope(e,p,poolEpoch,target))put('researchSnapshotStatus',err.message)}finally{archiveBusy=false}
});
$('runManagementReplay').addEventListener('click',async()=>{
 const p=target,e=poolEpoch,id=$('replaySnapshotId').value.trim(),position=$('managementReplayPosition').value.trim();
 if(archiveBusy||replayRequestBusy||!p||!hash(id)||!addr(position)){put('managementReplayStatus','需要有效快照与仓位地址');return}
 archiveBusy=true;$('runManagementReplay').disabled=true;$('managementReplayRows').replaceChildren();put('managementReplayStatus','读取归档仓位及本地风险策略…');
 try{const res=await terminalPost('/api/terminal/research-replay',{pool:p,snapshotId:id,mode:'management',position},45000),x=await res.json();if(!sameScope(e,p,poolEpoch,target)||$('managementReplayPosition').value.trim()!==position||$('replaySnapshotId').value.trim()!==id)return;
 if(!res.ok)throw Error(x.gaps?.[0]??'MANAGEMENT_REPLAY_BLOCKED');if(x.mode!=='management'||x.position!==position||x.snapshotId!==id)throw Error('历史仓位身份无效');showHistoricalRun(x,p);await refreshResearchCatalog()
 }catch(err){if(sameScope(e,p,poolEpoch,target))put('managementReplayStatus','重放阻塞：'+err.message)}finally{archiveBusy=false;$('runManagementReplay').disabled=false}
});
$('buildResearchEvidence').addEventListener('click',async()=>{
 if(builderRequestBusy||!target||!serviceMarket||serviceMarket.expiresAt<=Date.now()){put('researchBuilderStatus','需要有效市场快照');return}
 const p=target,e=poolEpoch,m=serviceMarket,d=draft?.pool===p?draft:null;builderRequestBusy=true;$('buildResearchEvidence').disabled=true;put('researchBuilderStatus','收集链上时间、Holder 与独立市场报价…');
 try{
  const res=await terminalPost('/api/terminal/research-build',{pool:p,marketSlot:m.slot,marketRawHash:m.rawHash,draft:d},150000),x=await res.json();
  if(!sameScope(e,p,poolEpoch,target))return;if(!res.ok)throw Error(x.gaps?.[0]??'RESEARCH_BUILD_FAILED');
  if(x.scope!=='RESEARCH_CANDIDATE_ONLY'||x.pool!==p||x.marketSlot!==m.slot||x.marketRawHash!==m.rawHash||!hash(x.candidateId)||!hash(x.snapshotId)||x.modelInputReady!==false||x.executionReady!==false||x.decisionReady!==false||!Array.isArray(x.gaps))throw Error('候选证据身份无效');
  $('replaySnapshotId').value=x.snapshotId;put('researchSnapshotStatus','已保存 '+x.snapshotId.slice(0,12)+' · Slot '+x.marketSlot+' · '+x.reviewStatus);
  put('researchBuilderStatus','候选 '+x.candidateId.slice(0,12)+' · '+(x.clock?'区块时间已读取（未独立验收）':'区块时间缺失')+' · '+(x.replay?.runId?'已归档研究重放 '+x.replay.runId.slice(0,12):x.replayReason??'待审阅')+' · '+x.gaps.concat((x.sourceErrors??[]).map(z=>z.source+':'+z.reason)).join('；'));
  if(x.replay&&draft===d){
   const y=x.replay;if(y.scope!=='HISTORICAL_RESEARCH_ONLY'||y.pool!==p||y.snapshotId!==x.snapshotId||!hash(y.runId)||y.decisionReady!==false||y.executionReady!==false||y.pnlReady!==false||y.report?.pool!==p||y.report?.terminalBinding||y.report?.reviewId)throw Error('历史研究身份无效');
   const families=y.report.planPreview?.families??[];if(!Array.isArray(families)||families.length>7||families.some(f=>!Object.hasOwn(names,f.family)&&f.family!=='NO_LP'))throw Error('历史策略结构无效');
   $('replayRows').replaceChildren();for(const f of families){const tr=document.createElement('tr');cell(tr,names[f.family]??f.family);cell(tr,String(f.feasible)+' / '+String(f.total));cell(tr,fmt(f.best?.scenarioEstimates?.pnlSol));cell(tr,fmt(f.best?.scenarioEstimates?.cvarLossSol));$('replayRows').append(tr)}
   put('replayStatus','历史研究 '+y.runId.slice(0,12)+' · '+y.status+' · 非当前方案/实际收益');
  }
  await refreshModelInputs(p,e);
 }catch(err){if(sameScope(e,p,poolEpoch,target))put('researchBuilderStatus','收集阻塞：'+err.message)}finally{builderRequestBusy=false;$('buildResearchEvidence').disabled=false}
});
$('saveResearchSnapshot').addEventListener('click',async()=>{
 if(snapshotRequestBusy||!target||!serviceMarket||serviceMarket.expiresAt<=Date.now()){put('researchSnapshotStatus','需要有效市场快照');return}
 const p=target,e=poolEpoch,m=serviceMarket;snapshotRequestBusy=true;$('saveResearchSnapshot').disabled=true;put('researchSnapshotStatus','保存证据快照…');
 try{const res=await terminalPost('/api/terminal/research-snapshot',{pool:p,marketSlot:m.slot,marketRawHash:m.rawHash},45000),x=await res.json();
  if(!sameScope(e,p,poolEpoch,target))return;if(!res.ok)throw Error(x.gaps?.[0]??'SNAPSHOT_UNAVAILABLE');
  if(x.scope!=='IMMUTABLE_RESEARCH_DIAGNOSTIC'||x.pool!==p||x.marketSlot!==m.slot||x.marketRawHash!==m.rawHash||x.modelInputReady!==false||x.decisionReady!==false||x.executionReady!==false||!/^[0-9a-f]{64}$/.test(x.snapshotId))throw Error('快照契约错误');
  $('replaySnapshotId').value=x.snapshotId;put('researchSnapshotStatus','已保存 '+x.snapshotId.slice(0,12)+' · Slot '+x.marketSlot+' · '+x.reviewStatus+' · 仅研究归档');
 }catch(err){if(sameScope(e,p,poolEpoch,target))put('researchSnapshotStatus','保存失败：'+err.message)}finally{snapshotRequestBusy=false;$('saveResearchSnapshot').disabled=false}
});
$('runResearchReplay').addEventListener('click',async()=>{
 if(replayRequestBusy||!target||!draft||draft.pool!==target){put('replayStatus','请先检查当前 Pool 的资金和风险参数');return}
 const id=$('replaySnapshotId').value.trim();if(!/^[0-9a-f]{64}$/.test(id)){put('replayStatus','需要有效的完整快照 ID');return}
 const p=target,e=poolEpoch,d=draft;replayRequestBusy=true;$('runResearchReplay').disabled=true;$('replayRows').replaceChildren();put('replayStatus','正在重放已保存证据…');
 try{
  const res=await terminalPost('/api/terminal/research-replay',{pool:p,snapshotId:id,draft:d},45000),x=await res.json();
  if(!sameScope(e,p,poolEpoch,target))return;if(draft!==d){put('replayStatus','研究预算已变化，旧结果未显示；归档仍保留');return}
  if(!res.ok)throw Error(x.gaps?.[0]??'REPLAY_UNAVAILABLE');
  if(x.scope!=='HISTORICAL_RESEARCH_ONLY'||x.pool!==p||x.snapshotId!==id||x.executionReady!==false||x.decisionReady!==false||x.pnlReady!==false||!hash(x.runId)||x.report?.pool!==p||x.report?.terminalBinding||x.report?.reviewId)throw Error('历史结果身份无效');
  const families=x.report.planPreview?.families??[];
  if(!Array.isArray(families)||families.length>7||families.some(f=>!Object.hasOwn(names,f.family)&&f.family!=='NO_LP'))throw Error('历史策略结构无效');
  for(const f of families){const tr=document.createElement('tr');cell(tr,names[f.family]??f.family);cell(tr,String(f.feasible)+' / '+String(f.total));cell(tr,fmt(f.best?.scenarioEstimates?.pnlSol));cell(tr,fmt(f.best?.scenarioEstimates?.cvarLossSol));$('replayRows').append(tr)}
  put('replayStatus','历史研究 '+x.runId.slice(0,12)+' · Slot '+x.marketSlot+' · '+x.status+' · '+(x.report.planPreview?.reason??x.report.gaps?.[0]??'未验收')+' · 非当前方案/实际收益');
 }catch(err){if(sameScope(e,p,poolEpoch,target))put('replayStatus','重放阻塞：'+err.message)}finally{replayRequestBusy=false;$('runResearchReplay').disabled=false}
});
$('holderFeatureRefresh').addEventListener('click',async()=>{
 if(holderRequestBusy||!target||!serviceMarket||serviceMarket.expiresAt<=Date.now()){put('holderFeatureStatus','需要有效市场快照');return}
 const p=target,e=poolEpoch;holderRequestBusy=true;$('holderFeatureRefresh').disabled=true;put('holderFeatureStatus','读取经典 SPL Holder 索引…');
 try{const res=await terminalPost('/api/terminal/holder-features',{pool:p},90000),x=await res.json();
  if(!sameScope(e,p,poolEpoch,target))return;
  if(!res.ok)throw Error(x.gaps?.[0]??'HOLDER_UNAVAILABLE');
  if(x.scope!=='HOLDER_DIAGNOSTIC_ONLY'||x.pool!==p||x.modelEligible!==false||x.executionReady!==false||x.decisionReady!==false)throw Error('Holder 观察范围错误');
  put('holderFeatureStatus','已读取 · '+x.status+' · 60 秒后可读取下一次观察');await refreshModelInputs(p,e);
 }catch(err){if(sameScope(e,p,poolEpoch,target))put('holderFeatureStatus','读取失败：'+err.message)}finally{holderRequestBusy=false;$('holderFeatureRefresh').disabled=false}
});
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
renderPosition();renderShadow();

function renderReport(r,source){
 validateArchive(r,target);
  report=r;$('clearArchive').disabled=false;put('insight',reasonText(r.planPreview?.reason??r.gaps?.[0]??'等待策略评估'));put('inventory',fmt(r.model?.risk?.worstRatio==null?null:r.model.risk.worstRatio*100));put('marketTime',Number.isSafeInteger(r.asOf)?new Date(r.asOf*1000).toLocaleString():'—');put('price',fmt(r.referencePriceSolPerMeme));put('activeBin',r.market?String(r.market.activeId)+' / '+String(r.market.binStep)+' bps':'—');put('slot',r.market?.slot??'—');put('regime',r.model?.regime?.regime??'—');put('quality','归档未验收');put('importStatus','已导入历史报告 · asOf '+(Number.isSafeInteger(r.asOf)?new Date(r.asOf*1000).toISOString():'未知')+' · 不代表当前草稿');put('gaps',[...(Array.isArray(r.gaps)?r.gaps:[]),r.planPreview?.reason??'无方案',...(Array.isArray(r.planPreview?.missing)?r.planPreview.missing:[])].map(String).join('；'));rows();const chosen=r.planPreview?.selected,match=(r.planPreview?.families??[]).find(f=>f.family===chosen?.family&&f.best?.feasible);if(match){select(chosen);rows();}syncShape();put('shapeStatus',match?'正在查看模型选中的归档方案':'该报告没有选中的方案');put('decision',chosen?(chosen.family==='NO_LP'?'归档结论：No LP · 不部署':'归档模型选中：'+(names[chosen.family]??'未知')+' · 不可执行'):'归档未选中方案 · 查看阻塞原因');$('step3').classList.add('active')
 put('reportSource',source==='service'?'本地研究 · 未验收':'归档 · 未验收');
 if(source==='service'){
  put('quality',r.status==='BLOCKED'||r.planPreview?.status==='BLOCKED'?'分析阻塞':'研究未验收');
  put('importStatus','由本地分析服务生成，不是执行报价。');
  put('decision',r.planPreview?.selected?'研究选中：'+(names[r.planPreview.selected.family]??'未知')+' · 不可执行':'研究未选中方案 · '+reasonText(r.planPreview?.reason??r.gaps?.[0]));
  put('bindingStatus','已绑定本次请求及快照，仅供研究，禁止部署。');
  put('shapeStatus',r.planPreview?.selected?'正在查看本次研究方案':'没有可查看的研究方案');
 }
}
let serviceMarket=null,servicePool=null,serviceReview=null,refreshing=false,planBusy=false,refreshGeneration=0;
const servicePositions=new Set();
function canAnalyze(now=Date.now()){return !!serviceMarket&&serviceMarket.expiresAt>now&&serviceReview?.status==='PREFLIGHT_MATCHED_UNVERIFIED'&&serviceReview.expiresAt>now&&target===servicePool}
function updatePlanButton(){const b=$('generatePlan');b.disabled=planBusy||managementBusy||!canAnalyze();b.setAttribute('aria-busy',String(planBusy));b.textContent=planBusy?'正在分析…':'✦ 生成研究方案';put('generateGate',planBusy?'正在检查请求、快照和研究证据。':canAnalyze()?'证据预检查通过。生成结果仅供研究。':!target?'请先选择目标 Pool。':target!==servicePool?'当前 Pool 尚未匹配本地服务。':!serviceMarket?'等待有效市场快照。':serviceReview?.reason==='POOL_RESEARCH_NOT_CONFIGURED'?'当前池仅支持实时数据观察，尚未配置独立研究证据':reasonText(serviceReview?.reason??'REVIEW_STALE_OR_INVALID'));}
function renderActualMarket(m){
 const d=m?.display,body=$('actualBinRows');body.replaceChildren();
 put('observedPrice','—');put('actualBinTotals','—');put('actualBinStatus','等待链上快照');
 if(!m||d?.kind!=='POOL_OBSERVATION_ONLY'||!Array.isArray(d.rows)||d.rows.length>1500||m.expiresAt<=Date.now())return;
 const p=d.activeBinPriceSolPerMeme;
 put('observedPrice',Number.isFinite(p)&&p>0?p.toPrecision(8):'—');
 put('actualBinStatus','Slot '+m.slot+' · '+d.rows.length+'/'+d.totalBins+' Bins · 未验收');
 const total=(v,dec)=>{if(typeof v!=='string'||!/^\d{1,40}$/.test(v)||!Number.isInteger(dec)||dec<0||dec>18)return '—';let a=v.padStart(dec+1,'0');return dec?a.slice(0,-dec)+'.'+a.slice(-dec):a};
 put('actualBinTotals','MM 本金合计：'+total(d.totalYRaw,9)+' SOL / '+total(d.totalXRaw,m.decimalsX)+' MEME（不含订单流动性及费用）');
 for(const b of d.rows){const tr=document.createElement('tr');cell(tr,String(b.binId)+(b.binId===m.activeId?' · Active':''));cell(tr,Number.isFinite(b.priceSolPerMeme)&&b.priceSolPerMeme>0?b.priceSolPerMeme.toPrecision(8):'—');cell(tr,exactAmount(b.amountYRaw,9));cell(tr,exactAmount(b.amountXRaw,m.decimalsX));body.append(tr)}
}
function applyServiceMarket(m,gate=null){
 if(!m||serviceMarket?.rawHash!==m.rawHash||serviceMarket?.slot!==m.slot){clearExternalMarket();clearModelInputs()}
 renderActualMarket(m);
 serviceReview=gate;
 if(report?.terminalBinding&&(!m||report.terminalBinding.marketSlot!==m.slot||report.terminalBinding.marketRawHash!==m.rawHash||gate?.reviewHash!==report.terminalBinding.reviewHash||report.terminalBinding.expiresAt<=Date.now())){clearReport();put('generateStatus','市场快照或研究证据已变化，需重新生成。')}
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
$('request').addEventListener('submit',async e=>{
 if(e.submitter?.id!=='generatePlan'||!draft||!canAnalyze()||planBusy||managementBusy)return;const d=draft,m=serviceMarket,review=serviceReview,p=target,g=++importGeneration;planBusy=true;updatePlanButton();renderMonitorSelection();clearReport();put('generateStatus','正在运行已有研究引擎…');
 try{const res=await terminalPost('/api/terminal/plans',{draft:d,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:review.reviewHash},40000);const r=await res.json();if(g!==importGeneration||target!==p)return;if(draft!==d||serviceMarket?.rawHash!==m.rawHash||serviceMarket?.slot!==m.slot||serviceReview?.reviewHash!==review.reviewHash||!canAnalyze()){put('generateStatus','参数或快照已变化，已丢弃旧结果。');return}
  if(!res.ok||!r.terminalBinding){put('generateStatus','分析阻塞：'+reasonText(r.gaps?.[0]));return}
  const b=r.terminalBinding;if(b.scope!=='RESEARCH_ONLY'||b.marketSlot!==m.slot||b.marketRawHash!==m.rawHash||!hash(b.requestHash)||b.reviewHash!==review.reviewHash||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=Date.now())throw Error('研究报告绑定不符');
  renderReport(r,'service');put('generateStatus',r.planPreview?.status==='RESEARCH_PLAN_PREVIEW_UNVERIFIED'?'研究方案已生成 · 未验收 · 不可执行':'分析阻塞：'+reasonText(r.planPreview?.reason??r.gaps?.[0]));
 }catch(e){if(g===importGeneration)put('generateStatus','分析失败：'+e.message)}finally{planBusy=false;updatePlanButton();renderMonitorSelection()}
});

const rangeLabels={IN_RANGE:'区间内',BELOW_RANGE:'低于区间',ABOVE_RANGE:'高于区间',UNKNOWN:'未知'};
function renderMonitorRows(){
 const body=$('monitorRows');body.replaceChildren();for(const [id,x] of monitoring){const tr=document.createElement('tr');cell(tr,id.slice(0,7)+'…'+id.slice(-5)).title=id;cell(tr,monitorFresh(x)?'采集未验收':reasonText(x.reason??'POSITION_CAPTURE_STALE'));cell(tr,rangeFresh(x)?rangeLabels[x.rangeState]??'未知':'未知');cell(tr,manageReady(x,positions.get(id))?'证据预检查匹配':reasonText(x.managementGate?.reason??'REVIEW_STALE_OR_INVALID'));body.append(tr)}
 if(!monitoring.size){const tr=document.createElement('tr');cell(tr,'暂无配置的仓位采集状态').colSpan=4;body.append(tr)}
}
function renderMonitorSelection(){
 const x=monitoring.get(positionSelected),o=positions.get(positionSelected),g=x?.managementGate,ready=manageReady(x,o);
 put('posRangeState',rangeFresh(x)?rangeLabels[x.rangeState]??'未知':'未知');if(o?.source==='service'&&!o.management)put('posActive',rangeFresh(x)?x.activeId:'—');put('posCaptureState',o?.source==='archive'?'手动归档':monitorFresh(x)?(rangeFresh(x)?'同源快照 · 未验收':'未匹配当前市场 · 未验收'):o?.source==='service'?'旧采集快照 · 已过期或不可用':'—');
 $('manageGateDot').dataset.ready=String(ready);put('manageGateText',!o?'选择采集仓位':o.source!=='service'?'归档仓位仅可审阅':ready?'证据预检查匹配 · 仍需引擎校验':reasonText(g?.reason??'REVIEW_STALE_OR_INVALID'));
 $('evaluatePosition').disabled=!ready||managementBusy||planBusy;$('evaluatePosition').textContent=managementBusy?'正在评估…':'✦ 评估管理方案';$('evaluatePosition').setAttribute('aria-busy',String(managementBusy));
 const dl=$('managementPolicyView');dl.replaceChildren();
 const req=ready?g.request:null;const fields=req?{目标:req.goal,评估周期秒:req.horizonSeconds,额外SOL:exactAmount(req.solRaw,9),额外MEME:exactAmount(req.memeRaw,o.snapshot.snapshot.decimalsX),...req.riskConfig}:{状态:'等待有效仓位专属参数'};
 const labels={maxInventoryRatio:'最大库存比例',maxInventoryTokens:'最大库存数量',minSolReserve:'最小 SOL 储备',maxLossSol:'最大压力损失 SOL',stressDrop:'压力跌幅',maxBinShare:'最大 Bin 占比',operationCostSol:'单次操作成本 SOL',feeBps:'费率 bps',protocolShare:'协议分成比例',slippageBps:'滑点 bps',cooldownSeconds:'冷却秒数',maxRebalances:'调仓次数上限',maxTurnoverSol:'累计周转上限 SOL'};
 for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=labels[k]??k;dd.textContent=String(v);dl.append(dt,dd)}
}
function applyMonitoring(rows){
 const next=new Map();for(const x of Array.isArray(rows)?rows:[]){if(addr(x?.position)&&['BLOCKED','CAPTURED_UNVERIFIED'].includes(x.status))next.set(x.position,{...x,activeId:x.commonMarketCapture?serviceMarket?.activeId:null,rangeExpiresAt:x.commonMarketCapture?Math.min(x.expiresAt,serviceMarket?.expiresAt??0):0})}
 monitoring=next;let invalidated=false;
 for(const [id,o] of positions){if(o.management?.terminalBinding&&!matchesManagementBinding(o.management.terminalBinding,monitoring.get(id),o,serviceMarket)){o.management=null;if(id===positionSelected){clearManagementView();invalidated=true}}}
 const sig=JSON.stringify([...monitoring].map(([id,x])=>[id,x.status,x.slot,x.rawHash,x.rangeState,x.reason,x.managementGate?.status,x.managementGate?.reason,x.managementGate?.reviewHash,x.managementGate?.policyHash,monitorFresh(x),rangeFresh(x),manageReady(x,positions.get(id))]));
 if(sig!==monitorSignature){monitorSignature=sig;renderMonitorRows();renderMonitorSelection()}
 if(invalidated){renderPosition();put('managementStatus','仓位、证据或配置已变化，旧研究结果已失效。')}
}
$('evaluatePosition').addEventListener('click',async()=>{
 const id=positionSelected,o=positions.get(id),x=monitoring.get(id),m=serviceMarket,scope=target,g=x?.managementGate;
 if(!manageReady(x,o)||!m||planBusy||managementBusy)return;
 const generation=++positionGeneration;managementBusy=true;o.management=null;clearManagementView();renderPosition();updatePlanButton();put('managementStatus','正在运行 T10 管理评估…');
 try{
  const res=await terminalPost('/api/terminal/management',{position:id,positionSlot:x.slot,positionRawHash:x.rawHash,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:g.reviewHash,policyHash:g.policyHash},40000),r=await res.json();
  if(generation!==positionGeneration||scope!==target||positionSelected!==id)return;
  const current=positions.get(id),mon=monitoring.get(id);
  if(!res.ok||r.managementPreview?.status!=='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED'){put('managementStatus','评估阻塞：'+reasonText(r.managementPreview?.reason??r.gaps?.[0]));return}
  if(!matchesManagementBinding(r.terminalBinding,mon,current,serviceMarket)){put('managementStatus','仓位或证据已变化，丢弃旧结果。');return}
  validateManagement(r,target,current.snapshot);current.management=r;renderPosition();
  if(r.managementPreview.selected)viewManagement(r.managementPreview.candidates.find(a=>JSON.stringify(a)===JSON.stringify(r.managementPreview.selected)));
  put('managementStatus','研究评估完成 · 未验收 · 不可执行。');
 }catch(e){if(generation===positionGeneration)put('managementStatus','评估失败：'+e.message)}
 finally{managementBusy=false;updatePlanButton();renderMonitorSelection()}
});

let autoMonitor=null,autoMonitorReading=false,autoRenderSignature='';
const autoStates={UNKNOWN:'尚未评估',PENDING:'等待评估',BLOCKED:'评估阻塞',RISK_REVIEW_REQUIRED:'需人工风险复核',REVIEW_FLAGS:'存在复核标志',NO_MODEL_FLAGS:'模型未报告标志（未验收）'};
function autoObservationMatches(o,x,now=Date.now()){
 if(!o||!x||!monitorFresh(x,now)||!rangeFresh(x,now)||o.expiresAt<=now||!Number.isSafeInteger(o.expiresAt)||x.managementGate?.status!=='PREFLIGHT_MATCHED_UNVERIFIED'||x.managementGate.expiresAt<=now)return false;
 const g=x.managementGate,m=serviceMarket;if(!m||m.expiresAt<=now)return false;
 return o.key===[m.slot,m.rawHash,x.slot,x.rawHash,g.reviewHash,g.policyHash].join(':');
}
function renderAutoMonitor(){
 const a=autoMonitor?.pool===target?autoMonitor:null;
 const signature=JSON.stringify([a,positionSelected,[...monitoring].map(([id,x])=>[id,autoObservationMatches(a?.current?.[id],x)])]);if(signature===autoRenderSignature)return;autoRenderSignature=signature;
 const rows=$('autoMonitorRows'),events=$('autoMonitorEvents');rows.replaceChildren();events.replaceChildren();
 put('autoMonitorStatus',!a?'监控接口不可用':a.storageError?'记录服务异常':!a.enabled?'持续评估未开启':a.lastCycleAt?'最近轮询 '+new Date(a.lastCycleAt).toLocaleTimeString():'等待首次轮询');
 for(const [id,x] of monitoring){
  const tr=document.createElement('tr'),o=a?.current?.[id],matched=!!a?.enabled&&!a.storageError&&autoObservationMatches(o,x),current=matched?o:null;
  const status=current?.status??(a?.enabled&&!a.storageError&&['BLOCKED','PENDING'].includes(o?.status)?o.status:'UNKNOWN');
  cell(tr,id.slice(0,7)+'…'+id.slice(-5)).title=id;const stateCell=cell(tr,autoStates[status]??'未知');if(status==='RISK_REVIEW_REQUIRED')stateCell.style.color='var(--warn)';
  cell(tr,fmt(current?.stressLossSol));cell(tr,current?.worstInventoryRatio==null?'—':fmt(current.worstInventoryRatio*100)+'%');cell(tr,current?new Date(current.observedAt).toLocaleTimeString():'—');rows.append(tr);
 }
 if(!monitoring.size){const tr=document.createElement('tr');cell(tr,'暂无可监控仓位').colSpan=5;rows.append(tr)}
 const chosen=a?.current?.[positionSelected],x=monitoring.get(positionSelected),matched=!!a?.enabled&&!a.storageError&&autoObservationMatches(chosen,x);
 put('autoMonitorDetail',matched?'选中仓位：'+(chosen.flags?.length?chosen.flags.map(reasonText).join('；'):'模型未报告标志（未验收）'):a?.enabled&&chosen?.status==='BLOCKED'?'最近轮询阻塞：'+reasonText(chosen.reason):'等待与当前快照、配置和证据一致的风险结果。');
 for(const e of (a?.events??[]).slice().reverse()){const tr=document.createElement('tr');cell(tr,new Date(e.at).toLocaleString());cell(tr,e.position.slice(0,7)+'…'+e.position.slice(-5)).title=e.position;cell(tr,autoStates[e.status]??e.status);const td=cell(tr,[e.reason,...(Array.isArray(e.flags)?e.flags:[])].filter(Boolean).map(reasonText).join('；')||'—');td.style.whiteSpace='normal';events.append(tr)}
 if(!a?.events?.length){const tr=document.createElement('tr');cell(tr,'暂无历史状态变更').colSpan=4;events.append(tr)}
}
async function refreshAutoMonitor(){
 if(autoMonitorReading)return;autoMonitorReading=true;const scope=target,epoch=poolEpoch;
 try{const res=await terminalGet('/api/terminal/monitor',scope,10000),a=await res.json();if(!sameScope(epoch,scope,poolEpoch,target))return;if(!res.ok||a.pool!==scope||a.decisionReady!==false||a.executionReady!==false||!Array.isArray(a.events)||!a.current)throw Error('MONITOR_UNAVAILABLE');autoMonitor=a}
 catch{if(sameScope(epoch,scope,poolEpoch,target))autoMonitor=null}finally{autoMonitorReading=false;renderAutoMonitor()}
}

renderMonitorRows();renderMonitorSelection();renderAutoMonitor();
setInterval(()=>{if(monitoring.size)applyMonitoring([...monitoring.values()]);if(page==='positions')renderAutoMonitor();},1000);

refreshService({initial:true}).then(()=>refreshAutoMonitor());setInterval(()=>{refreshService().then(()=>refreshAutoMonitor())},15000);setInterval(()=>{if(report?.terminalBinding&&report.terminalBinding.expiresAt<=Date.now()){clearReport();put('generateStatus','研究证据已过期，请刷新后重新评估。')}if(serviceMarket&&!canAnalyze()){updatePlanButton();$('reviewDot').dataset.ready='false';if(serviceReview?.status==='PREFLIGHT_MATCHED_UNVERIFIED')put('reviewStatus','研究证据或市场快照已过期，请刷新。')}},1000);

let observationEpoch=0,observationExpiry=0,observationBusy=false;
let positionReadEpoch=0,walletIndex=null,walletReadBusy=false,lastPositionRead=0,walletDetails=new Map();
let walletAddress=null,walletProvider=null,walletBusy=false,walletEpoch=0,reviewEpoch=0,activeReview=null,walletEvidenceBusy=false,walletEvidenceResult=null,reviewVerified=false,reviewExpiresAt=0;
function walletKey(provider){try{const key=provider?.publicKey?.toBase58?.()??provider?.publicKey?.toString?.();return addr(key)?key:null}catch{return null}}
function closeResearchReview(){reviewEpoch++;activeReview=null;reviewVerified=false;reviewExpiresAt=0;walletEvidenceResult=null;if($('reviewDialog').open)$('reviewDialog').close()}
function setWallet(value){
 if(walletAddress!==value){clearWalletObservation();clearWalletPositions()}
 if(walletAddress!==value){walletEpoch++;closeResearchReview()}
 walletAddress=value;put('walletIdentity',value?value.slice(0,6)+'…'+value.slice(-6):'未连接钱包');$('walletIdentity').title=value??'';
 $('connectWallet').textContent=walletBusy?'连接中…':value?'断开钱包':'连接 Phantom';$('connectWallet').disabled=walletBusy;updateReviewButtons();if(value&&target)refreshWalletPositions();
}
$('connectWallet').addEventListener('click',async()=>{
 if(walletBusy)return;walletBusy=true;const prior=walletAddress;setWallet(prior);
 try{
  if(prior){try{await walletProvider?.disconnect()}finally{setWallet(null)}return}
  const provider=window.phantom?.solana;
  if(!provider?.isPhantom||typeof provider.connect!=='function'){put('walletIdentity','未检测到 Phantom 扩展');return}
  if(walletProvider!==provider){
   walletProvider=provider;provider.on?.('accountChanged',()=>{if(walletProvider===provider&&(walletAddress||walletBusy))setWallet(walletKey(provider))});provider.on?.('disconnect',()=>{if(walletProvider===provider)setWallet(null)});
  }
  await provider.connect();const key=walletKey(provider);if(!key)throw Error('钱包公钥不可用');setWallet(key);
 }catch{setWallet(null);put('walletIdentity','钱包连接未完成')}
 finally{walletBusy=false;$('connectWallet').disabled=false;$('connectWallet').textContent=walletAddress?'断开钱包':'连接 Phantom'}
});
function clearWalletObservation(){
 observationEpoch++;observationExpiry=0;
 for(const id of ['observedSol','observedMeme','observedWsol'])put(id,'—');
 put('observedWalletStatus','余额未读取');
}
$('observeWallet').addEventListener('click',async()=>{
 if(observationBusy)return;
 if(!walletAddress||!serviceMarket||serviceMarket.expiresAt<=Date.now()||servicePool!==target){put('observedWalletStatus','请连接钱包并等待有效池快照');return}
 clearWalletObservation();const g=observationEpoch,p=target,w=walletAddress,m=serviceMarket;observationBusy=true;$('observeWallet').disabled=true;put('observedWalletStatus','读取中…');
 try{
  const res=await terminalPost('/api/terminal/wallet-observation',{pool:p,wallet:w},35000),r=await res.json();
  if(g!==observationEpoch||p!==target||w!==walletAddress)return;
  if(!res.ok)throw Error(reasonText(r.gaps?.[0]));
  if(r.status!=='OBSERVED_NOT_SPENDABILITY_CHECK'||r.pool!==p||r.wallet!==w||r.mintX!==m.mintX||r.mintY!==m.mintY||r.decimalsX!==m.decimalsX||r.decisionReady!==false||r.executionReady!==false||r.signingAvailable!==false||!Number.isSafeInteger(r.slot)||r.slot<m.slot||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=Date.now()||!raw(r.nativeSolRaw)||!raw(r.memeAta?.amountRaw)||!raw(r.wsolAta?.amountRaw))throw Error('余额观测契约不符');
  put('observedSol',exactAmount(r.nativeSolRaw,9));put('observedMeme',exactAmount(r.memeAta.amountRaw,m.decimalsX)+(r.memeAta.status==='MISSING'?' · 未创建 ATA':r.memeAta.frozen?' · 冻结':''));put('observedWsol',exactAmount(r.wsolAta.amountRaw,9)+(r.wsolAta.status==='MISSING'?' · 未创建 ATA':r.wsolAta.frozen?' · 冻结':''));
  observationExpiry=r.expiresAt;put('observedWalletStatus','Slot '+r.slot+' · 只读观测');
 }catch(e){if(g===observationEpoch)put('observedWalletStatus','读取失败：'+e.message)}
 finally{observationBusy=false;$('observeWallet').disabled=false}
});
setInterval(()=>{if(observationExpiry&&observationExpiry<=Date.now()){clearWalletObservation();put('observedWalletStatus','余额已过期，请重新读取')}if(serviceMarket&&serviceMarket.expiresAt<=Date.now())applyServiceMarket(null)},1000);
let accountingGeneration=0,accountingBusy=false;
function clearAccounting(){accountingGeneration++;$('positionAccountingFields').replaceChildren();put('positionAccountingStatus','在钱包仓位中点击流水复盘。')}
function clearWalletPositions(){clearAccounting();positionReadEpoch++;walletIndex=null;lastPositionRead=0;walletDetails.clear();$('walletPositionRows').replaceChildren();put('walletPositionStatus','等待当前钱包与 Pool')}
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
setInterval(()=>{if(walletReadBusy)return;let changed=false;for(const [id,d] of walletDetails)if(d.readAt&&Date.now()-d.readAt>120000){walletDetails.delete(id);changed=true}if(walletIndex&&walletIndex.expiresAt<=Date.now()){clearWalletPositions();refreshWalletPositions()}else if(changed)renderWalletPositions()},1000);
let externalEpoch=0,externalExpiry=0,externalReading=false;
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
setInterval(()=>{if(externalExpiry&&externalExpiry<=Date.now()){clearExternalMarket();put('externalStatus','外部报价已过期，请重新获取')}},1000);
function reviewSelection(mode){
 if(!walletAddress||!serviceMarket)return null;
 if(mode==='plans'){
  const b=report?.terminalBinding,i=report?.planPreview?.families?.findIndex(f=>f.best===selected||JSON.stringify(f.best)===JSON.stringify(selected));
  if(!b||!report?.reviewId||!selected?.feasible||!Number.isInteger(i)||i<0||!canAnalyze()||b?.expiresAt<=Date.now()||b?.marketSlot!==serviceMarket.slot||b?.marketRawHash!==serviceMarket.rawHash||b?.reviewHash!==serviceReview?.reviewHash)return null;
  return {report,row:selected,rowIndex:i,wallet:walletAddress,mode};
 }
 const o=positions.get(positionSelected),r=o?.management,i=r?.managementPreview?.candidates?.indexOf(managementSelected);
 if(!r?.reviewId||o.snapshot.owner!==walletAddress||!managementSelected?.feasible||!Number.isInteger(i)||i<0||!matchesManagementBinding(r.terminalBinding,monitoring.get(positionSelected),o,serviceMarket))return null;
 return {report:r,row:managementSelected,rowIndex:i,wallet:walletAddress,mode};
}
function updateReviewButtons(){
 $('reviewPlan').disabled=!reviewSelection('plans');$('reviewManagement').disabled=!reviewSelection('management');
 if(activeReview){const cur=reviewSelection(activeReview.mode);if((reviewVerified&&reviewExpiresAt<=Date.now())||!cur||cur.report!==activeReview.report||cur.row!==activeReview.row||cur.wallet!==activeReview.wallet){closeResearchReview();}}
}
function matchesReviewResponse(r,ctx){
 const b=ctx.report.terminalBinding,management=ctx.mode==='management';
 return r.reviewId===ctx.report.reviewId&&r.mode===ctx.mode&&r.rowIndex===ctx.rowIndex&&r.pool===target&&r.wallet===ctx.wallet&&r.requestHash===b.requestHash&&r.marketSlot===b.marketSlot&&r.marketRawHash===b.marketRawHash&&r.reviewHash===b.reviewHash&&r.position===(management?b.position:null)&&r.policyHash===(management?b.policyHash:null)&&r.positionSlot===(management?b.positionSlot:null)&&r.positionRawHash===(management?b.positionRawHash:null)&&Number.isSafeInteger(r.expiresAt)&&r.expiresAt>Date.now()&&r.expiresAt<=b.expiresAt;
}
async function openResearchReview(mode){
 const ctx=reviewSelection(mode);if(!ctx)return;const epoch=++reviewEpoch,accountEpoch=walletEpoch;activeReview=ctx;reviewVerified=false;reviewExpiresAt=0;walletEvidenceResult=null;$('readWalletEvidence').disabled=true;$('walletEvidenceFields').replaceChildren();put('walletEvidenceStatus','主动读取时会向配置的 RPC 提供公开钱包地址。');
 $('reviewFields').replaceChildren();$('reviewBlockers').replaceChildren();$('integerFields').replaceChildren();$('integerRows').replaceChildren();put('integerStatus','等待服务端整数预检');$('weightFields').replaceChildren();$('weightRows').replaceChildren();put('weightStatus','等待 SDK 权重诊断');$('inverseFields').replaceChildren();$('inverseRows').replaceChildren();put('inverseStatus','等待同源采集证据');put('reviewMessage','正在核对当前仓位、钱包身份及研究证据…');$('reviewDialog').showModal();
 try{
  const res=await terminalPost('/api/terminal/review',{mode,reviewId:ctx.report.reviewId,rowIndex:ctx.rowIndex,wallet:ctx.wallet},10000),r=await res.json();
  if(epoch!==reviewEpoch||accountEpoch!==walletEpoch||!$('reviewDialog').open)return;
  const current=reviewSelection(mode);if(!current||current.report!==ctx.report||current.row!==ctx.row){closeResearchReview();return}
  if(!res.ok)throw Error(reasonText(r.gaps?.[0]));
  if(r.status!=='RESEARCH_REVIEW_ONLY'||r.signingAvailable!==false||r.executionReady!==false||r.decisionReady!==false||!matchesReviewResponse(r,ctx))throw Error('审阅结果身份不符');
  const fields={钱包:r.wallet,Pool:r.pool,Position:r.position??'尚未创建',研究动作:r.action,策略:r.strategy??'—',模型选中:r.modelSelected?'是':'否',模型SOL分配:fmt(r.modelAllocation?.sol),模型MEME分配:fmt(r.modelAllocation?.meme),Bin区间:r.modelAllocation?.lowerBinId==null?'无 LP':r.modelAllocation.lowerBinId+' 至 '+r.modelAllocation.upperBinId,快照Slot:r.marketSlot,有效期:new Date(r.expiresAt).toLocaleTimeString()};
  for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);$('reviewFields').append(dt,dd)}
  for(const code of r.blockers??[]){const li=document.createElement('li');li.textContent=reasonText(code);$('reviewBlockers').append(li)}
  renderIntegerDiagnostic(r.integerAllocation);renderWeightDiagnostic(r.weightDiagnostic);renderInverseDiagnostic(r.weightDiagnostic?.inverse);reviewVerified=true;reviewExpiresAt=r.expiresAt;$('readWalletEvidence').disabled=walletEvidenceBusy;put('reviewMessage','审阅完成 · 模型结果未验收 · 未获得任何签名权限');
 }catch(e){if(epoch===reviewEpoch)put('reviewMessage','审阅阻塞：'+e.message)}
}
$('reviewPlan').addEventListener('click',()=>openResearchReview('plans'));
$('reviewManagement').addEventListener('click',()=>openResearchReview('management'));
$('closeReview').addEventListener('click',closeResearchReview);
$('dismissReview').addEventListener('click',closeResearchReview);
$('reviewDialog').addEventListener('close',()=>{reviewEpoch++;activeReview=null;reviewVerified=false;walletEvidenceResult=null});
setInterval(()=>{if(walletAddress&&walletKey(walletProvider)!==walletAddress)setWallet(null);updateReviewButtons();if(walletEvidenceResult&&walletEvidenceResult.expiresAt<=Date.now()){walletEvidenceResult=null;$('walletEvidenceFields').replaceChildren();put('walletEvidenceStatus','余额观测已过期，请重新读取。')}},500);

$('readWalletEvidence').addEventListener('click',async()=>{
 const ctx=activeReview,epoch=reviewEpoch;
 if(!ctx||!reviewVerified||reviewExpiresAt<=Date.now()||walletEvidenceBusy)return;
 walletEvidenceBusy=true;walletEvidenceResult=null;$('walletEvidenceFields').replaceChildren();$('readWalletEvidence').disabled=true;put('walletEvidenceStatus','正在读取 finalized 链上账户…');
 try{
  const res=await terminalPost('/api/terminal/wallet-evidence',{mode:ctx.mode,reviewId:ctx.report.reviewId,rowIndex:ctx.rowIndex,wallet:ctx.wallet},40000),r=await res.json();
  if(epoch!==reviewEpoch||!$('reviewDialog').open)return;
  const cur=reviewSelection(ctx.mode);if(!cur||cur.report!==ctx.report||cur.row!==ctx.row||cur.wallet!==ctx.wallet){closeResearchReview();return}
  if(!res.ok)throw Error(reasonText(r.gaps?.[0]));
  if(r.status!=='OBSERVED_NOT_SPENDABILITY_CHECK'||r.decisionReady!==false||r.executionReady!==false||r.signingAvailable!==false||!matchesReviewResponse(r,ctx)||!Number.isSafeInteger(r.slot)||r.slot<ctx.report.terminalBinding.marketSlot||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=Date.now()||!hash(r.rawHash))throw Error('余额观测与审阅身份或时效不匹配');
  const tokenState=a=>a?.status==='MISSING'?'未创建 ATA':a?.frozen?'已冻结':a?.delegated?'存在委托':'已观测';
  const fields={'原生 SOL':exactAmount(r.nativeSolRaw,9),'MEME · ATA':exactAmount(r.memeAta?.amountRaw,r.decimalsX),'MEME 账户状态':tokenState(r.memeAta),'WSOL · ATA':exactAmount(r.wsolAta?.amountRaw,9),'WSOL 账户状态':tokenState(r.wsolAta),'单个经典 SPL 账户租金参考 SOL':exactAmount(r.classicTokenAccountRentRaw,9),'交易手续费':'待真实消息报价','账户观测 Slot':r.slot,'观测有效期':new Date(r.expiresAt).toLocaleTimeString()};
  for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);$('walletEvidenceFields').append(dt,dd)}
  walletEvidenceResult=r;put('walletEvidenceStatus','链上账户观测已读取 · 不代表可支配资金或交易已验证。');
 }catch(e){if(epoch===reviewEpoch)put('walletEvidenceStatus','读取阻塞：'+e.message)}
 finally{walletEvidenceBusy=false;$('readWalletEvidence').disabled=!reviewVerified}
});

function renderIntegerDiagnostic(d){
 const dl=$('integerFields'),rows=$('integerRows');dl.replaceChildren();rows.replaceChildren();
 if(d?.status!=='INTEGER_DIAGNOSTIC_ONLY'||d.executionReady!==false||d.signingAvailable!==false||d.decisionReady!==false||!Array.isArray(d.rows)||d.rows.length>1500){put('integerStatus',reasonText(d?.reason??'INTEGER_DIAGNOSTIC_FAILED'));return}
 put('integerStatus','整数预检完成 · 仍非 SDK 交易数量。');
 for(const [k,v] of Object.entries({'模型分配 SOL':exactAmount(d.totalSolRaw,9),'模型分配 MEME':exactAmount(d.totalMemeRaw,d.decimalsX),'SOL 最低储备':exactAmount(d.reservedSolRaw,9),'模型成本储备 SOL':exactAmount(d.modelCostReserveRaw,9),'预检剩余 SOL':exactAmount(d.remainingSolAfterReservesRaw,9),'预检剩余 MEME':exactAmount(d.remainingMemeRaw,d.decimalsX),'区间宽度 / 实际 Bin':d.rangeWidth+' / '+d.binCount,'非连续区间':d.discontinuous?'是 · 待 SDK 适配':'否','整数化后零额 Bin':d.zeroRows})){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);dl.append(dt,dd)}
 for(const b of d.rows){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,b.solRaw);cell(tr,b.memeRaw);rows.append(tr)}
}

function renderWeightDiagnostic(d){
 const dl=$('weightFields'),rows=$('weightRows');dl.replaceChildren();rows.replaceChildren();
 if(!d||d.executionReady!==false||d.signingAvailable!==false||d.decisionReady!==false){put('weightStatus','诊断不可用');return}
 put('weightStatus',d.status==='SDK_WEIGHT_SHAPE_DIAGNOSTIC_ONLY'?'形状偏差在配置范围内 · 非实际分配验证':reasonText(d.reason));
 const fields={'SDK 版本':d.sdkVersion??'—','形状总变差':Number.isInteger(d.totalVariationBps)?d.totalVariationBps+' bps':'—','最大单 Bin 占比偏差':Number.isInteger(d.maxBinShareDeltaBps)?d.maxBinShareDeltaBps+' bps':'—','配置上限':Number.isInteger(d.maxDeviationBps)?d.maxDeviationBps+' bps':'—','X / Y 比例取整余量':Number.isInteger(d.xResidualBps)&&Number.isInteger(d.yResidualBps)?d.xResidualBps+' / '+d.yResidualBps+' bps':'—','丢失 Bin':Array.isArray(d.droppedBins)?d.droppedBins.length?d.droppedBins.join(', '):'无':'—'};
 for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);dl.append(dt,dd)}
 for(const b of Array.isArray(d.rows)?d.rows.slice(0,1500):[]){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,Number.isInteger(b.modelQuoteShareBps)?(b.modelQuoteShareBps/100).toFixed(2)+'%':'—');cell(tr,Number.isInteger(b.sdkWeightShareBps)?(b.sdkWeightShareBps/100).toFixed(2)+'%':'—');rows.append(tr)}
}

function renderInverseDiagnostic(d){
 const dl=$('inverseFields'),body=$('inverseRows');dl.replaceChildren();body.replaceChildren();
 if(!d||d.decisionReady!==false||d.executionReady!==false||d.signingAvailable!==false){put('inverseStatus','未生成反算诊断');return}
 put('inverseStatus',d.status==='SDK_INVERSE_ESTIMATE_ONLY'?'反算偏差在配置范围内 · 仍需协议与模拟验收':reasonText(d.reason));
 const m=d.meme,y=d.sol,dec=d.decimalsX,valid=Number.isInteger(dec)&&dec>=0&&dec<=18;
 if(!valid||!m||!y||!Array.isArray(d.rows)||d.rows.length>1500)return;
 const fields={'估算方法':d.helper??'—','SOL 目标':exactAmount(y.targetRaw,9),'SOL 反算':exactAmount(y.estimatedRaw,9),'SOL 未分配':exactAmount(y.unusedRaw,9),'SOL 总绝对偏差':y.absoluteErrorBps+' bps','MEME 目标':exactAmount(m.targetRaw,dec),'MEME 反算':exactAmount(m.estimatedRaw,dec),'MEME 未分配':exactAmount(m.unusedRaw,dec),'MEME 总绝对偏差':m.absoluteErrorBps+' bps','允许上限':d.maxAmountErrorBps+' bps','Active Bin 已有 SOL':d.activeContext?exactAmount(d.activeContext.solRaw,9):'不适用','Active Bin 已有 MEME':d.activeContext?exactAmount(d.activeContext.memeRaw,dec):'不适用','丢失 Bin':d.droppedBins?.join(', ')||'无'};
 for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);dl.append(dt,dd)}
 for(const b of d.rows){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,exactAmount(b.targetSolRaw,9));cell(tr,exactAmount(b.estimatedSolRaw,9));cell(tr,exactAmount(b.targetMemeRaw,dec));cell(tr,exactAmount(b.estimatedMemeRaw,dec));body.append(tr)}
}

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

'use strict';
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



'use strict';
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

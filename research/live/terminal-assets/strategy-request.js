'use strict';
$('request').addEventListener('submit',async e=>{
 if(e.submitter?.id!=='generatePlan'||!draft||!canAnalyze()||planBusy||managementBusy)return;const d=draft,m=serviceMarket,review=serviceReview,p=target,g=++importGeneration;planBusy=true;updatePlanButton();renderMonitorSelection();clearReport();put('generateStatus','正在运行已有研究引擎…');
 try{const res=await terminalPost('/api/terminal/plans',{draft:d,marketSlot:m.slot,marketRawHash:m.rawHash,reviewHash:review.reviewHash},40000);const r=await res.json();if(g!==importGeneration||target!==p)return;if(draft!==d){put('generateStatus','本金或策略参数已变化。');return}
  if(!res.ok||!r.terminalBinding){put('generateStatus','分析阻塞：'+reasonText(r.gaps?.[0]));return}
  const b=r.terminalBinding;if(b.scope!=='RESEARCH_ONLY'||b.marketSlot!==m.slot||b.marketRawHash!==m.rawHash||!hash(b.requestHash)||b.reviewHash!==review.reviewHash||!Number.isSafeInteger(b.expiresAt))throw Error('研究报告绑定不符');
  if(serviceMarket?.rawHash!==m.rawHash||serviceMarket?.slot!==m.slot||serviceReview?.reviewHash!==review.reviewHash||!canAnalyze()||b.expiresAt<=Date.now()){const {terminalBinding,reviewId,...archive}=r;renderReport(archive,'archive');put('generateStatus','已保留 Slot '+b.marketSlot+' 的研究结果；市场已更新。');return}
  renderReport(r,'service');put('generateStatus',r.planPreview?.status==='RESEARCH_PLAN_PREVIEW_UNVERIFIED'?'研究方案已生成 · 未验收 · 不可执行':'分析阻塞：'+reasonText(r.planPreview?.reason??r.gaps?.[0]));
 }catch(e){if(g===importGeneration)put('generateStatus','分析失败：'+e.message)}finally{planBusy=false;updatePlanButton();renderMonitorSelection()}
});


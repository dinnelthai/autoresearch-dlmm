'use strict';
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

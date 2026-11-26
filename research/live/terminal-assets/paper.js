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
 put('paperAutoStatus',r.status+(r.reason?' · '+r.reason:'')+(r.slot!=null?' · Slot '+r.slot+' · '+r.snapshotCount+' 个快照':'')+(r.checkpointFresh?' · 最近观察（未验证）':' · 非当前有效结果'));
 for(const x of r.rows){const tr=document.createElement('tr');cell(tr,x.mode==='NO_LP'?'No LP / HODL':names[x.mode]??x.mode);cell(tr,x.status+(x.reason?' · '+x.reason:'')+(x.adaptiveReason?' · '+x.adaptiveReason:'')+(x.mode==='adaptive'?' · 调仓 '+x.rebalances:''));cell(tr,paperSignedSol(x.initialNavYRaw));for(const k of ['navYRaw','pnlYRaw','excessVsHoldYRaw','costYRaw'])cell(tr,paperSignedSol(x.latest?.[k]));cell(tr,Number.isFinite(x.latest?.drawdownBps)?fmt(x.latest.drawdownBps/100)+'%':'—');body.append(tr)}
}
function validateAutoPaper(r,scope){if(r?.scope!=='PAPER_AUTO_RESEARCH_ONLY'||r.pool!==scope||r.pnlReady!==false||r.executionReady!==false||r.protocolExact!==false||typeof r.running!=='boolean'||!Array.isArray(r.rows)||r.rows.length>8)throw Error('模拟服务响应不符');return r}
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
  if(!draft||draft.pool!==p||!canAnalyze()||!serviceMarket||!serviceReview)throw Error('请先在策略页准备有效草稿和市场审阅');
  const dd=number('paperAutoDrawdown')*100,gap=number('paperAutoGap');if(!Number.isFinite(dd)||Math.abs(dd-Math.round(dd))>1e-8||dd<1||dd>10000||!Number.isInteger(gap))throw Error('风险参数无效');
  const policy={maxDrawdownBps:Math.round(dd),maxGapSeconds:gap,maxLossSolRaw:paperSolRaw($('paperAutoLoss').value.trim()),exitCostSolRaw:paperSolRaw($('paperAutoExitCost').value.trim())};
  if($('paperAdaptiveEnabled').checked)policy.adaptive={cooldownSeconds:number('paperAdaptiveCooldown'),maxRebalances:number('paperAdaptiveCount'),maxTurnoverSol:number('paperAdaptiveTurnover')};
  paperAutoBusy=true;paperAutoGeneration++;$('paperAutoStart').disabled=true;put('paperAutoStatus','正在生成并冻结虚拟方案…');
  const res=await terminalPost('/api/terminal/paper-start',{draft,marketSlot:serviceMarket.slot,marketRawHash:serviceMarket.rawHash,reviewHash:serviceReview.reviewHash,policy},45000),r=await res.json();
  if(p!==target)return;if(!res.ok)throw Error(r.gaps?.[0]??'启动失败');renderAutoPaper(validateAutoPaper(r,p))
 }catch(e){if(p===target)put('paperAutoStatus','启动失败：'+e.message)}
 finally{paperAutoBusy=false;$('paperAutoStart').disabled=!!paperAutoData?.running;$('paperAutoPause').disabled=!paperAutoData?.running}
});
$('paperAutoPause').addEventListener('click',async()=>{if(paperAutoBusy||!paperAutoData?.running||paperAutoData.pool!==target)return;const p=target,id=paperAutoData.id;paperAutoBusy=true;paperAutoGeneration++;$('paperAutoPause').disabled=true;try{const res=await terminalPost('/api/terminal/paper-pause',{id},10000),r=await res.json();if(p!==target)return;if(!res.ok)throw Error(r.gaps?.[0]??'暂停失败');renderAutoPaper(validateAutoPaper(r,p))}catch(e){if(p===target)put('paperAutoStatus','暂停失败：'+e.message)}finally{paperAutoBusy=false;$('paperAutoStart').disabled=!!paperAutoData?.running;$('paperAutoPause').disabled=!paperAutoData?.running}});
setInterval(refreshPaperAuto,15000);

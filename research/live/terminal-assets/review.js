'use strict';
function reviewFacts(dl,fields){for(const [k,v] of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=String(v);dl.append(dt,dd)}}
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
  reviewFacts($('reviewFields'),fields)
  for(const code of r.blockers??[]){const li=document.createElement('li');li.textContent=reasonText(code);$('reviewBlockers').append(li)}
  renderIntegerDiagnostic(r.integerAllocation);renderWeightDiagnostic(r.weightDiagnostic);renderInverseDiagnostic(r.weightDiagnostic?.inverse);reviewVerified=true;reviewExpiresAt=r.expiresAt;$('readWalletEvidence').disabled=walletEvidenceBusy;put('reviewMessage','审阅完成 · 模型结果未验收 · 未获得任何签名权限');
 }catch(e){if(epoch===reviewEpoch)put('reviewMessage','审阅阻塞：'+e.message)}
}
$('reviewPlan').addEventListener('click',()=>openResearchReview('plans'));
$('reviewManagement').addEventListener('click',()=>openResearchReview('management'));
$('closeReview').addEventListener('click',closeResearchReview);
$('dismissReview').addEventListener('click',closeResearchReview);
$('reviewDialog').addEventListener('close',()=>{reviewEpoch++;activeReview=null;reviewVerified=false;walletEvidenceResult=null});

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
  reviewFacts($('walletEvidenceFields'),fields)
  walletEvidenceResult=r;put('walletEvidenceStatus','链上账户观测已读取 · 不代表可支配资金或交易已验证。');
 }catch(e){if(epoch===reviewEpoch)put('walletEvidenceStatus','读取阻塞：'+e.message)}
 finally{walletEvidenceBusy=false;$('readWalletEvidence').disabled=!reviewVerified}
});

function renderIntegerDiagnostic(d){
 const dl=$('integerFields'),rows=$('integerRows');dl.replaceChildren();rows.replaceChildren();
 if(d?.status!=='INTEGER_DIAGNOSTIC_ONLY'||d.executionReady!==false||d.signingAvailable!==false||d.decisionReady!==false||!Array.isArray(d.rows)||d.rows.length>1500){put('integerStatus',reasonText(d?.reason??'INTEGER_DIAGNOSTIC_FAILED'));return}
 put('integerStatus','整数预检完成 · 仍非 SDK 交易数量。');
 reviewFacts(dl,{'模型分配 SOL':exactAmount(d.totalSolRaw,9),'模型分配 MEME':exactAmount(d.totalMemeRaw,d.decimalsX),'SOL 最低储备':exactAmount(d.reservedSolRaw,9),'模型成本储备 SOL':exactAmount(d.modelCostReserveRaw,9),'预检剩余 SOL':exactAmount(d.remainingSolAfterReservesRaw,9),'预检剩余 MEME':exactAmount(d.remainingMemeRaw,d.decimalsX),'区间宽度 / 实际 Bin':d.rangeWidth+' / '+d.binCount,'非连续区间':d.discontinuous?'是 · 待 SDK 适配':'否','整数化后零额 Bin':d.zeroRows});
 for(const b of d.rows){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,b.solRaw);cell(tr,b.memeRaw);rows.append(tr)}
}

function renderWeightDiagnostic(d){
 const dl=$('weightFields'),rows=$('weightRows');dl.replaceChildren();rows.replaceChildren();
 if(!d||d.executionReady!==false||d.signingAvailable!==false||d.decisionReady!==false){put('weightStatus','诊断不可用');return}
 put('weightStatus',d.status==='SDK_WEIGHT_SHAPE_DIAGNOSTIC_ONLY'?'形状偏差在配置范围内 · 非实际分配验证':reasonText(d.reason));
 const fields={'SDK 版本':d.sdkVersion??'—','形状总变差':Number.isInteger(d.totalVariationBps)?d.totalVariationBps+' bps':'—','最大单 Bin 占比偏差':Number.isInteger(d.maxBinShareDeltaBps)?d.maxBinShareDeltaBps+' bps':'—','配置上限':Number.isInteger(d.maxDeviationBps)?d.maxDeviationBps+' bps':'—','X / Y 比例取整余量':Number.isInteger(d.xResidualBps)&&Number.isInteger(d.yResidualBps)?d.xResidualBps+' / '+d.yResidualBps+' bps':'—','丢失 Bin':Array.isArray(d.droppedBins)?d.droppedBins.length?d.droppedBins.join(', '):'无':'—'};
 reviewFacts(dl,fields);
 for(const b of Array.isArray(d.rows)?d.rows.slice(0,1500):[]){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,Number.isInteger(b.modelQuoteShareBps)?(b.modelQuoteShareBps/100).toFixed(2)+'%':'—');cell(tr,Number.isInteger(b.sdkWeightShareBps)?(b.sdkWeightShareBps/100).toFixed(2)+'%':'—');rows.append(tr)}
}

function renderInverseDiagnostic(d){
 const dl=$('inverseFields'),body=$('inverseRows');dl.replaceChildren();body.replaceChildren();
 if(!d||d.decisionReady!==false||d.executionReady!==false||d.signingAvailable!==false){put('inverseStatus','未生成反算诊断');return}
 put('inverseStatus',d.status==='SDK_INVERSE_ESTIMATE_ONLY'?'反算偏差在配置范围内 · 仍需协议与模拟验收':reasonText(d.reason));
 const m=d.meme,y=d.sol,dec=d.decimalsX,valid=Number.isInteger(dec)&&dec>=0&&dec<=18;
 if(!valid||!m||!y||!Array.isArray(d.rows)||d.rows.length>1500)return;
 const fields={'估算方法':d.helper??'—','SOL 目标':exactAmount(y.targetRaw,9),'SOL 反算':exactAmount(y.estimatedRaw,9),'SOL 未分配':exactAmount(y.unusedRaw,9),'SOL 总绝对偏差':y.absoluteErrorBps+' bps','MEME 目标':exactAmount(m.targetRaw,dec),'MEME 反算':exactAmount(m.estimatedRaw,dec),'MEME 未分配':exactAmount(m.unusedRaw,dec),'MEME 总绝对偏差':m.absoluteErrorBps+' bps','允许上限':d.maxAmountErrorBps+' bps','Active Bin 已有 SOL':d.activeContext?exactAmount(d.activeContext.solRaw,9):'不适用','Active Bin 已有 MEME':d.activeContext?exactAmount(d.activeContext.memeRaw,dec):'不适用','丢失 Bin':d.droppedBins?.join(', ')||'无'};
 reviewFacts(dl,fields);
 for(const b of d.rows){const tr=document.createElement('tr');cell(tr,b.binId);cell(tr,exactAmount(b.targetSolRaw,9));cell(tr,exactAmount(b.estimatedSolRaw,9));cell(tr,exactAmount(b.targetMemeRaw,dec));cell(tr,exactAmount(b.estimatedMemeRaw,dec));body.append(tr)}
}


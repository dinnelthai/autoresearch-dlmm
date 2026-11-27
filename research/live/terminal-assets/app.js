'use strict';
// Bootstrap only after every controller has loaded and registered its handlers.
rows();
syncShape();
renderPosition();renderShadow();renderPaper();
renderMonitorRows();renderMonitorSelection();renderAutoMonitor();
refreshService({initial:true}).then(()=>{refreshAutoMonitor();refreshPaperAuto()});
setInterval(()=>refreshService().then(refreshAutoMonitor),15000);
setInterval(()=>{
 const now=Date.now();
 if(serviceMarket&&serviceMarket.expiresAt<=now)applyServiceMarket(null);
 archiveExpiredReport(serviceMarket,serviceReview);
 if(serviceMarket&&!canAnalyze(now)){updatePlanButton();$('reviewDot').dataset.ready='false';if(serviceReview?.status==='PREFLIGHT_MATCHED_UNVERIFIED')put('reviewStatus','研究证据或市场快照已过期，请刷新。')}
 if(monitoring.size)applyMonitoring([...monitoring.values()]);if(page==='positions')renderAutoMonitor();
 if(observationExpiry&&observationExpiry<=now){clearWalletObservation();put('observedWalletStatus','余额已过期，请重新读取')}
 if(!walletReadBusy){let changed=false;for(const [id,d] of walletDetails)if(d.readAt&&now-d.readAt>120000){walletDetails.delete(id);changed=true}if(walletIndex&&walletIndex.expiresAt<=now){clearWalletPositions({preserveAccounting:true});refreshWalletPositions()}else if(changed)renderWalletPositions()}
 if(externalExpiry&&externalExpiry<=now){clearExternalMarket();put('externalStatus','外部报价已过期，请重新获取')}
},1000);
setInterval(()=>{if(walletAddress&&walletKey(walletProvider)!==walletAddress)setWallet(null);updateReviewButtons();if(walletEvidenceResult&&walletEvidenceResult.expiresAt<=Date.now()){walletEvidenceResult=null;$('walletEvidenceFields').replaceChildren();put('walletEvidenceStatus','余额观测已过期，请重新读取。')}},500);

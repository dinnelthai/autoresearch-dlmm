'use strict';
// Bootstrap only after every controller has loaded and registered its handlers.
rows();
syncShape();
renderPosition();renderShadow();renderPaper();
renderMonitorRows();renderMonitorSelection();renderAutoMonitor();
setInterval(()=>{if(monitoring.size)applyMonitoring([...monitoring.values()]);if(page==='positions')renderAutoMonitor();},1000);
refreshService({initial:true}).then(()=>refreshAutoMonitor());setInterval(()=>{refreshService().then(()=>refreshAutoMonitor())},15000);setInterval(()=>{if(report?.terminalBinding&&report.terminalBinding.expiresAt<=Date.now()){clearReport();put('generateStatus','研究证据已过期，请刷新后重新评估。')}if(serviceMarket&&!canAnalyze()){updatePlanButton();$('reviewDot').dataset.ready='false';if(serviceReview?.status==='PREFLIGHT_MATCHED_UNVERIFIED')put('reviewStatus','研究证据或市场快照已过期，请刷新。')}},1000);
setInterval(()=>{if(observationExpiry&&observationExpiry<=Date.now()){clearWalletObservation();put('observedWalletStatus','余额已过期，请重新读取')}if(serviceMarket&&serviceMarket.expiresAt<=Date.now())applyServiceMarket(null)},1000);
setInterval(()=>{if(walletReadBusy)return;let changed=false;for(const [id,d] of walletDetails)if(d.readAt&&Date.now()-d.readAt>120000){walletDetails.delete(id);changed=true}if(walletIndex&&walletIndex.expiresAt<=Date.now()){clearWalletPositions({preserveAccounting:true});refreshWalletPositions()}else if(changed)renderWalletPositions()},1000);
setInterval(()=>{if(externalExpiry&&externalExpiry<=Date.now()){clearExternalMarket();put('externalStatus','外部报价已过期，请重新获取')}},1000);
setInterval(()=>{if(walletAddress&&walletKey(walletProvider)!==walletAddress)setWallet(null);updateReviewButtons();if(walletEvidenceResult&&walletEvidenceResult.expiresAt<=Date.now()){walletEvidenceResult=null;$('walletEvidenceFields').replaceChildren();put('walletEvidenceStatus','余额观测已过期，请重新读取。')}},500);

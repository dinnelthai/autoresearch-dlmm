'use strict';
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

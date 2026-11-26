// T14 B1: exact public wallet observations. Not a spendability or fee quote.
const assert=(v,m)=>{if(!v)throw Error(m)};
const raw=v=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n;
export function lamportsRaw(v){
 assert(Number.isSafeInteger(v)&&v>=0,'WALLET_LAMPORTS_PRECISION_UNSUPPORTED');
 return String(v);
}
export function tokenObservation(a){
 if(a===null)return {status:'MISSING',amountRaw:'0',frozen:false,delegated:false};
 assert(a.isInitialized===true&&raw(a.amount.toString()),'TOKEN_ACCOUNT_INVALID');
 return {status:a.isFrozen?'FROZEN':'PRESENT',amountRaw:a.amount.toString(),frozen:!!a.isFrozen,delegated:!!a.delegate};
}
export function validateWalletEvidence(e,{wallet,mintX,mintY,decimalsX,marketSlot,genesis,now,maxAgeMs=30000}){
 assert(e?.schemaVersion===1&&e.status==='WALLET_CAPTURED_UNVERIFIED'&&e.decisionReady===false&&e.executionReady===false&&e.wallet===wallet&&e.mintX===mintX&&e.mintY===mintY&&e.decimalsX===decimalsX&&e.decimalsY===9&&e.genesisHash===genesis&&e.commitment==='finalized','WALLET_CAPTURE_IDENTITY_MISMATCH');
 assert(Number.isSafeInteger(e.slot)&&e.slot>=marketSlot&&Number.isSafeInteger(e.receivedAt)&&e.receivedAt<=now&&now-e.receivedAt<maxAgeMs,'WALLET_CAPTURE_STALE');
 assert(raw(e.nativeSolRaw)&&raw(e.classicTokenAccountRentRaw)&&e.walletAccountStatus!=='UNSUPPORTED'&&['SYSTEM_ACCOUNT','MISSING'].includes(e.walletAccountStatus),'WALLET_ACCOUNT_UNSUPPORTED');
 for(const a of [e.memeAta,e.wsolAta]){
  assert(a&&typeof a.address==='string'&&['MISSING','PRESENT','FROZEN'].includes(a.status)&&raw(a.amountRaw)&&typeof a.frozen==='boolean'&&typeof a.delegated==='boolean','WALLET_TOKEN_CAPTURE_INVALID');
  assert(a.status==='FROZEN'?a.frozen:a.frozen===false,'WALLET_TOKEN_CAPTURE_INVALID');
  if(a.status==='MISSING')assert(a.amountRaw==='0'&&!a.delegated,'WALLET_TOKEN_CAPTURE_INVALID');
 }
 assert(/^[0-9a-f]{64}$/.test(e.rawHash)&&typeof e.directory==='string','WALLET_EVIDENCE_HASH_MISSING');
 return e;
}
export function walletReview(e,review){
 // No conversion of floating-point model allocation into transaction debits.
 return {status:'OBSERVED_NOT_SPENDABILITY_CHECK',wallet:e.wallet,slot:e.slot,receivedAt:e.receivedAt,genesisHash:e.genesisHash,nativeSolRaw:e.nativeSolRaw,memeAta:e.memeAta,wsolAta:e.wsolAta,decimalsX:e.decimalsX,classicTokenAccountRentRaw:e.classicTokenAccountRentRaw,rawHash:e.rawHash,requestHash:review.requestHash,expiresAt:Math.min(e.receivedAt+30000,review.expiresAt),decisionReady:false,executionReady:false,signingAvailable:false,limitations:['Only canonical associated token accounts are measured, not all wallet token accounts.','Native SOL and WSOL are distinct; no automatic wrap, unwrap or transfer.','Rent exemption reference is for one classic SPL token account only, not the position or transaction fee.','No exact transaction message, fee quote, debit limits or simulation.']};
}

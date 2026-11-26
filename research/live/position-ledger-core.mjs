// T15: narrow finalized position cashflow reconciliation; no synthetic or simulated inputs.
const assert=(v,m)=>{if(!v)throw Error(m)};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n,'RAW_AMOUNT_INVALID');return BigInt(v)};
const lam=v=>{assert(Number.isSafeInteger(v)&&v>=0,'LAMPORT_PRECISION_UNSUPPORTED');return BigInt(v)};
export function reconcilePositionTransaction(o){
 const fail=reason=>({status:'BLOCKED',reason,signature:o?.signature,slot:o?.slot,decisionReady:false,executionReady:false});
 try{
  assert(o?.source==='FINALIZED_RPC_CAPTURE'&&typeof o.signature==='string'&&Number.isSafeInteger(o.slot)&&Number.isSafeInteger(o.txIndex)&&o.scopeValidated===true,'FINALIZED_SCOPE_REQUIRED');
  const fee=raw(o.feeRaw),before=lam(o.preWalletLamports),after=lam(o.postWalletLamports),rentBefore=lam(o.prePositionLamports),rentAfter=lam(o.postPositionLamports);
  const rent=rentAfter-rentBefore;
  assert(before-after===fee+rent,'NATIVE_LAMPORT_DELTA_MISMATCH');
  assert(o.otherLamportsUnchanged===true&&o.otherTokenBalancesUnchanged===true,'UNRELATED_BALANCE_CHANGE');
  const x=raw(o.walletX.post)-raw(o.walletX.pre),y=raw(o.walletY.post)-raw(o.walletY.pre),vx=raw(o.vaultX.post)-raw(o.vaultX.pre),vy=raw(o.vaultY.post)-raw(o.vaultY.pre);
  assert(x===-vx&&y===-vy,'WALLET_VAULT_DELTA_MISMATCH');
  let kind,amountX=0n,amountY=0n;
  if(!o.success){
   assert(x===0n&&y===0n&&rent===0n,'FAILED_TX_CHANGED_PRINCIPAL');
   kind='FAILED_FEE_ONLY';
  }else{
   assert(Array.isArray(o.events)&&o.events.length>0,'POSITION_EVENT_MISSING');
   const economic=o.events.filter(e=>['ADD','REMOVE','CLAIM'].includes(e.kind)),created=o.events.filter(e=>e.kind==='CREATE').length,closed=o.events.filter(e=>e.kind==='CLOSE').length;
   assert(o.events.length===economic.length+created+closed&&economic.length<=1&&created<=1&&closed<=1&&!(created&&closed),'COMPOSITE_OR_UNSUPPORTED_EVENT');
   assert(created?(rentBefore===0n&&rentAfter>0n):closed?(rentBefore>0n&&rentAfter===0n):rent===0n,'POSITION_RENT_LIFECYCLE_MISMATCH');
   if(economic.length){
    const e=economic[0];kind=e.kind;amountX=raw(e.amountXRaw);amountY=raw(e.amountYRaw);
    const direction=kind==='ADD'?-1n:1n;
    assert(x===direction*amountX&&y===direction*amountY,'EVENT_TRANSFER_AMOUNT_MISMATCH');
    assert(!created||kind==='ADD','CREATE_WITH_UNSUPPORTED_FLOW');assert(!closed||kind==='REMOVE','CLOSE_WITH_UNSUPPORTED_FLOW');
   }else{assert(x===0n&&y===0n,'UNCLASSIFIED_TOKEN_FLOW');assert(created||closed,'NO_SUPPORTED_EVENT');kind=created?'CREATE':'CLOSE'}
  }
  return {status:'TRANSACTION_DELTA_RECONCILED_UNVERIFIED',signature:o.signature,slot:o.slot,txIndex:o.txIndex,blockTime:o.blockTime??null,kind,success:o.success,created:o.success&&o.events.some(e=>e.kind==='CREATE'),closed:o.success&&o.events.some(e=>e.kind==='CLOSE'),depositXRaw:kind==='ADD'?amountX.toString():'0',depositYRaw:kind==='ADD'?amountY.toString():'0',withdrawXRaw:kind==='REMOVE'?amountX.toString():'0',withdrawYRaw:kind==='REMOVE'?amountY.toString():'0',claimedXRaw:kind==='CLAIM'?amountX.toString():'0',claimedYRaw:kind==='CLAIM'?amountY.toString():'0',networkFeeRaw:fee.toString(),rentLockedRaw:rent>0n?rent.toString():'0',rentRecoveredRaw:rent<0n?(-rent).toString():'0',decisionReady:false,executionReady:false};
 }catch(e){return fail(/^[A-Z0-9_]+$/.test(e.message)?e.message:'RECONCILIATION_FAILED')}
}
export function assembleLedger({pool,position,owner,mintX,mintY,observations}){
 assert(Array.isArray(observations)&&observations.length<=20000,'LEDGER_INPUT_INVALID');
 const bySig=new Map(),conflicts=new Set(),gaps=[];
 for(const x of observations){
  if(typeof x?.signature!=='string'){gaps.push({reason:'SIGNATURE_MISSING'});continue}
  const old=bySig.get(x.signature);
  if(old&&JSON.stringify(old)!==JSON.stringify(x)){conflicts.add(x.signature);gaps.push({signature:x.signature,reason:'DUPLICATE_EVIDENCE_CONFLICT'});continue}
  bySig.set(x.signature,x);
 }
 const rows=[...bySig.values()].sort((a,b)=>a.slot-b.slot||a.txIndex-b.txIndex);
 for(const x of rows)if(x.status!=='TRANSACTION_DELTA_RECONCILED_UNVERIFIED')gaps.push({signature:x.signature,reason:x.reason??'TRANSACTION_BLOCKED'});
 const order=new Map();for(const x of rows){const k=x.slot+':'+x.txIndex;if(order.has(k)&&order.get(k)!==x.signature){conflicts.add(x.signature);conflicts.add(order.get(k));gaps.push({signature:x.signature,reason:'BLOCK_ORDER_CONFLICT'})}else order.set(k,x.signature)}
 const accepted=rows.filter(x=>x.status==='TRANSACTION_DELTA_RECONCILED_UNVERIFIED'&&!conflicts.has(x.signature)),fields=['depositXRaw','depositYRaw','withdrawXRaw','withdrawYRaw','claimedXRaw','claimedYRaw','networkFeeRaw','rentLockedRaw','rentRecoveredRaw'];
 const totals=Object.fromEntries(fields.map(k=>[k,accepted.reduce((n,x)=>n+raw(x[k]),0n).toString()]));
 return {schemaVersion:1,status:gaps.length?'PARTIAL_LEDGER':'BOUNDED_LEDGER_UNVERIFIED',pool,position,owner,mintX,mintY,decisionReady:false,executionReady:false,historyComplete:false,pnlReady:false,observedCount:rows.length,acceptedCount:accepted.length,rows:rows.map(x=>conflicts.has(x.signature)?{signature:x.signature,slot:x.slot,txIndex:x.txIndex,status:'BLOCKED',reason:'CONFLICTING_EVIDENCE'}:x),gaps,totals,limitations:['Bounded finalized RPC evidence only. Totals are observed flows, not full history or realized profit.','Rent lock/recovery separate from network cost. Failed transactions may incur network fee.']};
}

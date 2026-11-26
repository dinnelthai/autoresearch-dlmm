// Narrow observational interval reconciliation. Never a complete event stream or protocol replay.
import {assert,hash,poolAddress} from './research-contract.mjs';
import {classifySwapCandidate} from './paper-event-core.mjs';
import {feeEventDiagnostic} from './paper-fee-core.mjs';
const raw=(v,bits=128)=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<BigInt(bits)),'PAPER_RAW_INTEGER_INVALID');return BigInt(v)};
const fields=['amountXRaw','amountYRaw','priceQ64Raw','liquiditySupplyRaw','feeXPerTokenRaw','feeYPerTokenRaw'];
const orders=['openOrderAmountRaw','totalProcessingOrderAmountRaw','processedOrderRemainingAmountRaw'];
function bins(report){
 assert(report.status==='BITMAP_COVERAGE_CHECKED_UNVERIFIED'&&report.coverage?.expected===report.arrays?.length&&report.coverage?.decoded===report.arrays?.length&&report.coverage?.missing===0&&report.coverage?.unsupported===0&&report.arrays.length<=98,'PAPER_BIN_COVERAGE');
 const map=new Map();
 for(const a of report.arrays){
  assert([2,3].includes(a.version)&&a.bins?.length===70,'PAPER_BIN_VERSION');
  for(const b of a.bins){assert(Number.isSafeInteger(b.binId)&&!map.has(b.binId),'PAPER_BIN_ID');for(const k of fields)raw(b[k],k==='amountXRaw'||k==='amountYRaw'?64:128);assert(orders.every(k=>a.version===2?b[k]===null:raw(b[k],64)===0n),'PAPER_LIMIT_ORDER_STATE_UNSUPPORTED');map.set(b.binId,{...b,version:a.version})}
 }
 return map;
}
export function reconcileInterval({before,after,history,manifest}){
 const pool=before?.identity?.pool,lo=before?.identity?.slot,hi=after?.identity?.slot;
 const result={schemaVersion:1,scope:'PAPER_INTERVAL_DIAGNOSTIC_ONLY',pool:pool??null,fromSlot:lo??null,toSlot:hi??null,status:'BLOCKED',reason:null,modelEligible:false,coverageVerified:false,protocolExact:false,executionReady:false,pnlReady:false,changedBins:[],fills:[]};
 try{
  assert(poolAddress(pool)&&Number.isSafeInteger(lo)&&lo>=0&&Number.isSafeInteger(hi)&&hi>lo,'PAPER_INTERVAL_SCOPE');
  const a=before.identity,b=after.identity;
  for(const x of [before,after]){const i=x.identity,r=x.bins;assert(i.status==='IDENTITY_CHECKED_UNVERIFIED'&&i.orientation==='MEME_X_SOL_Y'&&hash(i.rawHash)&&r.rawHash===i.rawHash&&r.slot===i.slot&&r.pool===pool&&r.mintX===i.mintX&&r.mintY===i.mintY&&r.binStep===i.binStep&&r.activeId===i.activeId&&r.idlBlob===i.idlBlob&&r.sdkCommit===i.sdkCommit,'PAPER_SNAPSHOT_IDENTITY')}
  assert(['pool','mintX','mintY','vaultX','vaultY','binStep','idlBlob','sdkCommit'].every(k=>a[k]===b[k])&&a.sides?.length===2&&b.sides?.length===2&&a.sides.every((x,i)=>x.mint===b.sides[i].mint&&x.vault===b.sides[i].vault&&x.decimals===b.sides[i].decimals),'PAPER_SNAPSHOT_SCOPE_CHANGED');
  const A=bins(before.bins),B=bins(after.bins);assert(A.size===B.size&&[...A.keys()].every(id=>B.has(id)),'PAPER_BIN_SET_CHANGED');
  for(const [id,x] of A){
   const y=B.get(id);assert(x.version===y.version&&x.priceQ64Raw===y.priceQ64Raw,'PAPER_BIN_LAYOUT_CHANGED');
   if(!fields.every(k=>x[k]===y[k]))result.changedBins.push({bin:id,deltaXRaw:(raw(y.amountXRaw)-raw(x.amountXRaw)).toString(),deltaYRaw:(raw(y.amountYRaw)-raw(x.amountYRaw)).toString(),supplyBeforeRaw:x.liquiditySupplyRaw,supplyAfterRaw:y.liquiditySupplyRaw,feeGrowthXDeltaRaw:(raw(y.feeXPerTokenRaw)-raw(x.feeXPerTokenRaw)).toString(),feeGrowthYDeltaRaw:(raw(y.feeYPerTokenRaw)-raw(x.feeYPerTokenRaw)).toString()});
  }
  assert(manifest?.pool===pool&&manifest.position===null&&manifest.indexAddress===pool&&manifest.commitment==='finalized'&&manifest.before===null&&manifest.status==='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED'&&Array.isArray(manifest.gaps)&&manifest.gaps.length===0&&history?.pool===pool&&history.position===null&&history.status==='EVENTS_DECODED_UNVERIFIED'&&history.indexEvidence?.coverageVerified===false&&Array.isArray(history.gaps)&&history.gaps.length===0&&Array.isArray(manifest.signatures)&&Array.isArray(history.transactions)&&Array.isArray(history.events),'PAPER_HISTORY_UNVERIFIED');
  const txs=new Map(history.transactions.map(t=>[t.signature,t]));assert(txs.size===history.transactions.length&&txs.size===manifest.signatures.length&&manifest.signatures.every(s=>{const t=txs.get(s.signature);return t&&t.slot===s.slot&&t.success===(s.err===null)}),'PAPER_HISTORY_TX_MISMATCH');
  // Strict bracketing: an observed older signature and a newer signature outside the snapshot range.
  assert(manifest.signatures.some(s=>s.slot<lo)&&manifest.signatures.some(s=>s.slot>hi)&&!manifest.signatures.some(s=>s.slot===lo||s.slot===hi),'PAPER_HISTORY_NOT_STRICTLY_BRACKETED');
  const tx=history.transactions.filter(t=>t.slot>lo&&t.slot<hi&&t.success);
  assert(tx.length===1,'PAPER_INTERVAL_NOT_SINGLE_SUCCESSFUL_TX');
  const rows=history.events.filter(e=>e.slot>lo&&e.slot<hi);assert(rows.length===1&&rows[0].signature===tx[0].signature,'PAPER_INTERVAL_NOT_SINGLE_SWAP');
  const e=rows[0],candidate=classifySwapCandidate(e,tx[0]);assert(candidate.status==='SINGLE_BIN_FEE_CANDIDATE_ONLY'&&e.feeOnInput===true&&raw(e.hostFeeRaw,64)===0n,'PAPER_SINGLE_BIN_INPUT_FEE_REQUIRED');
  assert(result.changedBins.length===1&&result.changedBins[0].bin===candidate.bin&&a.activeId===candidate.bin&&b.activeId===candidate.bin,'PAPER_OTHER_BIN_OR_ACTIVE_CHANGE');
  const d=result.changedBins[0],x=A.get(d.bin),y=B.get(d.bin);
  assert(x.liquiditySupplyRaw===y.liquiditySupplyRaw&&raw(x.liquiditySupplyRaw)>0n&&raw(x.priceQ64Raw)>0n,'PAPER_LIQUIDITY_SUPPLY_CHANGED');
  const dx=BigInt(d.deltaXRaw),dy=BigInt(d.deltaYRaw),gx=BigInt(d.feeGrowthXDeltaRaw),gy=BigInt(d.feeGrowthYDeltaRaw);
  const gross=raw(e.amountInRaw,64),out=raw(e.amountOutRaw,64),mm=raw(e.mmFeeRaw,64),protocol=raw(e.protocolFeeRaw,64),net=gross-mm-protocol;
  assert(net>0n&&mm>0n&&out>0n&&(e.swapForY?dx===net&&dy===-out&&gx>0n&&gy===0n:dy===net&&dx===-out&&gy>0n&&gx===0n),'PAPER_PRINCIPAL_OR_FEE_GROWTH_MISMATCH');
  const v=tx[0];for(const [index,k] of [[0,'vaultX'],[1,'vaultY']]){const t=v[k];assert(v.vaultStatus==='DELTA_OBSERVED_NOT_RECONCILED'&&t?.mint===a.sides[index].mint&&raw(t.preRaw,64)===raw(a.sides[index].vaultAmountRaw,64)&&raw(t.postRaw,64)===raw(b.sides[index].vaultAmountRaw,64)&&BigInt(t.deltaRaw)===raw(t.postRaw,64)-raw(t.preRaw,64),'PAPER_VAULT_BOUNDARY_MISMATCH')}
  assert(e.swapForY?BigInt(v.vaultX.deltaRaw)===gross&&BigInt(v.vaultY.deltaRaw)===-out:BigInt(v.vaultY.deltaRaw)===gross&&BigInt(v.vaultX.deltaRaw)===-out,'PAPER_VAULT_EVENT_MISMATCH');
  result.status='SINGLE_BIN_PRINCIPAL_MATCHED_UNVERIFIED';result.reason='FEE_GROWTH_UNITS_AND_COVERAGE_REQUIRE_INDEPENDENT_REVIEW';
  // Raw facts only; not a PER_BIN_RECONCILED model fill.
  result.candidate={signature:e.signature,slot:e.slot,txIndex:e.txIndex,bin:d.bin,side:candidate.side,basePrincipalRaw:(e.swapForY?dx:-dx).toString(),mmFeeRaw:e.mmFeeRaw,feeToken:e.feeToken,preBin:x,postBin:y};
  result.feeCalibration=feeEventDiagnostic(result.candidate);
 }catch(e){result.reason=/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'PAPER_INTERVAL_INVALID'}
 return result;
}

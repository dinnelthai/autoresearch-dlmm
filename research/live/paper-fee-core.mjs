// SDK position fee checkpoint arithmetic + explicitly hypothetical dilution model.
import {IntegerKernel as K} from '../integer.mjs';
import {assert,hash,poolAddress,errorCode} from './research-contract.mjs';
const raw=(v,bits=128)=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<BigInt(bits)),'PAPER_FEE_RAW_INVALID');return BigInt(v)};
const text=v=>v.toString();
const SCOPE='PAPER_FEE_GROWTH_DIAGNOSTIC_ONLY';
const limits=['openOrderAmountRaw','totalProcessingOrderAmountRaw','processedOrderRemainingAmountRaw'];
function snapshotRows(s){
 const i=s?.identity,b=s?.bins;
 assert(i?.status==='IDENTITY_CHECKED_UNVERIFIED'&&i.orientation==='MEME_X_SOL_Y'&&poolAddress(i.pool)&&poolAddress(i.mintX)&&poolAddress(i.mintY)&&i.mintX!==i.mintY&&Number.isSafeInteger(i.slot)&&i.slot>=0&&hash(i.rawHash)&&i.sdkCommit===K.SDK_COMMIT&&b?.status==='BITMAP_COVERAGE_CHECKED_UNVERIFIED'&&['pool','slot','rawHash','mintX','mintY','binStep','activeId','sdkCommit','idlBlob'].every(k=>i[k]===b[k]),'PAPER_FEE_SNAPSHOT_SCOPE');
 assert(Array.isArray(b.arrays)&&b.arrays.length<=98&&b.coverage?.expected===b.arrays.length&&b.coverage?.decoded===b.arrays.length&&b.coverage?.missing===0&&b.coverage?.unsupported===0,'PAPER_FEE_BIN_COVERAGE');
 const map=new Map();
 for(const a of b.arrays){assert([2,3].includes(a.version)&&Array.isArray(a.bins)&&a.bins.length===70,'PAPER_FEE_BIN_LAYOUT');for(const r of a.bins){assert(Number.isSafeInteger(r.binId)&&!map.has(r.binId),'PAPER_FEE_BIN_ID');map.set(r.binId,{...r,version:a.version})}}
 return {identity:i,map};
}
// Existing-share entitlement arithmetic, not a real ownership claim.
export function checkpointFees(binId,share,from,to){
 return K.positionBin({binId,share:text(share),supply:text(share),amountX:'0',amountY:'0',feeGrowthX:text(to.x),feeGrowthY:text(to.y),checkpointX:text(from.x),checkpointY:text(from.y),pendingX:'0',pendingY:'0'});
}
export function estimateFeeGrowth({before,after,allocation}){
 const result={schemaVersion:1,scope:SCOPE,status:'BLOCKED',reason:null,pool:before?.identity?.pool??null,fromSlot:before?.identity?.slot??null,toSlot:after?.identity?.slot??null,modelEligible:false,coverageVerified:false,protocolExact:false,executionReady:false,pnlReady:false,rows:[],totals:null};
 try{
  const A=snapshotRows(before),B=snapshotRows(after),a=A.identity,b=B.identity;
  assert(b.slot>a.slot&&['pool','mintX','mintY','vaultX','vaultY','binStep','sdkCommit','idlBlob'].every(k=>a[k]===b[k]),'PAPER_FEE_SNAPSHOT_SCOPE_CHANGED');
  assert(allocation?.schemaVersion===1&&allocation.pool===a.pool&&allocation.mintX===a.mintX&&allocation.mintY===a.mintY&&allocation.openingSlot===a.slot&&allocation.openingRawHash===a.rawHash&&Array.isArray(allocation.shares)&&allocation.shares.length>0&&allocation.shares.length<=256,'PAPER_FEE_ALLOCATION_SCOPE');
  const seen=new Set(),totals={observedX:0n,observedY:0n,dilutedX:0n,dilutedY:0n};let allDiluted=true;
  for(const item of allocation.shares){
   const id=item.binId;assert(Number.isSafeInteger(id)&&!seen.has(id),'PAPER_FEE_DUPLICATE_BIN');seen.add(id);
   const x=A.map.get(id),y=B.map.get(id);assert(x&&y&&x.version===y.version&&x.priceQ64Raw===y.priceQ64Raw&&raw(x.priceQ64Raw)>0n,'PAPER_FEE_BIN_MISSING_OR_CHANGED');
   assert([x,y].every(r=>limits.every(k=>r.version===2?r[k]===null:raw(r[k],64)===0n)),'PAPER_FEE_LIMIT_ORDER_UNSUPPORTED');
   const share=raw(item.shareRaw),s0=raw(x.liquiditySupplyRaw),s1=raw(y.liquiditySupplyRaw);
   assert(share>0n&&s0>0n&&s1>0n&&share*10n<=s0&&share*10n<=s1,'PAPER_FEE_SHARE_LIMIT');
   const from={x:raw(x.feeXPerTokenRaw),y:raw(x.feeYPerTokenRaw)},to={x:raw(y.feeXPerTokenRaw),y:raw(y.feeYPerTokenRaw)};
   assert(to.x>=from.x&&to.y>=from.y,'PAPER_FEE_GROWTH_REGRESSED');
   const delta={x:to.x-from.x,y:to.y-from.y};
   const observed=checkpointFees(id,share,from,to);
   // Constant external supply + frozen fee-flow sensitivity only. Endpoint equality does not establish intra-interval constancy.
   let diluted=null;
   if(s0===s1){const growth={x:delta.x*s0/(s0+share),y:delta.y*s0/(s0+share)};diluted=checkpointFees(id,share,{x:0n,y:0n},growth);totals.dilutedX+=diluted.feeX;totals.dilutedY+=diluted.feeY}else allDiluted=false;
   totals.observedX+=observed.feeX;totals.observedY+=observed.feeY;
   result.rows.push({binId:id,shareRaw:text(share),supplyBeforeRaw:text(s0),supplyAfterRaw:text(s1),growthXDeltaRaw:text(delta.x),growthYDeltaRaw:text(delta.y),observedShareFeeXRaw:text(observed.feeX),observedShareFeeYRaw:text(observed.feeY),dilutedFeeXRaw:diluted?text(diluted.feeX):null,dilutedFeeYRaw:diluted?text(diluted.feeY):null,dilutionStatus:diluted?'CONSTANT_SUPPLY_ASSUMPTION_ONLY':'ENDPOINT_SUPPLY_CHANGED'});
  }
  result.status='PAPER_FEE_ESTIMATES_UNVERIFIED';result.reason=allDiluted?'FROZEN_FEE_FLOW_ASSUMPTION':'DILUTION_UNAVAILABLE_FOR_CHANGED_SUPPLY';
  result.totals={observedXRaw:text(totals.observedX),observedYRaw:text(totals.observedY),dilutedXRaw:allDiluted?text(totals.dilutedX):null,dilutedYRaw:allDiluted?text(totals.dilutedY):null};
 }catch(e){result.reason=errorCode(e,'PAPER_FEE_INPUT_INVALID');result.rows=[];result.totals=null}
 return {...result,limitations:['Shares are user-declared hypothetical fixed shares, not deposits, positions or claims. No proof of ex ante allocation.','SDK checkpoint arithmetic uses observed growth; virtual addition changes denominator and potentially trade paths. Diluted estimate assumes constant external supply and unchanged total fee flow; equal endpoints do not prove this.','No missing intermediate state, liquidity changes, principal attribution, operating costs, markout, exit valuation or PnL inferred.','Not a bound on realized fees, not a complete history or protocol replay.']};
}
// Compare observed market-supply entitlement to a single event fee as a calibration diagnostic.
export function feeEventDiagnostic(candidate){
 const a=candidate.preBin,b=candidate.postBin,share=raw(a.liquiditySupplyRaw);
 assert(share>0n&&share===raw(b.liquiditySupplyRaw)&&['X','Y'].includes(candidate.feeToken),'PAPER_FEE_CALIBRATION_SCOPE');
 const from={x:raw(a.feeXPerTokenRaw),y:raw(a.feeYPerTokenRaw)},to={x:raw(b.feeXPerTokenRaw),y:raw(b.feeYPerTokenRaw)};
 assert(to.x>=from.x&&to.y>=from.y,'PAPER_FEE_GROWTH_REGRESSED');
 const calc=checkpointFees(candidate.bin,share,from,to),observed=candidate.feeToken==='X'?calc.feeX:calc.feeY,event=raw(candidate.mmFeeRaw,64);
 return {status:'MARKET_SUPPLY_CHECKPOINT_COMPARISON_ONLY',feeToken:candidate.feeToken,eventMmFeeRaw:text(event),wholeSupplyCheckpointFeeRaw:text(observed),differenceRaw:text(observed-event),protocolExact:false,modelEligible:false};
}

// Compare the paper proxy to isolated unsigned program simulation, conditional on actual deposits.
import {proportionalShare} from './paper-share-core.mjs';
import {assert,errorCode} from './research-contract.mjs';
const raw=v=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<128n),'PAPER_CALIBRATION_RAW');return BigInt(v)};
const abs=n=>n<0n?-n:n;
function metric(proxy,observed){const d=proxy-observed;return {proxyRaw:String(proxy),observedRaw:String(observed),differenceRaw:String(d),absoluteErrorBps:observed?String((abs(d)*10000n+observed-1n)/observed):d===0n?'0':null}}
function within(m,t){return m.absoluteErrorBps!==null&&BigInt(m.absoluteErrorBps)<=BigInt(t)}
export function calibratePaperOpening({simulation,bins,activeId,tolerance,declaredCostRaw}){
 const out={schemaVersion:1,scope:'LOCAL_UNSIGNED_PAPER_OPEN_CALIBRATION_ONLY',status:'BLOCKED',reason:null,rows:[],executionReady:false,decisionReady:false,pnlReady:false,protocolExact:false,calibrated:false,programBinaryVerified:false,feeGrowthCalibrated:false,inventoryPathCalibrated:false};
 try{
  assert(simulation?.status==='LOCAL_SIMULATION_RECONCILED_UNVERIFIED'&&simulation.executionReady===false&&simulation.signingAvailable===false&&Array.isArray(simulation.blockers)&&simulation.blockers.length===0,'PAPER_CALIBRATION_SIMULATION_NOT_RECONCILED');
  assert(Number.isSafeInteger(activeId)&&tolerance&&['shareErrorBps','principalErrorBps','costErrorBps'].every(k=>Number.isInteger(tolerance[k])&&tolerance[k]>=0&&tolerance[k]<=10000),'PAPER_CALIBRATION_TOLERANCE_REQUIRED');
  assert(Array.isArray(bins)&&bins.length>0&&bins.length<=140&&new Set(bins.map(b=>b.binId)).size===bins.length,'PAPER_CALIBRATION_BIN_SCOPE');
  const simRows=new Map(simulation.rows.map(r=>[r.binId,r]));assert(simRows.size===bins.length&&simulation.rows.length===bins.length,'PAPER_CALIBRATION_SIM_ROWS');
  const rows=[];
  for(const b of bins){
   const r=simRows.get(b.binId);assert(r,'PAPER_CALIBRATION_SIM_ROW_MISSING');
   const x=raw(b.beforeX),y=raw(b.beforeY),ax=raw(b.afterX),ay=raw(b.afterY),s=raw(b.beforeSupply),s1=raw(b.supply),actualShare=raw(b.share);
   assert(ax>=x&&ay>=y&&s1>=s&&s1-s===actualShare&&actualShare<=s1&&raw(r.depositXRaw)===ax-x&&raw(r.depositYRaw)===ay-y,'PAPER_CALIBRATION_DELTA_MISMATCH');
   const dx=ax-x,dy=ay-y;
   if(!dx&&!dy&&!actualShare)continue;
   const px=s1?actualShare*ax/s1:0n,py=s1?actualShare*ay/s1:0n;
   assert(raw(r.principalXRaw)===px&&raw(r.principalYRaw)===py,'PAPER_CALIBRATION_PRINCIPAL_MISMATCH');
   try{
    const proxy=proportionalShare({binId:b.binId,version:b.version,amountXRaw:b.beforeX,amountYRaw:b.beforeY,liquiditySupplyRaw:b.beforeSupply,priceQ64Raw:b.priceQ64Raw,openOrderAmountRaw:b.openOrderAmountRaw,totalProcessingOrderAmountRaw:b.totalProcessingOrderAmountRaw,processedOrderRemainingAmountRaw:b.processedOrderRemainingAmountRaw},{binId:b.binId,memeRaw:String(dx),solRaw:String(dy)},activeId);
    const share=metric(raw(proxy.shareRaw),actualShare),principalX=metric(raw(proxy.openingPrincipalXRaw),px),principalY=metric(raw(proxy.openingPrincipalYRaw),py);
    // Separately measure the observation-path principal used by the live snapshot runner.
    const observedPathX=metric(raw(proxy.shareRaw)*x/s,px),observedPathY=metric(raw(proxy.shareRaw)*y/s,py);
    rows.push({binId:b.binId,status:[within(share,tolerance.shareErrorBps),within(principalX,tolerance.principalErrorBps),within(principalY,tolerance.principalErrorBps),within(observedPathX,tolerance.principalErrorBps),within(observedPathY,tolerance.principalErrorBps)].every(Boolean)?'WITHIN_DECLARED_TOLERANCE':'OUTSIDE_DECLARED_TOLERANCE',share,principalX,principalY,observedPathX,observedPathY});
   }catch(e){rows.push({binId:b.binId,status:'PROXY_UNSUPPORTED',reason:errorCode(e,'PAPER_CALIBRATION_PROXY_UNSUPPORTED')})}
  }
  assert(rows.length>0,'PAPER_CALIBRATION_NO_DEPOSITS');
  const cost=metric(raw(declaredCostRaw),raw(simulation.feeRaw)),rent=raw(simulation.positionRentRaw);
  assert(raw(simulation.nativeDebitRaw)===raw(simulation.feeRaw)+rent,'PAPER_CALIBRATION_NATIVE_DEBIT');
  out.rows=rows;out.cost={transactionFee:cost,positionRentRaw:String(rent),nativeDebitRaw:simulation.nativeDebitRaw,rentTreatedAsExpense:false,withinTolerance:within(cost,tolerance.costErrorBps)};
  out.tolerance=tolerance;
  out.status=rows.every(r=>r.status==='WITHIN_DECLARED_TOLERANCE')&&out.cost.withinTolerance?'LOCAL_OPEN_SAMPLE_WITHIN_TOLERANCE_UNVERIFIED':'LOCAL_OPEN_SAMPLE_DISCREPANCIES';
 }catch(e){out.reason=errorCode(e,'PAPER_CALIBRATION_INVALID');out.rows=[]}
 return {...out,limitations:['One local unsigned opening simulation, conditional on program-observed deposit amounts; not a proof of exact minting, intended allocation or real-world execution.','Simulated post-state principal uses share/supply redemption arithmetic, not a separately executed withdrawal.','Transaction fee and rent are separate; no claim of rent recovery, subsequent swap/fee growth, inventory path or rebalance cost calibration.','No global model calibration or readiness promotion; program binary provenance and independent acceptance remain required.']};
}

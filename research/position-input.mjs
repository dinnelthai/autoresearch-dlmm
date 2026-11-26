import {IntegerKernel as K} from './integer.mjs';
function normalizePosition(snapshot,request,events,config={}){
  if(request.entry!=="position")throw Error("integer snapshot requires existing LP entry");
  if(request.positionBins||request.pendingFeeX!=null||request.pendingFeeY!=null)throw Error("use one position source; duplicate initial inventory/fees forbidden");
  if(request.pool!==snapshot.pool)throw Error("snapshot/request pool mismatch");
  if(snapshot.tokenOrientation!=="MEME_X_SOL_Y")throw Error("explicit MEME X / SOL Y orientation required");
  if(snapshot.tokenExtensions!==false)throw Error("snapshot adapter does not support token extensions");
  if(!Number.isInteger(snapshot.decimalsX)||snapshot.decimalsX<0||snapshot.decimalsX>18||snapshot.decimalsY!==9)throw Error("invalid mint decimals");
  if(!Number.isFinite(snapshot.asOf)||snapshot.asOf<0)throw Error("snapshot asOf required");
  if(!Array.isArray(events)||!events.length||events.some(e=>!Number.isFinite(e.t)||e.t<=snapshot.asOf))throw Error("all replay events must be strictly after snapshot boundary");
  if(events.some(e=>e.pool&&e.pool!==snapshot.pool))throw Error("snapshot/event pool mismatch");
  if(typeof snapshot.binStep!=="string"||!/^\d+$/.test(snapshot.binStep))throw Error("snapshot bin step must be decimal integer string");
  const binStepBps=Number(snapshot.binStep);
  if(!Number.isInteger(binStepBps)||binStepBps<1||binStepBps>65535)throw Error("invalid bin step");
  const anchorPrice=Number(`1e${snapshot.decimalsX-snapshot.decimalsY}`);
  if(config.binStepBps!=null&&config.binStepBps!==binStepBps||config.anchorPrice!=null&&config.anchorPrice!==anchorPrice)throw Error("snapshot price grid conflicts with config");
  const reconciliation=K.reconcile(snapshot);
  if(reconciliation.status==="MISMATCH")throw Error("integer position snapshot mismatch");
  function human(v,d){if(v>BigInt(Number.MAX_SAFE_INTEGER))throw Error("raw balance exceeds safe float bridge; integer-only report required");return Number(v)/10**d;}
  const normalized={...request,positionBins:reconciliation.rows.map(b=>({id:b.binId,x:human(b.principalX,snapshot.decimalsX),y:human(b.principalY,snapshot.decimalsY)})),pendingFeeX:human(reconciliation.totals.feeX,snapshot.decimalsX),pendingFeeY:human(reconciliation.totals.feeY,snapshot.decimalsY)};
  return {request:normalized,config:{...config,binStepBps,anchorPrice},evidence:JSON.parse(K.stringify(reconciliation)),fidelity:"INTEGER_SNAPSHOT_TO_FLOATING_NORMALIZED_REPLAY_UNVERIFIED"};
}
export {normalizePosition};

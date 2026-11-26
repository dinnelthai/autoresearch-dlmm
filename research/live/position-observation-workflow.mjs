// Read-only position accounting workflow. All outputs are conditional diagnostics.
const assert=(v,m)=>{if(!v)throw Error(m)},hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),raw=v=>typeof v==='string'&&/^\d{1,80}$/.test(v);
const fields=['depositXRaw','depositYRaw','withdrawXRaw','withdrawYRaw','claimedXRaw','claimedYRaw','networkFeeRaw','rentLockedRaw','rentRecoveredRaw'];
export function positionObservation(detail,market,receivedAt){
 const p=detail?.snapshot;
 assert(p&&['POSITION_CALCULATED_UNVERIFIED','V2_POSITION_OBSERVATION_UNVERIFIED'].includes(detail.status)&&p.status===detail.status&&p.pool===detail.pool&&p.owner===detail.wallet&&p.position===detail.position&&p.slot===detail.slot&&hash(p.rawHash)&&Number.isSafeInteger(receivedAt),'OBSERVATION_POSITION_INVALID');
 assert(p.snapshot?.pool===p.pool&&p.snapshot.position===p.position&&p.snapshot.slot===p.slot&&Number.isInteger(p.snapshot.decimalsX)&&p.snapshot.decimalsX>=0&&p.snapshot.decimalsX<=18&&p.snapshot.decimalsY===9&&[p.currentPrincipalRaw?.x,p.currentPrincipalRaw?.y,p.pendingFeeRaw?.x,p.pendingFeeRaw?.y].every(raw),'OBSERVATION_ACCOUNTING_INVALID');
 assert(market?.pool===p.pool&&market.decimalsX===p.snapshot.decimalsX&&market.decimalsY===9,'OBSERVATION_MARKET_MISMATCH');
 return {scope:'POSITION_OBSERVATION_ONLY',pool:p.pool,owner:p.owner,position:p.position,slot:p.slot,rawHash:p.rawHash,mintX:market.mintX,mintY:market.mintY,decimalsX:p.snapshot.decimalsX,receivedAt,positionStatus:p.status,principal:p.currentPrincipalRaw,pending:p.pendingFeeRaw,range:{lower:p.lowerBinId,upper:p.upperBinId},commonMarketCapture:market.slot===p.slot&&market.rawHash===p.rawHash,decisionReady:false,executionReady:false,pnlReady:false};
}
export function ledgerProjection(l,identity){
 assert(l?.pool===identity.pool&&l.owner===identity.owner&&l.position===identity.position&&l.mintX===identity.mintX&&l.mintY===identity.mintY&&l.decimalsX===identity.decimalsX&&l.decimalsY===9&&['BOUNDED_LEDGER_UNVERIFIED','PARTIAL_LEDGER'].includes(l.status)&&l.historyComplete===false&&l.pnlReady===false&&l.decisionReady===false&&l.executionReady===false,'LEDGER_WORKFLOW_IDENTITY');
 assert(Number.isSafeInteger(l.observedCount)&&Number.isSafeInteger(l.acceptedCount)&&l.acceptedCount>=0&&l.acceptedCount<=l.observedCount&&Array.isArray(l.rows)&&l.rows.length===l.observedCount&&Array.isArray(l.gaps)&&Array.isArray(l.archiveGaps)&&fields.every(k=>raw(l.totals?.[k])),'LEDGER_WORKFLOW_INVALID');
 return {status:l.status,observedCount:l.observedCount,acceptedCount:l.acceptedCount,gapCount:l.gaps.length+l.archiveGaps.length,totals:Object.fromEntries(fields.map(k=>[k,l.totals[k]])),historyComplete:false,pnlReady:false};
}
export function windowLedger(l,openingSlot,closingSlot,assemble){
 assert(l.status==='BOUNDED_LEDGER_UNVERIFIED'&&!l.gaps.length&&!l.archiveGaps.length&&Number.isSafeInteger(openingSlot)&&Number.isSafeInteger(closingSlot)&&openingSlot<closingSlot,'WINDOW_LEDGER_BLOCKED');
 // A bounded sample must bracket the opening slot; this is not a proof of coverage.
 assert(l.rows.some(r=>r.slot<=openingSlot),'WINDOW_OPENING_NOT_BRACKETED');
 const rows=l.rows.filter(r=>r.slot>openingSlot&&r.slot<=closingSlot);
 assert(rows.length>0,'WINDOW_NO_RECONCILED_FLOWS');
 const out=assemble({pool:l.pool,position:l.position,owner:l.owner,mintX:l.mintX,mintY:l.mintY,observations:rows});
 return {...out,archiveGaps:[],decimalsX:l.decimalsX,decimalsY:l.decimalsY,sources:l.sources,identityCapture:l.identityCapture,limitations:[...out.limitations,'Opening slot bracket only; not proof of complete window coverage.']};
}

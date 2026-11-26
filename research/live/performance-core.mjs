// T16 bounded-window accounting diagnostic; never upgrades unverified evidence.
const assert=(v,m)=>{if(!v)throw Error(m)};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,80}$/.test(v),'PERF_RAW_INVALID');return BigInt(v)};
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const fields=['depositXRaw','depositYRaw','withdrawXRaw','withdrawYRaw','claimedXRaw','claimedYRaw','networkFeeRaw','rentLockedRaw','rentRecoveredRaw'];
const decimal=(n,d)=>{const neg=n<0n;let s=(neg?-n:n).toString().padStart(d+1,'0');const f=s.slice(-d).replace(/0+$/,'');return (neg?'-':'')+s.slice(0,-d)+(f?'.'+f:'')};
function snapshot(p,l){
 assert(p?.status==='POSITION_CALCULATED_UNVERIFIED'&&p.pool===l.pool&&p.position===l.position&&p.owner===l.owner&&hash(p.rawHash)&&Number.isSafeInteger(p.slot),'PERF_SNAPSHOT_IDENTITY');
 const s=p.snapshot,a=p.accounting;
 assert(s?.pool===l.pool&&s.position===l.position&&s.slot===p.slot&&s.tokenOrientation==='MEME_X_SOL_Y'&&s.tokenExtensions===false&&s.decimalsX===l.decimalsX&&s.decimalsY===9&&a?.status==='CALCULATED_UNVERIFIED'&&a.protocolReplayVerified===false&&a.pool===l.pool&&a.position===l.position&&a.slot===p.slot&&Array.isArray(a.rows)&&a.rows.length>0&&a.rows.length<=1500&&a.rows.length===p.upperBinId-p.lowerBinId+1,'PERF_SNAPSHOT_ACCOUNTING');
 const keys=['principalX','principalY','feeX','feeY'],sums=Object.fromEntries(keys.map(k=>[k,0n])),seen=new Set();
 for(const b of a.rows){assert(Number.isSafeInteger(b.binId)&&b.binId>=p.lowerBinId&&b.binId<=p.upperBinId&&!seen.has(b.binId),'PERF_BIN_ID');seen.add(b.binId);for(const k of keys)sums[k]+=raw(b[k])}
 for(const [k,v] of Object.entries({principalX:p.currentPrincipalRaw.x,principalY:p.currentPrincipalRaw.y,feeX:p.pendingFeeRaw.x,feeY:p.pendingFeeRaw.y}))assert(raw(v)===sums[k]&&raw(a.totals[k])===sums[k],'PERF_SNAPSHOT_SUM_MISMATCH');
 return {...sums,claimedX:raw(p.claimedLifetimeRaw.x),claimedY:raw(p.claimedLifetimeRaw.y)};
}
// Price integer = SOL per human MEME * 10^18. Source independence remains a review assertion.
export function mark(m,l,time,slot,policy){
 assert(m?.pool===l.pool&&m.mintX===l.mintX&&m.mintY===l.mintY&&m.slot===slot&&m.asOf===time&&hash(m.evidenceHash)&&Array.isArray(m.references)&&m.references.length===2,'PERF_MARK_IDENTITY');
 const [a,b]=m.references;
 assert([a,b].every(r=>r.pool!==l.pool&&typeof r.pool==='string'&&typeof r.source==='string'&&r.source&&typeof r.venue==='string'&&r.venue&&hash(r.evidenceHash)&&Number.isSafeInteger(r.observedAt)&&Number.isSafeInteger(r.availableAt)&&r.observedAt<=r.availableAt&&r.availableAt<=time&&time-r.observedAt<=policy.maxAgeSeconds),'PERF_MARK_TIME');
 assert(a.pool!==b.pool&&a.source!==b.source&&a.venue!==b.venue&&a.evidenceHash!==b.evidenceHash,'PERF_MARK_INDEPENDENCE');
 const x=raw(a.priceE18),y=raw(b.priceE18),lo=x<y?x:y,hi=x>y?x:y;
 assert(lo>0n&&(hi-lo)*10000n<=lo*BigInt(policy.maxSpreadBps),'PERF_MARK_SPREAD');
 return (x+y)/2n;
}
export function calculateWindow({ledger:l,opening,closing,marks,policy,bindings}){
 const blocked=reason=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,pnlReady:false});
 try{
  assert(l?.schemaVersion===1&&l.status==='BOUNDED_LEDGER_UNVERIFIED'&&l.historyComplete===false&&l.pnlReady===false&&l.decisionReady===false&&l.executionReady===false&&Array.isArray(l.rows)&&l.rows.length>0&&l.rows.length<=20000&&l.rows.length===l.acceptedCount&&!l.gaps?.length&&!l.archiveGaps?.length,'PERF_LEDGER_INCOMPLETE');
  assert(Number.isInteger(l.decimalsX)&&l.decimalsX>=0&&l.decimalsX<=18&&l.decimalsY===9,'PERF_DECIMALS');
  assert(policy?.scope==='EXISTING_POSITION_WINDOW_RETAIN_DISTRIBUTIONS'&&Number.isInteger(policy.maxAgeSeconds)&&policy.maxAgeSeconds>0&&policy.maxAgeSeconds<=600&&Number.isInteger(policy.maxSpreadBps)&&policy.maxSpreadBps>=0&&policy.maxSpreadBps<=10000,'PERF_POLICY_REQUIRED');
  assert(bindings&&['ledgerHash','openingHash','closingHash','marksHash'].every(k=>hash(bindings[k])),'PERF_BINDINGS_REQUIRED');
  const o=snapshot(opening,l),c=snapshot(closing,l);
  assert(opening.slot<closing.slot&&marks?.opening?.snapshotRawHash===opening.rawHash&&marks?.closing?.snapshotRawHash===closing.rawHash&&Number.isSafeInteger(marks.opening.asOf)&&Number.isSafeInteger(marks.closing.asOf)&&marks.opening.asOf<marks.closing.asOf,'PERF_WINDOW_BOUNDARY');
  const op=mark(marks.opening,l,marks.opening.asOf,opening.slot,policy),cp=mark(marks.closing,l,marks.closing.asOf,closing.slot,policy);
  const scale=18+l.decimalsX,ys=10n**BigInt(scale-9),value=(x,y,p)=>x*p+y*ys;
  const sums=Object.fromEntries(fields.map(k=>[k,0n])),seen=new Set(),orders=new Set(),flowMarks=new Map();
  assert(Array.isArray(marks.flows)&&marks.flows.length<=l.rows.length,'PERF_FLOW_MARKS');
  for(const m of marks.flows){assert(typeof m.signature==='string'&&!flowMarks.has(m.signature),'PERF_FLOW_MARK_DUPLICATE');flowMarks.set(m.signature,m)}
  let costBasis=value(o.principalX+o.feeX,o.principalY+o.feeY,op),depositBasis=0n,failedFee=0n,priorSlot=opening.slot,priorIndex=-1,priorTime=marks.opening.asOf;
  for(const r of l.rows){
   assert(r.status==='TRANSACTION_DELTA_RECONCILED_UNVERIFIED'&&hash(r.transactionHash)&&typeof r.signature==='string'&&!seen.has(r.signature)&&Number.isSafeInteger(r.slot)&&r.slot>opening.slot&&r.slot<=closing.slot&&Number.isSafeInteger(r.txIndex)&&r.txIndex>=0&&(r.slot>priorSlot||r.slot===priorSlot&&r.txIndex>priorIndex)&&Number.isSafeInteger(r.blockTime)&&r.blockTime>=priorTime&&r.blockTime<=marks.closing.asOf,'PERF_FLOW_ORDER_OR_BOUNDARY');
   assert(!r.created&&!r.closed&&['ADD','REMOVE','CLAIM','FAILED_FEE_ONLY'].includes(r.kind),'PERF_LIFECYCLE_UNSUPPORTED');
   seen.add(r.signature);priorSlot=r.slot;priorIndex=r.txIndex;priorTime=r.blockTime;
   for(const k of fields)sums[k]+=raw(r[k]);
   assert(raw(r.rentLockedRaw)===0n&&raw(r.rentRecoveredRaw)===0n,'PERF_RENT_CHANGE_UNSUPPORTED');
   const dx=raw(r.depositXRaw),dy=raw(r.depositYRaw);
   if(dx||dy){const m=flowMarks.get(r.signature);assert(m?.transactionHash===r.transactionHash,'PERF_FLOW_MARK_MISSING');const p=mark(m,l,r.blockTime,r.slot,policy);depositBasis+=value(dx,dy,p);flowMarks.delete(r.signature)}
   if(r.kind==='FAILED_FEE_ONLY')failedFee+=raw(r.networkFeeRaw);
  }
  assert(flowMarks.size===0,'PERF_UNUSED_FLOW_MARK');
  for(const k of fields)assert(raw(l.totals[k])===sums[k],'PERF_LEDGER_SUM_MISMATCH');
  assert(c.claimedX-o.claimedX===sums.claimedXRaw&&c.claimedY-o.claimedY===sums.claimedYRaw,'PERF_CLAIM_COUNTER_MISMATCH');
  costBasis+=depositBasis;assert(costBasis>0n,'PERF_ZERO_CAPITAL');
  const nav=value(c.principalX+c.feeX,c.principalY+c.feeY,cp),principal=value(c.principalX,c.principalY,cp);
  const withdrawn=value(sums.withdrawXRaw,sums.withdrawYRaw,cp),claimed=value(sums.claimedXRaw,sums.claimedYRaw,cp);
  const feeContribution=value(c.feeX+sums.claimedXRaw-o.feeX,c.feeY+sums.claimedYRaw-o.feeY,cp);
  const hodl=value(o.principalX+o.feeX+sums.depositXRaw,o.principalY+o.feeY+sums.depositYRaw,cp);
  const cost=sums.networkFeeRaw*ys,wealth=nav+withdrawn+claimed-cost,pnl=wealth-costBasis,alpha=wealth-hodl,pricePnl=hodl-costBasis,inventoryEffect=alpha-feeContribution+cost;
  const metrics=Object.fromEntries(Object.entries({openingValue:costBasis-depositBasis,depositValue:depositBasis,capitalBasis:costBasis,closingNav:nav,closingPrincipal:principal,withdrawnValue:withdrawn,claimedValue:claimed,feeContribution,networkCost:cost,failedNetworkCost:failedFee*ys,terminalWealth:wealth,hodlTerminal:hodl,netPnl:pnl,hodlPnl:pricePnl,alpha,inventoryEffect,attributionResidual:pnl-pricePnl-inventoryEffect-feeContribution+cost}).map(([k,v])=>[k,decimal(v,scale)]));
  return {schemaVersion:1,status:'BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC',decisionReady:false,executionReady:false,pnlReady:false,historyComplete:false,pool:l.pool,position:l.position,owner:l.owner,mintX:l.mintX,mintY:l.mintY,openingSlot:opening.slot,closingSlot:closing.slot,openingRawHash:opening.rawHash,closingRawHash:closing.rawHash,openingTime:marks.opening.asOf,closingTime:marks.closing.asOf,bindings,observedCount:l.rows.length,metrics,limitations:['Conditional window only; history completeness, reference evidence semantics and protocol accounting not accepted.','All withdrawn assets and claimed fees retained to end mark; no off-position trades included. Opening pending fees belong to opening capital.','Rent excluded from this existing-position window; changes block. No capital-hour, annualized return or realized cash PnL claim.']};
 }catch(e){return blocked(/^[A-Z0-9_]+$/.test(e.message)?e.message:'PERF_VALIDATION_FAILED')}
}

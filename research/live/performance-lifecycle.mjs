// T16 B2: closed lifecycle cashflow valuation, conditional on bounded archived evidence.
import {mark} from './performance-core.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const raw=v=>{assert(typeof v==='string'&&/^\d{1,80}$/.test(v),'LIFE_RAW_INVALID');return BigInt(v)};
const fields=['depositXRaw','depositYRaw','withdrawXRaw','withdrawYRaw','claimedXRaw','claimedYRaw','networkFeeRaw','rentLockedRaw','rentRecoveredRaw'];
function decimal(n,d){const neg=n<0n;let s=(neg?-n:n).toString().padStart(d+1,'0');const f=s.slice(-d).replace(/0+$/,'');return (neg?'-':'')+s.slice(0,-d)+(f?'.'+f:'')}
// Verify the observed provider page chain, not provider completeness or network authenticity.
export function checkPageCoverage(ledger,archives){
 assert(Array.isArray(archives)&&archives.length>0&&archives.length<=20&&Array.isArray(ledger.sources)&&ledger.sources.length===archives.length,'LIFE_COVERAGE_INPUT');
 const expected=new Map(ledger.rows.map(r=>[r.signature,r])),seen=new Set(),sourceHashes=new Set();
 let cursor=null,priorSlot=Infinity,head=null,tail=null;
 for(let i=0;i<archives.length;i++){
  const {manifest:m,manifestHash,pages}=archives[i],source=ledger.sources[i];
  assert(hash(manifestHash)&&source.manifestHash===manifestHash&&!sourceHashes.has(manifestHash)&&m.schemaVersion===1&&m.pool===ledger.pool&&m.position===ledger.position&&m.indexAddress===ledger.position&&m.commitment==='finalized'&&m.status==='BOUNDED_SAMPLE_CAPTURED_UNVERIFIED'&&Array.isArray(m.gaps)&&!m.gaps.length&&m.before===cursor,'LIFE_CAPTURE_CHAIN');
  sourceHashes.add(manifestHash);
  assert(Array.isArray(pages)&&pages.length>=1&&pages.length<=20&&Number.isInteger(m.pageLimit)&&m.pageLimit>=1&&m.pageLimit<=1000&&Array.isArray(m.signatures),'LIFE_PAGE_SCHEMA');
  let terminal=false;const local=[];
  for(const [j,page] of pages.entries()){
   assert(!terminal&&page.before===cursor&&page.limit===m.pageLimit&&Array.isArray(page.rows)&&page.rows.length<=page.limit,'LIFE_PAGE_CURSOR');
   for(const row of page.rows){
    const e=expected.get(row.signature);
    assert(e&&!seen.has(row.signature)&&Number.isSafeInteger(row.slot)&&row.slot<=priorSlot&&e.slot===row.slot&&e.blockTime===row.blockTime&&e.success===(row.err===null),'LIFE_PAGE_ROW_MISMATCH');
    seen.add(row.signature);local.push({signature:row.signature,slot:row.slot,err:row.err,blockTime:row.blockTime});priorSlot=row.slot;head??=row.signature;tail=row.signature;
   }
   if(page.rows.length)cursor=page.rows.at(-1).signature;
   if(page.rows.length<page.limit){terminal=true;assert(j===pages.length-1,'LIFE_AFTER_TERMINAL_PAGE')}
  }
  assert(JSON.stringify(local)===JSON.stringify(m.signatures)&&m.nextBefore===cursor,'LIFE_MANIFEST_PAGE_MISMATCH');
  if(i<archives.length-1)assert(!terminal&&m.stopReason==='PAGE_BUDGET_OR_ERROR','LIFE_EARLY_TERMINATION');
  else assert(terminal&&['SHORT_PAGE','EMPTY_PAGE'].includes(m.stopReason),'LIFE_TAIL_NOT_OBSERVED');
 }
 assert(seen.size===expected.size&&seen.size===ledger.rows.length,'LIFE_COVERAGE_SET_MISMATCH');
 return {status:'PROVIDER_PAGE_CHAIN_OBSERVED_UNVERIFIED',head,tail,count:seen.size,sourceHashes:[...sourceHashes],historyComplete:false};
}
export function calculateLifecycle({ledger:l,archives,marks,policy,bindings}){
 const blocked=reason=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,pnlReady:false,historyComplete:false});
 try{
  assert(l?.schemaVersion===1&&l.status==='BOUNDED_LEDGER_UNVERIFIED'&&l.historyComplete===false&&l.pnlReady===false&&l.decisionReady===false&&l.executionReady===false&&Array.isArray(l.rows)&&l.rows.length>=2&&l.rows.length<=20000&&l.rows.length===l.acceptedCount&&Array.isArray(l.gaps)&&!l.gaps.length&&Array.isArray(l.archiveGaps)&&!l.archiveGaps.length,'LIFE_LEDGER_INCOMPLETE');
  assert(Number.isInteger(l.decimalsX)&&l.decimalsX>=0&&l.decimalsX<=18&&l.decimalsY===9,'LIFE_DECIMALS');
  assert(policy?.scope==='CLOSED_POSITION_RETAIN_DISTRIBUTIONS'&&Number.isInteger(policy.maxAgeSeconds)&&policy.maxAgeSeconds>0&&policy.maxAgeSeconds<=600&&Number.isInteger(policy.maxSpreadBps)&&policy.maxSpreadBps>=0&&policy.maxSpreadBps<=10000,'LIFE_POLICY_REQUIRED');
  assert(bindings&&['ledgerHash','marksHash','configHash'].every(k=>hash(bindings[k])),'LIFE_BINDINGS_REQUIRED');
  const coverage=checkPageCoverage(l,archives),first=l.rows[0],last=l.rows.at(-1);
  assert(first.created===true&&last.closed===true&&first.success===true&&last.success===true&&Number.isSafeInteger(first.blockTime)&&Number.isSafeInteger(last.blockTime)&&last.blockTime>=first.blockTime,'LIFE_BOUNDARY_REQUIRED');
  assert(marks?.closing?.signature===last.signature&&marks.closing.transactionHash===last.transactionHash&&Array.isArray(marks.flows)&&marks.flows.length<=l.rows.length,'LIFE_MARKS_REQUIRED');
  const cp=mark(marks.closing,l,last.blockTime,last.slot,policy),scale=18+l.decimalsX,ys=10n**BigInt(scale-9),value=(x,y,p)=>x*p+y*ys;
  const flowMarks=new Map(),sums=Object.fromEntries(fields.map(k=>[k,0n]));let basis=0n,capitalSeconds=0n,failedFee=0n,locked=0n,prior=null;
  for(const m of marks.flows){assert(typeof m.signature==='string'&&!flowMarks.has(m.signature),'LIFE_DUPLICATE_MARK');flowMarks.set(m.signature,m)}
  for(const [i,r] of l.rows.entries()){
   assert(r.status==='TRANSACTION_DELTA_RECONCILED_UNVERIFIED'&&hash(r.transactionHash)&&typeof r.success==='boolean'&&r.decisionReady===false&&r.executionReady===false&&Number.isSafeInteger(r.slot)&&r.slot>=0&&Number.isSafeInteger(r.txIndex)&&r.txIndex>=0&&Number.isSafeInteger(r.blockTime)&&r.blockTime>=0&&(!prior||r.blockTime>=prior.blockTime&&(r.slot>prior.slot||r.slot===prior.slot&&r.txIndex>prior.txIndex)),'LIFE_FLOW_ORDER');
   assert(r.created===(i===0)&&r.closed===(i===l.rows.length-1),'LIFE_MULTIPLE_INCARNATIONS');
   assert(['CREATE','ADD','REMOVE','CLAIM','CLOSE','FAILED_FEE_ONLY'].includes(r.kind)&&r.success===(r.kind!=='FAILED_FEE_ONLY'),'LIFE_FLOW_KIND');
   assert(!r.created||['CREATE','ADD'].includes(r.kind),'LIFE_CREATE_KIND');assert(!r.closed||['CLOSE','REMOVE'].includes(r.kind),'LIFE_CLOSE_KIND');
   assert(r.kind!=='CREATE'||r.created,'LIFE_CREATE_KIND');assert(r.kind!=='CLOSE'||r.closed,'LIFE_CLOSE_KIND');
   const q=Object.fromEntries(fields.map(k=>[k,raw(r[k])]));for(const k of fields)sums[k]+=q[k];
   const dx=q.depositXRaw,dy=q.depositYRaw,wx=q.withdrawXRaw,wy=q.withdrawYRaw,cx=q.claimedXRaw,cy=q.claimedYRaw;
   assert((r.kind==='ADD'?dx+dy>0n:dx+dy===0n)&&(r.kind==='REMOVE'?wx+wy>0n:wx+wy===0n)&&(r.kind==='CLAIM'?cx+cy>0n:cx+cy===0n),'LIFE_FLOW_AMOUNT_KIND');
   assert(r.created?q.rentLockedRaw>0n:q.rentLockedRaw===0n,'LIFE_RENT_LOCK');assert(r.closed?q.rentRecoveredRaw>0n:q.rentRecoveredRaw===0n,'LIFE_RENT_RECOVERY');
   locked+=q.rentLockedRaw-q.rentRecoveredRaw;assert(locked>=0n,'LIFE_RENT_NEGATIVE');
   if(dx||dy){const m=flowMarks.get(r.signature);assert(m?.transactionHash===r.transactionHash,'LIFE_DEPOSIT_MARK_MISSING');const v=value(dx,dy,mark(m,l,r.blockTime,r.slot,policy));basis+=v;capitalSeconds+=v*BigInt(last.blockTime-r.blockTime);flowMarks.delete(r.signature)}
   if(!r.success)failedFee+=q.networkFeeRaw;prior=r;
  }
  assert(locked===0n&&sums.rentLockedRaw===sums.rentRecoveredRaw,'LIFE_RENT_NOT_FULLY_RECOVERED');
  assert(!flowMarks.size&&basis>0n,'LIFE_MARK_OR_CAPITAL_INVALID');for(const k of fields)assert(raw(l.totals[k])===sums[k],'LIFE_TOTAL_MISMATCH');
  const withdrawn=value(sums.withdrawXRaw,sums.withdrawYRaw,cp),fees=value(sums.claimedXRaw,sums.claimedYRaw,cp),hodl=value(sums.depositXRaw,sums.depositYRaw,cp),network=sums.networkFeeRaw*ys,wealth=withdrawn+fees-network,pnl=wealth-basis,alpha=wealth-hodl,price=hodl-basis,inventory=withdrawn-hodl;
  const metrics=Object.fromEntries(Object.entries({depositValue:basis,withdrawnValue:withdrawn,claimedValue:fees,networkCost:network,failedNetworkCost:failedFee*ys,rentLocked:sums.rentLockedRaw*ys,rentRecovered:sums.rentRecoveredRaw*ys,rentNetCost:0n,closingPositionNav:0n,terminalWealth:wealth,hodlTerminal:hodl,netPnl:pnl,hodlPnl:price,alpha,inventoryEffect:inventory,attributionResidual:pnl-price-inventory-fees+network,contributedSolHours:capitalSeconds/3600n,rentLockedSolHours:sums.rentLockedRaw*ys*BigInt(last.blockTime-first.blockTime)/3600n}).map(([k,v])=>[k,decimal(v,scale)]));
  return {schemaVersion:1,status:'CLOSED_LIFECYCLE_DIAGNOSTIC',decisionReady:false,executionReady:false,pnlReady:false,historyComplete:false,pool:l.pool,position:l.position,owner:l.owner,mintX:l.mintX,mintY:l.mintY,creationSignature:first.signature,closeSignature:last.signature,openingSlot:first.slot,closingSlot:last.slot,openingTime:first.blockTime,closingTime:last.blockTime,observedCount:l.rows.length,coverage,bindings,metrics,limitations:['Observed provider page chain is not proof of complete historical coverage or finalized network authenticity.','Successful close and zero position NAV are conditional on T15 event/transfer semantics. No independent historical state proof.','All withdrawn and claimed assets assumed retained until close mark, not actual wallet sale proceeds. Rent fully recovered; separately report capital lock time.','No realized cash PnL, funded approval, or profitability claim.']};
 }catch(e){return blocked(/^[A-Z0-9_]+$/.test(e.message)?e.message:'LIFE_VALIDATION_FAILED')}
}

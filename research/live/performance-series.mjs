// T16 B: recompute cumulative windows from the original baseline, never sum window PnL.
import {calculateWindow} from './performance-core.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const fields=['depositXRaw','depositYRaw','withdrawXRaw','withdrawYRaw','claimedXRaw','claimedYRaw','networkFeeRaw','rentLockedRaw','rentRecoveredRaw'];
const SCALE=36,UNIT=10n**36n;
function fixed(v){assert(typeof v==='string'&&/^-?\d{1,80}(\.\d{1,36})?$/.test(v),'SERIES_DECIMAL_INVALID');const [a,b='']=v.replace(/^-/,'').split('.');return (v.startsWith('-')?-1n:1n)*(BigInt(a)*UNIT+BigInt(b.padEnd(SCALE,'0')))}
function decimal(n){const neg=n<0n;let s=(neg?-n:n).toString().padStart(SCALE+1,'0');const f=s.slice(-SCALE).replace(/0+$/,'');return (neg?'-':'')+s.slice(0,-SCALE)+(f?'.'+f:'')}
export function calculateSeries({windows,maxIntervalSeconds,seriesHash}){
 const blocked=reason=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,pnlReady:false});
 try{
  assert(Array.isArray(windows)&&windows.length>=1&&windows.length<=100&&hash(seriesHash),'SERIES_INPUT_REQUIRED');
  assert(Number.isSafeInteger(maxIntervalSeconds)&&maxIntervalSeconds>0&&maxIntervalSeconds<=86400,'SERIES_INTERVAL_REQUIRED');
  const first=windows[0],allRows=[],allMarks=[],seen=new Set(),points=[],windowBindings=[];
  let timeWeightedPrincipal2=0n,timeWeightedCapital2=0n,previous=null,prior=null,baseline=null,peak=null,maxDrawdown=null;
  for(const w of windows){
   const r=calculateWindow(w);assert(r.status==='BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC','SERIES_WINDOW_BLOCKED_'+(r.reason??'UNKNOWN'));
   const {ledger:l,opening,closing,marks,policy,bindings}=w;
   assert(['pool','position','owner','mintX','mintY','decimalsX','decimalsY'].every(k=>l[k]===first.ledger[k])&&policy.scope===first.policy.scope&&policy.maxAgeSeconds===first.policy.maxAgeSeconds&&policy.maxSpreadBps===first.policy.maxSpreadBps,'SERIES_SCOPE_CHANGED');
   assert(!prior||(prior.closing.slot===opening.slot&&prior.bindings.closingHash===bindings.openingHash&&JSON.stringify(prior.closing)===JSON.stringify(opening)&&JSON.stringify(prior.marks.closing)===JSON.stringify(marks.opening)),'SERIES_BOUNDARY_MISMATCH');
   const dt=r.closingTime-r.openingTime;assert(dt>0&&dt<=maxIntervalSeconds,'SERIES_INTERVAL_GAP');
   for(const row of l.rows){assert(!seen.has(row.signature),'SERIES_DUPLICATE_SIGNATURE');seen.add(row.signature);allRows.push(row)}
   assert(allRows.length<=20000,'SERIES_TOO_MANY_TRANSACTIONS');allMarks.push(...marks.flows);
   windowBindings.push(bindings);
   const merged={...first.ledger,rows:allRows,acceptedCount:allRows.length,observedCount:allRows.length,totals:Object.fromEntries(fields.map(k=>[k,allRows.reduce((n,row)=>n+BigInt(row[k]),0n).toString()]))};
   const cumulative=calculateWindow({ledger:merged,opening:first.opening,closing,marks:{opening:first.marks.opening,closing:marks.closing,flows:allMarks},policy:first.policy,bindings:{ledgerHash:seriesHash,openingHash:first.bindings.openingHash,closingHash:bindings.closingHash,marksHash:seriesHash}});
   assert(cumulative.status==='BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC','SERIES_CUMULATIVE_BLOCKED_'+(cumulative.reason??'UNKNOWN'));
   if(!baseline){baseline=fixed(cumulative.metrics.openingValue);points.push({slot:r.openingSlot,asOf:r.openingTime,nav:r.metrics.openingValue,terminalWealth:r.metrics.openingValue,hodlTerminal:r.metrics.openingValue,netPnl:'0',alpha:'0',capitalBasis:r.metrics.openingValue});peak=0n;maxDrawdown=0n}
   const m=cumulative.metrics;
   // NAV is principal + pending fees, not idle wallet capital. Trapezoidal estimate, not exact utilization.
   const openingNav=fixed(r.metrics.openingValue),closingNav=fixed(r.metrics.closingNav);
   timeWeightedPrincipal2+=(openingNav+closingNav)*BigInt(dt);
   const startBasis=previous?fixed(previous.metrics.capitalBasis):baseline,flowMarks=new Map(marks.flows.map(x=>[x.signature,x]));
   // Exact contributed-capital-time from contribution times, not a trapezoidal capital estimate.
   timeWeightedCapital2+=startBasis*2n*BigInt(dt);
   for(const row of l.rows){if(BigInt(row.depositXRaw)||BigInt(row.depositYRaw)){
    const mark=flowMarks.get(row.signature),p=(BigInt(mark.references[0].priceE18)+BigInt(mark.references[1].priceE18))/2n;
    const amount=BigInt(row.depositXRaw)*p*10n**BigInt(18-l.decimalsX)+BigInt(row.depositYRaw)*10n**27n;
    timeWeightedCapital2+=amount*2n*BigInt(r.closingTime-row.blockTime);
   }}
   const pnl=fixed(m.netPnl);if(pnl>peak)peak=pnl;if(peak-pnl>maxDrawdown)maxDrawdown=peak-pnl;
   points.push({slot:r.closingSlot,asOf:r.closingTime,nav:m.closingNav,terminalWealth:m.terminalWealth,hodlTerminal:m.hodlTerminal,netPnl:m.netPnl,alpha:m.alpha,capitalBasis:m.capitalBasis});
   previous=cumulative;prior=w;
  }
  const seconds=points.at(-1).asOf-points[0].asOf,metrics=previous.metrics;
  const navHours=timeWeightedPrincipal2/7200n,capitalHours=timeWeightedCapital2/7200n;
  assert(capitalHours>0n,'SERIES_CAPITAL_TIME_ZERO');
  return {schemaVersion:1,status:'BOUNDED_SERIES_DIAGNOSTIC',decisionReady:false,executionReady:false,pnlReady:false,historyComplete:false,pool:first.ledger.pool,position:first.ledger.position,owner:first.ledger.owner,seriesHash,windowBindings,windowCount:windows.length,observedCount:allRows.length,durationSeconds:seconds,points,metrics,capitalTime:{sampledNavSolHours:decimal(navHours),contributedSolHours:decimal(capitalHours),sampledMeanNavSol:decimal(timeWeightedPrincipal2/(2n*BigInt(seconds))),netPnlPerContributedSolHour:decimal(fixed(metrics.netPnl)*UNIT/capitalHours),alphaPerContributedSolHour:decimal(fixed(metrics.alpha)*UNIT/capitalHours),sampledPnlPeakToTroughSol:decimal(maxDrawdown)},limitations:['Conditional existing-position windows; completeness unverified.','Cumulative PnL recomputed from first opening, distributions retained, contribution marks fixed.','NAV-hours trapezoidal approximation between sampled endpoints; not exact active liquidity utilization. Contributed capital-time does not subtract retained distributions.','Peak-to-trough is sampled absolute cumulative PnL, not time-weighted return drawdown. No annualization, lifetime or realized cash PnL.']};
 }catch(e){return blocked(/^[A-Z0-9_]+$/.test(e.message)?e.message:'SERIES_VALIDATION_FAILED')}
}

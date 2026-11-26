// Best-effort bounded address-index gap repair. Never certifies historical completeness.
const sig=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v);
export function repairPlan(previous,turn){
 const r=previous?.repair;
 return turn%2===1&&r?.status==='PENDING'&&sig(r.cursor)&&Number.isInteger(r.attempts)&&r.attempts>=0&&r.attempts<8?{before:r.cursor,repair:true}:{before:null,repair:false};
}
export function advanceRepair(previous,rows,manifest,plan){
 const old=previous?.headSignatures??previous?.records??[],r=previous?.repair??null;
 const valid=Array.isArray(rows)&&rows.length>0&&rows.every(x=>sig(x.signature))&&sig(manifest?.nextBefore)&&manifest.nextBefore===rows.at(-1)?.signature;
 const overlap=old.some(o=>rows.some(n=>n.signature===o.signature));
 if(plan.repair){
  if(!r||r.status!=='PENDING'||plan.before!==r.cursor)return r;
  const attempts=r.attempts+1;
  if(rows.some(n=>n.signature===r.anchor))return {...r,status:'ANCHOR_OVERLAP_OBSERVED',attempts,cursor:null};
  if(!valid||manifest.nextBefore===plan.before||rows.some(n=>n.signature===plan.before)||attempts>=8||['SHORT_PAGE','EMPTY_PAGE'].includes(manifest.stopReason))return {...r,status:'REPAIR_LIMIT_OR_NO_PROGRESS',attempts,cursor:null};
  return {...r,cursor:manifest.nextBefore,attempts};
 }
 if(!old.length||!rows.length||overlap||!valid)return r;
 if(r?.status==='PENDING')return {...r,additionalGapObserved:true};
 const anchor=old[0]?.signature;if(!sig(anchor))return r;
 return {status:'PENDING',anchor,cursor:manifest.nextBefore,attempts:0,additionalGapObserved:previous?.gapObserved===true&&!(r?.status==='ANCHOR_OVERLAP_OBSERVED'&&!r.additionalGapObserved)};
}

// Failed or empty repair attempts consume a bounded retry budget, without moving the cursor.
export function failedRepair(previous,plan,reason){
 const r=previous?.repair??null;
 if(!plan.repair||r?.status!=='PENDING'||r.cursor!==plan.before)return r;
 const attempts=r.attempts+1;
 return {...r,attempts,lastFailure:reason,...(attempts>=8||reason==='EMPTY_PAGE'?{status:'REPAIR_LIMIT_OR_NO_PROGRESS',cursor:null}:{})};
}
// Gap history is sticky. Only an isolated, successfully bracketed repair may be reported as anchor-recovered.
export function historyCoverage(merged,repair){
 if(!merged.gapObserved)return merged.status;
 if(repair?.status==='ANCHOR_OVERLAP_OBSERVED'&&!repair.additionalGapObserved&&!merged.retentionTruncated)return 'ANCHOR_RECOVERED_UNVERIFIED';
 if(repair?.status==='PENDING')return 'BACKFILL_PENDING';
 return 'UNRESOLVED_GAP';
}

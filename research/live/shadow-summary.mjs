// Paired, group-aware diagnostic. Missing groups never vanish from coverage denominators.
export function summarize(rows,split,baseline){
 const all=rows.filter(r=>r.split===split),groups=new Map();
 for(const row of all){const g=groups.get(row.group)??{planned:0,pairs:[]};g.planned++;groups.set(row.group,g);
  const a=row.runs?.find(r=>r.mode==='adaptive'),b=row.runs?.find(r=>r.mode===baseline);
  if(a?.status!=='HYPOTHETICAL_REPLAY'||b?.status!=='HYPOTHETICAL_REPLAY'||![a.pnlSol,b.pnlSol,a.initialNavSol,b.initialNavSol].every(Number.isFinite)||a.initialNavSol<=0||a.initialNavSol!==b.initialNavSol)continue;
  const delta=a.pnlSol-b.pnlSol,normalized=delta/a.initialNavSol;if(!Number.isFinite(delta)||!Number.isFinite(normalized))continue;g.pairs.push({delta,normalized});
 }
 const values=[...groups.values()],valid=values.reduce((n,g)=>n+g.pairs.length,0),complete=values.filter(g=>g.pairs.length===g.planned),n=complete.length;
 const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const deltas=complete.map(g=>mean(g.pairs.map(p=>p.delta))).sort((a,b)=>a-b),normalized=complete.map(g=>mean(g.pairs.map(p=>p.normalized))).sort((a,b)=>a-b);
 return {baseline,plannedWindows:all.length,validPairs:valid,invalidOrMissing:all.length-valid,declaredGroups:groups.size,completeGroups:n,incompleteGroups:groups.size-n,meanGroupDeltaSol:n?mean(deltas):null,medianGroupDeltaSol:n?(deltas[Math.floor((n-1)/2)]+deltas[Math.floor(n/2)])/2:null,worstGroupDeltaSol:n?deltas[0]:null,positiveGroupFraction:n?deltas.filter(v=>v>0).length/n:null,meanGroupReturnDelta:n?mean(normalized):null,worstGroupReturnDelta:n?normalized[0]:null,statisticScope:'COMPLETE_GROUPS_ONLY_DESCRIPTIVE_NO_INFERENCE',conclusion:'INCONCLUSIVE_UNVERIFIED_FROZEN_PATH'};
}

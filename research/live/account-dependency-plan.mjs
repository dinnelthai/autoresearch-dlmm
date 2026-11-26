// Address hints only; every resulting capture must be independently decoded at one finalized slot.
const key=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const assert=(v,m)=>{if(!v)throw Error(m)};
export function dependencyPlan({pool,market=[],positions=[],positionHints=new Map(),clock=null,limit=99}){
 assert(key(pool)&&Array.isArray(market)&&Array.isArray(positions)&&positions.length<=10&&positionHints instanceof Map&&Number.isInteger(limit)&&limit>=1&&limit<=99,'DEPENDENCY_PLAN_INVALID');
 const clean=xs=>{assert(Array.isArray(xs)&&xs.length<=256&&xs.every(key),'DEPENDENCY_ADDRESS_INVALID');return [...new Set(xs.filter(a=>a!==pool))]};
 const mandatory=clean([...market,...(clock?[clock]:[])]);
 assert(mandatory.length<=limit,'MARKET_ACCOUNT_BUDGET_EXCEEDED');
 const selected=new Set(mandatory),deferred=[];
 for(const p of clean(positions)){
  const group=clean([p,...(positionHints.get(p)??[])]);
  const next=new Set([...selected,...group]);
  if(next.size>limit){deferred.push(p);continue}
  for(const a of group)selected.add(a);
 }
 return {accounts:[...selected],deferred,marketAccounts:mandatory};
}
export function sameAccounts(a,b){return a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x))}

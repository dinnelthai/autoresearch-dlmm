// Aggregate read-only holder diagnostics. No wallet labels, no transfer attribution, no trade signal.
const assert=(v,m)=>{if(!v)throw Error(m)};
const amount=v=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<(1n<<64n);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const key=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const ratio=(a,b)=>b>0n?Number(a*100000000n/b)/100000000:null;
export function holderDistribution(rows,supplyRaw,{topN=10}={}){
 assert(Array.isArray(rows)&&rows.length<=50000&&amount(supplyRaw)&&Number.isInteger(topN)&&topN>=1&&topN<=100,'HOLDER_INPUT_INVALID');
 const supply=BigInt(supplyRaw),owners=new Map(),accounts=new Set();let sum=0n,frozen=0n;
 for(const a of rows){
  assert(key(a.account)&&key(a.owner)&&!accounts.has(a.account)&&amount(a.amountRaw)&&typeof a.frozen==='boolean','HOLDER_ACCOUNT_INVALID');accounts.add(a.account);
  const n=BigInt(a.amountRaw);sum+=n;if(a.frozen)frozen+=n;if(n>0n)owners.set(a.owner,(owners.get(a.owner)??0n)+n);
 }
 assert(sum<=((1n<<64n)-1n),'HOLDER_TOTAL_OVERFLOW');
 const ranked=[...owners].sort((a,b)=>a[1]===b[1]?a[0].localeCompare(b[0]):a[1]>b[1]?-1:1);
 const top=ranked.slice(0,topN).reduce((n,x)=>n+x[1],0n),conserved=sum===supply&&supply>0n;
 return {scope:'ALL_CLASSIC_TOKEN_ACCOUNT_OWNERS_INCLUDING_VAULTS',accountCount:accounts.size,positiveOwnerCount:owners.size,supplyRaw,sumRaw:sum.toString(),supplyConserved:conserved,frozenRaw:frozen.toString(),topN,topShare:conserved?ratio(top,supply):null,largestShare:conserved?ratio(ranked[0]?.[1]??0n,supply):null,topOwners:ranked.slice(0,topN).map(([owner,n])=>({owner,amountRaw:n.toString()})),ownerBalances:owners};
}
export function cohortChange(previous,current,now){
 if(!previous||!current||previous.mint!==current.mint||previous.genesis!==current.genesis||previous.slot>=current.slot||!Number.isSafeInteger(previous.receivedAt)||!Number.isSafeInteger(current.receivedAt)||current.receivedAt<=previous.receivedAt||current.receivedAt>now||current.receivedAt-previous.receivedAt>1800000||!previous.distribution?.supplyConserved||!current.distribution?.supplyConserved||previous.distribution.supplyRaw!==current.distribution.supplyRaw)return null;
 let before=0n,after=0n;
 for(const a of previous.distribution.topOwners){before+=BigInt(a.amountRaw);after+=current.distribution.ownerBalances.get(a.owner)??0n}
 if(!before)return null;
 return {scope:'PREVIOUS_TOP_OWNER_COHORT_NET_BALANCE_CHANGE_NOT_SELL_FLOW',previousSlot:previous.slot,slot:current.slot,windowMs:current.receivedAt-previous.receivedAt,previousRaw:before.toString(),currentRaw:after.toString(),netDecreaseShare:ratio(before>after?before-after:0n,before)};
}
export function mintSafety({mintAuthority,freezeAuthority,initialized,classic,decimals,supported=classic}){
 assert(typeof initialized==='boolean'&&typeof classic==='boolean'&&typeof supported==='boolean'&&Number.isInteger(decimals)&&decimals>=0&&decimals<=18&&(mintAuthority===null||key(mintAuthority))&&(freezeAuthority===null||key(freezeAuthority)),'MINT_FACTS_INVALID');
 const flags=[];if(!supported)flags.push('TOKEN_PROGRAM_UNSUPPORTED');if(!initialized)flags.push('MINT_NOT_INITIALIZED');if(mintAuthority)flags.push('MINT_AUTHORITY_PRESENT');if(freezeAuthority)flags.push('FREEZE_AUTHORITY_PRESENT');
 return {scope:'MINT_AUTHORITY_FACTS_ONLY',mintAuthorityRevoked:mintAuthority===null,freezeAuthorityRevoked:freezeAuthority===null,flags,tokenSafe:null,modelEligible:false};
}
export function featureProjection(feature,m,now,maxAgeMs){
 if(!feature||!m||feature.pool!==m.pool||feature.mint!==m.mintX||feature.genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'||!Number.isSafeInteger(feature.slot)||feature.slot<feature.requestMarketSlot||!Number.isSafeInteger(feature.receivedAt)||feature.receivedAt>now||now-feature.receivedAt>maxAgeMs||!hash(feature.evidenceHash)||feature.scope!=='HOLDER_DIAGNOSTIC_ONLY')return null;
 return {slot:feature.slot,receivedAt:feature.receivedAt,distribution:feature.distribution,cohort:feature.cohort,safety:feature.safety,gaps:feature.gaps,evidenceHash:feature.evidenceHash,modelEligible:false};
}

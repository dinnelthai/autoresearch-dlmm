// T14 B2: conservative integer allocation diagnostic, NOT SDK transaction input.
// Exact IEEE-754 rational rounding; never redistribute rounded dust.
const assert=(v,m)=>{if(!v)throw Error(m)};
const uint=v=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n;
export function scaledFloat(v,decimals,ceil=false){
 assert(typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isInteger(decimals)&&decimals>=0&&decimals<=18,'INVALID_RESEARCH_AMOUNT');
 if(v===0)return 0n;
 const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,v,false);
 const bits=bytes.getBigUint64(0,false),exp=Number((bits>>52n)&2047n),mantissa=(bits&((1n<<52n)-1n))+(exp?1n<<52n:0n);
 const power=exp?exp-1023-52:-1074;
 const n=mantissa*10n**BigInt(decimals);
 const den=power<0?1n<<BigInt(-power):1n,num=power>=0?n<<BigInt(power):n;
 const q=num/den+(ceil&&num%den!==0n?1n:0n);
 assert(q<=18446744073709551615n,'RAW_AMOUNT_OVERFLOW');return q;
}
export function allocationDiagnostic({row,market,budget}){
 const blocked=reason=>({status:'BLOCKED',reason,executionReady:false,signingAvailable:false});
 if(row?.family==='NO_LP')return {status:'NO_OPERATION',reason:'NO_LP_BASELINE',executionReady:false,signingAvailable:false};
 if(row?.action?.type!=='OPEN'||row.feasible!==true||row.action.acquireSol)return blocked('OPEN_RESEARCH_ONLY');
 try{
  assert(budget?.allowDispose===false&&uint(budget.solRaw)&&uint(budget.memeRaw),'RESEARCH_BUDGET_INVALID');
  assert(market?.decimalsY===9&&Number.isInteger(market.decimalsX)&&market.decimalsX>=0&&market.decimalsX<=18&&Number.isInteger(market.activeId)&&Array.isArray(market.bins),'MARKET_GRID_INVALID');
  const a=row.allocation;assert(Array.isArray(a?.bins)&&a.bins.length>0&&a.bins.length<=1500,'RESEARCH_ALLOCATION_INVALID');
  const known=new Set(market.bins.map(x=>x.binId)),seen=new Set();
  const rows=a.bins.map(b=>{
   assert(Number.isSafeInteger(b.binId)&&known.has(b.binId)&&!seen.has(b.binId),'BIN_NOT_OBSERVED_OR_DUPLICATE');seen.add(b.binId);
   const x=scaledFloat(b.meme,market.decimalsX),y=scaledFloat(b.sol,9);
   assert(!(b.binId<market.activeId&&b.meme>0)&&!(b.binId>market.activeId&&b.sol>0),'WRONG_ACTIVE_BIN_SIDE');
   return {binId:b.binId,memeRaw:x.toString(),solRaw:y.toString()};
  }).sort((a,b)=>a.binId-b.binId);
  const lo=rows[0].binId,hi=rows.at(-1).binId;
  assert(a.lowerBinId===lo&&a.upperBinId===hi,'RESEARCH_RANGE_MISMATCH');
  const x=rows.reduce((n,b)=>n+BigInt(b.memeRaw),0n),y=rows.reduce((n,b)=>n+BigInt(b.solRaw),0n);
  const reserve=scaledFloat(budget.minSolReserve,9,true),cost=scaledFloat(budget.operationCostSol,9,true),maxX=BigInt(budget.memeRaw),maxY=BigInt(budget.solRaw);
  assert(x<=maxX&&y+reserve+cost<=maxY,'EXACT_BUDGET_EXCEEDED');
  assert(x+y>0n,'ALLOCATION_ROUNDS_TO_ZERO');
  // These are integer diagnostics, not weights accepted by an on-chain program.
  const gaps=hi-lo+1!==rows.length,zeroRows=rows.filter(b=>b.memeRaw==='0'&&b.solRaw==='0').length;
  return {status:'INTEGER_DIAGNOSTIC_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,lowerBinId:lo,upperBinId:hi,binCount:rows.length,rangeWidth:hi-lo+1,discontinuous:gaps,zeroRows,totalMemeRaw:x.toString(),totalSolRaw:y.toString(),reservedSolRaw:reserve.toString(),modelCostReserveRaw:cost.toString(),remainingMemeRaw:(maxX-x).toString(),remainingSolAfterReservesRaw:(maxY-y-reserve-cost).toString(),decimalsX:market.decimalsX,decimalsY:9,rows,rounding:'PER_BIN_EXACT_BINARY_FLOAT_FLOOR_RESERVES_CEIL',blockers:['SDK_WEIGHT_MAPPING_UNVERIFIED','SDK_POSITION_AND_ACCOUNT_COST_UNVERIFIED','EXACT_MESSAGE_FEE_AND_SIMULATION_REQUIRED']};
 }catch(e){return blocked(/^[A-Z0-9_]+$/.test(e.message)?e.message:'INTEGER_DIAGNOSTIC_FAILED')}
}

// B6 pure local simulation reconciliation. No execution authorization.
const assert=(v,m)=>{if(!v)throw Error(m)};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,40}$/.test(v)&&BigInt(v)<(1n<<128n),'SIM_RAW_INVALID');return BigInt(v)};
const sum=a=>a.reduce((s,v)=>s+v,0n),abs=v=>v<0n?-v:v;
export function reconcileOpenSimulation({before,after,bins,expected,feeRaw,rentCapRaw,reserveRaw,maxAmountErrorBps}){
 const blockers=[],block=x=>blockers.push(x);
 assert(Number.isInteger(maxAmountErrorBps)&&maxAmountErrorBps>=0&&maxAmountErrorBps<=10000,'SIM_TOLERANCE_REQUIRED');
 const x=raw(before.memeRaw)-raw(after.memeRaw),y=raw(before.wsolRaw)-raw(after.wsolRaw),sol=raw(before.nativeRaw)-raw(after.nativeRaw),rent=raw(after.positionRentRaw),fee=raw(feeRaw);
 assert(x>=0n&&y>=0n&&sol>=0n,'SIM_UNEXPECTED_WALLET_CREDIT');
 if(x>raw(expected.amountXRaw)||y>raw(expected.amountYRaw))block('SIM_DEPOSIT_CAP_EXCEEDED');
 if(raw(after.vaultXRaw)-raw(before.vaultXRaw)!==x||raw(after.vaultYRaw)-raw(before.vaultYRaw)!==y)block('SIM_VAULT_DELTA_MISMATCH');
 if(sol!==rent+fee)block('SIM_NATIVE_DEBIT_MISMATCH');
 if(rent>raw(rentCapRaw)||raw(after.nativeRaw)<raw(reserveRaw))block('SIM_RENT_OR_RESERVE_CAP');
 assert(Array.isArray(bins)&&bins.length>0&&Array.isArray(expected.rows)&&expected.rows.length>0,'SIM_BINS_MISSING');
 const targets=new Map(expected.rows.map(b=>[b.binId,b]));assert(targets.size===expected.rows.length&&new Set(bins.map(b=>b.binId)).size===bins.length,'SIM_BINS_DUPLICATE');
 const rows=bins.map(b=>{
  const dx=raw(b.afterX)-raw(b.beforeX),dy=raw(b.afterY)-raw(b.beforeY),s=raw(b.supply),share=raw(b.share),beforeSupply=raw(b.beforeSupply);
  assert(dx>=0n&&dy>=0n&&share<=s&&s>=beforeSupply,'SIM_BIN_DELTA_INVALID');
  if(share!==s-beforeSupply)block('SIM_SHARE_DELTA_MISMATCH');
  const t=targets.get(b.binId);if(!t&&(dx||dy||share))block('SIM_OUTSIDE_RANGE_CHANGE');
  if(t&&!share)block('SIM_TARGET_BIN_NO_SHARE');
  const principalX=s?share*raw(b.afterX)/s:0n,principalY=s?share*raw(b.afterY)/s:0n;
  return {binId:b.binId,depositXRaw:dx.toString(),depositYRaw:dy.toString(),principalXRaw:principalX.toString(),principalYRaw:principalY.toString(),targetXRaw:t?.memeRaw??'0',targetYRaw:t?.solRaw??'0'};
 });
 assert([...targets.keys()].every(id=>rows.some(b=>b.binId===id)),'SIM_TARGET_BIN_MISSING');
 if(sum(rows.map(b=>raw(b.depositXRaw)))!==x||sum(rows.map(b=>raw(b.depositYRaw)))!==y)block('SIM_BIN_VAULT_MISMATCH');
 function metric(side){const target=sum(rows.map(b=>raw(b['target'+side+'Raw']))),actual=sum(rows.map(b=>raw(b['deposit'+side+'Raw']))),err=sum(rows.map(b=>abs(raw(b['target'+side+'Raw'])-raw(b['deposit'+side+'Raw']))));const bps=target?(err*10000n+target-1n)/target:err?10001n:0n;return {targetRaw:target.toString(),depositRaw:actual.toString(),absoluteErrorRaw:err.toString(),errorBps:bps.toString()}}
 const meme=metric('X'),wsol=metric('Y');
 if(BigInt(meme.errorBps)>BigInt(maxAmountErrorBps)||BigInt(wsol.errorBps)>BigInt(maxAmountErrorBps))block('SIM_BIN_AMOUNT_ERROR_EXCEEDED');
 return {status:blockers.length?'SIMULATION_RECONCILIATION_BLOCKED':'LOCAL_SIMULATION_RECONCILED_UNVERIFIED',decisionReady:false,executionReady:false,signingAvailable:false,blockers:[...new Set(blockers)],nativeDebitRaw:sol.toString(),feeRaw:fee.toString(),positionRentRaw:rent.toString(),meme,wsol,principalXRaw:sum(rows.map(b=>raw(b.principalXRaw))).toString(),principalYRaw:sum(rows.map(b=>raw(b.principalYRaw))).toString(),rows,limitations:['Simulated account deltas only; principal is floor share/supply estimate. No actual transaction or realized PnL.']};
}

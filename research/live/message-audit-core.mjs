// B5: read-only structural inspection and exact message fee evidence.
// This is NOT a semantic instruction audit, transaction builder or approval.
const assert=(v,m)=>{if(!v)throw Error(m)};
const addr=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const raw=v=>{assert(typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n,'INVALID_RAW_AMOUNT');return BigInt(v)};
export const DLMM='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
export const COMPUTE='ComputeBudget111111111111111111111111111111';
export function inspectStructure(message,{wallet,position,pool}){
 assert([wallet,position,pool].every(addr)&&new Set([wallet,position,pool]).size===3,'MESSAGE_IDENTITY_INVALID');
 const {keys,requiredSigners,writable,instructions}=message;
 assert(Array.isArray(keys)&&keys.length<=64&&keys.every(addr)&&new Set(keys).size===keys.length&&keys[0]===wallet,'MESSAGE_ACCOUNT_KEYS_INVALID');
 assert(Array.isArray(requiredSigners)&&requiredSigners.length===2&&requiredSigners[0]===wallet&&requiredSigners[1]===position,'MESSAGE_SIGNER_SCOPE_MISMATCH');
 assert(Array.isArray(writable)&&writable.length===keys.length&&writable.every(v=>typeof v==='boolean')&&writable[0]&&writable[1],'MESSAGE_WRITABLE_INVALID');
 assert(Array.isArray(instructions)&&instructions.length>0&&instructions.length<=12,'MESSAGE_INSTRUCTION_COUNT_INVALID');
 const blockers=[],names=[];
 for(const ix of instructions){
  assert(keys.includes(ix.program)&&Array.isArray(ix.accounts)&&ix.accounts.every(a=>keys.includes(a))&&typeof ix.name==='string','MESSAGE_INSTRUCTION_INVALID');
  names.push(ix.name);
  if(ix.program===DLMM){
   if(!['initialize_position','add_liquidity_by_weight','add_liquidity_one_side'].includes(ix.name))blockers.push('UNSUPPORTED_DLMM_INSTRUCTION');
   if(!ix.accounts.includes(pool)||!ix.accounts.includes(position)||!ix.accounts.includes(wallet))blockers.push('EXPECTED_ACCOUNTS_MISSING');
  }else if(ix.program===COMPUTE){if(!['set_compute_unit_limit','set_compute_unit_price'].includes(ix.name)||ix.accounts.length)blockers.push('UNSUPPORTED_COMPUTE_INSTRUCTION')}
  else blockers.push('UNSUPPORTED_PROGRAM');
 }
 const liquidity=names.filter(n=>n==='add_liquidity_by_weight'||n==='add_liquidity_one_side');
 if(names.filter(n=>n==='initialize_position').length!==1||liquidity.length!==1||names.indexOf('initialize_position')>names.indexOf(liquidity[0]))blockers.push('OPEN_SEQUENCE_UNSUPPORTED');
 return {status:blockers.length?'STRUCTURAL_BLOCKED':'STRUCTURE_OBSERVED_UNVERIFIED',decisionReady:false,executionReady:false,signingAvailable:false,blockers:[...new Set(blockers)],accounts:keys.map((address,i)=>({address,signer:requiredSigners.includes(address),writable:writable[i]})),instructions,limitations:['Only outer instruction identity and account scope observed. Account roles, amounts, CPI, account creation and rent not verified.']};
}
export function feeEvidence({feeLamports,slot,valid,feeCapRaw,nativeSolRaw,minReserveRaw}){
 assert(Number.isSafeInteger(slot)&&slot>=0&&typeof valid==='boolean','FEE_CONTEXT_INVALID');
 assert(Number.isSafeInteger(feeLamports)&&feeLamports>=0,'MESSAGE_FEE_UNAVAILABLE');
 const fee=BigInt(feeLamports),cap=raw(feeCapRaw),balance=raw(nativeSolRaw),reserve=raw(minReserveRaw);
 return {status:!valid?'BLOCKHASH_INVALID':fee>cap?'FEE_CAP_EXCEEDED':fee+reserve>balance?'FEE_AND_RESERVE_EXCEED_BALANCE':'FEE_OBSERVED_ONLY',feeLamportsRaw:fee.toString(),feeCapRaw:cap.toString(),nativeSolRaw:balance.toString(),minReserveRaw:reserve.toString(),remainingAfterFeeAndReserveRaw:balance>=fee+reserve?(balance-fee-reserve).toString():null,slot,blockhashValid:valid,decisionReady:false,executionReady:false,signingAvailable:false,limitations:['Fee for exact message only; excludes rent, LP deposit, account creation and other effects. Not a sufficiency check.']};
}

// B5b narrow unsigned OPEN audit: only existing classic SPL ATAs and bin arrays.
import {DLMM,COMPUTE,inspectStructure,feeEvidence} from './message-audit-core.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n,'RAW_INVALID');return BigInt(v)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const equal=(a,b,m)=>assert(a===b,m);
export function checkOpenInstructions(message,expected){
 const structural=inspectStructure(message,expected);
 assert(structural.status==='STRUCTURE_OBSERVED_UNVERIFIED','STRUCTURE_BLOCKED');
 const list=message.instructions,init=list.find(i=>i.name==='initialize_position'),add=list.find(i=>i.name==='add_liquidity_by_weight'||i.name==='add_liquidity_one_side');
 const compute=list.filter(i=>i.program===COMPUTE);
 assert(compute.length<=2&&new Set(compute.map(i=>i.name)).size===compute.length&&list.slice(0,compute.length).every(i=>i.program===COMPUTE),'COMPUTE_SEQUENCE_INVALID');
 assert(same(init.accounts,expected.initAccounts)&&same(add.accounts,expected.depositAccounts),'ACCOUNT_ROLE_MISMATCH');
 assert(init.program===DLMM&&add.program===DLMM&&init.args?.lowerBinId===expected.lowerBinId&&init.args?.width===expected.width,'POSITION_RANGE_MISMATCH');
 assert(add.name===expected.depositName&&add.args?.activeId===expected.activeId&&add.args?.maxActiveBinSlippage===expected.maxActiveBinSlippage,'DEPOSIT_GRID_MISMATCH');
 equal(add.args.amountXRaw,expected.amountXRaw,'DEPOSIT_X_MISMATCH');equal(add.args.amountYRaw,expected.amountYRaw,'DEPOSIT_Y_MISMATCH');
 assert(same(add.args.weights,expected.weights),'DEPOSIT_WEIGHT_MISMATCH');
 const allowed=new Set([...expected.initAccounts,...expected.depositAccounts,DLMM,COMPUTE]);
 assert(message.keys.every(k=>allowed.has(k)),'UNEXPECTED_ACCOUNT');
 const mustWrite=new Set(expected.writableAccounts),allowedWrite=new Set(expected.writableAccounts);
 assert(message.keys.every((k,i)=>message.writable[i]===allowedWrite.has(k))&&[...mustWrite].every(k=>message.keys.includes(k)),'WRITABLE_ROLE_MISMATCH');
 return {status:'OUTER_ROLES_AND_ARGS_CHECKED_UNVERIFIED',decisionReady:false,executionReady:false,signingAvailable:false,structural,limitations:['No CPI or program binary semantics verified.']};
}
export function checkFunding({nativeSolRaw,memeAtaRaw,wsolAtaRaw,amountXRaw,amountYRaw,feeLamports,feeCapRaw,minReserveRaw,rentReferenceRaw,rentCapRaw,slot,valid}){
 const fee=feeEvidence({feeLamports,slot,valid,feeCapRaw,nativeSolRaw,minReserveRaw});
 const n=raw(nativeSolRaw),x=raw(memeAtaRaw),y=raw(wsolAtaRaw),dx=raw(amountXRaw),dy=raw(amountYRaw),rent=raw(rentReferenceRaw),cap=raw(rentCapRaw),reserve=raw(minReserveRaw),f=raw(fee.feeLamportsRaw);
 const blockers=[];
 if(fee.status!=='FEE_OBSERVED_ONLY')blockers.push(fee.status);
 if(rent>cap)blockers.push('RENT_REFERENCE_EXCEEDS_CAP');
 if(n<f+cap+reserve)blockers.push('NATIVE_SOL_CAP_BUDGET_INSUFFICIENT');
 if(x<dx)blockers.push('MEME_ATA_INSUFFICIENT');
 if(y<dy)blockers.push('WSOL_ATA_INSUFFICIENT');
 return {status:blockers.length?'BLOCKED':'CAP_BUDGET_DIAGNOSTIC_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,blockers,fee,rentReferenceRaw:rent.toString(),rentCapRaw:cap.toString(),nativeRequiredWithCapRaw:(f+cap+reserve).toString(),memeRequiredRaw:dx.toString(),wsolRequiredRaw:dy.toString(),limitations:['Rent reference is based on locally declared account size, not proven allocation size. Actual debit and CPI must be simulated. Native SOL and WSOL are separate.']};
}

// Pinned IDL layouts for the three allowed DLMM instructions. Reject trailing bytes.
export function decodeOpenArgs(name,bytes,side){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(name==='initialize_position'){assert(bytes.length===16,'INIT_DATA_LENGTH');return {lowerBinId:d.getInt32(8,true),width:d.getInt32(12,true)}}
 const one=name==='add_liquidity_one_side';assert(one||name==='add_liquidity_by_weight','DEPOSIT_TYPE_INVALID');
 const start=one?16:24;assert(bytes.length>=start+12,'DEPOSIT_DATA_LENGTH');
 const first=d.getBigUint64(8,true),second=one?0n:d.getBigUint64(16,true);
 assert(!one||['X','Y'].includes(side),'DEPOSIT_SIDE_INVALID');
 const count=d.getUint32(start+8,true);assert(count>0&&count<26&&bytes.length===start+12+count*6,'DEPOSIT_DATA_LENGTH');
 const weights=Array.from({length:count},(_,i)=>({binId:d.getInt32(start+12+i*6,true),weight:d.getUint16(start+16+i*6,true)}));
 assert(weights.every((b,i)=>b.weight>0&&(!i||b.binId>weights[i-1].binId))&&weights.reduce((n,b)=>n+b.weight,0)<=65535,'DEPOSIT_WEIGHT_INVALID');
 return {amountXRaw:(one&&side==='Y'?0n:first).toString(),amountYRaw:(one&&side==='Y'?first:second).toString(),activeId:d.getInt32(start,true),maxActiveBinSlippage:d.getInt32(start+4,true),weights};
}

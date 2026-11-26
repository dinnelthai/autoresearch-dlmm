// Read-only Solana JSON RPC message normalization; never builds or signs transactions.
export const MAX_READ_TRANSACTION_VERSION=1;
const assert=(v,m)=>{if(!v)throw Error(m)};
const address=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const idx=(v,n)=>Number.isInteger(v)&&v>=0&&v<n&&v<=255;
function byteIndexes(v){return Array.isArray(v)&&v.every(x=>idx(x,256))&&new Set(v).size===v.length}
export function resolveReadMessage(tx){
 const msg=tx?.transaction?.message,meta=tx?.meta;
 assert(msg&&meta&&Array.isArray(msg.accountKeys)&&msg.accountKeys.length>0&&Array.isArray(msg.instructions),'INVALID_TRANSACTION_MESSAGE');
 const version=tx.version??'legacy';
 assert(['legacy',0,1].includes(version),'UNSUPPORTED_TRANSACTION_VERSION');
 const loaded=meta.loadedAddresses;
 assert(loaded==null||Array.isArray(loaded.writable)&&Array.isArray(loaded.readonly),'INVALID_LOADED_ADDRESSES');
 const writable=loaded?.writable??[],readonly=loaded?.readonly??[];
 if(version===0){
  assert(msg.transactionConfig===undefined&&Array.isArray(msg.addressTableLookups),'INVALID_V0_MESSAGE');
  let w=0,r=0;
  for(const l of msg.addressTableLookups){assert(address(l.accountKey)&&byteIndexes(l.writableIndexes)&&byteIndexes(l.readonlyIndexes)&&l.writableIndexes.every(i=>!l.readonlyIndexes.includes(i)),'INVALID_V0_LOOKUP');w+=l.writableIndexes.length;r+=l.readonlyIndexes.length}
  assert(w===writable.length&&r===readonly.length,'LOADED_ADDRESS_COUNT_MISMATCH');
 }else{
  assert(msg.addressTableLookups===undefined&&writable.length===0&&readonly.length===0,'UNEXPECTED_LOADED_ADDRESSES');
  if(version===1)assert(msg.transactionConfig!==null&&typeof msg.transactionConfig==='object'&&!Array.isArray(msg.transactionConfig),'V1_CONFIG_MISSING');
  else assert(msg.transactionConfig===undefined,'UNEXPECTED_TRANSACTION_CONFIG');
 }
 const keys=[...msg.accountKeys,...writable,...readonly];
 assert(keys.length<=256&&keys.every(address)&&new Set(keys).size===keys.length,'INVALID_ACCOUNT_KEYS');
 function instruction(ix){assert(ix&&idx(ix.programIdIndex,keys.length)&&Array.isArray(ix.accounts)&&ix.accounts.every(i=>idx(i,keys.length))&&typeof ix.data==='string'&&/^[1-9A-HJ-NP-Za-km-z]*$/.test(ix.data),'INVALID_COMPILED_INSTRUCTION')}
 for(const ix of msg.instructions)instruction(ix);
 const groups=meta.innerInstructions;
 assert(groups==null||Array.isArray(groups),'INVALID_INNER_INSTRUCTIONS');
 const seen=new Set();
 for(const g of groups??[]){assert(idx(g.index,msg.instructions.length)&&!seen.has(g.index)&&Array.isArray(g.instructions),'INVALID_INNER_GROUP');seen.add(g.index);for(const ix of g.instructions)instruction(ix)}
 return {version,keys,msg,meta};
}

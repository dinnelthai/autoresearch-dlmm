// B5 local diagnostic. Reads an already-built unsigned legacy message only.
// No transaction creation, private keys, signatures, submission, or approval.
import {Message,PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {createHash} from 'node:crypto';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {inspectStructure,feeEvidence,DLMM,COMPUTE} from './message-audit-core.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const sha=v=>createHash('sha256').update(v).digest('hex');
const blob=v=>createHash('sha1').update('blob '+v.length+'\0').update(v).digest('hex');
const IDL_BLOB='6715f5cf19dffa8651a185ac0dd823218c6a2a75';
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const key=v=>new PublicKey(v).toBase58();
async function main(){
 const {values}=parseArgs({options:{input:{type:'string'},idl:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/audit-message.mjs --input data/message-audit.json --idl data/raw/dlmm-idl.json');return}
 assert(values.input&&values.idl,'INPUT_AND_IDL_REQUIRED');
 const inputBytes=await readFile(values.input);assert(inputBytes.length<=16384,'INPUT_TOO_LARGE');
 const x=JSON.parse(inputBytes);
 assert(x.schemaVersion===1&&x.scope==='LOCAL_UNSIGNED_MESSAGE_DIAGNOSTIC'&&x.sdkVersion==='1.9.15'&&hash(x.requestHash)&&hash(x.marketRawHash)&&Number.isSafeInteger(x.marketSlot)&&x.marketSlot>=0&&[x.wallet,x.position,x.pool].every(a=>key(a)===a),'INPUT_IDENTITY_INVALID');
 assert(typeof x.expectedGenesisHash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(x.expectedGenesisHash),'GENESIS_REQUIRED');
 assert(typeof x.messageBase64==='string'&&x.messageBase64.length<=1644,'MESSAGE_ENCODING_INVALID');
 const bytes=Buffer.from(x.messageBase64,'base64');assert(bytes.length>0&&bytes.toString('base64')===x.messageBase64&&(bytes[0]&128)===0,'LEGACY_MESSAGE_REQUIRED');
 const message=Message.from(bytes);assert(Buffer.from(message.serialize()).equals(bytes),'MESSAGE_NONCANONICAL');
 assert(bytes.length+1+64*message.header.numRequiredSignatures<=1232,'TRANSACTION_PACKET_LIMIT');
 const messageHash=sha(bytes);assert(messageHash===x.messageHash,'MESSAGE_HASH_MISMATCH');
 const idlBytes=await readFile(values.idl);assert(blob(idlBytes)===IDL_BLOB,'PINNED_IDL_MISMATCH');
 const idl=JSON.parse(idlBytes);assert(idl.address===DLMM,'IDL_PROGRAM_MISMATCH');
 const names=new Map(idl.instructions.map(i=>[Buffer.from(i.discriminator).toString('hex'),i.name]));
 const keys=message.accountKeys.map(a=>a.toBase58());
 const instructions=message.instructions.map((ix,index)=>{
  const data=Buffer.from(bs58.decode(ix.data)),program=keys[ix.programIdIndex];let name='unknown';
  if(program===DLMM&&data.length>=8)name=names.get(data.subarray(0,8).toString('hex'))??'unknown';
  if(program===COMPUTE)name=data[0]===2&&data.length===5?'set_compute_unit_limit':data[0]===3&&data.length===9?'set_compute_unit_price':'unknown';
  return {index,program,name,accounts:ix.accounts.map(i=>keys[i]),dataHash:sha(data),dataLength:data.length};
 });
 const structural=inspectStructure({keys,requiredSigners:keys.slice(0,message.header.numRequiredSignatures),writable:keys.map((_,i)=>message.isAccountWritable(i)),instructions},x);
 assert(process.env.SOLANA_RPC_URL,'RPC_NOT_CONFIGURED');
 const endpoint=new URL(process.env.SOLANA_RPC_URL);assert(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname),'RPC_SCHEME_INVALID');
 const calls=[];
 async function rpc(method,params){
  const request={jsonrpc:'2.0',id:calls.length+1,method,params},entry={request,startedAt:Date.now()};calls.push(entry);
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(8000),redirect:'error'});
  assert(r.ok,'RPC_HTTP_FAILURE');const body=await r.text();assert(body.length<=512*1024,'RPC_RESPONSE_TOO_LARGE');
  entry.receivedAt=Date.now();entry.body=body;const p=JSON.parse(body);assert(p.jsonrpc==='2.0'&&p.id===request.id&&!p.error,'RPC_RESPONSE_INVALID');return p.result;
 }
 assert(await rpc('getGenesisHash',[])===x.expectedGenesisHash,'RPC_GENESIS_MISMATCH');
 const config={commitment:'confirmed',minContextSlot:x.marketSlot};
 const balance=await rpc('getBalance',[x.wallet,config]),fee=await rpc('getFeeForMessage',[x.messageBase64,config]),valid=await rpc('isBlockhashValid',[message.recentBlockhash,config]);
 for(const r of [balance,fee,valid])assert(Number.isSafeInteger(r?.context?.slot)&&r.context.slot>=x.marketSlot,'RPC_CONTEXT_TOO_OLD');
 assert(Number.isSafeInteger(balance.value)&&balance.value>=0,'BALANCE_PRECISION_UNSUPPORTED');
 const cost=feeEvidence({feeLamports:fee.value,slot:fee.context.slot,valid:valid.value,feeCapRaw:x.feeCapRaw,nativeSolRaw:String(balance.value),minReserveRaw:x.minReserveRaw});
 const archive=JSON.stringify(calls),root=join('data','raw');await mkdir(root,{recursive:true,mode:0o700});const directory=await mkdtemp(join(root,'message-audit-'));
 await writeFile(join(directory,'rpc.json'),archive,{flag:'wx',mode:0o600});
 const report={schemaVersion:1,status:'MESSAGE_DIAGNOSTIC_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,scope:x.scope,sdkVersionDeclared:x.sdkVersion,sourceInputHash:sha(inputBytes),messageHash,requestHash:x.requestHash,marketRawHash:x.marketRawHash,marketSlot:x.marketSlot,pool:x.pool,wallet:x.wallet,position:x.position,genesisHash:x.expectedGenesisHash,observedAt:Date.now(),balanceSlot:balance.context.slot,blockhashCheckSlot:valid.context.slot,structural,cost,rawHash:sha(archive),directory,blockers:['MESSAGE_PROVENANCE_NOT_VERIFIED','ACCOUNT_ROLES_AND_DEBITS_UNVERIFIED','ACCOUNT_CREATION_AND_RENT_UNVERIFIED','SIMULATION_UNAVAILABLE','NO_SIGNING_OR_SUBMISSION']};
 await writeFile(join(directory,'manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{const m=String(e.message);console.log(JSON.stringify({status:'BLOCKED',decisionReady:false,executionReady:false,signingAvailable:false,reason:/^[A-Z0-9_]{1,100}$/.test(m)?m:'MESSAGE_AUDIT_FAILED'}));process.exitCode=1});

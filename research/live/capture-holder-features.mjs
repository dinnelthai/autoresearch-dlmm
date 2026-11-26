// Current classic SPL holder snapshot and mint authority facts; read-only.
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,unpackMint} from '@solana/spl-token';
import {createReadRpc} from './rpc-read.mjs';
import {holderDistribution,mintSafety} from './market-features.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const key=v=>{const p=new PublicKey(v);assert(p.toBase58()===v,'HOLDER_PUBLIC_KEY_INVALID');return p};
const sha=b=>createHash('sha256').update(b).digest('hex');
const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export async function captureHolderFeatures(m,{endpoint=process.env.SOLANA_RPC_URL,archive,fetcher=fetch}={}){
 assert(endpoint&&typeof archive==='function'&&Number.isSafeInteger(m.slot)&&m.slot>=0&&Number.isInteger(m.decimalsX),'HOLDER_RPC_NOT_CONFIGURED');
 const mint=key(m.mintX),program=TOKEN_PROGRAM_ID.toBase58(),transport=createReadRpc(endpoint,{fetcher,maxBytes:16*1024*1024,timeoutMs:12000,totalMs:20000,maxAttempts:2});
 let id=0;const files=[];
 async function read(method,params,file){
  const request={jsonrpc:'2.0',id:++id,method,params},startedAt=Date.now(),r=await transport(request);
  const receivedAt=Date.now();await archive(file,r.raw);files.push({file,request,startedAt,receivedAt,sha256:sha(r.raw),attempts:r.attempts});return r.payload.result;
 }
 assert(await read('getGenesisHash',[],'genesis.json')===genesis,'HOLDER_GENESIS_MISMATCH');
 const before=await read('getMultipleAccounts',[[mint.toBase58()],{encoding:'base64',commitment:'finalized',minContextSlot:m.slot}],'mint-before.json');
 function mintInfo(r,min){
  assert(Number.isSafeInteger(r?.context?.slot)&&r.context.slot>=min&&Array.isArray(r.value)&&r.value.length===1,'HOLDER_MINT_CONTEXT_INVALID');
  const a=r.value[0];assert(a?.owner===program&&a.executable===false&&a.data?.[1]==='base64'&&typeof a.data[0]==='string','HOLDER_MINT_UNSUPPORTED');
  const bytes=Buffer.from(a.data[0],'base64');assert(bytes.length===82&&bytes.toString('base64')===a.data[0]&&Number.isSafeInteger(a.lamports),'HOLDER_MINT_LAYOUT_INVALID');
  const v=unpackMint(mint,{data:bytes,owner:TOKEN_PROGRAM_ID,executable:false,lamports:a.lamports,rentEpoch:a.rentEpoch},TOKEN_PROGRAM_ID);
  assert(v.isInitialized&&v.decimals===m.decimalsX,'HOLDER_MINT_IDENTITY_MISMATCH');
  return {slot:r.context.slot,supplyRaw:v.supply.toString(),safety:mintSafety({mintAuthority:v.mintAuthority?.toBase58()??null,freezeAuthority:v.freezeAuthority?.toBase58()??null,classic:true,initialized:v.isInitialized,decimals:v.decimals})};
 }
 const b=mintInfo(before,m.slot);
 const index=await read('getProgramAccounts',[program,{commitment:'finalized',encoding:'base64',withContext:true,minContextSlot:b.slot,filters:[{dataSize:165},{memcmp:{offset:0,bytes:mint.toBase58()}}],dataSlice:{offset:0,length:109}}],'holder-index.json');
 assert(Number.isSafeInteger(index?.context?.slot)&&index.context.slot>=b.slot&&Array.isArray(index.value)&&index.value.length<=50000,'HOLDER_INDEX_CONTEXT_OR_LIMIT');
 const slot=index.context.slot,rows=index.value.map(x=>{
  const a=x.account;assert(a?.owner===program&&a.executable===false&&a.data?.[1]==='base64'&&typeof a.data[0]==='string','HOLDER_ACCOUNT_PROGRAM_INVALID');
  const bytes=Buffer.from(a.data[0],'base64');assert(bytes.length===109&&bytes.toString('base64')===a.data[0]&&new PublicKey(bytes.subarray(0,32)).equals(mint)&&[1,2].includes(bytes[108]),'HOLDER_ACCOUNT_LAYOUT_INVALID');
  return {account:key(x.pubkey).toBase58(),owner:new PublicKey(bytes.subarray(32,64)).toBase58(),amountRaw:bytes.readBigUInt64LE(64).toString(),frozen:bytes[108]===2};
 });
 const after=mintInfo(await read('getMultipleAccounts',[[mint.toBase58()],{encoding:'base64',commitment:'finalized',minContextSlot:slot}],'mint-after.json'),slot);
 const stable=b.supplyRaw===after.supplyRaw&&JSON.stringify(b.safety)===JSON.stringify(after.safety)&&after.slot-b.slot<=150;
 const distribution=holderDistribution(rows,after.supplyRaw);
 if(!stable){distribution.supplyConserved=false;distribution.topShare=null;distribution.largestShare=null}
 const gaps=[];if(!stable)gaps.push('MINT_BRACKET_CHANGED_OR_TOO_WIDE');if(!distribution.supplyConserved)gaps.push('SUPPLY_CONSERVATION_NOT_ESTABLISHED');
 const receivedAt=Date.now();
 return {scope:'HOLDER_DIAGNOSTIC_ONLY',status:gaps.length?'PARTIAL':'OBSERVED_UNVERIFIED',pool:m.pool,mint:mint.toBase58(),genesis,requestMarketSlot:m.slot,requestMarketRawHash:m.rawHash,slot,receivedAt,bracket:{before:b.slot,after:after.slot},distribution,safety:after.safety,gaps,files,decisionReady:false,executionReady:false,modelEligible:false};
}

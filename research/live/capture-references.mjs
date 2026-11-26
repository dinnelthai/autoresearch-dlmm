// Read-only manual reference pools; no discovery, signing, transaction construction or submission.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import anchor from '@coral-xyz/anchor';
import {Connection,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getExtensionTypes} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import {PROGRAM,SDK_COMMIT} from './inspect-pool.mjs';
import {quoteMath} from './reference-math.mjs';
const assert=(v,m)=>{if(!v)throw Error(m);};
const key=v=>new PublicKey(v).toBase58();
const raw=v=>{const s=v.toString();assert(/^\d+$/.test(s),'invalid raw amount');return s;};
const amount=s=>{assert(typeof s==='string'&&/^[1-9]\d*$/.test(s)&&BigInt(s)<1n<<64n,'amount must be positive u64 decimal string');return s;};
async function main(){
 const {values}=parseArgs({options:{pool:{type:'string'},reference:{type:'string',multiple:true},'probe-sol-raw':{type:'string'},'sell-raw':{type:'string',multiple:true},'max-discount-bps':{type:'string',default:'200'},'slippage-bps':{type:'string',default:'50'},provider:{type:'string',default:'solana-rpc'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/capture-references.mjs --pool TARGET --reference POOL_A --reference POOL_B --probe-sol-raw LAMPORTS --sell-raw TOKEN_RAW_SMALL --sell-raw TOKEN_RAW_LARGE');return;}
 const pool=key(values.pool),refs=(values.reference??[]).map(key);
 assert(refs.length>=2&&refs.length<=8&&new Set(refs).size===refs.length&&!refs.includes(pool),'require 2–8 distinct manually selected non-target pools');
 const probe=amount(values['probe-sol-raw']),ladder=(values['sell-raw']??[]).map(amount);
 assert(ladder.length>=1&&ladder.length<=12&&ladder.every((v,i)=>i===0||BigInt(v)>BigInt(ladder[i-1])),'require increasing 1–12 sell sizes');
 const maxDiscount=Number(values['max-discount-bps']),slippage=Number(values['slippage-bps']);
 assert([maxDiscount,slippage].every(v=>Number.isInteger(v)&&v>=0&&v<10000)&&slippage<=maxDiscount,'invalid bps');
 assert(/^[a-zA-Z0-9_-]{1,48}$/.test(values.provider),'invalid provider label');
 const endpoint=new URL(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
 assert(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)),'invalid RPC endpoint');
 const root=join('data','raw');await mkdir(root,{recursive:true,mode:0o700});const dir=await mkdtemp(join(root,'references-'));
 const report={schemaVersion:1,pool,referencePools:refs,provider:values.provider,sdkCommit:SDK_COMMIT,commitment:'finalized',requestedAt:new Date().toISOString(),probeSolRaw:probe,sellLadderRaw:ladder,maxDiscountBps:maxDiscount,slippageBps:slippage,status:'BLOCKED',rpcEvidence:[],references:[],gaps:[],limitations:['SDK quotes are not executable guarantees; no network fees, wallet balance, transaction simulation or future availability verified.','RPC calls use multiple contexts; slot/time brackets are not proof of an atomic snapshot.','Different pools on the same protocol do not establish economically independent price sources.','Only tested sizes, no interpolation, no summed exit capacity, no strategy-ready MARKET event.']};
 let serial=0;
 const conn=new Connection(endpoint.href,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:async(url,opts)=>{
  const i=++serial;const request=typeof opts?.body==='string'?opts.body:null;
  assert(request,'unexpected SDK RPC request format');
  // Reject arbitrary methods: only SDK state reads permitted.
  const q=JSON.parse(request),batch=Array.isArray(q)?q:[q];
  const allowed=new Set(['getAccountInfo','getMultipleAccounts','getSlot','getBlockTime','getEpochInfo','getProgramAccounts','getMinimumBalanceForRentExemption']);
  assert(batch.every(x=>allowed.has(x.method)),'unexpected non-read RPC method');
  const startedAt=new Date().toISOString();
  const response=await fetch(url,{...opts,signal:AbortSignal.timeout(30000),redirect:'error'});
  const rawResponse=await response.clone().text();
  const file='rpc-'+i+'.json';
  await writeFile(join(dir,file),rawResponse,{mode:0o600,flag:'wx'});
  report.rpcEvidence.push({file,request:batch.map(x=>({id:x.id,method:x.method,params:x.params})),startedAt,receivedAt:new Date().toISOString(),httpStatus:response.status,sha256:createHash('sha256').update(rawResponse).digest('hex')});
  return response;
 }});
 async function load(address){
  const pk=new PublicKey(address),rawAccount=await conn.getAccountInfo(pk,'finalized');
  assert(rawAccount&&!rawAccount.executable&&rawAccount.owner.equals(PROGRAM),'not a Meteora pool');
  const dlmm=await DLMM.create(conn,pk,{programId:PROGRAM});
  const x=dlmm.tokenX,y=dlmm.tokenY;
  assert(x.owner.equals(TOKEN_PROGRAM_ID)&&y.owner.equals(TOKEN_PROGRAM_ID)&&!getExtensionTypes(x.mint.tlvData).length&&!getExtensionTypes(y.mint.tlvData).length,'unsupported token program/extensions');
  assert(y.publicKey.equals(NATIVE_MINT)&&y.mint.decimals===9&&!x.publicKey.equals(y.publicKey),'unsupported token orientation');
  return dlmm;
 }
 async function bracket(){
  const slot=await conn.getSlot('finalized'),blockTime=await conn.getBlockTime(slot);
  assert(Number.isSafeInteger(slot)&&slot>=0&&Number.isSafeInteger(blockTime)&&blockTime>0,'chain-time unavailable');
  return {slot,blockTime,receivedAt:new Date().toISOString()};
 }
 function quote(dlmm,arrays,inRaw,sell){
  try{
   const q=dlmm.swapQuote(new anchor.BN(inRaw),sell,new anchor.BN(slippage),arrays,false);
   const consumed=raw(q.consumedInAmount),out=raw(q.outAmount),min=raw(q.minOutAmount);
   assert(consumed===inRaw&&BigInt(out)>0n&&BigInt(min)>0n&&BigInt(min)<=BigInt(out),'partial or invalid quote');
   return {status:'FULL_QUOTE',inRaw,outRaw:out,minOutRaw:min,feeRaw:raw(q.fee),protocolFeeRaw:raw(q.protocolFee),feeOnInput:q.feeOnInput,binArrays:q.binArraysPubkey.map(k=>k.toBase58())};
  }catch{return {status:'QUOTE_UNAVAILABLE',inRaw};}
 }
 try{
  const target=await load(pool),mint=target.tokenX.publicKey.toBase58(),decimals=target.tokenX.mint.decimals;
  report.mint=mint;report.decimals=decimals;
  for(const address of refs){
   try{
    const before=await bracket(),dlmm=await load(address);
    assert(dlmm.tokenX.publicKey.toBase58()===mint&&dlmm.tokenX.mint.decimals===decimals,'reference mint mismatch');
    const buyArrays=await dlmm.getBinArrayForSwap(false);
    const ask=quote(dlmm,buyArrays,probe,false);
    const sellArrays=await dlmm.getBinArrayForSwap(true);
    const sell=ladder.map(v=>quote(dlmm,sellArrays,v,true)),bid=sell[0];
    const after=await bracket();
    assert(after.slot>=before.slot&&after.blockTime>=before.blockTime,'nonmonotonic chain-time bracket');
    assert(bid.status==='FULL_QUOTE'&&ask.status==='FULL_QUOTE','two-sided probe unavailable');
    const math=quoteMath(bid,ask,sell,maxDiscount);
    report.references.push({pool:address,venue:'METEORA_DLMM',before,after,bid,ask,...math,status:'QUOTES_CAPTURED_UNVERIFIED'});
   }catch{report.gaps.push({pool:address,reason:'REFERENCE_READ_OR_QUOTE_FAILED'});}
  }
  report.status=report.references.length>=2&&!report.gaps.length?'REFERENCE_EVIDENCE_UNVERIFIED':'PARTIAL';
 }catch{report.gaps.push({pool,reason:'TARGET_IDENTITY_OR_RPC_FAILED'});}
 report.completedAt=new Date().toISOString();
 await writeFile(join(dir,'manifest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({directory:dir,status:report.status,references:report.references.length,gaps:report.gaps.length}));if(report.status!=='REFERENCE_EVIDENCE_UNVERIFIED')process.exitCode=1;
}
main().catch(()=>{console.error('T06 blocked: check inputs, dependencies, RPC or local storage.');process.exitCode=1;});

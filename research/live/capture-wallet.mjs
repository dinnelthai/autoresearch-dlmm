// T14 B1 read-only capture via explicitly configured RPC. No wallet secrets or signing.
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,ACCOUNT_SIZE,getAssociatedTokenAddressSync,unpackMint,unpackAccount,getExtensionTypes} from '@solana/spl-token';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {lamportsRaw,tokenObservation} from './wallet-evidence-core.mjs';
import {createReadRpc} from './rpc-read.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
const sha=v=>createHash('sha256').update(v).digest('hex');
const key=v=>{const p=new PublicKey(v);assert(p.toBase58()===v,'INVALID_PUBLIC_KEY');return p};
async function main(){
 const {values}=parseArgs({options:{wallet:{type:'string'},'mint-x':{type:'string'},'mint-y':{type:'string'},'decimals-x':{type:'string'},'min-slot':{type:'string'},genesis:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('SOLANA_RPC_URL=... node research/live/capture-wallet.mjs --wallet ADDRESS --mint-x MINT --mint-y WSOL --decimals-x N --min-slot SLOT --genesis EXPECTED_GENESIS_HASH');return}
 const wallet=key(values.wallet),x=key(values['mint-x']),y=key(values['mint-y']),dx=Number(values['decimals-x']),minSlot=Number(values['min-slot']),genesis=values.genesis;
 assert(y.equals(NATIVE_MINT)&&!x.equals(y)&&Number.isInteger(dx)&&dx>=0&&dx<=18&&Number.isSafeInteger(minSlot)&&minSlot>=0&&typeof genesis==='string'&&/^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(genesis),'WALLET_CAPTURE_ARGUMENTS_INVALID');
 assert(process.env.SOLANA_RPC_URL,'WALLET_RPC_NOT_CONFIGURED');
 const endpoint=new URL(process.env.SOLANA_RPC_URL);assert(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname),'WALLET_RPC_SCHEME_INVALID');
 const ax=getAssociatedTokenAddressSync(x,wallet,false,TOKEN_PROGRAM_ID),ay=getAssociatedTokenAddressSync(y,wallet,false,TOKEN_PROGRAM_ID);
 const addresses=[wallet,x,y,ax,ay].map(k=>k.toBase58());assert(new Set(addresses).size===5,'WALLET_CAPTURE_ADDRESS_COLLISION');
 const calls=[],transport=createReadRpc(endpoint,{maxBytes:512*1024,totalMs:8000,timeoutMs:4000,maxAttempts:2});
 async function rpc(method,params){
  const request={jsonrpc:'2.0',id:calls.length+1,method,params},startedAt=Date.now();const record={request,startedAt};calls.push(record);
  const r=await transport(request);record.receivedAt=Date.now();record.body=r.raw;record.attempts=r.attempts;return r.payload.result;
 }
 assert(await rpc('getGenesisHash',[])===genesis,'WALLET_RPC_GENESIS_MISMATCH');
 const result=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'finalized',minContextSlot:minSlot}]),receivedAt=Date.now();
 assert(Number.isSafeInteger(result?.context?.slot)&&result.context.slot>=minSlot&&Array.isArray(result.value)&&result.value.length===5,'WALLET_CAPTURE_CONTEXT_INVALID');
 function account(v){
  if(v===null)return null;
  assert(v&&v.data?.[1]==='base64'&&typeof v.data[0]==='string'&&v.executable===false,'WALLET_ACCOUNT_INVALID');
  const data=Buffer.from(v.data[0],'base64');assert(data.toString('base64')===v.data[0],'WALLET_ACCOUNT_INVALID');
  lamportsRaw(v.lamports);return {data,owner:key(v.owner),executable:false,lamports:v.lamports,rentEpoch:v.rentEpoch};
 }
 const [w,mx,my,tx,ty]=result.value.map(account);
 assert(w===null||w.owner.equals(SystemProgram.programId)&&w.data.length===0,'WALLET_ACCOUNT_UNSUPPORTED');
 for(const [mint,info,dec] of [[x,mx,dx],[y,my,9]]){assert(info?.owner.equals(TOKEN_PROGRAM_ID),'WALLET_MINT_UNSUPPORTED');const decoded=unpackMint(mint,info,TOKEN_PROGRAM_ID);assert(decoded.isInitialized&&decoded.decimals===dec&&!getExtensionTypes(decoded.tlvData).length,'WALLET_MINT_MISMATCH')}
 function decode(ata,mint,info){if(!info)return {address:ata.toBase58(),...tokenObservation(null)};assert(info.owner.equals(TOKEN_PROGRAM_ID)&&info.data.length===ACCOUNT_SIZE,'WALLET_ATA_UNSUPPORTED');const a=unpackAccount(ata,info,TOKEN_PROGRAM_ID);assert(a.owner.equals(wallet)&&a.mint.equals(mint),'WALLET_ATA_IDENTITY_MISMATCH');return {address:ata.toBase58(),...tokenObservation(a)}}
 const memeAta=decode(ax,x,tx),wsolAta=decode(ay,y,ty);
 const rent=lamportsRaw(await rpc('getMinimumBalanceForRentExemption',[ACCOUNT_SIZE,{commitment:'finalized'}]));
 const raw=JSON.stringify(calls),rawHash=sha(raw);const root=join('data','raw');await mkdir(root,{recursive:true,mode:0o700});const directory=await mkdtemp(join(root,'wallet-'));
 await writeFile(join(directory,'rpc.json'),raw,{mode:0o600,flag:'wx'});
 const report={schemaVersion:1,status:'WALLET_CAPTURED_UNVERIFIED',decisionReady:false,executionReady:false,wallet:wallet.toBase58(),mintX:x.toBase58(),mintY:y.toBase58(),decimalsX:dx,decimalsY:9,genesisHash:genesis,commitment:'finalized',slot:result.context.slot,receivedAt,walletAccountStatus:w?'SYSTEM_ACCOUNT':'MISSING',nativeSolRaw:lamportsRaw(w?.lamports??0),memeAta,wsolAta,classicTokenAccountRentRaw:rent,rawHash,directory};
 await writeFile(join(directory,'manifest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(report));
}
main().catch(e=>{const m=String(e.message);console.log(JSON.stringify({status:'BLOCKED',decisionReady:false,executionReady:false,reason:/^(WALLET|RPC)_[A-Z0-9_]+$|^TOKEN_ACCOUNT_INVALID$|^INVALID_PUBLIC_KEY$/.test(m)?m:'WALLET_CAPTURE_FAILED'}));process.exitCode=1});

// Read-only T02 adapter. No RPC, signing or execution. Consumes T01 captures.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import anchor from '@coral-xyz/anchor';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT,unpackMint,unpackAccount,getExtensionTypes} from '@solana/spl-token';
const SDK_COMMIT='1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1';
const IDL_BLOB='6715f5cf19dffa8651a185ac0dd823218c6a2a75';
const PROGRAM=new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const sha=(buf)=>createHash('sha256').update(buf).digest('hex');
const blob=(buf)=>createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
const str=(v)=>new PublicKey(v).toBase58();
async function readCapture(dir){
 const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
 assert(m.schemaVersion===1&&m.commitment==='finalized'&&m.raw?.file==='accounts.json','not a T01 finalized capture');
 assert(m.status==='CAPTURED_UNVERIFIED'||m.status==='PARTIAL','capture is blocked');
 const raw=await readFile(join(dir,'accounts.json'));
 assert(sha(raw)===m.raw.sha256,'raw capture hash mismatch');
 const p=JSON.parse(raw);
 assert(p.jsonrpc==='2.0'&&p.id===1&&!p.error&&Number.isSafeInteger(p.result?.context?.slot)&&p.result.context.slot===m.contextSlot,'invalid RPC context');
 assert(Array.isArray(m.addresses)&&m.addresses[0]===m.pool&&new Set(m.addresses).size===m.addresses.length&&p.result.value.length===m.addresses.length,'address mapping mismatch');
 const accounts=new Map(m.addresses.map((a,i)=>{
  assert(str(a)===a,'invalid account address');
  const v=p.result.value[i];if(v===null)return [a,null];
  assert(v.data?.[1]==='base64'&&typeof v.data[0]==='string','expected base64 raw account');
  const data=Buffer.from(v.data[0],'base64');assert(data.toString('base64')===v.data[0],'invalid base64');
  assert(typeof v.executable==='boolean','missing executable flag');
  return [a,{data,owner:new PublicKey(v.owner),executable:v.executable,lamports:v.lamports,rentEpoch:v.rentEpoch}];
 }));
 return {m,accounts};
}
function tokenProgram(info){
 assert(info&&!info.executable,'missing/invalid token account');
 assert(info.owner.equals(TOKEN_PROGRAM_ID)||info.owner.equals(TOKEN_2022_PROGRAM_ID),'unknown token program');
 return info.owner;
}
export async function loadMarketCapture(capture,idlPath){
 const bytes=await readFile(idlPath);assert(blob(bytes)===IDL_BLOB,'pinned IDL mismatch');
 const idl=JSON.parse(bytes);assert(idl.address===PROGRAM.toBase58(),'IDL program mismatch');
 const {m,accounts}=await readCapture(capture),coder=new anchor.BorshAccountsCoder(idl),raw=accounts.get(m.pool);
 assert(raw&&!raw.executable&&raw.owner.equals(PROGRAM),'Pool account owner mismatch or missing');
 return {m,accounts,coder,pair:coder.decode('LbPair',raw.data)};
}
export function decodePool({m,accounts,pair}){
 const poolKey=new PublicKey(m.pool);
 const mintX=str(pair.token_x_mint),mintY=str(pair.token_y_mint),vaultX=str(pair.reserve_x),vaultY=str(pair.reserve_y);
 assert(new Set([mintX,mintY,vaultX,vaultY,m.pool]).size===5,'invalid duplicate account identities');
 assert(Number.isInteger(pair.active_id)&&Number.isInteger(pair.bin_step)&&pair.bin_step>0,'invalid pool price grid');
 const required=[mintX,mintY,vaultX,vaultY];
 const result={sdkCommit:SDK_COMMIT,idlBlob:IDL_BLOB,slot:m.contextSlot,rawHash:m.raw.sha256,pool:m.pool,mintX,mintY,vaultX,vaultY,activeId:pair.active_id,binStep:pair.bin_step,poolStatus:pair.status,requiredAccounts:required,status:'POOL_DECODED_UNVERIFIED'};
 const missing=required.filter(a=>!accounts.get(a));
 if(missing.length){result.missing=missing;return result;}
 const sides=[[mintX,vaultX],[mintY,vaultY]].map(([mint,vault])=>{
  const mi=accounts.get(mint),vi=accounts.get(vault),program=tokenProgram(mi);
  assert(tokenProgram(vi).equals(program),'mint/vault token program mismatch');
  const decodedMint=unpackMint(new PublicKey(mint),mi,program),decodedVault=unpackAccount(new PublicKey(vault),vi,program);
  assert(decodedMint.isInitialized&&decodedVault.isInitialized,'mint/vault uninitialized');
  assert(decodedVault.mint.toBase58()===mint,'vault mint mismatch');
  assert(decodedVault.owner.equals(poolKey),'vault authority differs from LbPair; investigate');
  return {mint,vault,tokenProgram:program.toBase58(),decimals:decodedMint.decimals,mintExtensions:getExtensionTypes(decodedMint.tlvData),vaultExtensions:getExtensionTypes(decodedVault.tlvData),vaultAmountRaw:decodedVault.amount.toString(),vaultFrozen:decodedVault.isFrozen};
 });
 result.sides=sides;result.orientation=mintY===NATIVE_MINT.toBase58()?'MEME_X_SOL_Y':mintX===NATIVE_MINT.toBase58()?'SOL_X_MEME_Y':'NON_SOL';
 const supported=result.orientation==='MEME_X_SOL_Y'&&sides[1].decimals===9&&sides.every(s=>s.tokenProgram===TOKEN_PROGRAM_ID.toBase58()&&!s.mintExtensions.length&&!s.vaultExtensions.length&&!s.vaultFrozen);
 result.status=supported?'IDENTITY_CHECKED_UNVERIFIED':'UNSUPPORTED_ENGINE_INPUT';
 result.limitations=['Input evidence is a supplied T01 capture, not independent RPC verification.','Token-2022 and reverse token orientation are not supported by the current strategy adapter.','No BinArray, historical state, execution or income validation.'];
 return result;
}
async function main(){
 const {values}=parseArgs({options:{capture:{type:'string'},idl:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/inspect-pool.mjs --capture data/raw/accounts-... --idl data/raw/dlmm-idl.json');return;}
 assert(values.capture&&values.idl,'capture and pinned IDL required');
 const result=decodePool(await loadMarketCapture(values.capture,values.idl));
 console.log(JSON.stringify(result,null,2));if(result.status!=='IDENTITY_CHECKED_UNVERIFIED')process.exitCode=1;
}
export {readCapture,PROGRAM,SDK_COMMIT,IDL_BLOB,blob};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('T02 blocked: '+e.message);process.exitCode=1;});

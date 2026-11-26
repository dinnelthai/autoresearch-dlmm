// B6 isolated loopback RPC simulation only. Exact unsigned message, no blockhash replacement.
import {PublicKey,SystemProgram,VersionedTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token';
import {reconcileOpenSimulation} from './simulation-core.mjs';
import {createHash} from 'node:crypto';
const assert=(v,m)=>{if(!v)throw Error(m)},sha=v=>createHash('sha256').update(v).digest('hex');
const number=v=>{assert(Number.isSafeInteger(v)&&v>=0,'SIM_RPC_INTEGER_UNSAFE');return v};
const raw=v=>{const s=v.toString();assert(/^\d+$/.test(s),'SIM_RAW_INVALID');return s};
function account(v){
 if(v===null)return null;
 assert(v&&v.data?.[1]==='base64'&&typeof v.executable==='boolean','SIM_ACCOUNT_INVALID');
 const data=Buffer.from(v.data[0],'base64');assert(data.toString('base64')===v.data[0],'SIM_ACCOUNT_INVALID');
 return {data,owner:new PublicKey(v.owner),lamports:number(v.lamports),executable:v.executable,rentEpoch:v.rentEpoch};
}
function identity(a){return a===null?null:[a.owner.toBase58(),a.lamports,a.executable,sha(a.data)]}
export async function simulateLocalOpen({endpoint,genesis,msg,messageHash,market,cfg,coder,program,addresses,low,high,allocation,funding}){
 const url=new URL(endpoint);assert(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname),'LOCAL_RPC_REQUIRED');
 assert(funding.status==='CAP_BUDGET_DIAGNOSTIC_ONLY','SIM_FUNDING_BLOCKED');
 const message=Buffer.from(msg.serialize());assert(sha(message)===messageHash,'SIM_MESSAGE_HASH_MISMATCH');
 const unsigned=new VersionedTransaction(msg);assert(unsigned.signatures.every(s=>s.every(v=>v===0)),'SIM_UNSIGNED_REQUIRED');
 const bytes=Buffer.from(unsigned.serialize());assert(bytes.length<=1232,'SIM_PACKET_LIMIT');
 const calls=[];async function rpc(method,params){
  const request={jsonrpc:'2.0',id:calls.length+1,method,params},entry={request,startedAt:Date.now()};calls.push(entry);
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(15000),redirect:'error'});
  assert(r.ok,'SIM_RPC_HTTP_FAILURE');const text=await r.text();assert(text.length<=4*1024*1024,'SIM_RPC_RESPONSE_TOO_LARGE');entry.body=text;entry.receivedAt=Date.now();
  const p=JSON.parse(text);assert(p.id===request.id&&p.jsonrpc==='2.0'&&!p.error,'SIM_RPC_ERROR');return p.result;
 }
 try{
  assert(await rpc('getGenesisHash',[])===genesis,'SIM_GENESIS_MISMATCH');
  const names=addresses.map(a=>a.toBase58());assert(names.length===11&&new Set(names).size===11,'SIM_ACCOUNT_SCOPE_INVALID');
  const options={encoding:'base64',commitment:'confirmed',minContextSlot:market.slot};
  const first=await rpc('getMultipleAccounts',[names,options]);assert(first.context.slot>=market.slot&&first.value.length===11,'SIM_PRE_CONTEXT_INVALID');
  const pre=first.value.map(account);
  const fee=await rpc('getFeeForMessage',[message.toString('base64'),{commitment:'confirmed',minContextSlot:first.context.slot}]);
  assert(fee.context.slot>=first.context.slot&&String(number(fee.value))===funding.fee.feeLamportsRaw,'SIM_FEE_CHANGED');
  const sim=await rpc('simulateTransaction',[bytes.toString('base64'),{encoding:'base64',commitment:'confirmed',sigVerify:false,replaceRecentBlockhash:false,minContextSlot:fee.context.slot,accounts:{encoding:'base64',addresses:names}}]);
  assert(sim.context.slot>=fee.context.slot,'SIM_CONTEXT_TOO_OLD');
  const last=await rpc('getMultipleAccounts',[names,{...options,minContextSlot:sim.context.slot}]);
  assert(last.context.slot>=sim.context.slot&&last.value.length===11,'SIM_POST_CONTEXT_INVALID');
  // Strict same-bank observation required; no reconstruction across moving banks.
  assert(first.context.slot===fee.context.slot&&fee.context.slot===sim.context.slot&&sim.context.slot===last.context.slot,'SIM_BANK_CONTEXT_CHANGED');
  assert(JSON.stringify(pre.map(identity))===JSON.stringify(last.value.map(account).map(identity)),'SIM_BASE_STATE_CHANGED');
  if(sim.value.err!==null)return {result:{status:'SIMULATION_PROGRAM_ERROR',decisionReady:false,executionReady:false,signingAvailable:false,error:sim.value.err,slot:sim.context.slot,unitsConsumed:sim.value.unitsConsumed??null},calls};
  assert(Array.isArray(sim.value.accounts)&&sim.value.accounts.length===11,'SIM_POST_ACCOUNTS_MISSING');
  const post=sim.value.accounts.map(account),[w,p,lp,mx,my,rx,ry,tx,ty,bl,bu]=addresses;
  assert(pre[1]===null&&post[1]&&post[1].owner.equals(program)&&!post[1].executable,'SIM_POSITION_CREATE_INVALID');
  for(const i of [0,2,3,4,5,6,7,8,9,10])assert(pre[i]&&post[i]&&pre[i].owner.equals(post[i].owner)&&pre[i].executable===post[i].executable,'SIM_ACCOUNT_OWNER_CHANGED');
  assert(pre[0].owner.equals(SystemProgram.programId)&&pre[0].data.length===0&&post[0].data.length===0,'SIM_WALLET_INVALID');
  for(const i of [3,4])assert(JSON.stringify(identity(pre[i]))===JSON.stringify(identity(post[i])),'SIM_MINT_CHANGED');
  for(const i of [2,5,6,7,8,9,10])assert(pre[i].lamports===post[i].lamports,'SIM_EXISTING_ACCOUNT_RENT_CHANGED');
  function token(a,i,owner,mint){const t=unpackAccount(addresses[i],a[i],TOKEN_PROGRAM_ID);assert(t.owner.equals(owner)&&t.mint.equals(mint)&&t.isInitialized&&!t.isFrozen&&!t.delegate&&!t.closeAuthority,'SIM_TOKEN_IDENTITY_CHANGED');return raw(t.amount)}
  function balances(a){return {nativeRaw:String(a[0].lamports),memeRaw:token(a,7,w,mx),wsolRaw:token(a,8,w,my),vaultXRaw:token(a,5,lp,mx),vaultYRaw:token(a,6,lp,my),positionRentRaw:String(a[1]?.lamports??0)}}
  const pos=coder.decode('PositionV2',post[1].data);
  assert(new PublicKey(pos.owner).equals(w)&&new PublicKey(pos.lb_pair).equals(lp)&&pos.lower_bin_id===allocation.lowerBinId&&pos.upper_bin_id===allocation.upperBinId&&Array.isArray(pos.liquidity_shares)&&pos.liquidity_shares.length>=allocation.rangeWidth,'SIM_POSITION_IDENTITY_INVALID');
  const a0=coder.decode('LbPair',pre[2].data),a1=coder.decode('LbPair',post[2].data);
  assert(a0.active_id===market.activeId&&a1.active_id===market.activeId&&a0.bin_step===market.binStep&&a1.bin_step===market.binStep,'SIM_ACTIVE_GRID_CHANGED');
  const bins=[];for(const [i,index] of [[9,low],[10,high]]){
   const b=coder.decode('BinArray',pre[i].data),a=coder.decode('BinArray',post[i].data);
   assert(b.version===3&&a.version===3&&b.index.toString()===index.toString()&&a.index.toString()===index.toString()&&new PublicKey(b.lb_pair).equals(lp)&&new PublicKey(a.lb_pair).equals(lp)&&b.bins.length===70&&a.bins.length===70,'SIM_ARRAY_INVALID');
   for(let j=0;j<70;j++){
    const id=Number(index.toString())*70+j,old=b.bins[j],next=a.bins[j],offset=id-pos.lower_bin_id;
    bins.push({binId:id,beforeX:raw(old.amount_x),beforeY:raw(old.amount_y),afterX:raw(next.amount_x),afterY:raw(next.amount_y),beforeSupply:raw(old.liquidity_supply),supply:raw(next.liquidity_supply),share:offset>=0&&offset<allocation.rangeWidth?raw(pos.liquidity_shares[offset]):'0'});
   }
  }
  const result=reconcileOpenSimulation({before:balances(pre),after:balances(post),bins,expected:{amountXRaw:allocation.totalMemeRaw,amountYRaw:allocation.totalSolRaw,rows:allocation.rows},feeRaw:String(fee.value),rentCapRaw:funding.rentCapRaw,reserveRaw:funding.fee.minReserveRaw,maxAmountErrorBps:cfg.maxAmountErrorBps});
  return {result:{...result,slot:sim.context.slot,unitsConsumed:sim.value.unitsConsumed??null,messageHash,positionDataLength:post[1].data.length,signatureVerification:false,blockhashReplaced:false,limitations:[...result.limitations,'Same reported RPC slot and stable requested prestate; program binary and complete CPI semantics are not independently verified.']},calls};
 }catch(e){return {result:{status:'SIMULATION_BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'SIMULATION_VALIDATION_FAILED',decisionReady:false,executionReady:false,signingAvailable:false},calls}}
}

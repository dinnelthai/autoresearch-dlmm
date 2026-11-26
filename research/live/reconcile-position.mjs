// T15 offline finalized archive adapter. Narrow direct lifecycle transactions only.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {PROGRAM,SDK_COMMIT,IDL_BLOB,blob} from './inspect-pool.mjs';
import {reconcilePositionTransaction,assembleLedger} from './position-ledger-core.mjs';
import {resolveReadMessage} from './transaction-version.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)},sha=v=>createHash('sha256').update(v).digest('hex');
const key=v=>{const a=new PublicKey(v).toBase58();assert(a===v,'PUBLIC_KEY_INVALID');return a};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n,'TOKEN_AMOUNT_INVALID');return v};
const lam=v=>{assert(Number.isSafeInteger(v)&&v>=0,'LAMPORT_PRECISION_UNSUPPORTED');return v};
const run=promisify(execFile),script=n=>fileURLToPath(new URL(n,import.meta.url));
const COMPUTE='ComputeBudget111111111111111111111111111111';
const TOKEN=TOKEN_PROGRAM_ID.toBase58(),DLMM=PROGRAM.toBase58();
async function inspect(n,args){
 try{return JSON.parse((await run(process.execPath,[script(n),...args],{maxBuffer:32*1024*1024,timeout:120000})).stdout)}
 catch(e){if(e.stdout)try{return JSON.parse(e.stdout)}catch{}throw Error('UPSTREAM_INSPECTION_FAILED')}
}
const KIND={PositionCreate:'CREATE',PositionClose:'CLOSE',AddLiquidity:'ADD',RemoveLiquidity:'REMOVE',ClaimFee:'CLAIM'};
const CALL={initialize_position:'CREATE',close_position:'CLOSE',add_liquidity_by_weight:'ADD',add_liquidity_one_side:'ADD',remove_liquidity:'REMOVE',claim_fee:'CLAIM'};
async function main(){
 const {values}=parseArgs({options:{capture:{type:'string',multiple:true},'pool-capture':{type:'string'},idl:{type:'string'},owner:{type:'string'},position:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/reconcile-position.mjs --capture data/raw/swaps-... [--capture ...] --pool-capture data/raw/accounts-... --idl data/raw/dlmm-idl.json --owner WALLET --position POSITION');return}
 assert(values.capture?.length&&values.capture.length<=20&&values['pool-capture']&&values.idl,'CAPTURE_INPUT_REQUIRED');
 const owner=key(values.owner),position=key(values.position);
 const idlBytes=await readFile(values.idl);assert(blob(idlBytes)===IDL_BLOB,'PINNED_IDL_MISMATCH');
 const idl=JSON.parse(idlBytes),defs=new Map(idl.instructions.map(i=>[Buffer.from(i.discriminator).toString('hex'),i]));
 const ident=await inspect('inspect-pool.mjs',['--capture',values['pool-capture'],'--idl',values.idl]);
 assert(ident.status==='IDENTITY_CHECKED_UNVERIFIED'&&ident.sdkCommit===SDK_COMMIT&&ident.idlBlob===IDL_BLOB,'POOL_IDENTITY_REQUIRED');
 const {pool,mintX,mintY,vaultX,vaultY}=ident;
 assert(new Set([owner,position,pool,mintX,mintY,vaultX,vaultY]).size===7,'IDENTITY_COLLISION');
 const ax=getAssociatedTokenAddressSync(new PublicKey(mintX),new PublicKey(owner),false,TOKEN_PROGRAM_ID).toBase58(),ay=getAssociatedTokenAddressSync(new PublicKey(mintY),new PublicKey(owner),false,TOKEN_PROGRAM_ID).toBase58();
 const observations=[],sources=[],archiveGaps=[];
 for(const dir of values.capture){
  const mb=await readFile(join(dir,'manifest.json')),m=JSON.parse(mb);
  assert(m.schemaVersion===1&&m.pool===pool&&m.position===position&&m.indexAddress===position&&m.commitment==='finalized'&&Array.isArray(m.files)&&Array.isArray(m.signatures),'POSITION_CAPTURE_MISMATCH');
  const decoded=await inspect('inspect-swaps.mjs',['--capture',dir,'--idl',values.idl]);
  assert(decoded.pool===pool&&decoded.position===position&&Array.isArray(decoded.transactions)&&Array.isArray(decoded.positionEvents),'DECODED_HISTORY_MISMATCH');
  sources.push({directory:dir,manifestHash:sha(mb),status:m.status,stopReason:m.stopReason,signatureCount:m.signatures.length});
  for(const g of decoded.gaps??[])archiveGaps.push({directory:dir,...g});
  const files=new Map(m.files.map(f=>[f.file,f]));assert(files.size===m.files.length,'DUPLICATE_ARCHIVE_FILE');
  for(const s of m.signatures){
   let slot=s.slot,txIndex=null;
   try{
    assert(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s.signature)&&Number.isSafeInteger(slot),'INVALID_SIGNATURE');
    const filename='tx-'+s.signature+'.json',f=files.get(filename);
    assert(f?.method==='getTransaction'&&f.params?.[0]===s.signature&&f.params?.[1]?.commitment==='finalized','TRANSACTION_REQUEST_MISMATCH');
    const b=await readFile(join(dir,filename));assert(sha(b)===f.sha256,'TRANSACTION_HASH_MISMATCH');
    const envelope=JSON.parse(b),tx=envelope.result;assert(envelope.jsonrpc==='2.0'&&envelope.id===f.requestId&&!envelope.error&&tx?.slot===slot&&tx.transaction?.signatures?.[0]===s.signature&&tx.meta,'TRANSACTION_IDENTITY_MISMATCH');
    const record=decoded.transactions.find(t=>t.signature===s.signature);
    assert(record&&record.slot===slot&&Number.isSafeInteger(record.txIndex)&&record.success===(tx.meta.err===null),'DECODED_TRANSACTION_MISSING');txIndex=record.txIndex;
    assert(!(decoded.gaps??[]).some(g=>g.signature===s.signature||g.slot===slot&&!g.signature),'TRANSACTION_EVIDENCE_GAP');
    const {meta,msg,keys}=resolveReadMessage(tx);
    assert(keys.every(k=>key(k)===k)&&new Set(keys).size===keys.length&&keys[0]===owner&&keys.includes(position),'OWNER_FEEPAYER_SCOPE_REQUIRED');
    const sigCount=msg.header.numRequiredSignatures;
    assert(Number.isInteger(sigCount)&&sigCount>=1&&sigCount<=2&&keys.slice(0,sigCount).every(k=>k===owner||k===position),'SIGNER_SCOPE_UNSUPPORTED');
    const calls=[];
    for(const [index,ix] of msg.instructions.entries()){
     const program=keys[ix.programIdIndex];assert(Array.isArray(ix.accounts)&&ix.accounts.every(i=>Number.isInteger(i)&&keys[i]),'INSTRUCTION_ACCOUNT_INVALID');
     if(program===COMPUTE){assert(!ix.accounts.length,'COMPUTE_SCOPE_INVALID');continue}
     assert(program===DLMM,'UNSUPPORTED_OUTER_PROGRAM');
     const data=Buffer.from(bs58.decode(ix.data)),def=defs.get(data.subarray(0,8).toString('hex')),kind=CALL[def?.name];
     assert(kind&&def.accounts.length===ix.accounts.length,'UNSUPPORTED_DLMM_CALL');
     const roles=Object.fromEntries(def.accounts.map((a,i)=>[a.name,keys[ix.accounts[i]]]));
     assert(roles.position===position&&roles.lb_pair===pool,'POSITION_OR_POOL_ROLE_MISMATCH');
     assert(kind==='CREATE'?roles.owner===owner&&roles.payer===owner:roles.sender===owner,'ACTOR_ROLE_MISMATCH');
     if(kind==='CLOSE')assert(roles.rent_receiver===owner,'RENT_RECEIVER_MISMATCH');
     if(kind==='ADD'&&def.name==='add_liquidity_one_side'){
      assert(roles.token_program===TOKEN&&((roles.user_token===ax&&roles.reserve===vaultX&&roles.token_mint===mintX)||(roles.user_token===ay&&roles.reserve===vaultY&&roles.token_mint===mintY)),'TOKEN_ROLE_MISMATCH');
     }else if(['ADD','REMOVE','CLAIM'].includes(kind)){
      assert(roles.user_token_x===ax&&roles.user_token_y===ay&&roles.reserve_x===vaultX&&roles.reserve_y===vaultY&&roles.token_x_mint===mintX&&roles.token_y_mint===mintY&&(kind==='CLAIM'?roles.token_program===TOKEN:roles.token_x_program===TOKEN&&roles.token_y_program===TOKEN),'TOKEN_ROLE_MISMATCH');
     }
     calls.push({index,kind});
    }
    assert(calls.length>0&&calls.length<=2&&new Set(calls.map(x=>x.kind)).size===calls.length,'COMPOSITE_CALL_UNSUPPORTED');
    const life=decoded.positionEvents.filter(e=>e.signature===s.signature);
    const events=life.map(e=>{const kind=KIND[e.event];assert(kind&&e.actor===owner&&e.source==='CPI'&&calls.some(c=>c.kind===kind&&c.index===e.outerIndex),'EVENT_SCOPE_UNSUPPORTED');return {kind,amountXRaw:e.amountXRaw??e.feeXRaw??'0',amountYRaw:e.amountYRaw??e.feeYRaw??'0'}});
    const success=meta.err===null;
    if(success)assert(events.length===calls.length&&calls.every(c=>events.filter(e=>e.kind===c.kind).length===1),'LIFECYCLE_CALL_EVENT_MISMATCH');
    else assert(!events.length,'FAILED_EVENT_UNEXPECTED');
    const pre=meta.preTokenBalances,post=meta.postTokenBalances;
    assert(Array.isArray(pre)&&Array.isArray(post)&&Array.isArray(meta.preBalances)&&Array.isArray(meta.postBalances)&&meta.preBalances.length===keys.length&&meta.postBalances.length===keys.length,'BALANCE_EVIDENCE_MISSING');
    const map=rows=>{const result=new Map();for(const r of rows){assert(Number.isInteger(r.accountIndex)&&keys[r.accountIndex]&&!result.has(r.accountIndex),'TOKEN_BALANCE_DUPLICATE');result.set(r.accountIndex,r)}return result};
    const pm=map(pre),qm=map(post);
    function pair(address,mint,authority,decimals){
     const i=keys.indexOf(address);
     if(i<0)return {pre:'0',post:'0'}; // absent message account: no possible balance delta, not an observed balance
     const a=pm.get(i),b=qm.get(i);assert(a&&b&&[a,b].every(v=>v.mint===mint&&v.owner===authority&&v.programId===TOKEN&&v.uiTokenAmount?.decimals===decimals),'TOKEN_BALANCE_IDENTITY_MISMATCH');
     return {pre:raw(a.uiTokenAmount.amount),post:raw(b.uiTokenAmount.amount)};
    }
    const walletX=pair(ax,mintX,owner,ident.sides[0].decimals),walletY=pair(ay,mintY,owner,9),poolX=pair(vaultX,mintX,pool,ident.sides[0].decimals),poolY=pair(vaultY,mintY,pool,9);
    const permitted=new Set([ax,ay,vaultX,vaultY]);
    let otherTokenBalancesUnchanged=true;
    for(const i of new Set([...pm.keys(),...qm.keys()]))if(!permitted.has(keys[i])){
     const a=pm.get(i),b=qm.get(i);
     if(!a||!b||a.owner!==b.owner||a.programId!==b.programId||a.mint!==b.mint||raw(a.uiTokenAmount.amount)!==raw(b.uiTokenAmount.amount))otherTokenBalancesUnchanged=false;
    }
    const posIndex=keys.indexOf(position),otherLamportsUnchanged=keys.every((_,i)=>i===0||i===posIndex||lam(meta.preBalances[i])===lam(meta.postBalances[i]));
    const result=reconcilePositionTransaction({source:'FINALIZED_RPC_CAPTURE',scopeValidated:true,signature:s.signature,slot,txIndex,blockTime:tx.blockTime,success,events,feeRaw:String(lam(meta.fee)),preWalletLamports:meta.preBalances[0],postWalletLamports:meta.postBalances[0],prePositionLamports:meta.preBalances[posIndex],postPositionLamports:meta.postBalances[posIndex],walletX,walletY,vaultX:poolX,vaultY:poolY,otherLamportsUnchanged,otherTokenBalancesUnchanged});
    observations.push({...result,transactionHash:sha(JSON.stringify(tx))});
   }catch(e){observations.push({status:'BLOCKED',signature:s.signature,slot,txIndex,reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'ARCHIVE_TRANSACTION_RECONCILIATION_FAILED'})}
  }
 }
 const ledger=assembleLedger({pool,position,owner,mintX,mintY,observations});
 const result={...ledger,status:archiveGaps.length?'PARTIAL_LEDGER':ledger.status,archiveGaps,sources,identityCapture:{slot:ident.slot,rawHash:ident.rawHash},decimalsX:ident.sides[0].decimals,decimalsY:9,sdkCommit:SDK_COMMIT,idlBlob:IDL_BLOB,limitations:[...ledger.limitations,'Only narrow direct lifecycle calls with CPI events and aggregate wallet/vault deltas. No wrapping, swaps, combined claim/withdraw, rewards, rebalances, delegated payer or third-party account flows.','Current pool identity checked against historical transaction token metadata; historical program upgrade and CPI semantics remain unverified.']};
 console.log(JSON.stringify(result,null,2));if(result.status==='PARTIAL_LEDGER')process.exitCode=1;
}
main().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'LEDGER_CAPTURE_FAILED',decisionReady:false,executionReady:false,pnlReady:false}));process.exitCode=1});

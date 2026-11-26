// T04 offline transaction evidence inspection; not per-bin replay or PnL.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {PROGRAM,SDK_COMMIT,IDL_BLOB,blob} from './inspect-pool.mjs';
const assert=(v,m)=>{if(!v)throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const key=v=>new PublicKey(v).toBase58();
const u=(v,bits=64)=>{const n=BigInt(v.toString());assert(n>=0n&&n<(1n<<BigInt(bits)),'invalid unsigned field');return n.toString();};
const i32=v=>{assert(Number.isInteger(v)&&v>=-2147483648&&v<=2147483647,'invalid bin id');return v;};
const TAG=Buffer.from('e445a52e51cb9a1d','hex'); // Anchor event-CPI instruction tag.
function normalize(e,pool){
 const d=e.data;if(!['Swap','Swap2Evt'].includes(e.name)||key(d.lb_pair)!==pool)return null;
 assert(typeof d.swap_for_y==='boolean','direction absent');
 const row={event:e.name,pool,from:key(d.from),startBinId:i32(d.start_bin_id),endBinId:i32(d.end_bin_id),swapForY:d.swap_for_y,direction:d.swap_for_y?'X_TO_Y':'Y_TO_X',amountInRaw:u(d.amount_in),amountOutRaw:u(d.amount_out),feeBpsFieldRaw:u(d.fee_bps,128),protocolFeeRaw:u(d.protocol_fee),hostFeeRaw:u(d.host_fee),perBinStatus:'UNAVAILABLE'};
 if(e.name==='Swap2Evt'){assert(typeof d.fees_on_input==='boolean'&&typeof d.fees_on_token_x==='boolean','fee flags absent');Object.assign(row,{amountLeftRaw:u(d.amount_left),mmFeeRaw:u(d.mm_fee),limitOrderFeeRaw:u(d.limit_order_fee),feeOnInput:d.fees_on_input,feeToken:d.fees_on_token_x?'X':'Y'});}
 else Object.assign(row,{legacyFeeRaw:u(d.fee),mmFeeRaw:null,feeToken:null});
 return row;
}
function positionEvent(e,pool,position){
 if(!position)return null;
 const d=e.data;
 if(!['PositionCreate','PositionClose','AddLiquidity','RemoveLiquidity','ClaimFee','ClaimFee2','Rebalancing'].includes(e.name)||key(d.position)!==position)return null;
 if(e.name!=='PositionClose'&&key(d.lb_pair)!==pool)throw Error('position event pool mismatch');
 const r={event:e.name,position,pool:e.name==='PositionClose'?null:pool,actor:key(d.owner??d.from),amountsStatus:'EVENT_FIELDS_NOT_TRANSFER_RECONCILED'};
 if(e.name==='AddLiquidity'||e.name==='RemoveLiquidity'){assert(Array.isArray(d.amounts)&&d.amounts.length===2,'invalid lifecycle amounts');r.amountXRaw=u(d.amounts[0]);r.amountYRaw=u(d.amounts[1]);}
 if(e.name==='ClaimFee'||e.name==='ClaimFee2'){r.feeXRaw=u(d.fee_x);r.feeYRaw=u(d.fee_y);}
 if(e.name==='Rebalancing'){Object.assign(r,{withdrawXRaw:u(d.x_withdrawn_amount),withdrawYRaw:u(d.y_withdrawn_amount),addXRaw:u(d.x_added_amount),addYRaw:u(d.y_added_amount),feeXRaw:u(d.x_fee_amount),feeYRaw:u(d.y_fee_amount),rewardAmountsRaw:d.rewards.map(v=>u(v))});}
 return r;
}
function balances(meta,keys,address){
 const idx=keys.indexOf(address);if(idx<0)return null;
 const pre=meta.preTokenBalances?.filter(b=>b.accountIndex===idx),post=meta.postTokenBalances?.filter(b=>b.accountIndex===idx);
 if(pre?.length!==1||post?.length!==1||pre[0].mint!==post[0].mint)return null;
 return {mint:pre[0].mint,preRaw:u(pre[0].uiTokenAmount.amount),postRaw:u(post[0].uiTokenAmount.amount),deltaRaw:(BigInt(u(post[0].uiTokenAmount.amount))-BigInt(u(pre[0].uiTokenAmount.amount))).toString()};
}
async function main(){
 const {values}=parseArgs({options:{capture:{type:'string'},idl:{type:'string'},identity:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/inspect-swaps.mjs --capture data/raw/swaps-... --idl data/raw/dlmm-idl.json [--identity POOL_REPORT.json]');return;}
 assert(values.capture&&values.idl,'capture and IDL required');
 const bytes=await readFile(values.idl);assert(blob(bytes)===IDL_BLOB,'pinned IDL mismatch');const idl=JSON.parse(bytes);
 const coder=new anchor.BorshCoder(idl);const parser=new anchor.EventParser(PROGRAM,coder);
 const m=JSON.parse(await readFile(join(values.capture,'manifest.json'),'utf8'));assert(m.schemaVersion===1&&m.commitment==='finalized'&&key(m.pool)===m.pool&&Array.isArray(m.files)&&Array.isArray(m.signatures),'invalid capture manifest');
 const position=m.position?key(m.position):null;
 const identity=values.identity?JSON.parse(await readFile(values.identity,'utf8')):null;
 if(identity)assert(identity.pool===m.pool&&identity.sdkCommit===SDK_COMMIT&&identity.idlBlob===IDL_BLOB,'identity report mismatch');
 const files=new Map();for(const f of m.files){assert(typeof f.file==='string'&&/^(signatures-\d+|block-\d+|tx-[1-9A-HJ-NP-Za-km-z]{64,88})\.json$/.test(f.file)&&!files.has(f.file),'invalid or duplicate evidence path');files.set(f.file,f);}
 async function load(file,method,param){
  const f=files.get(file);assert(f&&f.method===method&&f.params?.[0]===param,'missing/mismatched request evidence');
  const b=await readFile(join(values.capture,file));assert(sha(b)===f.sha256,'evidence hash mismatch');const p=JSON.parse(b);assert(p.jsonrpc==='2.0'&&p.id===f.requestId&&!p.error&&p.result!=null,'invalid evidence payload');return p.result;
 }
 const report={pool:m.pool,sdkCommit:SDK_COMMIT,idlBlob:IDL_BLOB,status:'PARTIAL',position,events:[],positionEvents:[],transactions:[],gaps:[...(m.gaps??[])],limitations:['Supplied evidence only; no live or complete history claim.','CPI events preferred over log mirror; log-only evidence has no instruction path.','Transaction-level vault deltas are observations, not per-swap reconciliation.','No inferred per-bin fill, fee rate units or legacy MM fee.']};
 const seen=new Set(),blocks=new Map();
 for(const s of m.signatures){
  try{
   assert(typeof s.signature==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s.signature)&&Number.isSafeInteger(s.slot)&&s.slot>=0&&!seen.has(s.signature),'invalid or duplicate signature');seen.add(s.signature);
   const tx=await load('tx-'+s.signature+'.json','getTransaction',s.signature);assert(tx.slot===s.slot&&tx.transaction.signatures[0]===s.signature&&tx.meta,'transaction identity mismatch');
   if(!blocks.has(s.slot)){const b=await load('block-'+s.slot+'.json','getBlock',s.slot);assert(Array.isArray(b.signatures)&&new Set(b.signatures).size===b.signatures.length,'invalid block signature order');blocks.set(s.slot,b.signatures);}
   const txIndex=blocks.get(s.slot).indexOf(s.signature);assert(txIndex>=0,'transaction missing in block');
   const meta=tx.meta,msg=tx.transaction.message,keys=[...msg.accountKeys,...(meta.loadedAddresses?.writable??[]),...(meta.loadedAddresses?.readonly??[])];assert(keys.every(k=>typeof k==='string'),'unexpected account key format');
   const record={signature:s.signature,slot:s.slot,txIndex,blockTime:tx.blockTime,success:meta.err===null,networkFeeLamports:Number.isSafeInteger(meta.fee)?String(meta.fee):null,eventCount:0};
   if(identity){record.vaultX=balances(meta,keys,identity.vaultX);record.vaultY=balances(meta,keys,identity.vaultY);if(record.vaultX&&record.vaultX.mint!==identity.mintX||record.vaultY&&record.vaultY.mint!==identity.mintY)throw Error('vault mint mismatch');record.vaultStatus=record.vaultX&&record.vaultY?'DELTA_OBSERVED_NOT_RECONCILED':'MISSING';}
   if(!record.success){report.transactions.push(record);continue;}
   const cpi=[],logs=[],posCpi=[],posLogs=[];
   for(const group of meta.innerInstructions??[]){
    for(const [innerIndex,ix] of group.instructions.entries()){
     if(keys[ix.programIdIndex]!==PROGRAM.toBase58()||typeof ix.data!=='string')continue;
     const raw=Buffer.from(bs58.decode(ix.data));if(raw.length<8||!raw.subarray(0,8).equals(TAG))continue;
     const e=coder.events.decode(raw.subarray(8).toString('base64'));
     if(!e){report.gaps.push({signature:s.signature,reason:'UNKNOWN_CPI_EVENT'});continue;}
     const row=normalize(e,m.pool);if(row)cpi.push({...row,outerIndex:group.index,innerIndex,source:'CPI'});
     const life=positionEvent(e,m.pool,position);if(life)posCpi.push({...life,outerIndex:group.index,innerIndex,source:'CPI'});
    }
   }
   if(Array.isArray(meta.logMessages)){
    for(const e of parser.parseLogs(meta.logMessages)){const row=normalize(e,m.pool);if(row)logs.push({...row,outerIndex:null,innerIndex:null,source:'LOG'});const life=positionEvent(e,m.pool,position);if(life)posLogs.push({...life,outerIndex:null,innerIndex:null,source:'LOG'});}
   }else report.gaps.push({signature:s.signature,reason:'LOGS_UNAVAILABLE'});
   const fingerprint=r=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!['outerIndex','innerIndex','source'].includes(k))));
   if(cpi.length&&logs.length&&JSON.stringify(cpi.map(fingerprint))!==JSON.stringify(logs.map(fingerprint)))report.gaps.push({signature:s.signature,reason:'CPI_LOG_EVENT_MISMATCH'});
   const rows=cpi.length?cpi:logs;
   if(!cpi.length&&logs.length)report.gaps.push({signature:s.signature,reason:'LOG_ONLY_NO_INSTRUCTION_PATH'});
   // Detect known swap calls for this pool. A missing event is not proof of zero volume.
   const swaps=idl.instructions.filter(x=>/^swap/i.test(x.name)).map(x=>Buffer.from(x.discriminator));
   let calls=0;
   for(const ix of [...(msg.instructions??[]),...(meta.innerInstructions??[]).flatMap(g=>g.instructions)]){
    if(keys[ix.programIdIndex]!==PROGRAM.toBase58()||keys[ix.accounts?.[0]]!==m.pool||typeof ix.data!=='string')continue;
    const d=Buffer.from(bs58.decode(ix.data));if(swaps.some(tag=>d.subarray(0,tag.length).equals(tag)))calls++;
   }
   if(calls!==rows.length)report.gaps.push({signature:s.signature,reason:'SWAP_CALL_EVENT_COUNT_MISMATCH',calls,events:rows.length});
   if(meta.innerInstructions==null)report.gaps.push({signature:s.signature,reason:'INNER_INSTRUCTIONS_UNAVAILABLE'});
   for(const [eventIndex,row] of rows.entries())report.events.push({...row,signature:s.signature,slot:s.slot,txIndex,eventIndex,blockTime:tx.blockTime,id:s.signature+':'+row.source+':'+(row.outerIndex??'unknown')+':'+(row.innerIndex??eventIndex)});
   if(posCpi.length&&posLogs.length&&JSON.stringify(posCpi.map(fingerprint))!==JSON.stringify(posLogs.map(fingerprint)))report.gaps.push({signature:s.signature,reason:'POSITION_CPI_LOG_MISMATCH'});
   if(!posCpi.length&&posLogs.length)report.gaps.push({signature:s.signature,reason:'POSITION_LOG_ONLY_NO_INSTRUCTION_PATH'});
   for(const [eventIndex,row] of (posCpi.length?posCpi:posLogs).entries())report.positionEvents.push({...row,signature:s.signature,slot:s.slot,txIndex,eventIndex,blockTime:tx.blockTime,id:s.signature+':position:'+row.source+':'+(row.outerIndex??'unknown')+':'+(row.innerIndex??eventIndex)});
   record.eventCount=rows.length;record.swapCalls=calls;report.transactions.push(record);
  }catch(e){report.gaps.push({signature:s.signature,reason:'TRANSACTION_INSPECTION_FAILED',detail:e.message.slice(0,180)});}
 }
 report.events.sort((a,b)=>a.slot-b.slot||a.txIndex-b.txIndex||a.eventIndex-b.eventIndex);
 report.positionEvents.sort((a,b)=>a.slot-b.slot||a.txIndex-b.txIndex||a.eventIndex-b.eventIndex);
 report.transactions.sort((a,b)=>a.slot-b.slot||a.txIndex-b.txIndex);
 report.status=(position?report.positionEvents.length:report.events.length)&&!report.gaps.length?'EVENTS_DECODED_UNVERIFIED':'PARTIAL';
 if(position)report.limitations.push('Position lifecycle is bounded event evidence, not transfer-reconciled ledger; no inference of missing deposits, withdrawals, claim balances, ownership history or PnL.');
 console.log(JSON.stringify(report,null,2));if(report.status!=='EVENTS_DECODED_UNVERIFIED')process.exitCode=1;
}
main().catch(e=>{console.error('T04 inspection blocked: '+e.message);process.exitCode=1;});

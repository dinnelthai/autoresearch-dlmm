// T03 read-only adapter. Never joins different capture slots or invents missing bins.
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import anchor from '@coral-xyz/anchor';
import {PublicKey} from '@solana/web3.js';
import {deriveBinArray,deriveBinArrayBitmapExtension,getBinArrayLowerUpperBinId} from './sdk-runtime.mjs';
import {readCapture,PROGRAM,SDK_COMMIT,IDL_BLOB,blob} from './inspect-pool.mjs';
import {bitmapIndexes} from './bitmap.mjs';
import {decodeMarketBin} from './bin-version.mjs';
const assert=(v,msg)=>{if(!v)throw Error(msg);};
const key=v=>new PublicKey(v).toBase58();
const int=(v)=>{const n=Number(v.toString());assert(Number.isSafeInteger(n),'invalid integer');return n;};
async function main(){
 const {values}=parseArgs({options:{capture:{type:'string'},idl:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/inspect-bins.mjs --capture data/raw/accounts-... --idl data/raw/dlmm-idl.json');return;}
 assert(values.capture&&values.idl,'capture and pinned IDL required');
 const bytes=await readFile(values.idl);assert(blob(bytes)===IDL_BLOB,'pinned IDL mismatch');
 const idl=JSON.parse(bytes);assert(idl.address===PROGRAM.toBase58(),'IDL program mismatch');
 const coder=new anchor.BorshAccountsCoder(idl);
 const {m,accounts}=await readCapture(values.capture);
 const pool=new PublicKey(m.pool);
 function decode(address,name){const raw=accounts.get(address);assert(raw&&!raw.executable&&raw.owner.equals(PROGRAM),'missing account or owner mismatch: '+address);return coder.decode(name,raw.data);}
 const pair=decode(m.pool,'LbPair');
 const bitmap=deriveBinArrayBitmapExtension(pool,PROGRAM)[0].toBase58();
 const report={schemaVersion:1,sdkCommit:SDK_COMMIT,idlBlob:IDL_BLOB,slot:m.contextSlot,rawHash:m.raw.sha256,pool:m.pool,mintX:key(pair.token_x_mint),mintY:key(pair.token_y_mint),activeId:int(pair.active_id),binStep:int(pair.bin_step),bitmap,scope:'BITMAP_MARKED_ARRAYS_ONLY',status:'PARTIAL',limitations:['Supplied capture only; not independent RPC verification.','Bitmap membership is not proof of all allocated empty arrays.','No quote, position entitlement, or PnL calculation.']};
 assert(report.binStep>0,'invalid bin step');
 const print=()=>{console.log(JSON.stringify(report,null,2));if(report.status!=='BITMAP_COVERAGE_CHECKED_UNVERIFIED')process.exitCode=1;};
 if(!accounts.has(bitmap)){report.missing=[bitmap];print();return;}
 let ext=null;
 if(accounts.get(bitmap)){ext=decode(bitmap,'BinArrayBitmapExtension');assert(key(ext.lb_pair)===m.pool,'extension pool mismatch');}
 report.extension=ext?'PRESENT':'ABSENT_AT_CAPTURE_SLOT';
 const indexes=bitmapIndexes(pair.bin_array_bitmap,ext?.positive_bin_array_bitmap??null,ext?.negative_bin_array_bitmap??null);
 report.expected=indexes.map(index=>({index,address:deriveBinArray(pool,new anchor.BN(index),PROGRAM)[0].toBase58()}));
 assert(new Set(report.expected.map(e=>e.address)).size===report.expected.length,'duplicate derived array address');
 report.singleCapturePossible=indexes.length<=98;
 report.missing=report.expected.filter(e=>!accounts.get(e.address)).map(e=>e.address);
 // Always recompute from the pool/extension included in THIS capture. Do not stitch separate slots.
 report.arrays=[];report.unsupported=[];
 let totalX=0n,totalY=0n;
 for(const e of report.expected){
  if(!accounts.get(e.address))continue;
  const ba=decode(e.address,'BinArray');assert(key(ba.lb_pair)===m.pool,'BinArray pool mismatch');assert(int(ba.index)===e.index,'BinArray index mismatch');assert(Array.isArray(ba.bins)&&ba.bins.length===70,'BinArray layout mismatch');
  const version=int(ba.version);
  if(version!==2&&version!==3){report.unsupported.push({address:e.address,index:e.index,version,reason:'Bin layout semantics require version-specific validation'});continue;}
  const [lo,hi]=getBinArrayLowerUpperBinId(new anchor.BN(e.index)).map(int);
  assert(hi-lo===69,'SDK bin bounds mismatch');
  const bins=ba.bins.map((b,i)=>{
   const row=decodeMarketBin(b,lo+i,version);
   totalX+=BigInt(row.amountXRaw);totalY+=BigInt(row.amountYRaw);return row;
  });
  report.arrays.push({...e,version,lowerBinId:lo,upperBinId:hi,bins});
 }
 report.coverage={expected:indexes.length,decoded:report.arrays.length,missing:report.missing.length,unsupported:report.unsupported.length};
 report.decodedMmAmountsRaw={x:totalX.toString(),y:totalY.toString()};
 report.limitations.push('Totals sum only decoded MM bin principal, not vault balances, total TVL or executable depth. V2 order fields are unknown and not interpreted; reward and order semantics require separate validation.');
 if(!report.missing.length&&!report.unsupported.length)report.status='BITMAP_COVERAGE_CHECKED_UNVERIFIED';
 if(!report.singleCapturePossible)report.limitations.push('More than 98 arrays: current capture CLI cannot archive all in one request; retain partial coverage until an independently validated common-slot reconstruction is available.');
 print();
}
main().catch(e=>{console.error('T03 blocked: '+e.message);process.exitCode=1;});

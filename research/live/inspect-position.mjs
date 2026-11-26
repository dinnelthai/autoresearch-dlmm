// Read-only T05 position snapshot. Requires same-response pool, position and required arrays.
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import anchor from '@coral-xyz/anchor';
import {Connection,PublicKey} from '@solana/web3.js';
import {createProgram,wrapPosition,getBinArrayIndexesCoverage,deriveBinArray,getBinArrayLowerUpperBinId,POSITION_MAX_LENGTH} from '@meteora-ag/dlmm';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,unpackMint,getExtensionTypes} from '@solana/spl-token';
import {readCapture,PROGRAM,SDK_COMMIT,IDL_BLOB,blob} from './inspect-pool.mjs';
import {IntegerKernel as K} from '../integer.mjs';
const assert=(v,m)=>{if(!v)throw Error(m);};
const key=v=>new PublicKey(v).toBase58();
const raw=v=>{const s=v.toString();assert(/^\d+$/.test(s),'invalid unsigned integer');return s;};
async function main(){
 const {values}=parseArgs({options:{capture:{type:'string'},idl:{type:'string'},position:{type:'string'},owner:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/inspect-position.mjs --capture DIR --idl FILE --position ADDRESS [--owner WALLET]');return;}
 assert(values.capture&&values.idl&&values.position,'capture, IDL and position required');
 const position=key(values.position),bytes=await readFile(values.idl);assert(blob(bytes)===IDL_BLOB,'pinned IDL mismatch');
 const idl=JSON.parse(bytes);assert(idl.address===PROGRAM.toBase58(),'IDL program mismatch');
 const {m,accounts}=await readCapture(values.capture);const coder=new anchor.BorshAccountsCoder(idl);
 function programAccount(a){const v=accounts.get(a);assert(v&&!v.executable&&v.owner.equals(PROGRAM),'missing or wrong program account: '+a);return v;}
 const pair=coder.decode('LbPair',programAccount(m.pool).data);
 const miX=key(pair.token_x_mint),miY=key(pair.token_y_mint);
 const report={schemaVersion:1,sdkCommit:SDK_COMMIT,idlBlob:IDL_BLOB,pool:m.pool,position,slot:m.contextSlot,rawHash:m.raw.sha256,status:'PARTIAL',requiredAccounts:[miX,miY,position],limitations:['No historical cash flow, market valuation, reward entitlement or net PnL.','Calculated from supplied capture; no independent live verification.']};
 function output(){console.log(JSON.stringify(report,null,2));if(report.status!=='POSITION_CALCULATED_UNVERIFIED')process.exitCode=1;}
 if(!accounts.get(position)){report.missing=[position];output();return;}
 // createProgram creates a local coder/provider only; no RPC method is called here.
 const program=createProgram(new Connection('http://127.0.0.1:8899','finalized'),{programId:PROGRAM});
 // Verify that the SDK account discriminator matches the pinned IDL before using its extended-position wrapper.
 const actual=programAccount(position);
 const disc=idl.accounts.find(a=>a.name==='PositionV2')?.discriminator;
 assert(disc&&actual.data.subarray(0,8).equals(Buffer.from(disc)),'unsupported position account');
 const base=coder.decode('PositionV2',actual.data);
 assert(Number.isInteger(base.lower_bin_id)&&Number.isInteger(base.upper_bin_id)&&base.upper_bin_id>=base.lower_bin_id&&base.upper_bin_id-base.lower_bin_id+1<=POSITION_MAX_LENGTH.toNumber(),'invalid position width');
 const pos=wrapPosition(program,new PublicKey(position),actual);
 assert(pos.lbPair().toBase58()===m.pool,'position pool mismatch');
 const owner=pos.owner().toBase58();if(values.owner)assert(owner===key(values.owner),'position owner mismatch');
 const lo=pos.lowerBinId().toNumber(),hi=pos.upperBinId().toNumber(),width=hi-lo+1;
 assert(lo===base.lower_bin_id&&hi===base.upper_bin_id,'SDK/pinned IDL range mismatch');
 report.owner=owner;report.lowerBinId=lo;report.upperBinId=hi;report.operator=pos.operator().toBase58();report.feeOwner=pos.feeOwner().toBase58();report.lockReleasePointRaw=raw(pos.lockReleasePoint());
 report.claimedLifetimeRaw={x:raw(pos.totalClaimedFeeXAmount()),y:raw(pos.totalClaimedFeeYAmount())};
 report.claimedRewardsRaw=pos.totalClaimedRewards().map(raw);
 const arrayEntries=getBinArrayIndexesCoverage(pos.lowerBinId(),pos.upperBinId()).map(index=>({index:index.toNumber(),address:deriveBinArray(new PublicKey(m.pool),index,PROGRAM)[0].toBase58()}));
 report.requiredAccounts.push(...arrayEntries.map(a=>a.address));report.missing=report.requiredAccounts.filter(a=>!accounts.get(a));
 if(report.missing.length){output();return;}
 function mint(a){const info=accounts.get(a);assert(info&&!info.executable&&info.owner.equals(TOKEN_PROGRAM_ID),'unsupported token program');const v=unpackMint(new PublicKey(a),info,TOKEN_PROGRAM_ID);assert(v.isInitialized&&!getExtensionTypes(v.tlvData).length,'unsupported mint');return v;}
 const x=mint(miX),y=mint(miY);assert(miY===NATIVE_MINT.toBase58()&&miX!==miY&&y.decimals===9,'unsupported MEME_X_SOL_Y orientation');
 const shares=pos.liquidityShares(),fees=pos.feeInfos();
 assert(shares.length>=width&&fees.length>=width,'position bin data incomplete');
 const bins=new Map();
 for(const e of arrayEntries){
  const arr=coder.decode('BinArray',programAccount(e.address).data);
  assert(key(arr.lb_pair)===m.pool&&Number(arr.index.toString())===e.index&&arr.version===3&&arr.bins.length===70,'unsupported/mismatched BinArray');
  const [start,end]=getBinArrayLowerUpperBinId(new anchor.BN(e.index)).map(n=>n.toNumber());assert(end-start===69,'invalid array bounds');
  for(let i=0;i<70;i++)bins.set(start+i,arr.bins[i]);
 }
 const snapshot={sdkCommit:SDK_COMMIT,pool:m.pool,position,slot:m.contextSlot,tokenOrientation:'MEME_X_SOL_Y',tokenExtensions:false,decimalsX:x.decimals,decimalsY:y.decimals,binStep:raw(pair.bin_step),bins:[]};
 for(let i=0;i<width;i++){
  const id=lo+i,b=bins.get(id),f=fees[i];assert(b&&f,'missing position bin or checkpoint');
  snapshot.bins.push({binId:id,supply:raw(b.liquidity_supply),share:raw(shares[i]),amountX:raw(b.amount_x),amountY:raw(b.amount_y),feeGrowthX:raw(b.fee_amount_x_per_token_stored),feeGrowthY:raw(b.fee_amount_y_per_token_stored),checkpointX:raw(f.feeXPerTokenComplete),checkpointY:raw(f.feeYPerTokenComplete),pendingX:raw(f.feeXPending),pendingY:raw(f.feeYPending)});
 }
 const calc=JSON.parse(K.stringify(K.reconcile(snapshot)));
 report.snapshot=snapshot;report.accounting=calc;report.currentPrincipalRaw={x:calc.totals.principalX,y:calc.totals.principalY};report.pendingFeeRaw={x:calc.totals.feeX,y:calc.totals.feeY};
 report.status='POSITION_CALCULATED_UNVERIFIED';
 report.limitations.push('Claimed lifetime fees are historical counters, NOT current wallet balances or additional current NAV.','No replay asOf is assigned from local receipt time; a validated chain-time boundary is required before strategy replay.','SDK wrapper, fee formula, range and version must be cross-checked with actual SDK position data.');
 output();
}
main().catch(e=>{console.error('T05 blocked: '+e.message);process.exitCode=1;});

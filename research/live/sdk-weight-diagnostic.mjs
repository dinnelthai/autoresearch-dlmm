// Read-only runtime bridge to pinned Meteora helpers. No RPC, no transaction builder.
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {inspectWeightShape} from './weight-shape-core.mjs';
import {compareInverse} from './inverse-allocation-core.mjs';
const require=createRequire(import.meta.url);
export async function sdkWeightDiagnostic(d,market,config,captureDirectory){
 const blocked=reason=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,signingAvailable:false});
 if(d?.status==='NO_OPERATION')return {...blocked('NO_LP_BASELINE'),status:'NO_OPERATION'};
 if(d?.status!=='INTEGER_DIAGNOSTIC_ONLY')return blocked('INTEGER_DIAGNOSTIC_UNAVAILABLE');
 if(config?.enabled!==true)return blocked('SDK_WEIGHT_DIAGNOSTIC_DISABLED');
 if(!Number.isInteger(config.maxDeviationBps)||config.maxDeviationBps<0||config.maxDeviationBps>10000)return blocked('WEIGHT_TOLERANCE_REQUIRED');
 try{
  const entry=require.resolve('@meteora-ag/dlmm'),pkg=JSON.parse(await readFile(join(dirname(entry),'..','package.json'),'utf8'));
  if(pkg.name!=='@meteora-ag/dlmm'||pkg.version!=='1.9.15')return blocked('SDK_VERSION_MISMATCH');
  const sdk=await import('./sdk-runtime.mjs'),anchor=await import('@coral-xyz/anchor'),BN=anchor.BN??anchor.default?.BN;
  if(typeof sdk.toWeightDistribution!=='function'||typeof BN!=='function')return blocked('SDK_WEIGHT_HELPER_UNAVAILABLE');
  const positionLimit=Number(sdk.DEFAULT_BIN_PER_POSITION?.toString()),singleMessageExclusiveLimit=sdk.MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX;
  let sdkWeights=null;
  const output=inspectWeightShape(d,market,{maxDeviationBps:config.maxDeviationBps,positionLimit,singleMessageExclusiveLimit,convert:(x,y,rows,step)=>(sdkWeights=sdk.toWeightDistribution(new BN(x),new BN(y),rows.map(r=>({binId:r.binId,xAmountBpsOfTotal:new BN(r.xBps),yAmountBpsOfTotal:new BN(r.yBps)})),step))});
  const inverse=await inverseEstimate(d,market,config,captureDirectory,sdk,BN,sdkWeights,output);
  return {...output,inverse,sdkVersion:pkg.version,sourceReference:'1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1',versionCheck:'INSTALLED_PACKAGE_METADATA_ONLY'};
 }catch{return blocked('SDK_WEIGHT_RUNTIME_UNAVAILABLE')}
}

async function inverseEstimate(d,market,config,captureDirectory,sdk,BN,weights,shape){
 const block=reason=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,signingAvailable:false});
 if(shape.status!=='SDK_WEIGHT_SHAPE_DIAGNOSTIC_ONLY')return block('WEIGHT_SHAPE_UNAVAILABLE');
 if(config.inverseEnabled!==true)return block('SDK_INVERSE_DISABLED');
 if(!Number.isInteger(config.maxAmountErrorBps)||config.maxAmountErrorBps<0||config.maxAmountErrorBps>10000)return block('INVERSE_TOLERANCE_REQUIRED');
 if(!captureDirectory)return block('INVERSE_CAPTURE_UNAVAILABLE');
 try{
  const {readCapture}=await import('./inspect-pool.mjs');
  const {PublicKey,SYSVAR_CLOCK_PUBKEY}=await import('@solana/web3.js');
  const {TOKEN_PROGRAM_ID,NATIVE_MINT,unpackMint,getExtensionTypes}=await import('@solana/spl-token');
  const {m,accounts}=await readCapture(captureDirectory);
  if(m.pool!==market.pool||m.contextSlot!==market.slot||m.raw.sha256!==market.rawHash)return block('INVERSE_CAPTURE_MISMATCH');
  const clockInfo=accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58());
  if(!clockInfo||clockInfo.executable||clockInfo.owner.toBase58()!=='Sysvar1111111111111111111111111111111111111'||clockInfo.data.length!==40||typeof sdk.ClockLayout?.decode!=='function')return block('INVERSE_CLOCK_UNAVAILABLE');
  const clock=sdk.ClockLayout.decode(clockInfo.data);
  if(clock.slot.toString()!==String(market.slot)||!Number.isSafeInteger(Number(clock.epoch.toString())))return block('INVERSE_CLOCK_SLOT_MISMATCH');
  if(market.mintY!==NATIVE_MINT.toBase58())return block('INVERSE_MINT_UNSUPPORTED');
  const mints=[market.mintX,market.mintY].map((a,i)=>{
   const info=accounts.get(a);if(!info||info.executable||!info.owner.equals(TOKEN_PROGRAM_ID))throw Error('INVERSE_MINT_UNSUPPORTED');
   const mint=unpackMint(new PublicKey(a),info,TOKEN_PROGRAM_ID);
   if(!mint.isInitialized||mint.decimals!==(i?9:market.decimalsX)||getExtensionTypes(mint.tlvData).length)throw Error('INVERSE_MINT_UNSUPPORTED');
   return mint;
  });
  const [mx,my]=mints,x=new BN(d.totalMemeRaw),y=new BN(d.totalSolRaw);
  let result,helper,activeContext=null;
  if(x.isZero()){
   if(typeof sdk.toAmountBidSide!=='function')return block('SDK_INVERSE_HELPER_UNAVAILABLE');
   helper='toAmountBidSide';result=sdk.toAmountBidSide(market.activeId,y,weights,my,clock).map(b=>({binId:b.binId,memeRaw:'0',solRaw:b.amount.toString()}));
  }else if(y.isZero()){
   if(typeof sdk.toAmountAskSide!=='function')return block('SDK_INVERSE_HELPER_UNAVAILABLE');
   helper='toAmountAskSide';result=sdk.toAmountAskSide(market.activeId,market.binStep,x,weights,mx,clock).map(b=>({binId:b.binId,memeRaw:b.amount.toString(),solRaw:'0'}));
  }else{
   if(typeof sdk.toAmountBothSide!=='function')return block('SDK_INVERSE_HELPER_UNAVAILABLE');
   const active=market.bins.find(b=>b.binId===market.activeId);
   const valid=v=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n;
   if(!active||!valid(active.amountXRaw)||!valid(active.amountYRaw))return block('INVERSE_ACTIVE_BIN_UNAVAILABLE');
   activeContext={binId:active.binId,memeRaw:active.amountXRaw,solRaw:active.amountYRaw};
   helper='toAmountBothSide';result=sdk.toAmountBothSide(market.activeId,market.binStep,x,y,new BN(active.amountXRaw),new BN(active.amountYRaw),weights,mx,my,clock).map(b=>({binId:b.binId,memeRaw:b.amountX.toString(),solRaw:b.amountY.toString()}));
  }
  return {...compareInverse(d,market,result,config.maxAmountErrorBps),helper,activeContext,slot:market.slot,rawHash:market.rawHash,clockEpoch:clock.epoch.toString()};
 }catch(e){return block(e.message==='INVERSE_MINT_UNSUPPORTED'?e.message:'SDK_INVERSE_RUNTIME_UNAVAILABLE')}
}

// B5b isolated local-validator SDK construction. Never signs or submits.
import DLMM,{deriveBinArray,deriveEventAuthority,binIdToBinArrayIndex,toWeightDistribution,MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX,DEFAULT_BIN_PER_POSITION} from '@meteora-ag/dlmm';
import anchor from '@coral-xyz/anchor';
import {Connection,PublicKey,SystemProgram,SYSVAR_RENT_PUBKEY} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync,unpackAccount,unpackMint,getExtensionTypes} from '@solana/spl-token';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {readCapture,PROGRAM,IDL_BLOB,blob} from './inspect-pool.mjs';
import {currentMarket,reviewMatches} from './terminal-core.mjs';
import {buildReview} from './review-core.mjs';
import {allocationDiagnostic} from './allocation-diagnostic.mjs';
import {sdkWeightDiagnostic} from './sdk-weight-diagnostic.mjs';
import {checkOpenInstructions,checkFunding,decodeOpenArgs} from './open-message-core.mjs';
import {DLMM as PROGRAM_ADDRESS,COMPUTE} from './message-audit-core.mjs';
import {simulateLocalOpen} from './simulate-local-open.mjs';
const BN=anchor.BN,require=createRequire(import.meta.url),assert=(v,m)=>{if(!v)throw Error(m)},sha=v=>createHash('sha256').update(v).digest('hex');
const key=v=>{const p=new PublicKey(v);assert(p.toBase58()===v,'INVALID_PUBLIC_KEY');return p};
const raw=v=>{assert(typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n,'INVALID_RAW_AMOUNT');return BigInt(v)};
const numeric=v=>{assert(Number.isSafeInteger(v)&&v>=0,'RPC_INTEGER_UNSAFE');return v};
const dataRoot=resolve('data');
async function json(path){const p=resolve(path),r=relative(dataRoot,p);assert(r&&!r.startsWith('..')&&!isAbsolute(r),'LOCAL_DATA_PATH_REQUIRED');return JSON.parse(await readFile(p,'utf8'))}
async function main(){
 const {values}=parseArgs({options:{input:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/build-local-open.mjs --input data/local-open.json');return}
 const cfg=await json(values.input);
 assert(cfg.schemaVersion===1&&cfg.scope==='LOCAL_VALIDATOR_UNSIGNED_OPEN_ONLY','LOCAL_TEST_SCOPE_REQUIRED');
 const endpoint=new URL(process.env.SOLANA_RPC_URL??'http://127.0.0.1:8899');
 assert(endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'LOCAL_RPC_REQUIRED');
 const genesis=cfg.expectedGenesisHash;assert(typeof genesis==='string'&&genesis.length>=20&&genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','NON_MAINNET_GENESIS_REQUIRED');
 const pkg=JSON.parse(await readFile(join(dirname(require.resolve('@meteora-ag/dlmm')),'..','package.json'),'utf8'));
 assert(pkg.version==='1.9.15'&&pkg.name==='@meteora-ag/dlmm','SDK_VERSION_MISMATCH');
 const wallet=key(cfg.wallet),position=key(cfg.position),pool=key(cfg.pool);
 assert(new Set([cfg.wallet,cfg.position,cfg.pool]).size===3,'IDENTITY_COLLISION');
 const state=await json(cfg.state),report=await json(cfg.report),review=await json(cfg.review),now=Date.now();
 const market=currentMarket(state,cfg.pool,now,180000);reviewMatches(review,market,now);
 const reviewHash=sha(await readFile(resolve(cfg.review)));const r=buildReview({report,mode:'plans',rowIndex:cfg.rowIndex,wallet:cfg.wallet,market,reviewHash,now});
 assert(r.action==='OPEN','OPEN_ONLY');
 const row=report.planPreview.families[cfg.rowIndex].best,d=allocationDiagnostic({row,market,budget:report.terminalBinding.researchBudget});
 assert(d.status==='INTEGER_DIAGNOSTIC_ONLY','INTEGER_DIAGNOSTIC_BLOCKED');
 const capturePath=resolve(market.capture),rel=relative(dataRoot,capturePath);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'CAPTURE_PATH_INVALID');
 const {m,accounts}=await readCapture(capturePath);
 assert(m.pool===cfg.pool&&m.contextSlot===market.slot&&m.raw.sha256===market.rawHash,'CAPTURE_BINDING_INVALID');
 const wd=await sdkWeightDiagnostic(d,market,{enabled:true,inverseEnabled:true,maxDeviationBps:cfg.maxDeviationBps,maxAmountErrorBps:cfg.maxAmountErrorBps},capturePath);
 assert(wd.status==='SDK_WEIGHT_SHAPE_DIAGNOSTIC_ONLY'&&wd.inverse?.status==='SDK_INVERSE_ESTIMATE_ONLY','SDK_DIAGNOSTIC_BLOCKED');
 const idlBytes=await readFile(cfg.idl);assert(blob(idlBytes)===IDL_BLOB,'PINNED_IDL_MISMATCH');const idl=JSON.parse(idlBytes),coder=new anchor.BorshAccountsCoder(idl);
 const capturePair=accounts.get(cfg.pool);assert(capturePair?.owner.equals(PROGRAM),'POOL_CAPTURE_INVALID');
 const pair=coder.decode('LbPair',capturePair.data),mintX=key(market.mintX),mintY=key(market.mintY),reserveX=new PublicKey(pair.reserve_x),reserveY=new PublicKey(pair.reserve_y);
 assert(mintY.equals(NATIVE_MINT)&&!mintX.equals(mintY)&&new PublicKey(pair.token_x_mint).equals(mintX)&&new PublicKey(pair.token_y_mint).equals(mintY),'MINT_SCOPE_UNSUPPORTED');
 const ax=getAssociatedTokenAddressSync(mintX,wallet,false,TOKEN_PROGRAM_ID),ay=getAssociatedTokenAddressSync(mintY,wallet,false,TOKEN_PROGRAM_ID);
 const low=binIdToBinArrayIndex(new BN(d.lowerBinId)),high=BN.max(low.add(new BN(1)),binIdToBinArrayIndex(new BN(d.upperBinId)));
 assert(low.toNumber()>=-512&&high.toNumber()<=511,'BITMAP_EXTENSION_UNSUPPORTED');
 const al=deriveBinArray(pool,low,PROGRAM)[0],au=deriveBinArray(pool,high,PROGRAM)[0],event=deriveEventAuthority(PROGRAM)[0];
 const conn=new Connection(endpoint.toString(),'confirmed');assert(await conn.getGenesisHash()===genesis,'GENESIS_MISMATCH');
 const addresses=[wallet,position,pool,mintX,mintY,reserveX,reserveY,ax,ay,al,au];
 const snapshot=async()=>{
  const q=await conn.getMultipleAccountsInfoAndContext(addresses,{commitment:'confirmed',minContextSlot:market.slot});
  assert(q.context.slot>=market.slot,'RPC_CONTEXT_TOO_OLD');const [w,p,lp,mx,my,rx,ry,tx,ty,bl,bu]=q.value;
  assert(w&&w.owner.equals(SystemProgram.programId)&&!w.executable&&!w.data.length&&p===null,'WALLET_OR_POSITION_INVALID');
  for(const [address,info] of [[pool,lp],[mintX,mx],[mintY,my],[reserveX,rx],[reserveY,ry],[al,bl],[au,bu]]){
   const old=accounts.get(address.toBase58());assert(old&&info&&!info.executable&&old.owner.equals(info.owner)&&old.data.equals(info.data),'CAPTURE_ACCOUNT_CHANGED_OR_MISSING');
  }
  for(const [mint,info,dec] of [[mintX,mx,market.decimalsX],[mintY,my,9]]){assert(info.owner.equals(TOKEN_PROGRAM_ID),'MINT_UNSUPPORTED');const v=unpackMint(mint,info,TOKEN_PROGRAM_ID);assert(v.isInitialized&&v.decimals===dec&&!getExtensionTypes(v.tlvData).length,'MINT_UNSUPPORTED')}
  for(const [address,info,mint] of [[reserveX,rx,mintX],[reserveY,ry,mintY]]){assert(info.owner.equals(TOKEN_PROGRAM_ID),'VAULT_UNSUPPORTED');const a=unpackAccount(address,info,TOKEN_PROGRAM_ID);assert(a.isInitialized&&!a.isFrozen&&a.owner.equals(pool)&&a.mint.equals(mint)&&!getExtensionTypes(a.tlvData).length,'VAULT_UNSUPPORTED')}
  for(const [info,index] of [[bl,low],[bu,high]]){assert(info.owner.equals(PROGRAM),'BIN_ARRAY_UNSUPPORTED');const b=coder.decode('BinArray',info.data);assert(new PublicKey(b.lb_pair).equals(pool)&&b.index.toString()===index.toString()&&Number(b.version)===3,'BIN_ARRAY_IDENTITY_INVALID')}
  function token(address,info,mint){assert(info&&!info.executable&&info.owner.equals(TOKEN_PROGRAM_ID),'EXISTING_ATA_REQUIRED');const a=unpackAccount(address,info,TOKEN_PROGRAM_ID);assert(a.isInitialized&&!a.isFrozen&&!a.delegate&&!a.closeAuthority&&a.owner.equals(wallet)&&a.mint.equals(mint)&&!getExtensionTypes(a.tlvData).length,'ATA_UNSUPPORTED');return a.amount.toString()}
  return {slot:q.context.slot,nativeSolRaw:String(numeric(w.lamports)),memeAtaRaw:token(ax,tx,mintX),wsolAtaRaw:token(ay,ty,mintY)};
 };
 await snapshot();
 const x=raw(d.totalMemeRaw),y=raw(d.totalSolRaw);
 const bps=d.rows.map(b=>({binId:b.binId,xAmountBpsOfTotal:new BN(x?String(raw(b.memeRaw)*10000n/x):'0'),yAmountBpsOfTotal:new BN(y?String(raw(b.solRaw)*10000n/y):'0')}));
 assert(d.rangeWidth===bps.length&&d.rangeWidth<=Number(DEFAULT_BIN_PER_POSITION.toString())&&bps.length<MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX,'SINGLE_MESSAGE_SCOPE_REQUIRED');
 const weights=toWeightDistribution(new BN(x.toString()),new BN(y.toString()),bps,market.binStep);
 assert(weights.length===bps.length,'SDK_WEIGHT_DROPPED');
 assert(Number.isInteger(cfg.slippageBps)&&cfg.slippageBps>0&&cfg.slippageBps<=market.binStep,'EXPLICIT_ONE_BIN_SLIPPAGE_REQUIRED');
 const sdk=await DLMM.create(conn,pool,{cluster:'localhost',programId:PROGRAM,skipSolWrappingOperation:true});
 assert(sdk.lbPair.activeId===market.activeId&&sdk.lbPair.binStep===market.binStep&&sdk.lbPair.reserveX.equals(reserveX)&&sdk.lbPair.reserveY.equals(reserveY)&&sdk.lbPair.tokenXMint.equals(mintX)&&sdk.lbPair.tokenYMint.equals(mintY),'SDK_STATE_CHANGED');
 const tx=await sdk.initializePositionAndAddLiquidityByWeight({positionPubKey:position,totalXAmount:new BN(x.toString()),totalYAmount:new BN(y.toString()),xYAmountDistribution:bps,user:wallet,slippage:cfg.slippageBps/100});
 assert(!Array.isArray(tx)&&tx.feePayer.equals(wallet)&&tx.signatures.every(s=>s.signature===null),'UNSIGNED_SINGLE_MESSAGE_REQUIRED');
 const msg=tx.compileMessage(),bytes=Buffer.from(msg.serialize()),keys=msg.accountKeys.map(k=>k.toBase58());
 assert(bytes.length+1+64*msg.header.numRequiredSignatures<=1232,'TRANSACTION_PACKET_LIMIT');
 const names=new Map(idl.instructions.map(i=>[Buffer.from(i.discriminator).toString('hex'),i.name])),side=x===0n?'Y':y===0n?'X':'BOTH';
 const instructions=tx.instructions.map(ix=>{const program=ix.programId.toBase58(),data=ix.data;let name='unknown',args=null;
  if(program===PROGRAM_ADDRESS){name=names.get(data.subarray(0,8).toString('hex'))??'unknown';if(['initialize_position','add_liquidity_one_side','add_liquidity_by_weight'].includes(name))args=decodeOpenArgs(name,data,side)}
  if(program===COMPUTE)name=data[0]===2&&data.length===5?'set_compute_unit_limit':data[0]===3&&data.length===9?'set_compute_unit_price':'unknown';
  return {program,name,args,accounts:ix.keys.map(k=>k.pubkey.toBase58()),dataHash:sha(data)};
 });
 const ss=a=>a.map(k=>k.toBase58()),initAccounts=ss([wallet,position,pool,wallet,SystemProgram.programId,SYSVAR_RENT_PUBKEY,event,PROGRAM]);
 const depositAccounts=side==='BOTH'?ss([position,pool,PROGRAM,ax,ay,reserveX,reserveY,mintX,mintY,al,au,wallet,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,event,PROGRAM]):ss([position,pool,PROGRAM,side==='X'?ax:ay,side==='X'?reserveX:reserveY,side==='X'?mintX:mintY,al,au,wallet,TOKEN_PROGRAM_ID,event,PROGRAM]);
 const writableAccounts=ss([wallet,position,pool,al,au,...(side==='BOTH'?[ax,ay,reserveX,reserveY]:side==='X'?[ax,reserveX]:[ay,reserveY])]);
 const audit=checkOpenInstructions({keys,requiredSigners:keys.slice(0,msg.header.numRequiredSignatures),writable:keys.map((_,i)=>msg.isAccountWritable(i)),instructions},{wallet:cfg.wallet,position:cfg.position,pool:cfg.pool,initAccounts,depositAccounts,writableAccounts,lowerBinId:d.lowerBinId,width:d.rangeWidth,depositName:side==='BOTH'?'add_liquidity_by_weight':'add_liquidity_one_side',activeId:market.activeId,maxActiveBinSlippage:Math.ceil(cfg.slippageBps/market.binStep),amountXRaw:x.toString(),amountYRaw:y.toString(),weights});
 const balance=await snapshot();
 assert(Number.isSafeInteger(cfg.positionRentReferenceBytes)&&cfg.positionRentReferenceBytes>0&&cfg.positionRentReferenceBytes<=100000,'RENT_REFERENCE_SIZE_REQUIRED');
 const rent=numeric(await conn.getMinimumBalanceForRentExemption(cfg.positionRentReferenceBytes,'confirmed'));
 const fee=await conn.getFeeForMessage(msg,'confirmed'),valid=await conn.isBlockhashValid(msg.recentBlockhash,{commitment:'confirmed',minContextSlot:balance.slot});
 assert(fee.context.slot>=balance.slot&&valid.context.slot>=balance.slot,'FEE_CONTEXT_TOO_OLD');
 const funding=checkFunding({...balance,amountXRaw:x.toString(),amountYRaw:y.toString(),feeLamports:fee.value,feeCapRaw:cfg.feeCapRaw,minReserveRaw:d.reservedSolRaw,rentReferenceRaw:String(rent),rentCapRaw:cfg.rentCapRaw,slot:fee.context.slot,valid:valid.value});
 assert(r.expiresAt>Date.now()&&await conn.getGenesisHash()===genesis,'RESEARCH_OR_NETWORK_CHANGED');
 const directory=await mkdtemp(join(dataRoot,'raw','local-open-'));const messageHash=sha(bytes);
 const simulation=cfg.simulationEnabled===true&&funding.status==='CAP_BUDGET_DIAGNOSTIC_ONLY'?await simulateLocalOpen({endpoint:endpoint.toString(),genesis,msg,messageHash,market,cfg,coder,program:PROGRAM,addresses,low,high,allocation:d,funding,capturedAccounts:accounts}):{result:{status:'SIMULATION_NOT_RUN',reason:cfg.simulationEnabled===true?'SIM_FUNDING_BLOCKED':'SIMULATION_DISABLED',decisionReady:false,executionReady:false,signingAvailable:false},calls:[]};
 const simulationRaw=JSON.stringify(simulation.calls);await writeFile(join(directory,'simulation-rpc.json'),simulationRaw,{flag:'wx',mode:0o600});
 const result={schemaVersion:1,status:'LOCAL_UNSIGNED_OPEN_DIAGNOSTIC_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,genesisHash:genesis,pool:cfg.pool,wallet:cfg.wallet,position:cfg.position,requestHash:r.requestHash,marketSlot:market.slot,marketRawHash:market.rawHash,messageHash,observedAt:Date.now(),audit,funding,simulation:simulation.result,simulationRawHash:sha(simulationRaw),balance,feeSlot:fee.context.slot,validitySlot:valid.context.slot,positionRentReferenceBytes:cfg.positionRentReferenceBytes,blockers:['LOCAL_INPUT_PROVENANCE_NOT_AUTHENTICATED','RENT_SIZE_AND_CPI_NOT_VERIFIED','INDEPENDENT_SIMULATION_ACCEPTANCE_PENDING','NO_SIGNING_OR_SUBMISSION'],directory};
 await writeFile(join(directory,'message.bin'),bytes,{flag:'wx',mode:0o600});
 await writeFile(join(directory,'manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(directory,'message-audit.json'),JSON.stringify({schemaVersion:1,scope:'LOCAL_UNSIGNED_MESSAGE_DIAGNOSTIC',sdkVersion:'1.9.15',wallet:cfg.wallet,position:cfg.position,pool:cfg.pool,requestHash:r.requestHash,marketRawHash:market.rawHash,marketSlot:market.slot,expectedGenesisHash:genesis,messageBase64:bytes.toString('base64'),messageHash,feeCapRaw:cfg.feeCapRaw,minReserveRaw:d.reservedSolRaw},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{const m=String(e.message);console.log(JSON.stringify({status:'BLOCKED',decisionReady:false,executionReady:false,signingAvailable:false,reason:/^[A-Z0-9_]{1,100}$/.test(m)?m:'LOCAL_OPEN_DIAGNOSTIC_FAILED'}));process.exitCode=1});

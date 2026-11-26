// Read-only position discovery within a user-selected pool; not opportunity discovery.
import {parseArgs} from 'node:util';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {positionV2Filter,positionLbPairFilter,positionOwnerFilter} from './sdk-runtime.mjs';
import {PROGRAM,SDK_COMMIT} from './inspect-pool.mjs';
import {createReadRpc} from './rpc-read.mjs';
async function main(){
 const {values}=parseArgs({options:{pool:{type:'string'},owner:{type:'string'},provider:{type:'string',default:'solana-rpc'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/discover-positions.mjs --pool ADDRESS [--owner WALLET]');return;}
 const pool=new PublicKey(values.pool),owner=values.owner?new PublicKey(values.owner):null;
 if(!/^[a-zA-Z0-9_-]{1,48}$/.test(values.provider))throw Error('invalid provider label');
 const endpoint=new URL(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
 if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw Error('invalid RPC endpoint');
 const filters=[positionV2Filter(),positionLbPairFilter(pool),...(owner?[positionOwnerFilter(owner)]:[])];
 const params=[PROGRAM.toBase58(),{commitment:'finalized',encoding:'base64',withContext:true,filters,dataSlice:{offset:0,length:72}}];
 const root=join('data','raw');await mkdir(root,{recursive:true,mode:0o700});const dir=await mkdtemp(join(root,'positions-'));
 const report={sdkCommit:SDK_COMMIT,pool:pool.toBase58(),owner:owner?.toBase58()??null,provider:values.provider,requestedAt:new Date().toISOString(),status:'BLOCKED',scope:'POSITION_V2_ACCOUNT_INDEX_ONLY',positions:[]};
 try{
  const r=await createReadRpc(endpoint,{maxBytes:4*1024*1024})({jsonrpc:'2.0',id:1,method:'getProgramAccounts',params});
  report.httpStatus=r.httpStatus;report.rpcAttempts=r.attempts;const raw=r.raw,p=r.payload;
  if(p.id!==1||p.jsonrpc!=='2.0'||p.error||!Number.isSafeInteger(p.result?.context?.slot)||!Array.isArray(p.result.value)||p.result.value.length>5000)throw Error('invalid context or response');
  const seen=new Set();
  for(const v of p.result.value){
   const address=new PublicKey(v.pubkey).toBase58(),a=v.account;
   const data=Buffer.from(a.data[0],'base64');
   if(seen.has(address)||a.owner!==PROGRAM.toBase58()||a.executable!==false||a.data[1]!=='base64'||data.length!==72||data.toString('base64')!==a.data[0]||!new PublicKey(data.subarray(8,40)).equals(pool)||owner&&!new PublicKey(data.subarray(40,72)).equals(owner))throw Error('index record mismatch');
   seen.add(address);report.positions.push({address,owner:new PublicKey(data.subarray(40,72)).toBase58()});
  }
  await writeFile(join(dir,'accounts.json'),raw,{mode:0o600,flag:'wx'});report.rawHash=createHash('sha256').update(raw).digest('hex');report.slot=p.result.context.slot;report.status='INDEX_CAPTURED_UNVERIFIED';
 }catch(e){report.positions=[];if(/^RPC_[A-Z0-9_]+$/.test(e.message))report.rpcReason=e.message;report.failure='RPC, decoding or storage failure; check provider limits';}
 report.receivedAt=new Date().toISOString();report.limitations=['Current V2 index, not historical or all position versions.','Each position must be recaptured and decoded with its pool and bins in a single context.','No position assets or PnL inferred from index.'];
 await writeFile(join(dir,'manifest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({directory:dir,status:report.status,count:report.positions.length,slot:report.slot}));if(report.status!=='INDEX_CAPTURED_UNVERIFIED')process.exitCode=1;
}
main().catch(()=>{console.error('Position discovery blocked: check inputs, dependency installation and local environment.');process.exitCode=1;});

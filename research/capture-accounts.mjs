// T01: read-only raw account capture. Node.js 20+, no dependencies.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
function pubkey(v){if(typeof v!=="string"||v.length<32||v.length>44)return false;const a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let n=0n;for(const c of v){const d=a.indexOf(c);if(d<0)return false;n=n*58n+BigInt(d);}let count=0;for(;n>0n;n>>=8n)count++;return count+(v.match(/^1*/)[0].length)===32;}
function inspect(payload,addresses){if(!payload||payload.error||payload.id!==1||payload.jsonrpc!=="2.0")throw Error("RPC response error or invalid envelope");const r=payload.result;if(!Number.isSafeInteger(r?.context?.slot)||r.context.slot<0||!Array.isArray(r.value)||r.value.length!==addresses.length)throw Error("invalid account response");return addresses.map((address,i)=>{const a=r.value[i];if(a===null)return {address,status:"MISSING"};if(!pubkey(a?.owner)||!Array.isArray(a.data)||a.data[1]!=="base64"||typeof a.data[0]!=="string"||!a.data[0].length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.data[0]))throw Error("invalid account record");return {address,status:"PRESENT",owner:a.owner};});}

async function main(){
 const {values}=parseArgs({options:{pool:{type:'string'},account:{type:'string',multiple:true},provider:{type:'string',default:'solana-rpc'},help:{type:'boolean'}}});
 if(values.help){console.log('Usage: SOLANA_RPC_URL=... node research/capture-accounts.mjs --pool ADDRESS [--account ADDRESS ...] [--provider LABEL]');return;}
 const addresses=[values.pool,...(values.account??[])];
 if(addresses.some(v=>!pubkey(v))||new Set(addresses).size!==addresses.length||addresses.length>100)throw Error('Provide a valid pool and up to 99 unique additional account addresses.');
 if(!/^[a-zA-Z0-9_-]{1,48}$/.test(values.provider))throw Error('Provider must be a short non-secret label.');
 const endpoint=new URL(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
 if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw Error('RPC requires HTTPS or local HTTP.');
 const root=join('data','raw');await mkdir(root,{recursive:true,mode:0o700});
 const dir=await mkdtemp(join(root,'accounts-'));
 const request={jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[addresses,{encoding:'base64',commitment:'finalized'}]};
 const manifest={schemaVersion:1,provider:values.provider,commitment:'finalized',pool:values.pool,addresses,requestedAt:new Date().toISOString(),status:'BLOCKED',limitations:['Account capture only; protocol identity and completeness not validated.','One RPC context; does not reconstruct historical state.']};
 let stage='network';
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000),redirect:'error'});
  const body=await response.text();manifest.receivedAt=new Date().toISOString();manifest.httpStatus=response.status;
  if(!response.ok)throw Error('RPC HTTP failure');
  stage='validation';
  const payload=JSON.parse(body);
  const accounts=inspect(payload,addresses);
  const hash=createHash('sha256').update(body,'utf8').digest('hex');
  stage='storage';
  await writeFile(join(dir,'accounts.json'),body,{mode:0o600,flag:'wx'});
  manifest.raw={file:'accounts.json',sha256:hash};manifest.contextSlot=payload.result.context.slot;manifest.accounts=accounts;
  manifest.status=accounts.every(a=>a.status==='PRESENT')?'CAPTURED_UNVERIFIED':'PARTIAL';
 }catch(e){
  manifest.receivedAt??=new Date().toISOString();
  manifest.failureStage=stage;
  // Do not expose endpoint URLs, API credentials or remote error bodies.
  manifest.error=stage==='network'?'RPC connection/HTTP failed':stage==='validation'?'RPC payload invalid or returned an error':'Local storage failed';
 }
 await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({directory:dir,status:manifest.status,contextSlot:manifest.contextSlot,failureStage:manifest.failureStage}));
 if(manifest.status!=='CAPTURED_UNVERIFIED')process.exitCode=1;
}
main().catch(()=>{console.error('Capture aborted: check arguments, RPC configuration and local write permissions.');process.exitCode=1;});

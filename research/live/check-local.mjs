// Read-only local probe; does not restart processes or contact external RPC.
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {classifyLocal} from './local-check-core.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const {values}=parseArgs({options:{terminal:{type:'string',default:'8790'},collector:{type:'string',default:'8788'},'terminal-config':{type:'string',default:'data/terminal-config.json'},'live-config':{type:'string',default:'data/live-config.json'}}});
function port(s){const n=Number(s);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('INVALID_PORT');return n}
async function readConfig(path){try{const p=resolve(root,path);if((await stat(p)).size>32768)return null;const a=JSON.parse(await readFile(p,'utf8'));return typeof a.pool==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.pool)?{pool:a.pool}:null}catch{return null}}
async function get(port,path){
 try{
  const r=await fetch('http://127.0.0.1:'+port+path,{signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!r.ok)return {ok:false,httpStatus:r.status};
  const reader=r.body?.getReader();if(!reader)return {ok:false,reason:'EMPTY_BODY'};
  let total=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>8*1024*1024)throw Error('SIZE');parts.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  return {ok:true,data:JSON.parse(Buffer.concat(parts).toString('utf8'))};
 }catch{return {ok:false,reason:'LOCAL_FETCH_OR_PARSE_FAILED'}}
}
async function main(){
 const tp=port(values.terminal),cp=port(values.collector);
 const [tc,lc]=await Promise.all([readConfig(values['terminal-config']),readConfig(values['live-config'])]);
 const pool=tc?.pool??null;
 const hashes={htmlHash:sha(await readFile(join(root,'research/live/terminal.html'))),serverHash:sha(await readFile(join(root,'research/live/terminal-server.mjs')))};
 const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000});
 const dirty=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',timeout:5000});
 const vendorPath=join(root,'data/vendor/meteora-ag-dlmm-1.9.15.tgz');
 let vendorHash=null;try{if((await stat(vendorPath)).size<100*1024*1024)vendorHash=sha(await readFile(vendorPath))}catch{}
 const expectedVendor='7e8da2ee2e528a5aba4c1efd3909dcd74ac94cfed380fa9636f256ade1a41b3b';
 const dep=spawnSync(process.execPath,['--input-type=module','-e',"import('./sdk-runtime.mjs').then(m=>{if(typeof m.wrapPosition!=='function')process.exitCode=1})"],{cwd:join(root,'research/live'),timeout:15000,stdio:'ignore'});
 const endpoints=await Promise.all([get(tp,'/health'),get(cp,'/health'),get(tp,'/api/terminal/state'),get(tp,'/api/terminal/input-status')]);
 // A tick may land between the parallel reads. Retry only the two state views once.
 if(endpoints[2].data?.market&&(endpoints[3].data?.marketSlot!==endpoints[2].data.market.slot||endpoints[3].data?.marketRawHash!==endpoints[2].data.market.rawHash)){[endpoints[2],endpoints[3]]=await Promise.all([get(tp,'/api/terminal/state'),get(tp,'/api/terminal/input-status')])}
 const result=classifyLocal({pool,health:endpoints[0].data,collector:endpoints[1].data,state:endpoints[2].data,input:endpoints[3].data,...hashes});
 const environment=[{id:'node',status:Number(process.versions.node.split('.')[0])>=20?'PASS':'BLOCKED'},{id:'configs-match',status:pool&&lc?.pool===pool?'PASS':'BLOCKED'},{id:'sdk-tarball',status:vendorHash===expectedVendor?'PASS':'BLOCKED'},{id:'sdk-runtime-import',status:dep.status===0?'PASS':'BLOCKED'}];
 const tasks=endpoints[3].data?.tasks;
 const markets=endpoints[2].data?.market;
 const functionalGates={review:endpoints[2].data?.reviewGate??null,modelInputReady:endpoints[3].data?.modelInputReady===true,marketSlot:markets?.slot??null,marketRawHash:markets?.rawHash??null,collectorStreams:endpoints[1].data?.streamHealth??null,liveAcceptance:'NOT_ESTABLISHED_BY_LOCAL_READ_CHECK'};
 const report={...result,status:environment.every(x=>x.status==='PASS')?result.status:'LOCAL_READ_CHECKS_BLOCKED',scope:'LOCAL_READ_ONLY',commit:git.status===0?git.stdout.trim():null,dirty:dirty.status===0?Boolean(dirty.stdout.trim()):null,node:process.version,createdAt:new Date().toISOString(),pool,...hashes,vendorHash,environment,endpointStatus:endpoints.map(({ok,httpStatus,reason})=>({ok,httpStatus,reason})),functionalGates,missingModelInputs:Array.isArray(tasks)?tasks.filter(x=>x.state!=='OBSERVED').map(x=>({id:x.id,reason:x.reason})):[]};
 const dir=join(root,'data','acceptance');await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,'local-read-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({...report,report:path},null,2));if(report.status!=='LOCAL_READ_CHECKS_PASSED')process.exitCode=1;
}
main().catch(()=>{console.error('Local checks failed: configuration or environment unavailable.');process.exitCode=1});

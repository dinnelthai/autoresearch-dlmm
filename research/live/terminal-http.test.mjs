// Offline real HTTP integration, isolated temporary repo. No external network or real wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise((ok,fail)=>s.close(e=>e?fail(e):ok()));return p}
const key=()=>new PublicKey(randomBytes(32)).toBase58();
function state(pool,receivedAt){
 const identity={status:'IDENTITY_CHECKED_UNVERIFIED',pool,slot:1,rawHash:'a'.repeat(64),mintX:key(),mintY:'So11111111111111111111111111111111111111112',activeId:0,binStep:100,orientation:'MEME_X_SOL_Y'};
 identity.sides=[{mint:identity.mintX,decimals:6},{mint:identity.mintY,decimals:9}];
 const bins={...identity,status:'BITMAP_COVERAGE_CHECKED_UNVERIFIED',arrays:[{version:2,bins:Array.from({length:70},(_,binId)=>({binId,amountXRaw:'1',amountYRaw:'2',priceQ64Raw:'18446744073709551616',openOrderAmountRaw:null,totalProcessingOrderAmountRaw:null,processedOrderRemainingAmountRaw:null}))}],coverage:{missing:0,unsupported:0,expected:1,decoded:1}};
 return {schemaVersion:1,pool,sequence:1,decisionReady:false,streams:{market:{status:'CAPTURED_UNVERIFIED',receivedAt,evidence:{slot:1,identity,bins,capture:'data/raw/not-a-real-capture'}}},history:{}};
}
test('real localhost server: stale/missing state, scoped fixture, request guards and no readiness promotion',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dlmm-http-'));let child=null,done=null;
 try{
  await cp(join(root,'research'),join(dir,'research'),{recursive:true,filter:p=>!p.split(/[\\/]/).includes('node_modules')});
  for(const rel of ['node_modules','research/live/node_modules','research/node_modules']){
   const src=join(root,rel);try{await access(src)}catch{continue}await symlink(src,join(dir,rel),'dir');
  }
  const pool=key(),other=key(),configured=key(),port=await freePort(),base='http://127.0.0.1:'+port;
  await mkdir(join(dir,'data'),{recursive:true});
  await writeFile(join(dir,'data','config.json'),JSON.stringify({pool,researchPools:[configured],maxAgeSeconds:180,dynamicCapture:{enabled:false},monitoring:{enabled:false}}));
  child=spawn(process.execPath,[join(dir,'research/live/terminal-server.mjs'),'--config',join(dir,'data/config.json'),'--port',String(port)],{cwd:dir,env:{...process.env,SOLANA_RPC_URL:'http://127.0.0.1:1',JUPITER_API_KEY:''},stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',b=>{if(stderr.length<2000)stderr+=b.toString().slice(0,2000-stderr.length)});done=once(child,'close');
  async function get(path,options={}){const r=await fetch(base+path,{...options,signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()}}
  let health=null;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error('server exited: '+stderr);try{health=await get('/health');break}catch{await pause(150)}}assert.ok(health,'server did not start');assert.equal(health.body.apiVersion,'flow-data-v11');
  assert.equal(health.body.htmlHash,sha(await readFile(join(dir,'research/live/terminal.html'))));
  assert.equal(health.body.executionReady,false);assert.match(health.body.assetHash,/^[0-9a-f]{64}$/);
  const page=await fetch(base+'/');assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await page.text(),/src="\/assets\/app.js"/);
  for(const name of ['terminal.css','state.js','dom.js','api.js','app.js']){const a=await fetch(base+'/assets/'+name);assert.equal(a.status,200);assert.equal(sha(Buffer.from(await a.arrayBuffer())),sha(await readFile(join(dir,'research/live/terminal-assets',name))));assert.match(a.headers.get('content-type'),name.endsWith('.css')?/text\/css/:/text\/javascript/)}
  const unknown=await fetch(base+'/assets/missing.js');assert.notEqual(unknown.status,200);
  const missing=await get('/api/terminal/state');assert.equal(missing.body.status,'BLOCKED');assert.equal(missing.body.market,null);
  const preview=await get('/api/terminal/state?pool='+other);assert.equal(preview.body.pool,other);assert.equal(preview.body.reason,'DYNAMIC_CAPTURE_DISABLED');assert.equal(preview.body.executionReady,false);
  const invalid=await get('/api/terminal/state?pool=invalid');assert.equal(invalid.status,400);
  const invalidScope=await get('/health?pool='+other);assert.equal(invalidScope.status,400);
  const stDir=join(dir,'data','live',pool);await mkdir(stDir,{recursive:true});const stPath=join(stDir,'state.json');
  await writeFile(stPath,JSON.stringify(state(pool,Date.now()-1000)));
  const fresh=await get('/api/terminal/state');assert.equal(fresh.body.status,'CAPTURED_UNVERIFIED');assert.equal(fresh.body.market.display.totalBins,70);assert.equal(fresh.body.reviewGate.reason,'REVIEW_NOT_CONFIGURED');assert.equal(fresh.body.executionReady,false);
  const input=await get('/api/terminal/input-status');assert.equal(input.body.marketSlot,1);assert.equal(input.body.modelInputReady,false);
  const configuredDir=join(dir,'data','live',configured);await mkdir(configuredDir,{recursive:true});await writeFile(join(configuredDir,'state.json'),JSON.stringify(state(configured,Date.now()-1000)));
  const scoped=await get('/api/terminal/state?pool='+configured);assert.equal(scoped.body.scope,'SCOPED_RESEARCH_ONLY');assert.equal(scoped.body.pool,configured);assert.equal(scoped.body.market.slot,1);assert.equal(scoped.body.executionReady,false);
  const catalog=await get('/api/terminal/research-catalog?pool='+configured);assert.equal(catalog.body.pool,configured);assert.deepEqual(catalog.body.entries,[]);
  const again=await get('/api/terminal/state?pool='+other);assert.equal(again.body.market,null);
  assert.equal((await get('/api/terminal/state')).body.pool,pool);
  await writeFile(stPath,JSON.stringify(state(pool,Date.now()-200000)));
  const stale=await get('/api/terminal/state');assert.equal(stale.body.status,'BLOCKED');assert.equal(stale.body.market,null);
  const post=(path,body,origin)=>get(path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}: {})},body:JSON.stringify(body)});
  for(const path of ['/api/terminal/plans','/api/terminal/management','/api/terminal/research-snapshot','/api/terminal/research-build','/api/terminal/research-replay','/api/terminal/research-load','/api/terminal/position-accounting','/api/terminal/wallet-observation','/api/terminal/holder-features','/api/terminal/external-market','/api/terminal/wallet-positions'])assert.equal((await post(path,{},undefined)).status,403,path);
  assert.equal((await post('/api/terminal/research-load',{pool:configured,runId:'../bad'},base)).status,400);
  assert.equal((await post('/api/terminal/research-replay',{pool,snapshotId:'../bad'},base)).status,400);
  assert.equal((await post('/api/terminal/position-accounting',{pool,wallet:key(),position:key()},base)).status,400);
  assert.equal((await post('/api/terminal/research-snapshot',{pool},base)).status,400);
  assert.equal((await post('/api/terminal/plans',{},base)).status,400);
  assert.equal((await post('/api/terminal/execute',{},base)).status,404);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(timer)}
  await rm(dir,{recursive:true,force:true});
 }
});

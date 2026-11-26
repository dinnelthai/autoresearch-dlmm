// T12 formal terminal, single configured Pool. Localhost only, no signing.
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {poolAddress,currentMarket,requestFromDraft,reviewMatches} from './terminal-core.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data');
const {values}=parseArgs({options:{config:{type:'string'},port:{type:'string',default:'8790'},help:{type:'boolean'}}});
if(values.help){console.log('node research/live/terminal-server.mjs --config data/terminal-config.json [--port 8790]');process.exit(0)}
const assert=(x,m)=>{if(!x)throw Error(m)},sha=x=>createHash('sha256').update(x).digest('hex');
assert(values.config,'CONFIG_REQUIRED');
const cfg=JSON.parse(await readFile(values.config,'utf8')),pool=cfg.pool,port=Number(values.port),maxAgeMs=(cfg.maxAgeSeconds??180)*1000;
assert(poolAddress(pool)&&Number.isInteger(port)&&port>=1024&&port<=65535&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=15000&&maxAgeMs<=600000,'INVALID_CONFIG');
const statePath=join(DATA,'live',pool,'state.json'),origin='http://127.0.0.1:'+port;
async function safeDataPath(path){const root=await realpath(DATA),p=await realpath(resolve(ROOT,path)),rel=relative(root,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'INVALID_DATA_PATH');return p}
async function loadState(){return JSON.parse(await readFile(await safeDataPath(statePath),'utf8'))}
const html=await readFile(join(ROOT,'research/live/terminal.html'));
let busy=false;
async function jsonBody(req){assert(req.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED');let size=0,parts=[];for await(const b of req){size+=b.length;assert(size<=32768,'BODY_TOO_LARGE');parts.push(b)}return JSON.parse(Buffer.concat(parts).toString('utf8'))}
function run(args){return new Promise((ok,fail)=>{const p=spawn(process.execPath,[join(ROOT,'research/live/analyze-state.mjs'),...args],{cwd:ROOT,stdio:['ignore','pipe','ignore']});let parts=[],size=0,failed=false;const timer=setTimeout(()=>{failed=true;p.kill('SIGKILL')},30000);p.stdout.on('data',b=>{size+=b.length;if(size>8*1024*1024){failed=true;p.kill('SIGKILL')}else parts.push(b)});p.once('error',e=>{clearTimeout(timer);fail(e)});p.once('close',()=>{clearTimeout(timer);try{assert(!failed,'ANALYSIS_TIMEOUT_OR_SIZE');ok(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){fail(e)}})})}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
function blocked(reason){return {schemaVersion:1,pool,status:'BLOCKED',decisionReady:false,executionReady:false,gaps:[reason]}}
async function overview(){
 const s=await loadState(),now=Date.now();assert(s.pool===pool&&s.schemaVersion===1&&s.decisionReady===false&&Number.isSafeInteger(s.sequence),'STATE_IDENTITY_MISMATCH');const streams=Object.fromEntries(Object.entries(s.streams??{}).map(([k,v])=>[k,{status:v.status,receivedAt:v.receivedAt??null,locallyFresh:Number.isSafeInteger(v.receivedAt)&&v.receivedAt<=now&&now-v.receivedAt<=maxAgeMs}]));
 const positions=[];for(const [k,v] of Object.entries(s.streams??{})){const p=v.evidence?.report;if(k.startsWith('position:')&&v.status==='CAPTURED_UNVERIFIED'&&streams[k].locallyFresh&&p?.pool===pool&&p.position===k.slice(9)&&p.status==='POSITION_CALCULATED_UNVERIFIED')positions.push(p)}
 let market=null,reason=null;try{const m=currentMarket(s,pool,now,maxAgeMs);market={slot:m.slot,rawHash:m.rawHash,activeId:m.activeId,binStep:m.binStep,mintX:m.mintX,mintY:m.mintY,decimalsX:m.decimalsX,decimalsY:m.decimalsY,receivedAt:m.receivedAt,binCount:m.bins.length}}catch(e){reason=e.message}
 return {pool,sequence:s.sequence??null,status:market?'CAPTURED_UNVERIFIED':'BLOCKED',reason,market,positions,streams,decisionReady:false,executionReady:false,freshnessBasis:'LOCAL_RECEIPT_ONLY'};
}
async function preview(body){
 const now=Date.now(),s=await loadState(),m=currentMarket(s,pool,now,maxAgeMs);
 assert(body?.marketSlot===m.slot&&body.marketRawHash===m.rawHash,'MARKET_CHANGED_REFRESH_REQUIRED');
 const request=requestFromDraft(body.draft,m);
 assert(cfg.review,'REVIEW_NOT_CONFIGURED');
 const review=JSON.parse(await readFile(await safeDataPath(cfg.review),'utf8'));reviewMatches(review,m,now);
 const base=join(DATA,'terminal');await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'analysis-'));
 try{
  const requestJson=JSON.stringify(request),requestHash=sha(requestJson);
  for(const [name,data] of [['state',JSON.stringify(s)],['request',requestJson],['review',JSON.stringify(review)]])await writeFile(join(dir,name+'.json'),data,{mode:0o600});
  const r=await run(['--state',join(dir,'state.json'),'--request',join(dir,'request.json'),'--review',join(dir,'review.json'),'--plans']);
  assert(r.pool===pool&&r.decisionReady===false&&r.executionReady===false,'ANALYSIS_CONTRACT_MISMATCH');
  if(r.market)assert(r.market.slot===m.slot&&r.market.rawHash===m.rawHash,'ANALYSIS_SNAPSHOT_MISMATCH');
  const latest=currentMarket(await loadState(),pool,Date.now(),maxAgeMs);assert(latest.slot===m.slot&&latest.rawHash===m.rawHash,'MARKET_CHANGED_DURING_ANALYSIS');reviewMatches(review,m,Date.now());
  return {...r,terminalBinding:{requestHash,marketSlot:m.slot,marketRawHash:m.rawHash,sequence:s.sequence,generatedAt:Date.now(),scope:'RESEARCH_ONLY'}};
 }finally{await rm(dir,{recursive:true,force:true})}
}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin&&req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
 try{
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(req.method==='GET'&&req.url==='/api/terminal/state'){try{send(res,200,await overview())}catch{send(res,200,{...blocked('STATE_UNAVAILABLE'),market:null,positions:[],streams:{}})}return}
  if(req.method==='POST'&&req.url==='/api/terminal/plans'){
   if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
   if(busy){send(res,409,blocked('ANALYSIS_BUSY'));return}busy=true;
   try{send(res,200,await preview(await jsonBody(req)))}finally{busy=false}return
  }
  send(res,404,blocked('NOT_FOUND'));
 }catch(e){const m=String(e.message);send(res,400,blocked(/^[A-Z0-9_]+$/.test(m)?m:'INPUT_OR_EVIDENCE_VALIDATION_FAILED'))}
});
server.requestTimeout=45000;server.headersTimeout=10000;server.listen(port,'127.0.0.1',()=>console.log('Read-only Flow Terminal: '+origin));

// Explicit route registry; local origin and error envelope remain centralized.
import {randomUUID} from 'node:crypto';
import {currentMarket,scopedTerminalRequest} from './terminal-core.mjs';
import {diagnosticLog} from './diagnostic-log.mjs';
import {blockedResponse,errorCode} from './research-contract.mjs';
export function createTerminalHandler({pool,port,origin,html,assets=new Map(),startup,isStopping,validateScope,locks,jsonBody,send,archives,researchInputs,publicMonitor,loadState,maxAgeMs,indexedPool,indexedHistory,scopedOverview,positionAccounting,readPositionDetail,readPositionIndex,buildResearchCandidate,loadResearchRun,replayResearchSnapshot,saveResearchSnapshot,holderObservation,externalObservation,observeWallet,inspectWalletEvidence,inspectReview,rememberReport,preview,paperService}){
 const blocked=reason=>blockedResponse(pool,reason);
 const postRoutes=new Map([
  ['/api/terminal/paper-start',{lock:'analysis',reason:'ANALYSIS_BUSY',handle:body=>paperService.start(body)}],
  ['/api/terminal/paper-pause',{lock:null,reason:null,handle:body=>paperService.pause(body)}],
  ['/api/terminal/position-accounting',{lock:"positionAccounting",reason:"POSITION_ACCOUNTING_BUSY",handle:positionAccounting}],
  ['/api/terminal/wallet-positions',{lock:"positionRead",reason:"POSITION_CAPTURE_BUSY",handle:readPositionIndex}],
  ['/api/terminal/wallet-position-detail',{lock:"positionRead",reason:"POSITION_CAPTURE_BUSY",handle:readPositionDetail}],
  ['/api/terminal/research-build',{lock:"builder",reason:"RESEARCH_BUILD_BUSY",handle:buildResearchCandidate}],
  ['/api/terminal/research-load',{lock:null,reason:null,handle:loadResearchRun}],
  ['/api/terminal/research-replay',{lock:"replay",reason:"REPLAY_BUSY",handle:replayResearchSnapshot}],
  ['/api/terminal/research-snapshot',{lock:"snapshot",reason:"SNAPSHOT_BUSY",handle:saveResearchSnapshot}],
  ['/api/terminal/holder-features',{lock:"holder",reason:"HOLDER_CAPTURE_BUSY",handle:holderObservation}],
  ['/api/terminal/external-market',{lock:"external",reason:"EXTERNAL_CAPTURE_BUSY",handle:externalObservation}],
  ['/api/terminal/wallet-observation',{lock:"walletEvidence",reason:"WALLET_EVIDENCE_BUSY",handle:observeWallet}],
  ['/api/terminal/wallet-evidence',{lock:"walletEvidence",reason:"WALLET_EVIDENCE_BUSY",handle:inspectWalletEvidence}],
  ['/api/terminal/review',{lock:"review",reason:"REVIEW_BUSY",handle:inspectReview}],
  ['/api/terminal/plans',{lock:"analysis",reason:"ANALYSIS_BUSY",handle:async body=>rememberReport(await preview(body,'plans'),'plans')}],
  ['/api/terminal/management',{lock:"analysis",reason:"ANALYSIS_BUSY",handle:async body=>rememberReport(await preview(body,'management'),'management')}]
 ]);
return async function handle(req,res){
 const requestId=randomUUID(),startedAt=Date.now();res.setHeader('X-Request-Id',requestId);
 res.once('finish',()=>{if(res.statusCode>=400)diagnosticLog({component:'TERMINAL',event:'HTTP_REQUEST',status:'FAILED',reason:'HTTP_'+res.statusCode,requestId,durationMs:Date.now()-startedAt})});
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin&&req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
 try{
  if(isStopping()){send(res,503,blocked('SERVICE_STOPPING'));return}
  if(req.method==='GET'&&assets.has(req.url)){const a=assets.get(req.url);res.writeHead(200,{'Content-Type':a.type});res.end(a.bytes);return}
  const scoped=req.method==='GET'?scopedTerminalRequest(req.url,pool):{path:req.url,pool};
  const scope=validateScope(scoped.pool);
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(req.method==='GET'&&req.url==='/health'){send(res,200,{status:'RUNNING',pool,...startup,decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/research-catalog'){send(res,200,{pool:scope,scope:'HISTORICAL_ARCHIVE_INDEX_ONLY',entries:await archives.list(scope),decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&req.url==='/api/terminal/paper-pools'){send(res,200,await paperService.list());return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/paper-context'){send(res,200,await paperService.context(scope));return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/paper-status'){send(res,200,await paperService.get(scope));return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/input-status'){send(res,200,await researchInputs(scope));return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/monitor'){send(res,200,scope===pool?publicMonitor():{pool:scope,enabled:false,current:{},events:[],decisionReady:false,executionReady:false});return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/pool-info'){try{const m=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);send(res,200,await indexedPool([m.pool,m.mintX,m.mintY,m.decimalsX,m.decimalsY].join(':'),m))}catch(e){send(res,503,{pool:scope,status:'UNAVAILABLE',reason:/^INDEX_[A-Z_]+$/.test(e.message)?e.message:'POOL_INFO_UNAVAILABLE'})}return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/price-history'){try{send(res,200,await indexedHistory(scope,scope))}catch(e){send(res,503,{pool:scope,status:'UNAVAILABLE',reason:/^(INDEX|HISTORY|INVALID)_[A-Z_]+$/.test(e.message)?e.message:'HISTORY_UNAVAILABLE'})}return}
  if(req.method==='GET'&&scoped.path==='/api/terminal/state'){const release=locks.acquire('overview');if(!release){send(res,409,{...blocked('STATE_READ_BUSY'),pool:scope});return}try{send(res,200,await scopedOverview(scope))}catch{send(res,200,{...blocked('STATE_UNAVAILABLE'),pool:scope,market:null,reviewGate:{status:'BLOCKED',reason:'STATE_UNAVAILABLE'},positions:[],monitoring:[],streams:{}})}finally{release()}return}

  if(req.method==='POST'){
   const route=postRoutes.get(req.url);
   if(route){
    if(req.headers.origin!==origin){send(res,403,blocked('LOCAL_ORIGIN_REQUIRED'));return}
    const release=route.lock?locks.acquire(route.lock):()=>{};
    if(!release){send(res,409,blocked(route.reason));return}
    try{send(res,200,await route.handle(await jsonBody(req)))}finally{release()}return;
   }
  }
  send(res,404,blocked('NOT_FOUND'));
 }catch(e){const reason=errorCode(e);diagnosticLog({component:'TERMINAL',event:'REQUEST_VALIDATION',status:'BLOCKED',reason,requestId,durationMs:Date.now()-startedAt});send(res,400,{...blocked(reason),requestId})}
};
}

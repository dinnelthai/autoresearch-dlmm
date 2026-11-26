// Wallet position observation and bounded cashflow accounting. No signing or execution.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {currentMarket} from './terminal-core.mjs';
import {positionIndex,positionDetail} from './wallet-position-core.mjs';
import {positionObservation,ledgerProjection,windowLedger} from './position-observation-workflow.mjs';
import {assembleLedger} from './position-ledger-core.mjs';
import {incrementalLedgerStore,nextLedgerPage,appendLedgerPage} from './incremental-ledger.mjs';
import {assert,sha} from './terminal-runtime.mjs';
export function createPositionService({ROOT,DATA,cfg,previewCfg,maxAgeMs,validateScope,loadState,safeDataPath,boundedRead,run}){
const ledgerStore=incrementalLedgerStore(DATA,async(path,limit)=>boundedRead(await safeDataPath(path),limit));
let lastAccountingAttempt=0;
const indexes=new Map(),positionObservations=new Map();
async function readPositionIndex(body){
 const scope=validateScope(body?.pool),wallet=validateScope(body?.wallet),key=scope+':'+wallet,old=indexes.get(key);
 if(old&&old.expiresAt>Date.now()&&Date.now()-old.receivedAt<30000)return old;
 const r=await run(['--pool',scope,'--owner',wallet,'--provider',previewCfg.provider??'solana-rpc'],'discover-positions.mjs',40000);
 assert(r.status==='INDEX_CAPTURED_UNVERIFIED','POSITION_INDEX_RPC_FAILED');
 const path=await safeDataPath(r.directory),m=JSON.parse(await boundedRead(await safeDataPath(join(path,'manifest.json')),4*1024*1024));
 const bytes=await boundedRead(await safeDataPath(join(path,'accounts.json')),4*1024*1024);
 assert(sha(bytes)===m.rawHash&&r.slot===m.slot&&r.count===m.positions?.length,'POSITION_INDEX_HASH_MISMATCH');
 const x=positionIndex(m,scope,wallet);indexes.delete(key);indexes.set(key,x);while(indexes.size>8)indexes.delete(indexes.keys().next().value);return x;
}
async function readPositionDetail(body){
 const scope=validateScope(body?.pool),wallet=validateScope(body?.wallet),position=validateScope(body?.position),idx=indexes.get(scope+':'+wallet);
 assert(idx&&idx.expiresAt>Date.now()&&idx.positions.some(p=>p.address===position),'POSITION_INDEX_REFRESH_REQUIRED');
 let addresses=[position];
 for(let attempt=0;attempt<3;attempt++){
  const r=await run(['--pool',scope,'--provider',previewCfg.provider??'solana-rpc',...addresses.flatMap(a=>['--account',a])],'../capture-accounts.mjs',40000);
  const path=await safeDataPath(r.directory),m=JSON.parse(await boundedRead(await safeDataPath(join(path,'manifest.json')),16*1024*1024));
  assert(m.pool===scope&&m.commitment==='finalized'&&Number.isSafeInteger(m.contextSlot)&&m.contextSlot>=idx.slot&&m.contextSlot===r.contextSlot&&typeof m.raw?.sha256==='string','POSITION_CAPTURE_CONTEXT_INVALID');
  const report=await run(['--capture',path,'--idl',previewCfg.idl??'data/raw/dlmm-idl.json','--position',position,'--owner',wallet,'--observe-v2'],'inspect-position.mjs',15000);
  assert(report.pool===scope&&report.position===position&&report.slot===m.contextSlot&&report.rawHash===m.raw.sha256,'POSITION_CAPTURE_MISMATCH');
  if(['POSITION_CALCULATED_UNVERIFIED','V2_POSITION_OBSERVATION_UNVERIFIED'].includes(report.status)||report.reason==='POSITION_BIN_VERSION_UNSUPPORTED'){
   const detail=positionDetail(report,{pool:scope,wallet,position,slot:m.contextSlot,rawHash:m.raw.sha256});
   if(detail.snapshot){
    const market=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs),receivedAt=Date.parse(m.receivedAt);
    assert(Number.isSafeInteger(receivedAt)&&receivedAt<=Date.now()&&Date.now()-receivedAt<180000,'POSITION_CAPTURE_RECEIPT_INVALID');
    const observation=positionObservation(detail,market,receivedAt),key=scope+':'+wallet+':'+position;
    const raw=await boundedRead(await safeDataPath(join(path,'accounts.json')),32*1024*1024);assert(sha(raw)===m.raw.sha256,'POSITION_RAW_HASH_MISMATCH');
    const base=join(DATA,'position-observations',scope,position);await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'obs-'));
    const bytes=JSON.stringify(report);await writeFile(join(dir,'position.json'),bytes,{mode:0o600,flag:'wx'});
    const saved={...observation,reportHash:sha(bytes),capture:relative(ROOT,path),reportPath:relative(ROOT,join(dir,'position.json'))};
    await writeFile(join(dir,'manifest.json'),JSON.stringify(saved,null,2)+'\n',{mode:0o600,flag:'wx'});
    positionObservations.delete(key);positionObservations.set(key,saved);while(positionObservations.size>16)positionObservations.delete(positionObservations.keys().next().value);
    return {...detail,observation:saved};
   }
   return detail;
  }
  assert(Array.isArray(report.requiredAccounts),'POSITION_DETAIL_UNAVAILABLE');
  const next=[...new Set([...addresses,...report.requiredAccounts.map(validateScope)])].filter(a=>a!==scope);assert(next.length>addresses.length&&next.length<=99,'POSITION_DETAIL_INCOMPLETE');addresses=next;
 }
 throw Error('POSITION_CAPTURE_INCOMPLETE');
}
async function positionAccounting(body){
 const scope=validateScope(body?.pool),wallet=validateScope(body?.wallet),position=validateScope(body?.position),key=scope+':'+wallet+':'+position,obs=positionObservations.get(key);
 assert(obs&&obs.slot===body.slot&&obs.rawHash===body.rawHash&&Date.now()-obs.receivedAt<=180000,'POSITION_OBSERVATION_REFRESH_REQUIRED');
 assert(Date.now()-lastAccountingAttempt>=60000,'POSITION_ACCOUNTING_COOLDOWN');lastAccountingAttempt=Date.now();
 const market=currentMarket(await loadState(scope),scope,Date.now(),maxAgeMs);
 assert(obs.mintX===market.mintX&&obs.mintY===market.mintY&&obs.decimalsX===market.decimalsX,'ACCOUNTING_MARKET_MISMATCH');
 const bytes=await boundedRead(await safeDataPath(obs.reportPath),8*1024*1024);assert(sha(bytes)===obs.reportHash,'POSITION_REPORT_CHANGED');
 const closing=JSON.parse(bytes);
 assert(sha(await boundedRead(await safeDataPath(join(obs.capture,'accounts.json')),32*1024*1024))===obs.rawHash,'POSITION_RAW_HASH_MISMATCH');
 const prior=await ledgerStore.load(obs),plan=nextLedgerPage(prior);
 const raw=await run(['--pool',scope,'--position',position,'--provider',previewCfg.provider??'solana-rpc','--pages','1','--limit','10',...(plan.before?['--before',plan.before]:[])],'capture-swaps.mjs',120000);
 const capture=await safeDataPath(raw.directory),mb=await boundedRead(await safeDataPath(join(capture,'manifest.json')),8*1024*1024),cm=JSON.parse(mb);
 assert(cm.pool===scope&&cm.position===position&&cm.indexAddress===position&&cm.commitment==='finalized'&&cm.before===plan.before&&Array.isArray(cm.signatures)&&cm.signatures.length<=10,'POSITION_HISTORY_SCOPE_INVALID');
 const pointer={capture:relative(ROOT,capture),sha256:sha(mb)},next=appendLedgerPage(prior,obs,cm,pointer,plan);
 // Check even pages about to be replaced; otherwise a repeated signature could conceal conflicting evidence.
 const sources=new Map(prior.pages.map(p=>[p.capture,p.sha256]));for(const p of next.pages)sources.set(p.capture,p.sha256);sources.set(pointer.capture,pointer.sha256);
 const args=[];for(const [path,hash] of sources){const p=await safeDataPath(path);assert(sha(await boundedRead(await safeDataPath(join(p,'manifest.json')),8*1024*1024))===hash,'LEDGER_SOURCE_MANIFEST_CHANGED');args.push('--capture',p)}
 const poolCapture=await safeDataPath(market.capture);
 const ledger=await run([...args,'--pool-capture',poolCapture,'--idl',previewCfg.idl??'data/raw/dlmm-idl.json','--owner',wallet,'--position',position],'reconcile-position.mjs',120000);
 assert(!ledger.gaps?.some(g=>['DUPLICATE_EVIDENCE_CONFLICT','BLOCK_ORDER_CONFLICT'].includes(g.reason)),'LEDGER_SOURCE_CONFLICT_INDEX_NOT_ADVANCED');
 // Never treat separately retained but potentially disjoint pages as a clean valuation window.
 const coverage={mode:plan.mode,pages:next.pages.length,gapObserved:next.gapObserved,retentionTruncated:next.retentionTruncated,backfillExhausted:next.backfillExhausted,historyComplete:false};
 if(next.gapObserved||next.retentionTruncated){assert(Array.isArray(ledger.archiveGaps),'LEDGER_ARCHIVE_GAPS_REQUIRED');ledger.archiveGaps.push({reason:next.gapObserved?'INCREMENTAL_HISTORY_GAP_OBSERVED':'INCREMENTAL_RETENTION_TRUNCATED'});ledger.status='PARTIAL_LEDGER'}
 ledger.incrementalCoverage=coverage;
 const summary={...ledgerProjection(ledger,obs),incrementalCoverage:coverage},base=join(DATA,'position-accounting',scope,position);await mkdir(base,{recursive:true,mode:0o700});const dir=await mkdtemp(join(base,'run-'));
 const ledgerBytes=JSON.stringify(ledger);await writeFile(join(dir,'ledger.json'),ledgerBytes,{mode:0o600,flag:'wx'});await writeFile(join(dir,'closing.json'),bytes,{mode:0o600,flag:'wx'});
 let performance={status:'BLOCKED',reason:'WINDOW_OPENING_AND_REVIEWED_MARKS_REQUIRED',decisionReady:false,executionReady:false,pnlReady:false};
 const map=cfg.performanceWindows,policy=map&&Object.hasOwn(map,position)?map[position]:null;
 if(policy&&typeof policy==='object'){
  try{
   assert(policy.pool===scope&&policy.owner===wallet&&policy.position===position&&obs.positionStatus==='POSITION_CALCULATED_UNVERIFIED','WINDOW_POLICY_SCOPE_OR_VERSION');
   const openingPath=await safeDataPath(policy.opening),marksPath=await safeDataPath(policy.marks);
   const openingBytes=await boundedRead(openingPath,8*1024*1024),marksBytes=await boundedRead(marksPath,8*1024*1024);
   assert(sha(openingBytes)===policy.openingHash&&sha(marksBytes)===policy.marksHash,'WINDOW_CONFIG_EVIDENCE_CHANGED');
   const opening=JSON.parse(openingBytes),openingCapture=await safeDataPath(policy.openingCapture);
   assert(sha(await boundedRead(await safeDataPath(join(openingCapture,'accounts.json')),32*1024*1024))===opening.rawHash,'WINDOW_OPENING_RAW_HASH_MISMATCH');
   const om=JSON.parse(await boundedRead(await safeDataPath(join(openingCapture,'manifest.json')),16*1024*1024));
   assert(om.pool===scope&&om.contextSlot===opening.slot&&om.raw?.sha256===opening.rawHash,'WINDOW_OPENING_CAPTURE_MISMATCH');
   const wl=windowLedger(ledger,opening.slot,closing.slot,assembleLedger),lp=join(dir,'window-ledger.json'),op=join(dir,'opening.json'),mp=join(dir,'marks.json');
   await writeFile(lp,JSON.stringify(wl),{mode:0o600,flag:'wx'});await writeFile(op,openingBytes,{mode:0o600,flag:'wx'});await writeFile(mp,marksBytes,{mode:0o600,flag:'wx'});
   const cfgPath=join(dir,'window.json'),config={schemaVersion:1,scope:'EXISTING_POSITION_WINDOW_RETAIN_DISTRIBUTIONS',ledger:lp,opening:op,closing:join(dir,'closing.json'),marks:mp,maxAgeSeconds:policy.maxAgeSeconds,maxSpreadBps:policy.maxSpreadBps};
   await writeFile(cfgPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
   performance=await run(['--input',cfgPath],'calculate-performance.mjs',30000);
   assert(performance.pnlReady===false&&performance.executionReady===false&&performance.decisionReady===false&&['BLOCKED','BOUNDED_WINDOW_ACCOUNTING_DIAGNOSTIC'].includes(performance.status),'WINDOW_RESULT_INVALID');
   if(performance.status!=='BLOCKED')assert(performance.pool===scope&&performance.owner===wallet&&performance.position===position&&performance.closingRawHash===obs.rawHash&&performance.historyComplete===false,'WINDOW_RESULT_SCOPE');
  }catch(e){performance={status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'WINDOW_EVIDENCE_OR_CALCULATION_FAILED',decisionReady:false,executionReady:false,pnlReady:false}}
 }
 const perfBytes=JSON.stringify(performance);await writeFile(join(dir,'performance.json'),perfBytes,{mode:0o600,flag:'wx'});
 const out={scope:'POSITION_ACCOUNTING_DIAGNOSTIC_ONLY',pool:scope,owner:wallet,position,observation:obs,historyCapture:relative(ROOT,capture),historyManifestHash:sha(mb),ledgerHash:sha(ledgerBytes),performanceHash:sha(perfBytes),ledger:summary,performance,createdAt:Date.now(),historyComplete:false,pnlReady:false,decisionReady:false,executionReady:false};
 await writeFile(join(dir,'manifest.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600,flag:'wx'});
 await ledgerStore.save(obs,prior,next);
 return {...out,capture:relative(ROOT,dir)};
}

 return {readPositionIndex,readPositionDetail,positionAccounting};
}

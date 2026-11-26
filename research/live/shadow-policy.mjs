// T11 offline hypothetical replay. No funded operation, wallet, signing, or RPC.
import {Engine as E} from '../engine.mjs';
import {previewPlans} from './preview-plans.mjs';
import {previewManagement} from './preview-management.mjs';
const MODES=['hodl','spot','curve','bid_ask','hybrid','adaptive'];
const assert=(ok,m)=>{if(!ok)throw Error(m);};
export const PAPER_MODES=Object.freeze(['hodl','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid','adaptive']);
export function replayWindow(window,sample,{modes=MODES,paper=false}={}){
 assert(Array.isArray(modes)&&modes.length>0&&new Set(modes).size===modes.length&&modes.every(m=>PAPER_MODES.includes(m)),'invalid replay modes');
 const cfg=E.requestConfig(window.request,window.config);
 const first=E.reference(sample.events[0],cfg);assert(first.valid,'invalid opening reference');
 const req={...window.request,initialPrice:first.price,allowDispose:false};
 const runs=[];
 for(const mode of modes){
  const s=E.newState(req,cfg);
  let poolAt=null,lastReview=-Infinity,attempted=false,decisions=0,missing=0,gateCount=0;
  const policyLog=[];
  for(const e of sample.events){
   if(e.type==='MARKET')assert(E.reference(e,cfg).valid,'reference invalid during replay');
   // Pending orders are virtual and must not capture the incoming swap before becoming eligible.
   // Conservatively settle only at a MARKET event with updated reference; no exact execution claim.
   E.event(s,cfg,e);
   if(e.type==='POOL_STATE')poolAt=e.t;
   if(e.type!=='MARKET')continue;
   const stateFresh=poolAt!==null&&e.t-poolAt<=cfg.maxReferenceAge;
   if(s.pending&&stateFresh){
    const a=s.pending.action;
    if(['OPEN','ADD','REPOSITION'].includes(a.type)){
     const trial=JSON.parse(JSON.stringify(s));
     let ok=true;
     try{
      E.applyAction(trial,cfg,a,e.t);
      ok=E.binId(cfg,s.market.ref.price)===e.activeId&&trial.bins.length>0&&trial.bins.every(b=>{
       const ext=s.poolBins[b.id];
       return Number.isFinite(ext)&&ext>0&&b.liquidity/(b.liquidity+ext)<=cfg.maxBinShare&&!(b.id<e.activeId&&b.x>0)&&!(b.id>e.activeId&&b.y>0);
      });
     }catch{ok=false;}
     if(!ok){policyLog.push({t:e.t,action:a.type,status:'VIRTUAL_PREVIEW_INVALIDATED'});s.pending=null;gateCount++;}
    }
    if(s.pending)E.executePending(s,cfg,e.t);
   }
   if(mode==='hodl'||s.pending||(!paper&&e.t===window.end))continue;
   if(!stateFresh){missing++;continue;}
   if(e.t-lastReview<cfg.cooldownSeconds)continue;
   if(mode!=='adaptive'&&attempted)continue;
   const market={activeId:e.activeId,bins:Object.keys(s.poolBins).map(id=>({binId:Number(id)}))};
   let row=null,reason;
   if(!s.bins.length){
    const preview=previewPlans(s,cfg,market,{asOf:e.t});reason=preview.reason;
    if(mode==='adaptive')row=preview.selected;
    else if(preview.status==='RESEARCH_PLAN_PREVIEW_UNVERIFIED'){
     // Fixed comparator: same original width-4, full-size shape rule; no parameter search.
     row=paper&&mode==='hybrid_grid'
      ?preview.candidates.find(r=>r.family===mode&&r.action.spec?.width===4&&r.action.spec?.alphaBid===.5&&r.action.spec?.alphaAsk===.5&&r.action.spec?.askFraction===.5)??null
      :preview.candidates.find(r=>r.family===mode&&r.action.spec?.width===4&&r.action.spec?.bidFraction===(preview.regime==='DOWNTREND'?0:1)&&r.action.spec?.askFraction===(mode==='asymmetric'&&preview.regime==='UPTREND'?.25:.7))??null;
     attempted=true;
    }
   }else if(mode==='adaptive'){
    const position={position:'VIRTUAL:'+window.id};
    const operations={position:position.position,asOf:e.t,lastActionTime:s.lastActionTime,rebalances:s.rebalances,rebalanceTurnoverSol:s.rebalanceTurnover,spotTurnoverSol:s.turnover};
    const preview=previewManagement(s,cfg,market,{asOf:e.t,position,operations});reason=preview.reason;row=preview.selected;
    if(preview.alerts?.includes('MANUAL_RISK_REVIEW_REQUIRED'))gateCount++;
   }
   lastReview=e.t;decisions++;
   if(!row?.feasible||['HOLD','NO_LP'].includes(row.action.type)){policyLog.push({t:e.t,action:row?.action.type??'NO_SELECTION',status:'VIRTUAL_NO_ACTION',reason:reason??row?.reason??null});continue;}
   assert(!row.action.acquireSol&&!row.action.type.includes('DISPOSE'),'spot conversion not allowed');
   // Always enforce at least one later event for modeled execution.
   E.submit(s,{...cfg,executionDelaySeconds:Math.max(1,cfg.executionDelaySeconds)},row.action,e.t);
   policyLog.push({t:e.t,action:row.action.type,status:'VIRTUAL_INTENT_ONLY'});
  }
  const p=s.market.ref.price,r=E.reportAt(s,p);
  const invalid=s.quality.length>0||(!paper&&!!s.pending)||s.receipts.some(x=>['FAILED','REJECTED','EXPIRED','PARTIAL'].includes(x.status))||!Number.isFinite(r.residual)||Math.abs(r.residual)>1e-6*Math.max(1,Math.abs(r.nav));
  const capitalSeconds=s.curve.slice(1).reduce((v,b,i)=>v+s.curve[i].nav*(b.t-s.curve[i].t),0);
  runs.push({mode,status:invalid?'INCONCLUSIVE_MODEL_PATH':paper&&s.pending?'VIRTUAL_INTENT_PENDING':'HYPOTHETICAL_REPLAY',...(paper?{virtualNavSol:invalid?null:r.nav,virtualWallet:invalid?null:s.wallet,virtualBins:invalid?null:s.bins,unclaimed:invalid?null:r.unclaimed,claimed:invalid?null:r.claimed,navSeries:invalid?[]:s.curve.map(v=>({t:v.t,nav:v.nav,drawdown:v.drawdown})),liquidation:invalid?null:E.liquidation(s,cfg)}:{}),pnlSol:invalid?null:r.pnl,alphaSol:invalid?null:r.alpha,feesSol:invalid?null:r.fee,costSol:invalid?null:r.cost,inventoryContributionSol:invalid?null:r.inventory,unattributedSol:invalid?null:r.unattributed,markout:invalid?null:r.markout,maxDrawdown:Math.max(0,...s.curve.map(b=>b.drawdown)),netPerSolHour:!invalid&&capitalSeconds>0?r.pnl*3600/capitalSeconds:null,riskBreaches:s.riskLog.length,quality:s.quality,pending:!!s.pending,decisions,missingStateReviews:missing,manualReviewOrInvalidationCount:gateCount,policyLog,modeledOperations:s.receipts.map(x=>({t:x.t,action:x.action,modeledStatus:x.status,reason:x.reason??null})),initialNavSol:s.initialNav,endInventory:invalid?null:E.balances(s)});
 }
 return {id:window.id,group:window.group,split:window.split,runs,source:'HYPOTHETICAL_FROZEN_PATH_NOT_CHAIN_PNL'};
}

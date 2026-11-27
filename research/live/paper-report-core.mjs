// Read-only descriptive aggregation of committed Paper history. No new model or forecast.
import {assert} from './research-contract.mjs';
import {pairedObservation,completedPaperEvaluation} from './paper-auto-core.mjs';
export const REPORT_REGIMES=['HEALTHY_RANGE','UPTREND','DOWNTREND','DISTRIBUTION_RANGE','DEAD_RANGE','STRESS','UNKNOWN'];
const Q=1n<<64n;
const integer=x=>{assert(typeof x==='string'&&/^-?\d{1,80}$/.test(x),'PAPER_REPORT_INTEGER');return BigInt(x)};
const mark=(x,y,p)=>y+x*p/Q;
const ms=r=>Date.parse(r.proof?.receivedAt);
const fee=r=>({x:integer(r.claimedFeeXRaw??'0')+integer(r.point.feeXRaw),y:integer(r.claimedFeeYRaw??'0')+integer(r.point.feeYRaw)});
function holdings(p){return {x:integer(p.walletXRaw)+integer(p.principalXRaw)+integer(p.feeXRaw),y:integer(p.walletYRaw)+integer(p.principalYRaw)+integer(p.feeYRaw)}}
function pair(record,row,baseline){
 const p=row?.point,b=baseline?.point;
 assert(p&&b&&['HOLD_ONLY','OPEN_PROXY','EXITED_PROXY'].includes(row.status)&&baseline.status==='HOLD_ONLY'&&p.slot===record.slot&&b.slot===record.slot&&p.receivedAt===b.receivedAt&&p.receivedAt===ms(record)&&p.priceQ64Raw===b.priceQ64Raw,'PAPER_REPORT_UNPAIRED');
 const price=integer(p.priceQ64Raw),nav=integer(p.navYRaw),h=holdings(p),f=fee(row),cost=integer(p.costYRaw);
 assert(price>0n&&h.x>=0n&&h.y>=0n&&f.x>=0n&&f.y>=0n&&cost>=0n&&mark(h.x,h.y,price)===nav&&nav-integer(b.navYRaw)===integer(p.excessVsHoldYRaw),'PAPER_REPORT_ACCOUNTING');
 return {price,nav,h,f,cost,alpha:integer(p.excessVsHoldYRaw),drawdownBps:p.drawdownBps};
}
function environment(previous,current){
 const m=previous.observationLog?.market;
 if(!REPORT_REGIMES.includes(m?.regime)||m.regime==='UNKNOWN'||!m.inputBasis||!Number.isFinite(m.asOf)||!Number.isFinite(m.observationTime)||m.observationTime>m.asOf||m.asOf*1000>ms(previous)||!Number.isFinite(m.referenceExpiresAt)||m.referenceExpiresAt*1000<ms(current))return 'UNKNOWN';
 return m.regime;
}
const sums=()=>({netYRaw:0n,alphaYRaw:0n,feeAccrualYRaw:0n,priorHoldingsRepriceYRaw:0n,operationCostYRaw:0n,inventoryConversionResidualYRaw:0n});
const cell=()=>({intervals:0,observedMs:0,missingIntervals:0,missingMs:0,...sums()});
function accumulate(c,d,elapsed){c.intervals++;c.observedMs+=elapsed;for(const k of Object.keys(sums()))c[k]+=d[k]}
function miss(c,elapsed){c.missingIntervals++;c.missingMs+=elapsed}
function interval(a,b){
 assert(b.f.x>=a.f.x&&b.f.y>=a.f.y&&b.cost>=a.cost,'PAPER_REPORT_COUNTER_REGRESSED');
 const netYRaw=b.nav-a.nav,alphaYRaw=b.alpha-a.alpha,feeAccrualYRaw=mark(b.f.x-a.f.x,b.f.y-a.f.y,b.price),priorHoldingsRepriceYRaw=mark(a.h.x,a.h.y,b.price)-a.nav,operationCostYRaw=b.cost-a.cost;
 return {netYRaw,alphaYRaw,feeAccrualYRaw,priorHoldingsRepriceYRaw,operationCostYRaw,inventoryConversionResidualYRaw:netYRaw-feeAccrualYRaw-priorHoldingsRepriceYRaw+operationCostYRaw};
}
const encode=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,typeof x==='bigint'?String(x):x]));
export function createPaperReport(state,{maxChartPoints=2000}={}){
 assert(Number.isSafeInteger(maxChartPoints)&&maxChartPoints>=2&&maxChartPoints<=10000&&Number.isSafeInteger(state.snapshotCount)&&state.snapshotCount>=1,'PAPER_REPORT_CONFIG');
 const modes=state.rows.map(r=>r.mode),base=state.rows.find(r=>r.mode==='NO_LP'),initial=integer(base?.initialNavYRaw);
 assert(initial>0n&&modes.length===8&&new Set(modes).size===8&&state.rows.every(r=>integer(r.initialNavYRaw)===initial),'PAPER_REPORT_BASELINE');
 const matrix=Object.fromEntries(REPORT_REGIMES.map(r=>[r,{regime:r,intervals:0,observedMs:0,inputBases:{},strategies:Object.fromEntries(modes.map(m=>[m,cell()]))}]));
 const totals=Object.fromEntries(modes.map(m=>[m,cell()])),opening={},operations={},decisionReasons={},curve=[],stride=Math.max(1,Math.ceil((state.snapshotCount-1)/(maxChartPoints-1)));
 let prior=null,count=0,gapIntervals=0,gapMs=0,unknownLogCount=0,firstTime=null,elapsedMs=0,decisionCount=0;
 function points(record){
  const baseline=record.rows.find(r=>r.mode==='NO_LP'),out={};
  for(const mode of modes)try{out[mode]=pair(record,record.rows.find(r=>r.mode===mode),baseline)}catch{out[mode]=null}
  if(!out.NO_LP)for(const mode of modes)out[mode]=null;
  return out;
 }
 function add(r){
  assert(r.id===state.id&&r.pool===state.pool&&r.sequence===count+1&&r.backendHash===state.backendHash&&r.feeBasis===state.feeBasis,'PAPER_REPORT_SCOPE');
  const time=ms(r);assert(Number.isFinite(time),'PAPER_REPORT_TIME');
  const current=points(r),log=r.observationLog;
  if(!log)unknownLogCount++;
  const d=log?.decision;if(d){decisionCount++;const k=d.reason??d.status??'UNKNOWN';decisionReasons[k]=(decisionReasons[k]??0)+1}
  for(const op of log?.operations??[]){const k=op.mode+':'+op.action;operations[k]=(operations[k]??0)+1}
  if(!prior){
   firstTime=time;
   for(const mode of modes){const v=current[mode];opening[mode]=v?encode({netYRaw:v.nav-initial,alphaYRaw:v.alpha,operationCostYRaw:v.cost,inventoryConversionResidualYRaw:v.nav-initial+v.cost}):null}
  }else{
   const elapsed=time-ms(prior.r);assert(elapsed>=0,'PAPER_REPORT_TIME_ORDER');elapsedMs+=elapsed;
   const gap=r.gapCount!==prior.r.gapCount||elapsed>state.policy.maxGapSeconds*1000;
   if(gap){gapIntervals++;gapMs+=elapsed;for(const mode of modes)miss(totals[mode],elapsed)}
   else{
    const regime=environment(prior.r,r),bucket=matrix[regime],basis=regime==='UNKNOWN'?'UNKNOWN':prior.r.observationLog.market.inputBasis;
    bucket.intervals++;bucket.observedMs+=elapsed;bucket.inputBases[basis]=(bucket.inputBases[basis]??0)+1;
    for(const mode of modes){
     let delta=null;try{if(prior.points[mode]&&current[mode])delta=interval(prior.points[mode],current[mode])}catch{}
     if(delta){accumulate(bucket.strategies[mode],delta,elapsed);accumulate(totals[mode],delta,elapsed)}
     else{miss(bucket.strategies[mode],elapsed);miss(totals[mode],elapsed)}
    }
   }
  }
  // Chart is only a bounded projection; all intervals contribute to the statistics.
  if((count%stride===0)||r.sequence===state.snapshotCount)curve.push({sequence:r.sequence,slot:r.slot,time,regime:log?.market?.regime??'UNKNOWN',gapCount:r.gapCount,priceQ64Raw:current.NO_LP?String(current.NO_LP.price):null,rows:modes.map(mode=>{const v=current[mode];return {mode,navYRaw:v?String(v.nav):null,alphaYRaw:v?String(v.alpha):null,drawdownBps:v?.drawdownBps??null}})});
  prior={r,points:current};count++;
 }
 function finish(){
  assert(count===state.snapshotCount&&prior?.r.slot===state.last.slot,'PAPER_REPORT_INCOMPLETE');
  const comparison=pairedObservation(state);
  return {schemaVersion:1,scope:'PAPER_OBSERVED_RESEARCH_REPORT',id:state.id,pool:state.pool,backendHash:state.backendHash,feeBasis:state.feeBasis,window:state.window,initialNavYRaw:String(initial),startAt:firstTime,endAt:ms(prior.r),observations:count,intervals:count-1,elapsedMs,gapIntervals,gapMs,missingObservationLogs:unknownLogCount,opening,strategies:modes.map(mode=>{const v=prior.points[mode],t=totals[mode];return {mode,status:prior.r.rows.find(r=>r.mode===mode).status,latest:v?encode({navYRaw:v.nav,pnlYRaw:v.nav-initial,alphaYRaw:v.alpha,operationCostYRaw:v.cost,feeMarkYRaw:mark(v.f.x,v.f.y,v.price)}):null,intervalAttribution:encode(t)}}),environments:Object.values(matrix).map(b=>({...b,strategies:modes.map(mode=>({mode,...encode(b.strategies[mode])}))})),decisionCount,decisionReasons,operations,chart:{stride,points:curve},comparison,completedEvaluation:completedPaperEvaluation(state,comparison),attributionBasis:'PRIOR_HOLDINGS_REPRICE_PLUS_END_MARKED_NEW_FEES_MINUS_COST_PLUS_INVENTORY_CONVERSION_AND_ROUNDING_RESIDUAL',environmentBasis:'PRIOR_CAPTURE_CLASSIFICATION_VALID_THROUGH_INTERVAL_END',executionReady:false,protocolExact:false,parameterSelection:false,limitations:['Observed-share proxy, not realized PnL.','Interval contributions are additive in raw SOL, not compounded returns; opening allocation costs are reported separately.','Fee increments valued at ending mark; prior holdings repricing includes previously earned fees; residual includes conversion, rounding and model discrepancy, not exact IL.','Missing intervals excluded, no extrapolation. Regime attribution is a causal sampled approximation; changes between captures are unknown.','Chart downsampled, not a full export. Blocked paths retain observed prefixes only.']};
 }
 return {add,finish};
}

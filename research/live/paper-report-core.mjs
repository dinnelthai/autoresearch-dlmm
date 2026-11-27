// Read-only descriptive aggregation of committed Paper history. No new model or forecast.
import {assert} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
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
 const deployed=mark(integer(p.principalXRaw),integer(p.principalYRaw),price);assert(deployed>=0n&&deployed<=nav,'PAPER_REPORT_DEPLOYED_CAPITAL');
 return {price,nav,h,f,cost,deployed,status:row.status,alpha:integer(p.excessVsHoldYRaw),drawdownBps:p.drawdownBps};
}
function adaptiveDecision(d){return !!d&&d.kind!=='INITIAL_CONTROLS'&&d.reason!=='INITIAL_FROZEN_CONTROLS'&&(d.kind==='ADAPTIVE_MODEL'||!d.kind&&!!d.inputHash)}
function environment(previous,current){
 const m=previous.observationLog?.market;
 if(!REPORT_REGIMES.includes(m?.regime)||m.regime==='UNKNOWN'||!m.inputBasis||!Number.isFinite(m.asOf)||!Number.isFinite(m.observationTime)||m.observationTime>m.asOf||m.asOf*1000>ms(previous)||!Number.isFinite(m.referenceExpiresAt)||m.referenceExpiresAt*1000<ms(current))return 'UNKNOWN';
 return m.regime;
}
const sums=()=>({netYRaw:0n,alphaYRaw:0n,feeAccrualYRaw:0n,priorHoldingsRepriceYRaw:0n,operationCostYRaw:0n,inventoryConversionResidualYRaw:0n});
const cell=()=>({intervals:0,observedMs:0,missingIntervals:0,missingMs:0,openMs:0,flatMs:0,exitedMs:0,deployedLamportMs:0n,navLamportMs:0n,...sums()});
function accumulate(c,d,elapsed,a){c.intervals++;c.observedMs+=elapsed;c[a.status==='OPEN_PROXY'?'openMs':a.status==='EXITED_PROXY'?'exitedMs':'flatMs']+=elapsed;c.deployedLamportMs+=a.deployed*BigInt(elapsed);c.navLamportMs+=a.nav*BigInt(elapsed);for(const k of Object.keys(sums()))c[k]+=d[k]}
function miss(c,elapsed){c.missingIntervals++;c.missingMs+=elapsed}
function interval(a,b){
 assert(b.f.x>=a.f.x&&b.f.y>=a.f.y&&b.cost>=a.cost,'PAPER_REPORT_COUNTER_REGRESSED');
 const netYRaw=b.nav-a.nav,alphaYRaw=b.alpha-a.alpha,feeAccrualYRaw=mark(b.f.x-a.f.x,b.f.y-a.f.y,b.price),priorHoldingsRepriceYRaw=mark(a.h.x,a.h.y,b.price)-a.nav,operationCostYRaw=b.cost-a.cost;
 return {netYRaw,alphaYRaw,feeAccrualYRaw,priorHoldingsRepriceYRaw,operationCostYRaw,inventoryConversionResidualYRaw:netYRaw-feeAccrualYRaw-priorHoldingsRepriceYRaw+operationCostYRaw};
}
const encode=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,typeof x==='bigint'?String(x):x]));
function encodeCell(c,initial){
 const {deployedLamportMs,navLamportMs,...rest}=c;
 const rate=(amount,capitalMs)=>capitalMs>0n?Number(amount*3600000n*1000000n/capitalMs)/100:null;
 return {...encode(rest),alphaBpsPerHour:rate(c.alphaYRaw,initial*BigInt(c.observedMs)),feeBpsPerDeployedHour:rate(c.feeAccrualYRaw,deployedLamportMs),coverageBps:c.intervals+c.missingIntervals?Math.round(c.intervals*10000/(c.intervals+c.missingIntervals)):null,meanDeployedBps:navLamportMs>0n?Number(deployedLamportMs*10000n/navLamportMs):null,openTimeBps:c.observedMs>0?Math.round(c.openMs*10000/c.observedMs):null};
}
export function createPaperReport(state,{maxChartPoints=2000}={}){
 assert(Number.isSafeInteger(maxChartPoints)&&maxChartPoints>=2&&maxChartPoints<=10000&&Number.isSafeInteger(state.snapshotCount)&&state.snapshotCount>=1,'PAPER_REPORT_CONFIG');
 const modes=state.rows.map(r=>r.mode),base=state.rows.find(r=>r.mode==='NO_LP'),initial=integer(base?.initialNavYRaw);
 assert(initial>0n&&(modes.length===8&&new Set(modes).size===8||state.strategyScope==='ADAPTIVE_ONLY'&&modes.join(',')==='NO_LP,adaptive')&&state.rows.every(r=>integer(r.initialNavYRaw)===initial),'PAPER_REPORT_BASELINE');
 const displayModes=state.strategyScope==='ADAPTIVE_ONLY'?['adaptive']:modes;
 const matrix=Object.fromEntries(REPORT_REGIMES.map(r=>[r,{regime:r,intervals:0,observedMs:0,inputBases:{},strategies:Object.fromEntries(modes.map(m=>[m,cell()]))}]));
 const totals=Object.fromEntries(modes.map(m=>[m,cell()])),opening={},operations={},decisionReasons={},curve=[],timeline=[],followups=new Map(),horizons=[60,300,900].map(seconds=>({seconds,pending:[],groups:new Map()})),transitions=new Map(),stride=Math.max(1,Math.ceil((state.snapshotCount-1)/(maxChartPoints-1)));
 let prior=null,count=0,gapIntervals=0,gapMs=0,unknownLogCount=0,firstTime=null,elapsedMs=0,decisionCount=0,timelineCount=0,lastInterval=null;
 function segment(regime,start,end){const last=timeline.at(-1);if(last?.regime===regime&&last.endAt===start){last.endAt=end;last.intervals++;return}timelineCount++;timeline.push({regime,startAt:start,endAt:end,intervals:1});if(timeline.length>1000)timeline.shift()}
 function observeFollowup(previous,current,elapsed,gap){
  const log=previous.r.observationLog,d=log?.decision;if(!d||d.kind==='INITIAL_CONTROLS'||d.reason==='INITIAL_FROZEN_CONTROLS')return;
  const op=log.operations?.find(o=>o.mode==='adaptive'&&['OPEN','REENTRY','REDUCE','REPOSITION','REMOVE_AND_HOLD','EXIT'].includes(o.action));
  const selected=d.selected?.action??'NO_SELECTION',action=op?.action??(selected==='HOLD'||selected==='NO_LP'?selected:'NO_OPERATION'),key=action,group=followups.get(key)??{action,decisions:0,paired:0,missing:0,observedMs:0,nextNetYRaw:0n,nextAlphaYRaw:0n,positiveAlpha:0,immediateSamples:0,immediateNavChangeYRaw:0n};
  group.decisions++;
  if(op?.comparisonBasis==='SAME_CAPTURE_PRE_DECISION'&&op.before?.slot===op.after?.slot&&op.after?.slot===previous.r.slot){try{group.immediateNavChangeYRaw+=integer(op.after.navYRaw)-integer(op.before.navYRaw);group.immediateSamples++}catch{}}
  if(!gap&&previous.points.adaptive&&current.adaptive){try{const delta=interval(previous.points.adaptive,current.adaptive);group.paired++;group.observedMs+=elapsed;group.nextNetYRaw+=delta.netYRaw;group.nextAlphaYRaw+=delta.alphaYRaw;if(delta.alphaYRaw>0n)group.positiveAlpha++}catch{group.missing++}}else group.missing++;
  followups.set(key,group);
 }
 // Horizon followups are overlapping observations, not additive returns.
 function horizonGroup(h,action){let g=h.groups.get(action);if(!g){g={action,eligible:0,paired:0,missing:0,pending:0,positiveAlpha:0,sumAlphaYRaw:0n,sumNetYRaw:0n,elapsedMs:0};h.groups.set(action,g)}return g}
 function horizonStep(r,current,gap,continuous){
  const t=ms(r),v=current.adaptive;
  for(const h of horizons){
   if(gap||!continuous){for(const q of h.pending)horizonGroup(h,q.action).missing++;h.pending=[]}
   else{let done=0;while(done<h.pending.length&&h.pending[done].due<=t){const q=h.pending[done++],g=horizonGroup(h,q.action);if(v&&t-q.due<=state.policy.maxGapSeconds*1000){const alpha=v.alpha-q.alpha;g.paired++;g.sumAlphaYRaw+=alpha;g.sumNetYRaw+=v.nav-q.nav;g.elapsedMs+=t-q.start;if(alpha>0n)g.positiveAlpha++}else g.missing++}if(done)h.pending=h.pending.slice(done)}
   const l=r.observationLog,d=l?.decision,op=l?.operations?.find(o=>o.mode==='adaptive'&&['OPEN','REENTRY','REDUCE','REPOSITION','REMOVE_AND_HOLD','EXIT'].includes(o.action));
   if(!d||(!op&&!adaptiveDecision(d)))continue;
   const action=op?.action??(['HOLD','NO_LP'].includes(d.selected?.action)?d.selected.action:'NO_OPERATION'),g=horizonGroup(h,action);g.eligible++;
   const start=Math.max(t,Number.isFinite(d.decidedAt)?d.decidedAt:t);
   if(v){const q={action,start,due:start+h.seconds*1000,alpha:v.alpha,nav:v.nav};const last=h.pending.at(-1);h.pending.push(q);if(last&&last.due>q.due)h.pending.sort((a,b)=>a.due-b.due)}else g.missing++;
  }
 }
 function transitionStep(regime,deltas,elapsed){
  const old=lastInterval;
  if(old&&old.regime!==regime&&old.regime!=='UNKNOWN'&&regime!=='UNKNOWN'){
   const key=old.regime+'→'+regime,g=transitions.get(key)??{from:old.regime,to:regime,count:0,strategies:Object.fromEntries(modes.map(mode=>[mode,{paired:0,missing:0,beforeMs:0,afterMs:0,beforeAlphaYRaw:0n,afterAlphaYRaw:0n}]))};g.count++;
   for(const mode of modes){const a=old.deltas[mode],b=deltas[mode],s=g.strategies[mode];if(a&&b){s.paired++;s.beforeMs+=old.elapsed;s.afterMs+=elapsed;s.beforeAlphaYRaw+=a.alphaYRaw;s.afterAlphaYRaw+=b.alphaYRaw}else s.missing++}
   transitions.set(key,g);
  }
  lastInterval={regime,deltas,elapsed};
 }
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
 let gap=false,continuous=true;
  if(!log)unknownLogCount++;
  const d=log?.decision;if(d){decisionCount++;const k=d.reason??d.status??'UNKNOWN';decisionReasons[k]=(decisionReasons[k]??0)+1}
  for(const op of log?.operations??[]){const k=op.mode+':'+op.action;operations[k]=(operations[k]??0)+1}
  if(!prior){
   firstTime=time;
   for(const mode of modes){const v=current[mode];opening[mode]=v?encode({netYRaw:v.nav-initial,alphaYRaw:v.alpha,operationCostYRaw:v.cost,inventoryConversionResidualYRaw:v.nav-initial+v.cost}):null}
  }else{
   const elapsed=time-ms(prior.r);assert(elapsed>=0,'PAPER_REPORT_TIME_ORDER');elapsedMs+=elapsed;
   gap=r.gapCount!==prior.r.gapCount||elapsed>state.policy.maxGapSeconds*1000;
   continuous=false;try{if(prior.points.adaptive&&current.adaptive){interval(prior.points.adaptive,current.adaptive);continuous=true}}catch{}
   observeFollowup(prior,current,elapsed,gap);
   if(gap){lastInterval=null;segment('GAP',ms(prior.r),time);gapIntervals++;gapMs+=elapsed;for(const mode of modes)miss(totals[mode],elapsed)}
   else{
    const regime=environment(prior.r,r),bucket=matrix[regime],basis=regime==='UNKNOWN'?'UNKNOWN':prior.r.observationLog.market.inputBasis;
    segment(regime,ms(prior.r),time);bucket.intervals++;bucket.observedMs+=elapsed;bucket.inputBases[basis]=(bucket.inputBases[basis]??0)+1;
    const deltas={};
    for(const mode of modes){
     let delta=null;try{if(prior.points[mode]&&current[mode])delta=interval(prior.points[mode],current[mode])}catch{}
     deltas[mode]=delta;
     if(delta){accumulate(bucket.strategies[mode],delta,elapsed,prior.points[mode]);accumulate(totals[mode],delta,elapsed,prior.points[mode])}
     else{miss(bucket.strategies[mode],elapsed);miss(totals[mode],elapsed)}
    }
    transitionStep(regime,deltas,elapsed);
   }
  }
  horizonStep(r,current,gap,continuous);
  // Chart is only a bounded projection; all intervals contribute to the statistics.
  if((count%stride===0)||r.sequence===state.snapshotCount)curve.push({sequence:r.sequence,slot:r.slot,time,regime:log?.market?.regime??'UNKNOWN',gapCount:r.gapCount,priceQ64Raw:current.NO_LP?String(current.NO_LP.price):null,rows:displayModes.map(mode=>{const v=current[mode];return {mode,navYRaw:v?String(v.nav):null,alphaYRaw:v?String(v.alpha):null,drawdownBps:v?.drawdownBps??null}})});
  prior={r,points:current};count++;
 }
 function finish(){
  assert(count===state.snapshotCount&&prior?.r.slot===state.last.slot,'PAPER_REPORT_INCOMPLETE');
  const comparison=pairedObservation(state),adaptive=totals.adaptive,knownMs=Object.values(matrix).filter(b=>b.regime!=='UNKNOWN').reduce((n,b)=>n+b.observedMs,0),findings=[];
  findings.push({code:'ENVIRONMENT_COVERAGE',knownMs,unknownMs:matrix.UNKNOWN.observedMs,gapMs,unobserved:REPORT_REGIMES.filter(k=>matrix[k].intervals===0)});
  findings.push({code:'ADAPTIVE_OBSERVED_ALPHA',status:adaptive.intervals>=3&&adaptive.observedMs>=60000&&adaptive.missingIntervals===0&&state.rows.find(r=>r.mode==='adaptive')?.adaptiveDecisions>0?'DESCRIPTIVE_ONLY':'INSUFFICIENT_COVERAGE',intervals:adaptive.intervals,observedMs:adaptive.observedMs,alphaYRaw:String(adaptive.alphaYRaw)});
  for(const b of Object.values(matrix)){if(b.regime==='UNKNOWN')continue;const a=b.strategies.adaptive;if(a.intervals>=3&&a.observedMs>=60000&&a.missingIntervals===0&&state.rows.find(r=>r.mode==='adaptive')?.adaptiveDecisions>0)findings.push({code:'ADAPTIVE_ENVIRONMENT_ALPHA',regime:b.regime,alphaYRaw:String(a.alphaYRaw),observedMs:a.observedMs,intervals:a.intervals})}
  return {schemaVersion:1,scope:'PAPER_OBSERVED_RESEARCH_REPORT',id:state.id,pool:state.pool,backendHash:state.backendHash,feeBasis:state.feeBasis,window:state.window,initialNavYRaw:String(initial),experimentConfig:{capital:state.capital??null,policy:state.policy,goal:state.researchRequest?.goal??state.adaptiveRequest?.goal??null,requestHash:state.researchBinding?.requestHash??null,riskConfig:state.adaptiveRequest?.riskConfig??state.researchRequest?.riskConfig??null,adaptiveEnabled:!!state.adaptiveRequest,planBasis:state.researchBinding?.planBasis??null,configHash:sha(JSON.stringify({capital:state.capital??null,policy:state.policy,request:state.researchRequest??null,adaptiveRequest:state.adaptiveRequest??null,planBasis:state.researchBinding?.planBasis??null}))},startAt:firstTime,endAt:ms(prior.r),observations:count,intervals:count-1,elapsedMs,gapIntervals,gapMs,missingObservationLogs:unknownLogCount,strategyScope:state.strategyScope??'LEGACY_COMPARISON',opening:Object.fromEntries(displayModes.map(m=>[m,opening[m]])),strategies:displayModes.map(mode=>{const v=prior.points[mode],t=totals[mode],row=state.rows.find(r=>r.mode===mode),paired=comparison.rows.find(r=>r.mode===mode)?.status==='PAIRED_OBSERVED_PREFIX_ONLY',evaluated=mode!=='adaptive'||!!state.adaptiveRequest&&row.adaptiveDecisions>0,eligible=!!v&&paired&&evaluated;return {mode,status:prior.r.rows.find(r=>r.mode===mode).status,endpointComparison:{eligible,reason:eligible?null:!evaluated?'NO_ADAPTIVE_MODEL_DECISIONS':'UNPAIRED_OBSERVATION',netReturnBps:eligible?Number((v.nav-initial)*1000000n/initial)/100:null,alphaBps:eligible?Number(v.alpha*1000000n/initial)/100:null},maxDrawdownBps:row.maxDrawdownBps??null,adaptiveDecisions:mode==='adaptive'?row.adaptiveDecisions??0:null,latest:v?encode({navYRaw:v.nav,pnlYRaw:v.nav-initial,alphaYRaw:v.alpha,operationCostYRaw:v.cost,feeMarkYRaw:mark(v.f.x,v.f.y,v.price)}):null,intervalAttribution:encodeCell(t,initial)}}),environments:Object.values(matrix).map(b=>({...b,strategies:displayModes.map(mode=>({mode,...encodeCell(b.strategies[mode],initial)}))})),decisionCount,decisionReasons,operations,findings,transitions:[...transitions.values()].map(t=>({...t,strategies:displayModes.map(mode=>({mode,...encode(t.strategies[mode])}))})),decisionHorizons:horizons.map(h=>({seconds:h.seconds,groups:[...h.groups.values()].map(g=>{const pending=h.pending.filter(q=>q.action===g.action).length;return {...encode(g),pending,meanAlphaYRaw:g.paired?String(g.sumAlphaYRaw/BigInt(g.paired)):null,meanNetYRaw:g.paired?String(g.sumNetYRaw/BigInt(g.paired)):null}})})),timeline:{totalSegments:timelineCount,omittedSegments:timelineCount-timeline.length,segments:timeline},decisionFollowups:{basis:'NEXT_OBSERVED_INTERVAL_NOT_CAUSAL_ACTION_EFFECT',unobservedFinalDecision:!!prior.r.observationLog?.decision,groups:[...followups.values()].map(encode)},chart:{stride,points:curve},comparison,completedEvaluation:completedPaperEvaluation(state,comparison),attributionBasis:'PRIOR_HOLDINGS_REPRICE_PLUS_END_MARKED_NEW_FEES_MINUS_COST_PLUS_INVENTORY_CONVERSION_AND_ROUNDING_RESIDUAL',environmentBasis:'PRIOR_CAPTURE_CLASSIFICATION_VALID_THROUGH_INTERVAL_END',executionReady:false,protocolExact:false,parameterSelection:false,limitations:['Observed-share proxy, not realized PnL.','Interval contributions are additive in raw SOL, not compounded returns; opening allocation costs are reported separately.','Fee increments valued at ending mark; prior holdings repricing includes previously earned fees; residual includes conversion, rounding and model discrepancy, not exact IL.','Missing intervals excluded, no extrapolation. Regime attribution is a causal sampled approximation; changes between captures are unknown.','Hourly efficiency uses actual observed duration and deployed principal-time; not annualized yield or matched risk performance. Horizon outcomes overlap and may include later decisions; no interpolation or causal claims. Transition pairs use adjacent intervals, not equal-length windows.','Exposure uses prior observed position and NAV, not continuous exposure. Decision followups include subsequent market movement and cannot establish causal benefit.','Chart downsampled, not a full export. Blocked paths retain observed prefixes only.']};
 }
 return {add,finish};
}

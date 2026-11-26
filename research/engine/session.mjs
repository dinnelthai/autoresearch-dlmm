// Extracted from the offline research engine; calculations unchanged.
import {clone,sum,assert,requestConfig} from './numeric.mjs';
import {balances,reportAt,newState} from './accounting.mjs';
import {fresh,classify} from './market.mjs';
import {risk,liquidation} from './risk.mjs';
import {release,claim} from './liquidity.mjs';
import {event,executePending,submit} from './events.mjs';
import {forecast} from './forecast.mjs';
import {evaluate} from './evaluation.mjs';
import {decide} from './decision.mjs';
function createSession(request,overrides={},mode="adaptive"){
  const c=requestConfig(request,overrides),s=newState(request,c);
  assert(["adaptive","spot","curve","bid_ask","hybrid","asymmetric","hodl","sol_hold","manual"].includes(mode),"invalid mode");
  const staticMode=!["adaptive","hodl","sol_hold","manual"].includes(mode);
  let lastDecision=-Infinity,staticAttempted=false;
  if(mode==="hodl"||mode==="sol_hold"){release(s);claim(s);}
  function push(e){
    // Validate/commit the incoming event atomically. Never consume a rejected event ID.
    const trial=clone(s);event(trial,c,e);Object.assign(s,trial);
    const g=classify(s,c),rr=fresh(s,c)?risk(s,c,s.market.ref.price):null;
    const emergency=mode==="adaptive"&&(!fresh(s,c)||g.regime==="STRESS"||g.flags.includes("HOLDER_CONCENTRATION")||!!rr?.violations.length);
    if(emergency&&s.pending&&["OPEN","ADD","REPOSITION"].includes(s.pending.action.type)){const op=s.pending;s.pending=null;s.receipts.push({id:op.id,t:e.t,action:op.action.type,status:"CANCELLED",reason:"RISK_OVERRIDE"});}
    executePending(s,c,e.t);
    if(emergency&&s.bins.length&&!s.pending){const d={t:e.t,regime:g.regime,action:{type:"REMOVE_AND_HOLD"},reason:"HARD_RISK_OVERRIDE",selected:null,candidates:[]};s.decisions.push(d);lastDecision=e.t;submit(s,c,d.action,e.t);return;}
    if(e.type!=="MARKET"||s.pending||["manual","hodl","sol_hold"].includes(mode))return;
    if(e.t-lastDecision<c.cooldownSeconds)return;
    let d;
    if(staticMode){
      if(staticAttempted)return;
      const g=classify(s,c);
      if(!s.market.ref.valid||g.regime==="UNKNOWN")return;
      staticAttempted=true;
      const label=mode,shape=mode==="asymmetric"?"hybrid":mode;
      const action={type:s.bins.length?"REPOSITION":"OPEN",label,spec:{shape,width:4,bidFraction:.5,askFraction:.7,active:shape==="curve"?.2:shape==="spot"?.1:0,alphaBid:mode==="asymmetric"?.75:.5,alphaAsk:mode==="asymmetric"?.25:.5,skewBid:mode==="asymmetric"?-1:0,skewAsk:mode==="asymmetric"?1:0}};
      const v=evaluate(s,c,action,forecast(s,c));
      d={action:v.feasible?action:{type:"NO_LP"},reason:v.feasible?"FIXED_BENCHMARK":"FIXED_BENCHMARK_BLOCKED:"+v.reason,regime:g.regime,selected:v.feasible?v:null,candidates:[v]};
    }else d=decide(s,c,mode);
    s.decisions.push({t:e.t,regime:d.regime,action:d.action,reason:d.reason,selected:d.selected??null,candidates:d.candidates.map(x=>({label:x.action.label||x.action.type,action:x.action,utility:x.utility??null,feasible:x.feasible,reason:x.reason??null}))});lastDecision=e.t;
    if(!["HOLD","NO_LP"].includes(d.action.type))submit(s,c,d.action,e.t);
  }
  function action(a,options={}){
    assert(s.lastTime>=0,"feed market event first");
    if(s.pending){s.receipts.push({t:s.lastTime,status:"REJECTED",action:a.type,reason:"OPERATION_PENDING"});return;}
    submit(s,c,a,s.lastTime,options);
  }
  function analyze(){
    if(!fresh(s,c))return {action:{type:"NO_LP"},reason:"REFERENCE_UNAVAILABLE",candidates:[]};
    return decide(s,c,"adaptive");
  }
  function snapshot(){
    const m=s.market,valid=fresh(s,c);
    const report=valid?reportAt(s,m.ref.price):null;
    if(report)assert(Math.abs(report.residual)<1e-6*Math.max(1,Math.abs(report.nav)),"accounting residual");
    const status=!valid?"REFERENCE_UNAVAILABLE":s.quality.some(q=>q.reason==="FROZEN_PATH_SHARE_LIMIT")?"INVALID_SHARE_ASSUMPTION":s.pending?"PENDING":"SIMULATED";
    const curve=s.curve,avgCapital=curve.length?sum(curve.map(x=>x.nav))/curve.length:null;
    let capitalSeconds=0;for(let i=1;i<curve.length;i++)capitalSeconds+=curve[i-1].nav*(curve[i].t-curve[i-1].t);const duration=curve.length?curve.at(-1).t-curve[0].t:0;const timeWeightedNav=duration>0?capitalSeconds/duration:null;
    const maxInventoryX=Math.max(balances(s).x,...curve.map(x=>x.x)),minObservedSol=Math.min(balances(s).y,...curve.map(x=>x.y));
    return clone({source:"SYNTHETIC_OR_UNVERIFIED_NORMALIZED_EVENTS",calibrated:false,protocolExact:false,status,mode,entry:request.entry,report,liquidation:valid?liquidation(s,c):{status:"UNAVAILABLE",value:null},risk:valid?risk(s,c,m.ref.price):null,maxDrawdown:Math.max(0,...curve.map(x=>x.drawdown)),avgObservedNav:avgCapital,timeWeightedNav,capitalSeconds,netPerSolHour:report&&capitalSeconds>0?report.pnl*3600/capitalSeconds:null,maxInventoryX,minObservedSol,riskBreaches:s.riskLog.length,durationSeconds:curve.length?curve.at(-1).t-curve[0].t:0,state:s,config:c});
  }
  return {push,action,analyze,snapshot};
}
function run(request,events,overrides={},mode="adaptive",manual=[]){
  assert(Array.isArray(events)&&events.length,"events required");
  const session=createSession(request,overrides,mode);
  const sorted=manual.slice().sort((a,b)=>a.t-b.t);let mi=0;
  for(const e of events){session.push(e);while(mi<sorted.length&&sorted[mi].t<=e.t){const op=sorted[mi++];session.action(op.action,op.options||{});}}
  return session.snapshot();
}
function analyzeRequest(request,events,overrides={}){
  const s=createSession(request,overrides,"manual");for(const e of events)s.push(e);
  return {analysis:s.analyze(),snapshot:s.snapshot()};
}
function compare(request,events,overrides={}){
  const modes=["hodl","spot","curve","bid_ask","hybrid","asymmetric","adaptive"];
  const runs=modes.map(mode=>run(request,events,overrides,mode));
  return {source:runs[0].source,results:runs.map(r=>({mode:r.mode,status:r.status,report:r.report,maxDrawdown:r.maxDrawdown,risk:r.risk,liquidation:r.liquidation})),runs,solHold:{mode:"sol_hold",note:"Frictionless initial NAV held in SOL, separate opportunity baseline; no conversion modeled",pnl:0,nav:runs[0].state.initialNav}};
}
export {createSession,run,analyzeRequest,compare};

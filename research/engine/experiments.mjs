// Extracted from the offline research engine; calculations unchanged.
import {sum,assert,config,price,strategyTuning} from './numeric.mjs';
import {newState} from './accounting.mjs';
import {classify} from './market.mjs';
import {event} from './events.mjs';
import {compare,run} from './session.mjs';
function demo(kind="range",overrides={}){
  const c=config(overrides),events=[],ids=kind==="up"?[0,1,2,3,4,5,6,7,8,9,10,11]:kind==="down"?[0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11]:kind==="crash"?[0,1,-1,2,0,-1,-30,-35,-40,-43,-45,-50]:[0,1,-1,2,-2,3,-3,2,-2,1,-1,0,2,-2,3,-3,0,1,-1,0];
  for(let i=0;i<ids.length;i++){
    const id=ids[i],p=price(c,id),t=i*60,qty=8/p,side=i&&id<ids[i-1]?"LP_BUY":"LP_SELL",fee=qty*c.feeBps/10000*(1-c.protocolShare);
    events.push({type:"MARKET",id:"m"+i,t,pool:"DEMO_POOL",references:[{pool:"DEMO_A",price:p,depth:80,availableAt:t},{pool:"DEMO_B",price:p,depth:60,availableAt:t}],exitDepth:kind==="crash"&&i>=6?0.5:30,tokenSafe:true,holderShare:.25,holderOutflow:0,buyImbalance:0,flowSol:32,flowWindowSeconds:240,syntheticFixture:true});
    events.push({type:"SWAP",id:"s"+i,t:t+1,bin:id,side,baseQty:qty,externalLiquiditySol:80,mmFeeX:side==="LP_BUY"?fee:0,mmFeeY:side==="LP_SELL"?fee*p:0});
  }
  return events;
}
function opportunities(pools,cfg={}){
  const c=config(cfg);return pools.map(pool=>{const s=newState({entry:"sol",meme:0,sol:10,initialPrice:c.referencePrice},c);for(const e of pool.events)event(s,c,e);const g=classify(s,c);return {pool:pool.id,...g,admitted:!["UNKNOWN","STRESS","DISTRIBUTION_RANGE","DEAD_RANGE"].includes(g.regime)&&!g.flags.includes("HOLDER_CONCENTRATION")}});}
function evaluateSamples(samples,overrides={}){
  assert(Array.isArray(samples)&&samples.length,"samples required");
  const ids=new Set(),groups=new Map(),rows=[];
  for(const sample of samples){
    assert(typeof sample.id==="string"&&!ids.has(sample.id),"sample id missing or duplicate");ids.add(sample.id);
    assert(typeof sample.group==="string"&&sample.group.length,"group required");
    const split=sample.split??"scenario";assert(["train","validation","test","scenario"].includes(split),"invalid split");
    assert(!groups.has(sample.group)||groups.get(sample.group)===split,"group crosses frozen splits");groups.set(sample.group,split);
    const out=compare(sample.request,sample.events,overrides);
    const a=out.runs.find(r=>r.mode==="adaptive"),b=out.runs.find(r=>r.mode==="bid_ask");
    const valid=x=>x.status==="SIMULATED"&&x.report!==null;
    rows.push({id:sample.id,group:sample.group,split,source:"UNVERIFIED",result:out.results.map(x=>({mode:x.mode,status:x.status,pnl:x.report?.pnl??null,alpha:x.report?.alpha??null,fee:x.report?.fee??null,maxDrawdown:x.maxDrawdown})),delta:valid(a)&&valid(b)?a.report.pnl-b.report.pnl:null,adaptiveRiskBreaches:a.riskBreaches,adaptiveActions:a.state.decisions.map(d=>d.action.type)});
  }
  const summaries={};
  for(const split of new Set(rows.map(r=>r.split))){
    const all=rows.filter(r=>r.split===split),valid=all.filter(r=>r.delta!==null),byGroup=new Map();
    for(const v of valid){const l=byGroup.get(v.group)||[];l.push(v.delta);byGroup.set(v.group,l)}
    const means=[...byGroup.values()].map(l=>sum(l)/l.length).sort((a,b)=>a-b),n=means.length;
    summaries[split]={sampleCount:all.length,validCount:valid.length,independentGroupCount:n,meanGroupDelta:n?sum(means)/n:null,medianGroupDelta:n?means[Math.floor((n-1)/2)]:null,worstGroupDelta:n?means[0]:null,positiveGroupFraction:n?means.filter(x=>x>0).length/n:null,confidenceInterval:null,conclusion:"INCONCLUSIVE_UNVERIFIED_DATA_NO_CALIBRATION"};
  }
  return {source:"UNVERIFIED_OFFLINE_EXPERIMENT",parameterSelection:false,comparison:"Adaptive minus Static Bid-Ask, grouped by declared sample group",config:config(overrides),rows,summaries};
}
function scenarioSuite(request,overrides={}){
  return evaluateSamples(["range","up","down","crash"].map(name=>({id:name,group:name,split:"scenario",request,events:demo(name,overrides)})),overrides);
}
export {demo,opportunities,evaluateSamples,scenarioSuite};

/** One frozen development round. Search train only, evaluate exactly one challenger on later validation.
 * The caller must supply genuine independent time groups. Test events are never evaluated.
 */
export function optimizeSamples(samples,overrides={},options={}){
 const base=config(overrides),objective={drawdownWeight:options.drawdownWeight??.5,minGain:options.minGain??.0001};
 assert(Number.isFinite(objective.drawdownWeight)&&objective.drawdownWeight>=0&&Number.isFinite(objective.minGain)&&objective.minGain>=0,'invalid optimizer objective');
 assert(Array.isArray(samples)&&samples.length>=4&&samples.length<=100,'optimizer samples required');
 const ids=new Set(),groups=new Map(),windows={train:[],validation:[]};
 for(const s of samples){
  assert(typeof s.id==='string'&&s.id&&!ids.has(s.id)&&typeof s.group==='string'&&s.group&&['train','validation','test'].includes(s.split),'invalid optimizer split or identity');ids.add(s.id);
  assert(!groups.has(s.group)||groups.get(s.group)===s.split,'group crosses frozen splits');groups.set(s.group,s.split);
  if(s.split==='test')continue;
  assert(Array.isArray(s.events)&&s.events.length>0&&s.events.every((e,i)=>Number.isSafeInteger(e.t)&&e.t>=0&&(!i||e.t>=s.events[i-1].t)),'ordered sample times required');
  windows[s.split].push(s);
 }
 const groupCount=a=>new Set(a.map(s=>s.group)).size;
 assert(groupCount(windows.train)>=2&&groupCount(windows.validation)>=2,'two train and two validation groups required');
 const trainEnd=Math.max(...windows.train.map(s=>s.events.at(-1).t)),validationStart=Math.min(...windows.validation.map(s=>s.events[0].t));
 assert(trainEnd<validationStart,'validation must follow training');
 const seen=new Set(),candidates=[{},...((options.candidates??[
  {lambda:base.lambda*.5},{lambda:Math.min(100,base.lambda*2)},
  {targetRatio:Math.max(0,base.targetRatio-.1)},{targetRatio:Math.min(1,base.targetRatio+.1)},
  {cooldownSeconds:Math.max(15,Math.round(base.cooldownSeconds*.5))},{cooldownSeconds:Math.min(86400,Math.round(base.cooldownSeconds*2))}
 ]))];
 assert(candidates.length<=16,'too many optimizer candidates');
 const variants=candidates.map(strategyTuning).filter(p=>{const key=JSON.stringify(Object.entries(p).sort());if(seen.has(key))return false;seen.add(key);return true});
 function evaluate(tuning,items){
  const byGroup=new Map(),rows=[];
  for(const sample of items){
   const r=run(sample.request,sample.events,{...overrides,...tuning},'adaptive'),p=r.report,initial=r.state.initialNav;
   const valid=r.status==='SIMULATED'&&p&&initial>0&&[p.pnl,p.alpha,p.fee,p.cost,r.maxDrawdown,r.riskBreaches].every(Number.isFinite);
   const row={id:sample.id,group:sample.group,status:r.status,score:valid?p.alpha/initial-objective.drawdownWeight*r.maxDrawdown:null,alpha:valid?p.alpha/initial:null,netPnl:valid?p.pnl/initial:null,fees:valid?p.fee/initial:null,cost:valid?p.cost/initial:null,drawdown:valid?r.maxDrawdown:null,riskBreaches:r.riskBreaches};
   rows.push(row);const g=byGroup.get(row.group)??[];g.push(row);byGroup.set(row.group,g);
  }
  const eligible=rows.every(r=>r.score!==null),mean=k=>eligible?sum([...byGroup.values()].map(g=>sum(g.map(r=>r[k]))/g.length))/byGroup.size:null;
  return {tuning,eligible,score:mean('score'),alpha:mean('alpha'),netPnl:mean('netPnl'),fees:mean('fees'),cost:mean('cost'),drawdown:mean('drawdown'),riskBreaches:sum(rows.map(r=>r.riskBreaches)),rows};
 }
 const train=variants.map(t=>evaluate(t,windows.train)),incumbent=train[0];
 const best=incumbent.eligible?train.slice(1).filter(r=>r.eligible&&r.riskBreaches<=incumbent.riskBreaches&&r.score>incumbent.score+objective.minGain).sort((a,b)=>b.score-a.score)[0]??null:null;
 let validation=null,proposal=null;
 if(best){
  const a=evaluate({},windows.validation),b=evaluate(best.tuning,windows.validation);
  const accepted=a.eligible&&b.eligible&&b.riskBreaches<=a.riskBreaches&&b.score>a.score+objective.minGain;
  validation={incumbent:a,challenger:b,accepted};
  if(accepted)proposal={tuning:strategyTuning({...Object.fromEntries(Object.entries(overrides).filter(([k])=>['lambda','kappaSol','targetRatio','minImprovementSol','uncertaintySol','cooldownSeconds'].includes(k))),...best.tuning}),nextWindowAfter:Math.max(...windows.validation.map(s=>s.events.at(-1).t)),status:'PROPOSED_FOR_NEW_PAPER_WINDOW'};
 }
 return {source:'UNVERIFIED_NORMALIZED_EVENT_OPTIMIZATION',objective,train,validation,proposal,parameterSelection:!!proposal,testEvaluated:false,trainEnd,validationStart,liveValidated:false,calibrated:false,protocolExact:false};
}

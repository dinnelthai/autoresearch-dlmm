// Extracted from the offline research engine; calculations unchanged.
import {sum,assert,config,price} from './numeric.mjs';
import {newState} from './accounting.mjs';
import {classify} from './market.mjs';
import {event} from './events.mjs';
import {compare} from './session.mjs';
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

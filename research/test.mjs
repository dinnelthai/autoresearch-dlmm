import {Engine} from './engine.mjs';
function selfTest(E){
  let count=0;const check=(v,m)=>{if(!v)throw Error(m);count++};const close=(x,y)=>Math.abs(x-y)<1e-7;
  const c=E.config({executionDelaySeconds:0}),req={entry:"holding",meme:50000,sol:5,initialPrice:.0001};
  let s=E.newState(req,c);check(close(E.nav(s,.0001),10),"initial NAV");
  check(close(E.bidCap(s,c,.0001),1.5),"bid cap");
  check(close(E.cvar([1,2,3,4],.75),4),"CVaR");
  const ev=E.demo("range",c);for(const e of ev.slice(0,5))E.event(s,c,e);
  let before=E.nav(s,s.market.ref.price);E.applyAction(s,c,{type:"OPEN",spec:{shape:"spot",width:4,bidFraction:.5,askFraction:.5,active:.1}},s.lastTime);
  check(close(E.nav(s,s.market.ref.price),before-c.operationCostSol),"deposit conservation");
  let bin=s.bins.find(b=>b.x>0);E.swap(s,c,{id:"fill",t:130,bin:bin.id,side:"LP_SELL",baseQty:100,externalLiquiditySol:80,mmFeeX:0,mmFeeY:.00001});
  check(s.fills.length===1&&s.fills[0].q<0,"sell fill direction");
  const p=s.market.ref.price;check(close(E.reportAt(s,p).residual,0),"alpha conservation");
  before=E.nav(s,p);E.applyAction(s,c,{type:"CLAIM"},s.lastTime);check(close(E.nav(s,p),before-c.operationCostSol),"claim not double counted");
  before=E.nav(s,p);E.applyAction(s,c,{type:"REMOVE_AND_HOLD"},s.lastTime);check(!s.bins.length&&close(E.nav(s,p),before-c.operationCostSol),"remove conservation");
  check(E.balances(s).x>0,"remove not dispose");
  const result=E.compare(req,ev,c);check(result.results.length===7,"comparison modes");
  for(const r of result.runs){check(r.report!==null&&close(r.report.residual,0),"run ledger "+r.mode);check(r.protocolExact===false,"fidelity flag");}
  const sol=E.run({entry:"sol",meme:0,sol:10,initialPrice:.0001},ev,c);check(close(sol.report.residual,0),"SOL entry");
  const ex=E.run({entry:"position",meme:0,sol:5,initialPrice:.0001,positionBins:[{id:1,x:50000,y:0}]},ev,c,"manual",[{t:0,action:{type:"REMOVE_AND_HOLD"}}]);check(ex.state.bins.length===0&&close(ex.report.residual,0),"existing position");
  const fund=E.run(req,ev,c,"manual",[{t:0,action:{type:"FUND",x:100,y:1}}]);check(close(fund.report.externalFlows,1.01)&&close(fund.report.residual,0),"external flows");
  let missing=E.demo("range",c);missing[0].references=[];check(E.reference(missing[0],c).valid===false,"reference reject");
  let delayed=E.run(req,ev,{executionDelaySeconds:100},"manual",[{t:0,action:{type:"CLAIM"},options:{fail:true}}]);check(delayed.state.receipts.some(r=>r.status==="FAILED"),"failure receipt");
  const risk=E.run(req,E.demo("crash",c),c);check(risk.state.history.length>0,"crash processed");
  let dup=false;try{E.run(req,[ev[0],ev[0]],c)}catch{dup=true}check(dup,"duplicate rejected");
  let reversed=false;try{E.run(req,[ev[2],ev[0]],c)}catch{reversed=true}check(reversed,"out-of-order rejected");
  return {count,results:result.results.map(r=>({mode:r.mode,status:r.status,pnl:r.report.pnl,alpha:r.report.alpha,fee:r.report.fee})),adaptiveDecisions:result.runs.at(-1).state.decisions.map(d=>d.action.type)};
}
console.log(JSON.stringify(selfTest(Engine),null,2));

// Integration checks: static baselines must execute their own fixed allocations.
const req={entry:"holding",meme:50000,sol:5,initialPrice:.0001},ev=Engine.demo("range"),cfg={executionDelaySeconds:0};
const out=Engine.compare(req,ev,cfg);
let count=0;function check(v,m){if(!v)throw Error(m);count++;}
for(const r of out.runs.filter(x=>!["hodl","adaptive"].includes(x.mode))){check(r.state.bins.length>0,r.mode+" did not open: "+JSON.stringify(r.state.decisions[0]));check(r.report.fee>0,r.mode+" no fees");check(r.state.decisions[0].reason==="FIXED_BENCHMARK","static baseline incorrectly optimized");}
const stream=Engine.createSession(req,cfg);for(const e of ev)stream.push(e);check(JSON.stringify(stream.snapshot().report)===JSON.stringify(Engine.run(req,ev,cfg).report),"stream / replay mismatch");
const rw=Engine.run({...req,entry:"position",positionBins:[{id:1,x:1000,y:0}]},[ev[0],{id:"reward",t:1,type:"REWARD",x:100,y:.2},ev[2]],{},"manual");check(Math.abs(rw.report.residual)<1e-8&&rw.report.reward>.2,"reward accounting");
const expired=Engine.run(req,ev,{executionDelaySeconds:100},"manual",[{t:0,action:{type:"CLAIM"},options:{expiresAfterSeconds:5}}]);check(expired.state.receipts.some(x=>x.status==="EXPIRED"),"expiry");
const partial=Engine.run(req,ev,cfg,"manual",[{t:120,action:{type:"OPEN",spec:{shape:"spot",width:4,bidFraction:.5,askFraction:.5}},options:{partial:true}}]);check(partial.state.receipts.some(x=>x.status==="PARTIAL")&&partial.state.bins.length>0,"partial deployment");
check(Engine.analyzeRequest(req,ev.slice(0,5)).analysis.candidates.length>0,"analysis entry");console.log("Additional checks:",count);

const bizReq={entry:"holding",meme:50000,sol:5,initialPrice:.0001,pool:"DEMO_POOL",goal:"balanced",horizonSeconds:10800};
const biz=Engine.compare(bizReq,Engine.demo("range"),{executionDelaySeconds:0});
check(biz.runs.at(-1).state.fills.every(f=>f.kind!=="SPOT"||f.q>=0),"disposal without permission");
const analysis=Engine.analyzeRequest(bizReq,Engine.demo("range").slice(0,5),{executionDelaySeconds:0});check(analysis.analysis.candidates.filter(v=>v.action.label==="hybrid_grid").length===25,"hybrid grid");check(analysis.snapshot.config.forecastHorizonSeconds===10800,"horizon");
const w=Engine.weights(4,"hybrid",.5),ba=Engine.weights(4,"bid_ask",0);check(w.every((v,i)=>Math.abs(v-(.125+.5*ba[i]))<1e-10),"normalized mix");
check(Engine.analyzeRequest(bizReq,[{...Engine.demo("range")[0],references:[]}]).analysis.reason==="REFERENCE_UNAVAILABLE","reference unavailable");
check(Engine.run(bizReq,Engine.demo("crash"),{executionDelaySeconds:0}).riskBreaches>0,"risk monitor");console.log("Integration assertions:",count);

// Exercise active decision branches using test-only overrides, never production calibration.
const branchCfg={executionDelaySeconds:0,lambda:0,kappaSol:0,minImprovementSol:0,uncertaintySol:0};
const branchEvents=Engine.demo("range",branchCfg).map(e=>e.type==="MARKET"?{...e,flowSol:100}:e);
const branch=Engine.run(req,branchEvents,branchCfg);check(branch.state.receipts.some(x=>x.action==="OPEN"&&x.status==="CONFIRMED"),"adaptive open");check(branch.state.receipts.some(x=>x.action==="REPOSITION"&&x.status==="CONFIRMED"),"adaptive reposition");check(Math.abs(branch.report.residual)<1e-8,"adaptive accounting");
const stressReq={entry:"position",pool:"DEMO_POOL",sol:5,meme:0,positionBins:[{id:1,x:30000,y:0},{id:-1,x:0,y:1}],initialPrice:.0001};
const stress=Engine.run(stressReq,Engine.demo("crash"),cfg);check(stress.state.decisions[0].action.type==="HOLD","warmup should not liquidate");check(stress.state.decisions.some(d=>d.regime==="STRESS"&&d.action.type==="REMOVE_AND_HOLD"),"stress removal");check(Math.abs(stress.report.residual)<1e-8,"stress ledger");
const noReward=Engine.run(req,[ev[0],{id:"reward",t:1,type:"REWARD",x:100,y:.2},ev[2]],{},"hodl");check(noReward.report.reward===0,"HODL must not receive LP rewards");
const suite=Engine.scenarioSuite(bizReq,cfg);check(suite.rows.length===4&&suite.summaries.scenario.independentGroupCount===4,"scenario suite");check(suite.summaries.scenario.confidenceInterval===null,"no fabricated significance");
let splitRejected=false;try{Engine.evaluateSamples([{id:"a",group:"same",split:"train",request:req,events:ev},{id:"b",group:"same",split:"test",request:req,events:ev}],cfg)}catch{splitRejected=true}check(splitRejected,"frozen group leakage");console.log("Extended integration assertions:",count);

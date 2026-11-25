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

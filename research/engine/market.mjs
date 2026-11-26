// Extracted from the offline research engine; calculations unchanged.
import {EPS,sum} from './numeric.mjs';
import {markoutSummary} from './accounting.mjs';
function reference(e,c){
  if(!Array.isArray(e.references))return {valid:false,reason:"MISSING_REFERENCES"};
  const rs=e.references.filter(r=>r.pool!==e.pool&&typeof r.pool==="string"&&typeof r.price==="number"&&r.price>0&&Number.isFinite(r.price)&&typeof r.depth==="number"&&Number.isFinite(r.depth)&&r.depth>=c.minDepthSol&&Number.isFinite(r.availableAt)&&r.availableAt<=e.t&&r.availableAt>=e.t-c.maxReferenceAge&&Number.isFinite(r.observedAt??r.availableAt)&&(r.observedAt??r.availableAt)<=r.availableAt&&(r.observedAt??r.availableAt)>=e.t-c.maxReferenceAge);
  const uniq=[...new Map(rs.slice().sort((a,b)=>a.availableAt-b.availableAt).map(r=>[r.pool,r])).values()];
  if(uniq.length<2)return {valid:false,reason:"INSUFFICIENT_INDEPENDENT_POOLS"};
  const ps=uniq.map(r=>r.price),depth=sum(uniq.map(r=>r.depth));
  if(!Number.isFinite(depth)||depth<=0)return {valid:false,reason:'REFERENCE_NUMERIC_DOMAIN'};
  const p=sum(uniq.map(r=>r.price*(r.depth/depth)));
  if(!Number.isFinite(p)||p<=0)return {valid:false,reason:'REFERENCE_NUMERIC_DOMAIN'};
  if((Math.max(...ps)-Math.min(...ps))/p>c.maxReferenceDivergence)return {valid:false,reason:"REFERENCE_DIVERGENCE"};
  return {valid:true,price:p,depth,pools:uniq.map(r=>r.pool),expiresAt:Math.min(...uniq.map(r=>(r.observedAt??r.availableAt)+c.maxReferenceAge))};
}
function fresh(s,c,t=s.lastTime){return !!s.market?.ref.valid&&t>=s.market.t&&t<=s.market.ref.expiresAt&&t-s.market.t<=c.maxReferenceAge;}
function classify(s,c){
  const m=s.market;if(!m||!fresh(s,c))return {regime:"UNKNOWN",flags:["REFERENCE_UNAVAILABLE"],features:{}};
  const flags=[];
  if(m.tokenSafe!==true)flags.push("TOKEN_RISK");
  if(!Number.isFinite(m.holderShare))flags.push("HOLDER_UNKNOWN");else if(m.holderShare>c.maxHolderShare)flags.push("HOLDER_CONCENTRATION");
  if(!Number.isFinite(m.exitDepth)||m.exitDepth<c.minDepthSol)flags.push("EXIT_DEPTH_LOW");
  if(!Number.isFinite(m.flowSol)||m.flowSol<c.minFlowSol)flags.push("FLOW_LOW");
  if(!Number.isFinite(m.holderOutflow)||!Number.isFinite(m.buyImbalance))flags.push("FLOW_UNKNOWN");
  const ps=s.history.slice(-12).map(x=>x.ref.price);
  const returns=ps.slice(1).map((p,i)=>Math.log(p/ps[i])),trend=returns.length?sum(returns):0,volatility=Math.sqrt(sum(returns.map(r=>r*r))),path=sum(returns.map(Math.abs)),efficiency=path>EPS?Math.abs(trend)/path:0;
  const mature=markoutSummary(s);
  if(mature.bid.count>=3&&mature.bid.bps<-100)flags.push("TOXIC_BID");
  if(mature.ask.count>=3&&mature.ask.bps<-100)flags.push("TOXIC_ASK");
  let regime="HEALTHY_RANGE";
  if(flags.includes("TOKEN_RISK")||flags.includes("EXIT_DEPTH_LOW")||returns.some(r=>r<-.20))regime="STRESS";
  else if(flags.includes("HOLDER_UNKNOWN")||flags.includes("FLOW_UNKNOWN")||ps.length<3)regime="UNKNOWN";
  else if(m.holderOutflow>.1&&m.buyImbalance<0)regime="DISTRIBUTION_RANGE";
  else if(flags.includes("FLOW_LOW"))regime="DEAD_RANGE";
  else if(efficiency>.65&&trend>.025)regime="UPTREND";
  else if(efficiency>.65&&trend<-.025)regime="DOWNTREND";
  return {regime,flags,features:{trend,volatility,efficiency,buyImbalance:m.buyImbalance,holderOutflow:m.holderOutflow,markout:mature},calibration:"UNCALIBRATED_RULES"};
}
export {reference,fresh,classify};

// Extracted from the offline research engine; calculations unchanged.
import {EPS,sum} from './numeric.mjs';
import {markoutSummary} from './accounting.mjs';
function reference(e,c){
  if(!Array.isArray(e.references))return {valid:false,reason:"MISSING_REFERENCES"};
  const rs=e.references.filter(r=>r.pool!==e.pool&&typeof r.pool==="string"&&typeof r.price==="number"&&r.price>0&&Number.isFinite(r.price)&&typeof r.depth==="number"&&Number.isFinite(r.depth)&&r.depth>=c.minDepthSol&&Number.isFinite(r.availableAt)&&r.availableAt<=e.t&&r.availableAt>=e.t-c.maxReferenceAge&&Number.isFinite(r.observedAt??r.availableAt)&&(r.observedAt??r.availableAt)<=r.availableAt&&(r.observedAt??r.availableAt)>=e.t-c.maxReferenceAge);
  const uniq=[...new Map(rs.slice().sort((a,b)=>a.availableAt-b.availableAt).map(r=>[r.pool,r])).values()];
  if(!uniq.length){
    const r=e.targetReference;
    if(!r||r.pool!==e.pool||r.basis!=='TARGET_BIN_SNAPSHOT'||!Number.isFinite(r.price)||r.price<=0||!Number.isFinite(r.depth)||r.depth<c.minDepthSol||!Number.isFinite(r.observedAt)||!Number.isFinite(r.availableAt)||r.observedAt>r.availableAt||r.availableAt>e.t||r.observedAt<e.t-c.maxReferenceAge)return {valid:false,reason:"REFERENCE_UNAVAILABLE"};
    return {valid:true,price:r.price,depth:r.depth,pools:[e.pool],basis:'TARGET_POOL',confidence:'LOW',divergence:null,expiresAt:r.observedAt+c.maxReferenceAge};
  }
  const ps=uniq.map(r=>r.price),depth=sum(uniq.map(r=>r.depth));
  if(!Number.isFinite(depth)||depth<=0)return {valid:false,reason:'REFERENCE_NUMERIC_DOMAIN'};
  const p=sum(uniq.map(r=>r.price*(r.depth/depth)));
  if(!Number.isFinite(p)||p<=0)return {valid:false,reason:'REFERENCE_NUMERIC_DOMAIN'};
  if((Math.max(...ps)-Math.min(...ps))/p>c.maxReferenceDivergence)return {valid:false,reason:"REFERENCE_DIVERGENCE"};
  return {valid:true,price:p,depth,pools:uniq.map(r=>r.pool),basis:uniq.length>1?'MULTI_POOL':'SINGLE_POOL',confidence:uniq.length>1?'HIGHER':'MEDIUM',divergence:uniq.length>1?(Math.max(...ps)-Math.min(...ps))/p:null,expiresAt:Math.min(...uniq.map(r=>(r.observedAt??r.availableAt)+c.maxReferenceAge))};
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
  const ps=s.history.slice(-c.regimeLookback).map(x=>x.ref.price);
  const returns=ps.slice(1).map((p,i)=>Math.log(p/ps[i])),trend=returns.length?sum(returns):0,volatility=Math.sqrt(sum(returns.map(r=>r*r))),path=sum(returns.map(Math.abs)),efficiency=path>EPS?Math.abs(trend)/path:0;
  const mature=markoutSummary(s);
  if(mature.bid.count>=c.toxicMarkoutMinSamples&&mature.bid.bps<-c.toxicMarkoutBps)flags.push("TOXIC_BID");
  if(mature.ask.count>=c.toxicMarkoutMinSamples&&mature.ask.bps<-c.toxicMarkoutBps)flags.push("TOXIC_ASK");
  let regime="HEALTHY_RANGE";
  if(flags.includes("TOKEN_RISK")||flags.includes("EXIT_DEPTH_LOW")||returns.some(r=>r < -c.stressLogReturnThreshold))regime="STRESS";
  else if(flags.includes("HOLDER_UNKNOWN")||flags.includes("FLOW_UNKNOWN")||ps.length<c.regimeMinObservations)regime="UNKNOWN";
  else if(m.holderOutflow>c.holderOutflowThreshold&&m.buyImbalance<0)regime="DISTRIBUTION_RANGE";
  else if(flags.includes("FLOW_LOW"))regime="DEAD_RANGE";
  else if(efficiency>c.trendEfficiencyThreshold&&trend>c.trendLogReturnThreshold)regime="UPTREND";
  else if(efficiency>c.trendEfficiencyThreshold&&trend < -c.trendLogReturnThreshold)regime="DOWNTREND";
  return {regime,flags,features:{trend,volatility,efficiency,buyImbalance:m.buyImbalance,holderOutflow:m.holderOutflow,markout:mature},calibration:"UNCALIBRATED_RULES"};
}
// Lower-confidence sources need a wider economic improvement margin, not a hard gate.
function referenceUncertainty(s,c){
  const confidence=s.market?.ref?.confidence;
  return c.uncertaintySol*(confidence==='LOW'?2:confidence==='MEDIUM'?1.5:1);
}
// Shared admission rule for all research and paper decision adapters.
function marketAdmission(g){
  return ['HEALTHY_RANGE','UPTREND','DOWNTREND'].includes(g.regime)&&!g.flags.includes('HOLDER_CONCENTRATION');
}
export {reference,fresh,classify,marketAdmission,referenceUncertainty};

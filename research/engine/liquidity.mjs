// Extracted from the offline research engine; calculations unchanged.
import {EPS,sum,assert,finite,price,binId} from './numeric.mjs';
import {fresh} from './market.mjs';
import {bidCap} from './risk.mjs';
function pay(s,cost){finite(cost,"cost");assert(s.wallet.y+EPS>=cost,"insufficient SOL for cost");s.wallet.y=Math.max(0,s.wallet.y-cost);s.cost+=cost}
function release(s,fraction=1){finite(fraction,"fraction",0,1);for(const b of s.bins){s.wallet.x+=b.x*fraction;s.wallet.y+=b.y*fraction;b.x*=1-fraction;b.y*=1-fraction;b.liquidity*=1-fraction}s.bins=s.bins.filter(b=>b.liquidity>EPS);s.status=s.bins.length?"OPEN":"FLAT";}
function claim(s){s.wallet.x+=s.pendingFees.x;s.wallet.y+=s.pendingFees.y;s.claimed.x+=s.pendingFees.x;s.claimed.y+=s.pendingFees.y;s.pendingFees={x:0,y:0}}
function spot(s,c,p,q,m,t){
  // Synthetic executable-depth proxy. Costs embedded in execution price, not debited twice.
  if(!m?.ref.valid||!Number.isFinite(m.exitDepth)||m.exitDepth<=0)return 0;
  let amount=Math.min(Math.abs(q),m.exitDepth/p);
  const sign=Math.sign(q),e=p*(1+sign*c.slippageBps/10000);
  amount=Math.min(amount,sign>0?s.wallet.y/e:s.wallet.x);
  if(amount<EPS)return 0;
  const d=sign*amount;s.wallet.x+=d;s.wallet.y-=d*e;s.turnover+=amount*e;
  s.fills.push({id:"spot:"+s.fills.length,t,kind:"SPOT",q:d,price:e,reference:p,feeX:0,feeY:0});return d;
}
function weights(n,shape,alpha,skew=0){
  assert(["spot","curve","bid_ask","hybrid"].includes(shape),"unknown shape");finite(alpha,"hybrid alpha",0,1);assert(Number.isFinite(skew),"invalid skew");
  const edge=Array.from({length:n},(_,i)=>.1+((i+1)/n)**2),edgeSum=sum(edge),curve=Array.from({length:n},(_,i)=>Math.exp(-3*((i+1)/n)**2));
  const raw=edge.map((v,i)=>(shape==="spot"?1/n:shape==="curve"?curve[i]:shape==="bid_ask"?v/edgeSum:alpha/n+(1-alpha)*v/edgeSum)*Math.exp(skew*(i+1)/n));
  const total=sum(raw);return raw.map(x=>x/total);
}
function planBins(c,p,bid,ask,spec){
  const mid=binId(c,p),n=spec.width;
  const wb=weights(n,spec.shape,spec.alphaBid??.5,spec.skewBid??0),wa=weights(n,spec.shape,spec.alphaAsk??.5,spec.skewAsk??0);
  const active=spec.active??0;
  const map=new Map();
  function add(id,x,y){const b=map.get(id)||{id,x:0,y:0,liquidity:0};b.x+=x;b.y+=y;b.liquidity=b.x*price(c,id)+b.y;map.set(id,b)}
  const ax=wa.map((w,i)=>w/price(c,mid+1+i)),axs=sum(ax);
  for(let i=0;i<n;i++){add(mid-1-i,0,bid*(1-active)*wb[i]);add(mid+1+i,ask*(1-active)*ax[i]/axs,0)}
  add(mid,ask*active,bid*active);return [...map.values()].filter(b=>b.liquidity>EPS).sort((a,b)=>a.id-b.id);
}
function deploy(s,c,p,spec){
  const cap=bidCap(s,c,p,planBins(c,p,1,0,spec)),bid=Math.min(spec.bidFraction*cap,Math.max(0,s.wallet.y-c.minSolReserve)),ask=s.wallet.x*spec.askFraction;
  const bins=planBins(c,p,bid,ask,spec);s.wallet.y-=sum(bins.map(b=>b.y));s.wallet.x-=sum(bins.map(b=>b.x));
  for(const b of bins){const old=s.bins.find(a=>a.id===b.id);if(old){old.x+=b.x;old.y+=b.y;old.liquidity+=b.liquidity}else s.bins.push(b)}
  s.status=s.bins.length?"OPEN":"FLAT";return {bid,ask};
}
function applyAction(s,c,action,t,opts={}){
  const p=fresh(s,c,t)?s.market.ref.price:null;
  const k=action.type;
  if(k==='REPOSITION'){assert(s.bins.length>0,'REPOSITION_REQUIRES_POSITION');assert(t-s.lastActionTime>=c.cooldownSeconds,'REPOSITION_COOLDOWN');assert(s.rebalances<c.maxRebalances&&s.rebalanceTurnover+s.turnover<c.maxTurnoverSol,'REBALANCE_BUDGET');}
  assert(!['DISPOSE','REMOVE_AND_DISPOSE'].includes(k)||s.allowDispose===true,'DISPOSAL_NOT_ALLOWED');
  if(["HOLD","NO_LP"].includes(k))return {status:"NO_ACTION"};
  if(k==="FUND"||k==="WITHDRAW"){assert(p!==null,"reference required for external flows");const x=finite(action.x??0,"flow x"),y=finite(action.y??0,"flow y"),sign=k==="FUND"?1:-1;if(sign<0)assert(x<=Math.min(s.wallet.x,s.baseline.x)+EPS&&y<=Math.min(s.wallet.y,s.baseline.y)+EPS,"withdraw exceeds wallet or matched HODL inventory");s.wallet.x+=sign*x;s.wallet.y+=sign*y;s.baseline.x+=sign*x;s.baseline.y+=sign*y;s.externalFlows+=sign*(x*p+y);return {status:"CONFIRMED"}}
  assert(p!==null||["CLAIM","REMOVE","REMOVE_AND_HOLD","REDUCE"].includes(k),"reference required for "+k);
  pay(s,c.operationCostSol);
  if(opts.fail)return {status:"FAILED",reason:"SYNTHETIC_FAILURE"};
  if(k==="CLAIM"){claim(s);return {status:"CONFIRMED"}}
  if(k==="DISPOSE"){const wanted=Math.min(finite(action.quantity??s.wallet.x,"dispose quantity"),s.wallet.x),sold=-spot(s,c,p,-wanted,s.market,t);return {status:sold+EPS<wanted?"PARTIAL":"CONFIRMED",sold,remainingInventory:s.wallet.x}}
  if(k==="REDUCE"||k==="REMOVE"||k==="REMOVE_AND_HOLD"||k==="REMOVE_AND_DISPOSE"){
    const fraction=k==="REDUCE"?finite(action.fraction??.5,"reduce fraction",0,1):1;
    release(s,fraction*(opts.partial?.5:1));if(k.startsWith("REMOVE"))claim(s);
    let remaining=s.wallet.x,sold=0;
    if(k==="REMOVE_AND_DISPOSE"&&!opts.partial){const wanted=s.wallet.x;sold=-spot(s,c,p,-wanted,s.market,t);remaining=s.wallet.x}
    return {status:opts.partial||(k==="REMOVE_AND_DISPOSE"&&remaining>EPS)?"PARTIAL":"CONFIRMED",remainingInventory:remaining,sold,phases:k==="REMOVE_AND_DISPOSE"?["REMOVE",opts.partial?"DISPOSE_NOT_ATTEMPTED":"DISPOSE"]:["REMOVE"]};
  }
  assert(["OPEN","ADD","REPOSITION"].includes(k),"unsupported action "+k);
  if(k==="OPEN")assert(s.bins.length===0,"OPEN requires flat position");
  if(k==="REPOSITION"){s.rebalanceTurnover+=sum(s.bins.map(b=>b.x*p+b.y));release(s);claim(s);s.rebalances++;if(opts.partial)return {status:"PARTIAL",reason:"REMOVED_NOT_REDEPLOYED"}}
  if(action.acquireSol){const budget=Math.min(finite(action.acquireSol,"acquireSol"),Math.max(0,s.wallet.y-c.minSolReserve));spot(s,c,p,budget/(p*(1+c.slippageBps/10000)),s.market,t)}
  const spec=action.spec?{...action.spec}:null;assert(spec&&Number.isInteger(spec.width)&&spec.width>0&&spec.width<=50,"invalid plan");
  for(const key of ["bidFraction","askFraction"])finite(spec[key],key,0,1);
  for(const key of ["active","alphaBid","alphaAsk"])if(spec[key]!=null)finite(spec[key],key,0,1);
  if(opts.partial){spec.bidFraction*=.5;spec.askFraction*=.5;}const d=deploy(s,c,p,spec);if(k==="REPOSITION")s.rebalanceTurnover+=d.bid+d.ask*p;return {status:opts.partial?"PARTIAL":"CONFIRMED",...d};
}
export {pay,release,claim,spot,weights,planBins,deploy,applyAction};

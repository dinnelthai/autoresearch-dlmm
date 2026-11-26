// Extracted from the offline research engine; calculations unchanged.
import {EPS,clone,sum,assert,finite,price} from './numeric.mjs';
function balances(s){return {x:s.wallet.x+s.pendingFees.x+sum(s.bins.map(b=>b.x)),y:s.wallet.y+s.pendingFees.y+sum(s.bins.map(b=>b.y))}}
function nav(s,p){const b=balances(s);return b.x*p+b.y}
function hodl(s,p){return s.baseline.x*p+s.baseline.y}
function reportAt(s,p){
  const b=balances(s),v=nav(s,p),grossFee=s.feesEarned.x*p+s.feesEarned.y,reward=s.rewardsEarned.x*p+s.rewardsEarned.y,inventory=sum(s.fills.map(f=>f.q*(p-f.price))),fair=sum(s.fills.filter(f=>f.reference!==null).map(f=>f.q*(p-f.reference))),adverse=sum(s.fills.filter(f=>f.reference!==null).map(f=>f.q*(f.price-f.reference))),unattributed=sum(s.fills.filter(f=>f.reference===null).map(f=>f.q*(p-f.price))),alpha=v-hodl(s,p);
  const pnl=v-s.initialNav-s.externalFlows;
  return {nav:v,pnl,alpha,hodl:hodl(s,p),solBenchmark:s.initialNav+s.externalFlows,alphaSol:pnl,fee:grossFee,reward,feeX:s.feesEarned.x,feeY:s.feesEarned.y,inventory,fair,adverse,unattributed,cost:s.cost,externalFlows:s.externalFlows,reference:p,inventoryX:b.x,inventoryY:b.y,ratio:v>EPS?b.x*p/v:0,residual:alpha-(inventory+grossFee+reward-s.cost),unclaimed:clone(s.pendingFees),claimed:clone(s.claimed),markout:markoutSummary(s),turnover:s.turnover,rebalanceTurnover:s.rebalanceTurnover,rebalances:s.rebalances};
}
function newState(request,c){
  assert(["holding","sol","position"].includes(request.entry),"invalid entry");
  const x=finite(request.meme,"meme"),y=finite(request.sol,"sol"),p=finite(request.initialPrice,"initialPrice",Number.MIN_VALUE);
  assert(request.entry!=="sol"||x===0,"SOL entry must have no MEME");
  assert(request.entry!=="position"||Array.isArray(request.positionBins)&&request.positionBins.length>0,"position entry requires normalized position bins");
  const bins=(request.positionBins||[]).map(b=>({id:b.id,x:finite(b.x,"bin x"),y:finite(b.y,"bin y"),liquidity:finite(b.x,"bin x")*price(c,b.id)+finite(b.y,"bin y")}));
  assert(request.entry==="position"||bins.length===0,"unexpected position bins");
  assert(new Set(bins.map(b=>b.id)).size===bins.length,"duplicate initial bin");
  const pendingFees={x:finite(request.pendingFeeX??0,"pendingFeeX"),y:finite(request.pendingFeeY??0,"pendingFeeY")};
  assert(request.entry==="position"||pendingFees.x+pendingFees.y===0,"pending fees require position");
  const s={wallet:{x,y},bins,pendingFees,feesEarned:{x:0,y:0},rewardsEarned:{x:0,y:0},poolBins:{},claimed:{x:0,y:0},fills:[],marks:[],market:null,history:[],baseline:{x:0,y:0},initialNav:0,externalFlows:0,cost:0,turnover:0,rebalances:0,receipts:[],pending:null,lastActionTime:-1e12,curve:[],seen:[],lastTime:-1,quality:[],status:bins.length?"OPEN":"FLAT",decisions:[],allowDispose:request.allowDispose===true,pool:request.pool??null,goal:request.goal??"balanced",riskLog:[],rebalanceTurnover:0};
  s.baseline=balances(s);s.initialNav=nav(s,p);assert(s.initialNav>0,"initial capital must be positive");return s;
}
function markoutSummary(s){
  const out={};
  for(const side of ["bid","ask"]){const rows=s.marks.filter(m=>m.side===side),n=sum(rows.map(m=>m.notional));out[side]={count:rows.length,bps:n>EPS?10000*sum(rows.map(m=>m.net))/n:null,net:sum(rows.map(m=>m.net))}}
  out.eligible=s.fills.filter(f=>f.kind==="LP").length;out.coverage=out.eligible?(out.bid.count+out.ask.count)/out.eligible:null;return out;
}
function mature(s,c,m){
  if(!m.ref.valid)return;
  for(const f of s.fills){if(f.kind!=="LP"||f.marked||f.reference===null||m.t<f.t+c.markoutSeconds)continue;
    // First available valid observation after target horizon; bound staleness, never interpolate.
    f.marked=true;if(m.t-f.t-c.markoutSeconds>c.maxReferenceAge)continue;
    s.marks.push({t:m.t,fillId:f.id,side:f.q>0?"bid":"ask",notional:Math.abs(f.q)*f.price,net:f.q*(m.ref.price-f.price)+f.feeX*m.ref.price+f.feeY});
  }
}
export {balances,nav,hodl,reportAt,newState,markoutSummary,mature};

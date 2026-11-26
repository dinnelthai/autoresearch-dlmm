// Extracted from the offline research engine; calculations unchanged.
import {EPS,clone,assert,finite,price} from './numeric.mjs';
import {nav,balances,mature} from './accounting.mjs';
import {reference,fresh,classify} from './market.mjs';
import {risk} from './risk.mjs';
import {applyAction} from './liquidity.mjs';
function swap(s,c,e){
  const p=price(c,e.bin),q=finite(e.baseQty,"swap baseQty"),ext=finite(e.externalLiquiditySol??s.poolBins[e.bin],"external liquidity",EPS),fx=finite(e.mmFeeX,"MM fee X"),fy=finite(e.mmFeeY,"MM fee Y");assert(["LP_BUY","LP_SELL"].includes(e.side),"invalid swap direction");
  const b=s.bins.find(b=>b.id===e.bin);if(!b||b.liquidity<EPS||q===0)return {status:'NO_ACTIVE_EXPOSURE',requestedBaseQty:0,filledBaseQty:0};
  const share=b.liquidity/(ext+b.liquidity);
  if(share>c.maxBinShare+EPS){s.quality.push({id:e.id,reason:"FROZEN_PATH_SHARE_LIMIT",share});return {status:'SHARE_LIMIT',requestedBaseQty:0,filledBaseQty:0,share};}
  const requested=q*share,amount=Math.min(requested,e.side==="LP_BUY"?b.y/p:b.x);
  if(amount<EPS)return {status:'INVENTORY_UNAVAILABLE',requestedBaseQty:requested,filledBaseQty:0,share};
  const d=e.side==="LP_BUY"?amount:-amount,ratio=amount/q,feeX=fx*ratio,feeY=fy*ratio;
  b.x=Math.max(0,b.x+d);b.y=Math.max(0,b.y-d*p);s.pendingFees.x+=feeX;s.pendingFees.y+=feeY;s.feesEarned.x+=feeX;s.feesEarned.y+=feeY;
  const ref=fresh(s,c,e.t)?s.market.ref.price:null;
  s.fills.push({id:e.id,t:e.t,kind:"LP",bin:e.bin,q:d,price:p,reference:ref,feeX,feeY,share,requestedBaseQty:requested,filledBaseQty:amount,inventoryLimited:amount+EPS<requested});
  return {status:amount+EPS<requested?'INVENTORY_LIMITED':'FILLED_PROXY',requestedBaseQty:requested,filledBaseQty:amount,share};
}
function record(s,p,t){
  const v=nav(s,p),adjusted=v-s.externalFlows,peak=Math.max(s.initialNav,...s.curve.map(x=>x.adjusted),adjusted);
  s.curve.push({t,nav:v,adjusted,drawdown:peak>EPS?(peak-adjusted)/peak:0,...balances(s)});
}
function event(s,c,e){
  let fillResult;
  assert(typeof e.id==="string"&&e.id.length,"event id required");finite(e.t,"event time");assert(e.t>=s.lastTime,"out of order event");assert(!s.seen.includes(e.id),"duplicate event");s.seen.push(e.id);s.lastTime=e.t;
  if(e.type==="MARKET"){assert(typeof e.pool==="string"&&e.pool.length>0,"market pool required");assert(!s.pool||s.pool===e.pool,"market pool mismatch");if(!s.pool)s.pool=e.pool;const ref=reference(e,c);s.market={...e,ref};if(ref.valid){s.history.push(s.market);mature(s,c,s.market)}else s.quality.push({id:e.id,reason:ref.reason})}
  else if(e.type==="SWAP"){assert(!e.pool||e.pool===s.pool,"swap pool mismatch");fillResult=swap(s,c,e);}
  else if(e.type==="POOL_STATE"){assert(Array.isArray(e.bins),"pool snapshot bins required");s.poolBins={};for(const b of e.bins){assert(Number.isInteger(b.id)&&!(b.id in s.poolBins),"invalid snapshot bin");s.poolBins[b.id]=finite(b.externalLiquiditySol,"external liquidity",EPS);}}
  else if(e.type==="LIQUIDITY_UPDATE"){assert(Number.isInteger(e.bin),"invalid update bin");s.poolBins[e.bin]=finite(e.externalLiquiditySol,"external liquidity",EPS);}
  else if(e.type==="REWARD"){const x=finite(e.x??0,"reward x"),y=finite(e.y??0,"reward y");if(s.bins.length){s.pendingFees.x+=x;s.pendingFees.y+=y;s.rewardsEarned.x+=x;s.rewardsEarned.y+=y;}}
  else assert(false,"unknown event type");
  if(fresh(s,c,e.t)){record(s,s.market.ref.price,e.t);const r=risk(s,c,s.market.ref.price);if(r.violations.length)s.riskLog.push({t:e.t,event:e.id,...r});}
  return fillResult;
}
function executePending(s,c,t){
  if(!s.pending)return;
  if(s.pending.expires!==null&&t>s.pending.expires){const op=s.pending;s.pending=null;s.receipts.push({id:op.id,t,action:op.action.type,status:"EXPIRED"});return;}
  if(t<s.pending.due)return;
  const op=s.pending,trial=clone(s);trial.pending=null;
  try{
    const result=applyAction(trial,c,op.action,t,op.options);
    const modeledCostSol=trial.cost-s.cost,modeledTurnoverSol=trial.turnover+trial.rebalanceTurnover-s.turnover-s.rebalanceTurnover;
    assert([modeledCostSol,modeledTurnoverSol].every(v=>Number.isFinite(v)&&v>=-EPS),'OPERATION_ACCOUNTING_INVALID');
    if(["OPEN","ADD","REPOSITION"].includes(op.action.type)&&result.status!=="FAILED"&&result.reason!=="REMOVED_NOT_REDEPLOYED"){
      assert(trial.market?.ref.valid,"invalid execution reference");
      const r=risk(trial,c,trial.market.ref.price),g=classify(trial,c);
      assert(fresh(trial,c,t),"stale execution reference");
      assert(trial.rebalances<=c.maxRebalances&&trial.rebalanceTurnover+trial.turnover<=c.maxTurnoverSol,"turnover budget exceeded");
      assert(!g.flags.includes("TOXIC_BID")||!trial.bins.some(b=>b.y>EPS),"toxic bid blocked");
      assert(!g.flags.includes("TOXIC_ASK")||!trial.bins.some(b=>b.x>EPS),"toxic ask blocked");
      assert(!r.violations.length,"execution risk: "+r.violations.join(","));
      assert(!["UNKNOWN","STRESS","DISTRIBUTION_RANGE","DEAD_RANGE"].includes(g.regime)&&!g.flags.includes("HOLDER_CONCENTRATION"),"market admission changed");
    }
    Object.assign(s,trial);s.lastActionTime=t;s.receipts.push({id:op.id,t,action:op.action.type,...result,modeledCostSol,modeledTurnoverSol,costBasis:'DECLARED_LOGICAL_OPERATION_AGGREGATE'});
    if(fresh(s,c,t))record(s,s.market.ref.price,t);
  }catch(err){s.pending=null;s.receipts.push({id:op.id,t,action:op.action.type,status:"REJECTED",reason:String(err.message)});}
}
function submit(s,c,action,t,options={}){
  assert(!s.pending,"operation already pending");const id="operation:"+s.receipts.length;
  const expires=options.expiresAfterSeconds==null?null:t+finite(options.expiresAfterSeconds,"expiry");s.pending={id,action:clone(action),due:t+c.executionDelaySeconds,expires,options:clone(options)};s.receipts.push({id,t,action:action.type,status:"SUBMITTED"});
  if(c.executionDelaySeconds===0)executePending(s,c,t);
}
export {swap,record,event,executePending,submit};

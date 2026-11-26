// Extracted from the offline research engine; calculations unchanged.
import {EPS,sum,price} from './numeric.mjs';
import {balances,nav} from './accounting.mjs';
import {fresh} from './market.mjs';
// Sell depth is a declared reference-mark notional proxy, not received SOL or a bid curve.
function exitExposure(s,c,p){
  const b=balances(s),depth=s.market?.exitDepth,prospectiveX=b.x+sum(s.bins.map(i=>i.y/price(c,i.id)));
  const valid=Number.isFinite(p)&&p>0&&Number.isFinite(depth)&&depth>=0&&[b.x,b.y,prospectiveX].every(v=>Number.isFinite(v)&&v>=0)&&Number.isFinite(b.x*p)&&Number.isFinite(prospectiveX*p);
  if(!valid)return {status:'UNAVAILABLE',basis:'DECLARED_SELL_DEPTH_MARK_NOTIONAL_PROXY',capacitySol:null,currentHeadroomSol:null,prospectiveHeadroomSol:null};
  const currentNotional=b.x*p,prospectiveNotional=prospectiveX*p;
  return {status:'PROXY_ONLY',basis:'DECLARED_SELL_DEPTH_MARK_NOTIONAL_PROXY',capacitySol:depth,currentInventoryMeme:b.x,prospectiveInventoryMeme:prospectiveX,currentNotionalSol:currentNotional,prospectiveNotionalSol:prospectiveNotional,currentHeadroomSol:depth-currentNotional,prospectiveHeadroomSol:depth-prospectiveNotional,currentUncoveredMeme:Math.max(0,b.x-depth/p),prospectiveUncoveredMeme:Math.max(0,prospectiveX-depth/p),calibrated:false,executionReady:false};
}
function risk(s,c,p){
  const b=balances(s),v=nav(s,p),bid=sum(s.bins.map(i=>i.y)),postX=b.x+sum(s.bins.map(i=>i.y/price(c,i.id))),postY=b.y-bid,stressP=p*(1-c.stressDrop);
  const stressedValue=b.x*stressP+b.y-sum(s.bins.map(i=>i.y*Math.max(0,1-stressP/price(c,i.id))));
  const loss=Math.max(0,v-stressedValue,s.initialNav+s.externalFlows-stressedValue);
  const worstRatio=postX*p+postY>EPS?postX*p/(postX*p+postY):0;
  const exit=exitExposure(s,c,p),violations=[];
  if(s.market?.ref.valid&&(exit.status!=='PROXY_ONLY'||exit.prospectiveHeadroomSol < -EPS))violations.push("EXIT_CAPACITY");
  if(s.wallet.y<c.minSolReserve-EPS)violations.push("SOL_RESERVE");
  if(postX>c.maxInventoryTokens+EPS)violations.push("INVENTORY_QUANTITY");
  if(worstRatio>c.maxInventoryRatio+EPS)violations.push("INVENTORY_RATIO");
  if(loss>c.maxLossSol+EPS)violations.push("STRESS_LOSS");
  return {bid,postX,postY,worstRatio,stressLoss:loss,stressedValue,exitExposure:exit,violations};
}
function bidCap(s,c,p){
  const b=balances(s),v=nav(s,p),z=v>EPS?b.x*p/v:1,existing=sum(s.bins.map(b=>b.y));
  return Math.max(0,Math.min(s.wallet.y-c.minSolReserve,(c.maxInventoryRatio-z)*v-existing));
}
function liquidation(s,c){
  if(!fresh(s,c))return {status:'UNAVAILABLE',value:null,netLiquidationValue:null};
  const p=s.market.ref.price,b=balances(s),exit=exitExposure(s,c,p);
  if(exit.status!=='PROXY_ONLY')return {status:'UNAVAILABLE',value:null,netLiquidationValue:null};
  const sell=Math.min(b.x,exit.capacitySol/p),remaining=Math.max(0,b.x-sell),saleProceeds=sell*p*(1-c.slippageBps/10000),gross=b.y+saleProceeds,mark=nav(s,p);
  const requiresWithdrawal=s.bins.length>0,requiresClaim=s.pendingFees.x>EPS||s.pendingFees.y>EPS,withdrawalOrClaimCostProxy=requiresWithdrawal||requiresClaim?c.operationCostSol:0;
  return {status:remaining>EPS?'PARTIAL':'ESTIMATE',basis:'HYPOTHETICAL_WITHDRAW_AND_SELL_PROXY_BEFORE_EXIT_COSTS',value:remaining>EPS?null:gross,solProceeds:gross,markNavSol:mark,walletSol:s.wallet.y,walletMeme:s.wallet.x,positionSol:sum(s.bins.map(i=>i.y)),positionMeme:sum(s.bins.map(i=>i.x)),pendingFeesSol:s.pendingFees.y,pendingFeesMeme:s.pendingFees.x,heldSolAfterWithdrawalBeforeCost:b.y,heldMemeAfterWithdrawal:b.x,modeledSellMeme:sell,modeledSaleProceedsSol:saleProceeds,modeledSlippageCostSol:sell*p-saleProceeds,grossSolAfterHypotheticalSale:gross,unsoldMeme:remaining,unsoldMarkValueSol:remaining*p,withdrawalOrClaimCostProxy,upfrontWithdrawalCostCoveredByWallet:s.wallet.y+EPS>=withdrawalOrClaimCostProxy,walletReserveHeadroomSol:s.wallet.y-withdrawalOrClaimCostProxy-c.minSolReserve,netLiquidationValue:null,disposalAllowed:s.allowDispose===true,executionReady:false,calibrated:false};
}
export {exitExposure,risk,bidCap,liquidation};

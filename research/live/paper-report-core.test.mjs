import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperReport} from './paper-report-core.mjs';
const Q=1n<<64n,modes=['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid','adaptive'];
const mk=(n,{regime='HEALTHY_RANGE',expires=100,gapCount=0,price=1n,feeX=0n,claimedX=0n,cost=0n,block=false,log=true}={})=>{
 const time=n*1000,hold=100n+10n*price;
 const rows=modes.map(mode=>{
  const lp=mode!=='NO_LP',x=10n+(lp?claimedX:0n),y=100n-(lp?cost:0n),f=lp?feeX:0n,nav=y+(x+f)*price;
  const status=block&&mode==='spot'?'BLOCKED':lp?'OPEN_PROXY':'HOLD_ONLY';
  return {mode,status,claimedFeeXRaw:String(lp?claimedX:0n),claimedFeeYRaw:'0',point:status==='BLOCKED'?null:{slot:n,receivedAt:time,priceQ64Raw:String(price*Q),walletXRaw:String(x),walletYRaw:String(y),principalXRaw:'0',principalYRaw:'0',feeXRaw:String(f),feeYRaw:'0',costYRaw:String(lp?cost:0n),navYRaw:String(nav),pnlYRaw:String(nav-110n),excessVsHoldYRaw:String(nav-hold),drawdownBps:0}};
 });
 return {id:'r',pool:'p',sequence:n,slot:n,proof:{receivedAt:new Date(time).toISOString()},feeBasis:'MIDPOINT_SUPPLY_INTERVAL_FEE_PROXY_V2',backendHash:'h',gapCount,rows,...(log?{observationLog:{market:{regime,asOf:n,observationTime:n,referenceExpiresAt:expires,inputBasis:'COLLECTED_MARKET_FEATURE_PROXY_V1'},decision:{reason:'HOLD'},operations:[]}}:{})};
};
function report(records,options){const last=records.at(-1),s={id:'r',pool:'p',backendHash:'h',feeBasis:last.feeBasis,gapCount:last.gapCount,snapshotCount:records.length,last:{slot:last.slot},policy:{maxGapSeconds:60},rows:last.rows.map(r=>({...r,initialNavYRaw:'110',points:records.map(x=>x.rows.find(y=>y.mode===r.mode).point).filter(Boolean)}))},a=createPaperReport(s,options);records.forEach(a.add);return a.finish()}
test('causal regime allocation, fee claim is not new income, attribution conserves NAV',()=>{
 const r=report([mk(1,{cost:1n}),mk(2,{regime:'UPTREND',feeX:2n,cost:1n}),mk(3,{price:2n,claimedX:2n,cost:2n})]);
 const spot=r.strategies.find(x=>x.mode==='spot'),a=spot.intervalAttribution;
 assert.equal(r.opening.spot.netYRaw,'-1');assert.equal(a.feeAccrualYRaw,'2');assert.equal(a.priorHoldingsRepriceYRaw,'12');assert.equal(a.operationCostYRaw,'1');assert.equal(a.netYRaw,'13');assert.equal(a.alphaYRaw,'3');
 assert.equal(BigInt(a.netYRaw),BigInt(a.feeAccrualYRaw)+BigInt(a.priorHoldingsRepriceYRaw)-BigInt(a.operationCostYRaw)+BigInt(a.inventoryConversionResidualYRaw));
 assert.equal(r.environments.find(x=>x.regime==='HEALTHY_RANGE').strategies.find(x=>x.mode==='spot').alphaYRaw,'2');
 assert.equal(r.environments.find(x=>x.regime==='UPTREND').strategies.find(x=>x.mode==='spot').alphaYRaw,'1');
 assert.equal(r.environments.find(x=>x.regime==='STRESS').intervals,0);
});
test('stale regime, absent log, gaps and blocked paths are not fabricated',()=>{
 const r=report([mk(1,{expires:1}),mk(2,{log:false}),mk(3,{gapCount:1}),mk(4,{gapCount:1,block:true})],{maxChartPoints:2});
 assert.equal(r.gapIntervals,1);assert.equal(r.gapMs,1000);assert.equal(r.missingObservationLogs,1);assert.equal(r.environments.find(x=>x.regime==='UNKNOWN').intervals,1);assert.equal(r.strategies.find(x=>x.mode==='spot').intervalAttribution.missingIntervals,2);assert.equal(r.strategies.find(x=>x.mode==='spot').latest,null);assert.equal(r.chart.points.length,2);assert.equal(r.chart.points.at(-1).sequence,4);
});

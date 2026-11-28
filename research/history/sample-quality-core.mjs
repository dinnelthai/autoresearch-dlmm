export function auditReport(report){
 const bad=message=>{throw Error(message)};
 const uint=v=>typeof v==='string'&&/^\d+$/.test(v);
 const address=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
 if(!address(report?.pool)||!Array.isArray(report.events)||!Array.isArray(report.transactions)||!Array.isArray(report.gaps)||report.position!=null)bad('INVALID_POOL_REPORT');
 const txs=new Map(),ids=new Set(),coverage={},gaps={},versions={},counts={transactions:0,successful:0,failed:0,swaps:0,multiBin:0,invalid:0};
 const fields={amountInRaw:uint,amountOutRaw:uint,feeBpsFieldRaw:uint,protocolFeeRaw:uint,hostFeeRaw:uint,mmFeeRaw:uint,legacyFeeRaw:uint,feeToken:v=>['X','Y'].includes(v),startBinId:Number.isSafeInteger,endBinId:Number.isSafeInteger,blockTime:v=>Number.isSafeInteger(v)&&v>=0,outerIndex:v=>Number.isSafeInteger(v)&&v>=0,innerIndex:v=>Number.isSafeInteger(v)&&v>=0};
 for(const key of Object.keys(fields))coverage[key]=0;
 for(const t of report.transactions){
  if(typeof t.signature!=='string'||!t.signature||txs.has(t.signature)||!Number.isSafeInteger(t.slot)||t.slot<0||!Number.isSafeInteger(t.txIndex)||t.txIndex<0||typeof t.success!=='boolean')bad('INVALID_TRANSACTION_IDENTITY');
  txs.set(t.signature,t);counts.transactions++;counts[t.success?'successful':'failed']++;
 }
 let minTime=null,maxTime=null;const perTx=new Map();
 for(const e of report.events){
  const t=txs.get(e.signature);
  if(!t?.success||e.pool!==report.pool||e.slot!==t.slot||e.txIndex!==t.txIndex||e.blockTime!==t.blockTime||typeof e.id!=='string'||!e.id||ids.has(e.id)||!['Swap','Swap2Evt'].includes(e.event))bad('INVALID_EVENT_IDENTITY');
  ids.add(e.id);counts.swaps++;perTx.set(e.signature,(perTx.get(e.signature)??0)+1);versions[e.event]=(versions[e.event]??0)+1;
  for(const [k,valid] of Object.entries(fields))if(valid(e[k]))coverage[k]++;
  if(Number.isSafeInteger(e.startBinId)&&Number.isSafeInteger(e.endBinId)&&e.startBinId!==e.endBinId)counts.multiBin++;
  if(!uint(e.amountInRaw)||!uint(e.amountOutRaw)||!Number.isSafeInteger(e.startBinId)||!Number.isSafeInteger(e.endBinId)||!['X_TO_Y','Y_TO_X'].includes(e.direction))counts.invalid++;
  if(fields.blockTime(e.blockTime)){minTime=minTime===null?e.blockTime:Math.min(minTime,e.blockTime);maxTime=maxTime===null?e.blockTime:Math.max(maxTime,e.blockTime);}
 }
 for(const t of txs.values())if(t.success&&t.eventCount!==(perTx.get(t.signature)??0))bad('EVENT_COUNT_MISMATCH');
 for(const g of report.gaps){const k=typeof g?.reason==='string'&&/^[A-Z0-9_]+$/.test(g.reason)?g.reason:'UNCLASSIFIED';gaps[k]=(gaps[k]??0)+1;}
 const status=counts.swaps>0&&!counts.invalid&&!report.gaps.length&&report.status==='EVENTS_DECODED_UNVERIFIED'?'BOUNDED_EVENTS_USABLE_FOR_SCHEMA_RESEARCH':'PARTIAL_OR_EMPTY';
 return {pool:report.pool,status,counts,versions,coverage:Object.fromEntries(Object.entries(coverage).map(([k,n])=>[k,{present:n,total:counts.swaps,fraction:counts.swaps?n/counts.swaps:null}])),gaps,minTime,maxTime,observedSpanSeconds:minTime===null?null:maxTime-minTime,historyComplete:false,perBinReplayReady:false,feeGrowthReconstructionReady:false,profitabilityEvidence:false,missingForReplay:['historical_bin_checkpoint','complete_ordered_state_changes','per_bin_fills','liquidity_supply','fee_growth_q64','versioned_program_semantics','independent_checkpoint_reconciliation']};
}

// Research-only proportional share mapping. Not the program's mint-share algorithm.
import {IntegerKernel as K} from '../integer.mjs';
import {weights} from '../engine/liquidity.mjs';
import {allocationDiagnostic,scaledFloat} from './allocation-diagnostic.mjs';
import {snapshotRows,estimateFeeGrowth} from './paper-fee-core.mjs';
import {assert,hash,errorCode} from './research-contract.mjs';
const raw=(v,bits=128)=>{assert(typeof v==='string'&&/^\d{1,39}$/.test(v)&&BigInt(v)<(1n<<BigInt(bits)),'PAPER_SHARE_RAW_INVALID');return BigInt(v)};
const orders=['openOrderAmountRaw','totalProcessingOrderAmountRaw','processedOrderRemainingAmountRaw'];
const modes=['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'];
export function proportionalShare(bin,deposit,activeId){
 const x=raw(bin.amountXRaw,64),y=raw(bin.amountYRaw,64),dx=raw(deposit.memeRaw,64),dy=raw(deposit.solRaw,64),s=raw(bin.liquiditySupplyRaw),p=raw(bin.priceQ64Raw);
 assert(Number.isSafeInteger(bin.binId)&&bin.binId===deposit.binId&&Number.isSafeInteger(activeId)&&s>0n&&p>0n&&dx+dy>0n,'PAPER_SHARE_EMPTY_BIN_OR_DEPOSIT');
 assert([2,3].includes(bin.version)&&orders.every(k=>bin.version===2?bin[k]===null:raw(bin[k],64)===0n),'PAPER_SHARE_ORDER_STATE');
 assert(!(bin.binId<activeId&&(x>0n||dx>0n))&&!(bin.binId>activeId&&(y>0n||dy>0n)),'PAPER_SHARE_WRONG_SIDE');
 // Deposit must be exactly proportional to external principal. Reject mixed active-bin imbalance;
 // never invent internal swap, composition fee, or share minting behavior.
 assert(x+y>0n&&dx*y===dy*x&&(x>0n||dx===0n)&&(y>0n||dy===0n),'PAPER_SHARE_NONPROPORTIONAL_DEPOSIT');
 const share=x>0n?s*dx/x:s*dy/y;
 assert(share>0n&&share*10n<=s&&s+share<(1n<<128n),'PAPER_SHARE_LIMIT_OR_DUST');
 const principalX=share*(x+dx)/(s+share),principalY=share*(y+dy)/(s+share);
 assert(principalX<=dx&&principalY<=dy,'PAPER_SHARE_PRINCIPAL_DOMAIN');
 return {binId:bin.binId,shareRaw:String(share),depositXRaw:String(dx),depositYRaw:String(dy),externalSupplyRaw:String(s),projectedSupplyRaw:String(s+share),openingPrincipalXRaw:String(principalX),openingPrincipalYRaw:String(principalY),roundingDustXRaw:String(dx-principalX),roundingDustYRaw:String(dy-principalY),basis:'PROPORTIONAL_PRINCIPAL_SHARE_PROXY_NOT_PROTOCOL_MINT'};
}
export function assertProjectedShareLimit(rows,maxBinShare){
 assert(typeof maxBinShare==='number'&&Number.isFinite(maxBinShare)&&maxBinShare>0&&maxBinShare<=.1,'PAPER_SHARE_CONFIGURED_LIMIT_INVALID');
 const cap=scaledFloat(maxBinShare,9);
 assert(cap>0n&&rows.every(r=>raw(r.shareRaw)*1000000000n<=cap*raw(r.projectedSupplyRaw)),'PAPER_SHARE_CONFIGURED_LIMIT');
}
// Fixed comparison controls: observed one-sided bins only, no reference/flow forecast.
export function fixedPaperReport({snapshot,budget}){
 const {identity:i,map}=snapshotRows(snapshot),decimalsX=i.sides[0].decimals;
 const base={family:'NO_LP',action:{type:'NO_LP'},feasible:true},families=[{family:'NO_LP',best:base}];
 const availableY=Math.max(0,Number(budget.solRaw)/1e9-budget.minSolReserve-budget.operationCostSol);
 const availableX=Number(budget.memeRaw)/10**decimalsX;
 const cap=budget.maxBinShare;assertProjectedShareLimit([],cap);
 for(const family of modes.slice(1)){
  const shape=['asymmetric','hybrid_grid'].includes(family)?'hybrid':family;
  const alpha=family==='hybrid_grid'?.75:.5;
  const bins=[];
  for(const [side,amount,decimals] of [['X',availableX,decimalsX],['Y',availableY,9]]){
   if(amount<=0)continue;
   const own=side==='X'?'amountXRaw':'amountYRaw',other=side==='X'?'amountYRaw':'amountXRaw';
   const eligible=[...map.values()].filter(b=>Math.abs(b.binId-i.activeId)<=4&&(side==='X'?b.binId>=i.activeId:b.binId<=i.activeId)&&raw(b[own],64)>0n&&raw(b[other],64)===0n&&raw(b.liquiditySupplyRaw)>0n&&orders.every(k=>b.version===2?b[k]===null:raw(b[k],64)===0n)).sort((a,b)=>Math.abs(a.binId-i.activeId)-Math.abs(b.binId-i.activeId)).slice(0,4);
   if(!eligible.length)continue;
   const w=weights(eligible.length,shape,alpha,family==='asymmetric'?(side==='X'?1:-1):0);
   for(const [index,b] of eligible.entries()){
    const v=Math.min(amount*.05*w[index],Number(b[own])/10**decimals*cap);
    if(scaledFloat(v,decimals)>0n)bins.push({binId:b.binId,meme:side==='X'?v:0,sol:side==='Y'?v:0});
   }
  }
  const best=bins.length?{family,feasible:true,action:{type:'OPEN'},allocation:{lowerBinId:Math.min(...bins.map(b=>b.binId)),upperBinId:Math.max(...bins.map(b=>b.binId)),bins}}:null;
  families.push({family,best});
 }
 return {schemaVersion:1,pool:i.pool,status:'RESEARCH_DIAGNOSTIC_UNVERIFIED',executionReady:false,decisionReady:false,protocolExact:false,calibrated:false,market:{...i,decimalsX,decimalsY:9},planPreview:{status:'RESEARCH_PLAN_PREVIEW_UNVERIFIED',scope:'NEW_POSITION_ONLY',executionReady:false,decisionReady:false,families,selected:null,adaptiveReason:'ADAPTIVE_RESEARCH_INPUT_REQUIRED',basis:'FIXED_OBSERVED_BIN_CONTROL',allocationFraction:.05,width:4}};
}
export function mapPaperPlans({snapshot,report,budget}){
 const result={schemaVersion:1,scope:'PAPER_SHARE_MAPPING_DIAGNOSTIC_ONLY',status:'BLOCKED',reason:null,pool:snapshot?.identity?.pool??null,modelEligible:false,protocolExact:false,pnlReady:false,executionReady:false,rows:[]};
 try{
  const {identity:i,map}=snapshotRows(snapshot),m=report?.market,p=report?.planPreview;
  assert(report?.schemaVersion===1&&report.pool===i.pool&&report.status==='RESEARCH_DIAGNOSTIC_UNVERIFIED'&&report.executionReady===false&&report.decisionReady===false&&report.protocolExact===false&&report.calibrated===false&&m?.slot===i.slot&&m.rawHash===i.rawHash&&m.mintX===i.mintX&&m.mintY===i.mintY&&m.activeId===i.activeId&&m.binStep===i.binStep&&i.sides?.length===2&&i.sides[0].mint===i.mintX&&i.sides[1].mint===i.mintY&&m.decimalsX===i.sides[0].decimals&&m.decimalsY===9&&i.sides[1].decimals===9,'PAPER_SHARE_REPORT_SCOPE');
  assert(p?.status==='RESEARCH_PLAN_PREVIEW_UNVERIFIED'&&p.scope==='NEW_POSITION_ONLY'&&p.executionReady===false&&p.decisionReady===false&&Array.isArray(p.families)&&p.families.length===7&&new Set(p.families.map(r=>r.family)).size===7&&modes.every(k=>p.families.some(r=>r.family===k)),'PAPER_SHARE_PLAN_SCOPE');
  assert(budget?.allowDispose===false&&raw(budget.memeRaw,64)+raw(budget.solRaw,64)>0n&&Number.isFinite(budget.minSolReserve)&&budget.minSolReserve>=0&&Number.isFinite(budget.operationCostSol)&&budget.operationCostSol>=0,'PAPER_SHARE_BUDGET');
  const maxBinShare=budget.maxBinShare??.1;assertProjectedShareLimit([],maxBinShare);
  if(report.terminalBinding?.researchBudget){const frozen=report.terminalBinding.researchBudget;assert(['memeRaw','solRaw','allowDispose','minSolReserve','operationCostSol','maxBinShare'].every(k=>budget[k]===frozen[k]),'PAPER_SHARE_REPORT_BUDGET_CHANGED')}
  const market={...m,bins:[...map.values()]};
  function mapping(mode,row){
   const blocked=reason=>({mode,status:'BLOCKED',reason,allocation:null,rows:[]});
   if(!row||row.feasible!==true)return blocked('NO_FEASIBLE_PLAN');
   if(!modes.includes(row.family)||mode!=='adaptive'&&mode!==row.family)return blocked('PAPER_SHARE_FAMILY_MISMATCH');
   if(row.family==='NO_LP'&&row.action?.type==='NO_LP')return {mode,status:'NO_LP',reason:null,allocation:null,rows:[]};
   const d=allocationDiagnostic({row,market,budget});
   if(d.status!=='INTEGER_DIAGNOSTIC_ONLY')return blocked(d.reason??'INTEGER_MAPPING_UNAVAILABLE');
   try{
    assert(d.rows.length<=256&&d.zeroRows===0,'PAPER_SHARE_DUST_OR_RANGE');
    const rows=d.rows.map(v=>proportionalShare(map.get(v.binId),v,i.activeId));assertProjectedShareLimit(rows,maxBinShare);
    return {mode,status:'SHARE_PROXY_MAPPED_UNVERIFIED',reason:null,integerAllocation:d,rows,allocation:{schemaVersion:1,pool:i.pool,mintX:i.mintX,mintY:i.mintY,openingSlot:i.slot,openingRawHash:i.rawHash,shares:rows.map(r=>({binId:r.binId,shareRaw:r.shareRaw}))}};
   }catch(e){return blocked(errorCode(e,'PAPER_SHARE_MAPPING_FAILED'))}
  }
  result.rows=modes.map(mode=>mapping(mode,p.families.find(r=>r.family===mode).best));result.rows.push(p.selected?mapping('adaptive',p.selected):{...mapping('adaptive',null),reason:p.adaptiveReason??'NO_FEASIBLE_PLAN'});
  result.status='PAPER_SHARE_DIAGNOSTIC_UNVERIFIED';result.openingSlot=i.slot;result.openingRawHash=i.rawHash;result.mintX=i.mintX;result.mintY=i.mintY;result.sdkCommit=K.SDK_COMMIT;
 }catch(e){result.reason=errorCode(e,'PAPER_SHARE_INPUT_FAILED');result.rows=[]}
 return {...result,limitations:['Proportional share proxy only; exact on-chain mint rules, active-bin composition fees and SDK inverse allocation not verified.','Only nonempty bins with exact proportional deposit accepted; unsupported candidates remain blocked.','No causal freeze or proof of real wallet balances; no signing, real positions or realized PnL.']};
}
export function mappedFeeDiagnostics({before,after,mapping}){
 assert(mapping?.scope==='PAPER_SHARE_MAPPING_DIAGNOSTIC_ONLY'&&mapping.status==='PAPER_SHARE_DIAGNOSTIC_UNVERIFIED'&&mapping.protocolExact===false&&mapping.pnlReady===false&&mapping.pool===before.identity.pool&&mapping.openingSlot===before.identity.slot&&mapping.openingRawHash===before.identity.rawHash&&Array.isArray(mapping.rows)&&mapping.rows.length===8,'PAPER_SHARE_MAPPING_SCOPE');
 return mapping.rows.map(r=>({mode:r.mode,status:r.status,fee:r.status==='SHARE_PROXY_MAPPED_UNVERIFIED'?estimateFeeGrowth({before,after,allocation:r.allocation}):null,reason:r.reason,actualPnl:false}));
}

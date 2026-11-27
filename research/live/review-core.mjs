// T14 research review only. Never grants wallet permissions or builds transactions.
import {assert,hash,poolAddress as address,finite} from './research-contract.mjs';
const amount=v=>finite(v,0);
export function buildReview({report,mode,rowIndex,wallet,market,position=null,reviewHash,policyHash=null,now}){
 assert(['plans','management'].includes(mode)&&address(wallet),'REVIEW_WALLET_REQUIRED');
 assert(report?.status==='RESEARCH_DIAGNOSTIC_UNVERIFIED'&&report.decisionReady===false&&report.executionReady===false,'RESEARCH_REPORT_UNAVAILABLE');
 const b=report.terminalBinding;
 assert(b?.scope==='RESEARCH_ONLY'&&hash(b.requestHash)&&hash(b.reviewHash)&&b.reviewHash===reviewHash&&Number.isSafeInteger(b.expiresAt)&&b.expiresAt>now,'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
 assert(market?.pool===report.pool&&b.marketSlot===market.slot&&b.marketRawHash===market.rawHash,'RESEARCH_MARKET_CHANGED');
 const p=mode==='plans'?report.planPreview:report.managementPreview;
 assert(p?.status===(mode==='plans'?'RESEARCH_PLAN_PREVIEW_UNVERIFIED':'RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED')&&p.decisionReady===false&&p.executionReady===false,'RESEARCH_PREVIEW_UNAVAILABLE');
 const rows=mode==='plans'?p.families?.map(x=>x.best):p.candidates;
 assert(Array.isArray(rows)&&Number.isSafeInteger(rowIndex)&&rowIndex>=0&&rowIndex<rows.length,'RESEARCH_CANDIDATE_INVALID');
 const row=rows[rowIndex];assert(row?.feasible===true,'RESEARCH_CANDIDATE_INFEASIBLE');
 if(mode==='management'){
  assert(position?.position===b.position&&position?.owner===wallet&&p.position?.owner===wallet&&p.position?.address===position.position,'WALLET_POSITION_OWNER_MISMATCH');
  assert(position.slot===b.positionSlot&&position.rawHash===b.positionRawHash&&hash(policyHash)&&policyHash===b.policyHash,'RESEARCH_POSITION_OR_POLICY_CHANGED');
 }
 const action=mode==='plans'?(row.family==='NO_LP'?'NO_LP':'OPEN'):row.action?.type;
 assert(['OPEN','NO_LP','HOLD','REDUCE','REPOSITION','REMOVE_AND_HOLD'].includes(action)&&!row.action?.acquireSol,'RESEARCH_ACTION_UNSUPPORTED');
 const a=row.allocation;assert(a&&amount(a.bidSol)&&amount(a.askMeme)&&Array.isArray(a.bins)&&a.bins.length<=1500&&a.bins.every(x=>Number.isSafeInteger(x.binId)&&amount(x.sol)&&amount(x.meme)),'RESEARCH_ALLOCATION_INVALID');
 assert(new Set(a.bins.map(x=>x.binId)).size===a.bins.length,'RESEARCH_ALLOCATION_INVALID');
 const close=(x,y)=>Math.abs(x-y)<=1e-8*Math.max(1,Math.abs(x),Math.abs(y));
 assert(close(a.bins.reduce((n,x)=>n+x.sol,0),a.bidSol)&&close(a.bins.reduce((n,x)=>n+x.meme,0),a.askMeme),'RESEARCH_ALLOCATION_TOTAL_MISMATCH');
 if(action==='NO_LP')assert(a.bins.length===0&&a.bidSol===0&&a.askMeme===0,'RESEARCH_ALLOCATION_INVALID');
 return {schemaVersion:1,status:'RESEARCH_REVIEW_ONLY',decisionReady:false,executionReady:false,signingAvailable:false,mode,pool:report.pool,wallet,position:position?.position??null,action,strategy:row.family??row.action?.label??null,modelSelected:JSON.stringify(row)===JSON.stringify(p.selected),marketSlot:b.marketSlot,marketRawHash:b.marketRawHash,reviewHash:b.reviewHash,policyHash:mode==='management'?b.policyHash:null,positionSlot:mode==='management'?b.positionSlot:null,positionRawHash:mode==='management'?b.positionRawHash:null,rowIndex,requestHash:b.requestHash,expiresAt:b.expiresAt,modelAllocation:{sol:a.bidSol,meme:a.askMeme,lowerBinId:a.bins.length?Math.min(...a.bins.map(x=>x.binId)):null,upperBinId:a.bins.length?Math.max(...a.bins.map(x=>x.binId)):null},scenarioEstimates:row.scenarioEstimates??null,blockers:['UPSTREAM_LIVE_ACCEPTANCE_REQUIRED','SDK_TRANSACTION_QUOTE_UNAVAILABLE','WALLET_BALANCE_AND_FEE_CHECK_UNAVAILABLE','TRANSACTION_SIMULATION_UNAVAILABLE','NO_SIGNING_OR_SUBMISSION_ENDPOINT']};
}

// Validate the same selected research context after an asynchronous read. No execution permission.
export function assertSameReview(before,after,now){
 assert(before?.status==='RESEARCH_REVIEW_ONLY'&&after?.status==='RESEARCH_REVIEW_ONLY'&&before.executionReady===false&&after.executionReady===false&&before.signingAvailable===false&&after.signingAvailable===false,'RESEARCH_CONTEXT_INVALID');
 const keys=['mode','pool','wallet','position','action','rowIndex','requestHash','marketSlot','marketRawHash','reviewHash','policyHash','positionSlot','positionRawHash'];
 assert(keys.every(k=>before[k]===after[k]),'RESEARCH_CONTEXT_CHANGED');
 assert(Number.isSafeInteger(now)&&Number.isSafeInteger(before.expiresAt)&&Number.isSafeInteger(after.expiresAt)&&Math.min(before.expiresAt,after.expiresAt)>now,'RESEARCH_BINDING_EXPIRED_OR_CHANGED');
 return Math.min(before.expiresAt,after.expiresAt);
}

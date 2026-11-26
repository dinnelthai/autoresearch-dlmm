// Candidate evidence assembly. Missing or unreviewed facts never become model observations.
import {sha} from './evidence-digest.mjs';
import {assert,hash} from './research-contract.mjs';
import {reviewShape} from './research-input-status.mjs';
const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export function chainTimeFact({market,genesisReply,slotReply,timeReply,receivedAt,maxAgeSeconds}){
 assert(genesisReply?.jsonrpc==='2.0'&&genesisReply.id===1&&genesisReply.result===genesis&&slotReply?.jsonrpc==='2.0'&&slotReply.id===2&&Number.isSafeInteger(slotReply.result)&&slotReply.result>=market.slot,'CHAIN_TIME_SCOPE_INVALID');
 const t=timeReply?.result,now=Math.floor(receivedAt/1000);
 assert(timeReply?.jsonrpc==='2.0'&&timeReply.id===3&&!timeReply.error&&Number.isSafeInteger(t)&&t>0&&Number.isSafeInteger(now)&&t<=now&&now-t<=maxAgeSeconds,'CHAIN_TIME_MISSING_OR_STALE');
 return {scope:'RPC_BLOCK_TIME_OBSERVATION_ONLY',genesis,marketSlot:market.slot,marketRawHash:market.rawHash,finalizedSlot:slotReply.result,blockTime:t,receivedAt,independentlyReviewed:false};
}
export function assembleCandidate({market,snapshot,diagnostic,clock=null,sourceErrors=[],createdAt}){
 assert(market?.pool===snapshot?.pool&&market.slot===snapshot.marketSlot&&market.rawHash===snapshot.marketRawHash&&hash(snapshot.snapshotId)&&diagnostic?.pool===market.pool&&diagnostic.marketSlot===market.slot&&diagnostic.marketRawHash===market.rawHash&&diagnostic.modelInputReady===false&&snapshot.decisionReady===false&&snapshot.executionReady===false,'CANDIDATE_SCOPE_INVALID');
 assert(Number.isSafeInteger(createdAt)&&Array.isArray(sourceErrors)&&sourceErrors.length<=8,'CANDIDATE_INPUT_INVALID');
 if(clock)assert(clock.marketSlot===market.slot&&clock.marketRawHash===market.rawHash&&clock.scope==='RPC_BLOCK_TIME_OBSERVATION_ONLY'&&hash(clock.evidenceHash)&&clock.independentlyReviewed===false,'CANDIDATE_CLOCK_SCOPE');
 const gaps=[];
 if(!clock)gaps.push('RPC_BLOCK_TIME_REQUIRED');
 if(!diagnostic.swapSample||diagnostic.swapSample.sampleKind!=='RECENT_EVENT_SAMPLE')gaps.push('RECENT_SWAP_SAMPLE_REQUIRED');
 if(!diagnostic.externalQuote)gaps.push('DIRECT_QUOTE_REQUIRED');
 if(!diagnostic.holderFeatures?.distribution?.supplyConserved)gaps.push('HOLDER_DISTRIBUTION_REQUIRED');
 // Diagnostic facts are intentionally not promoted to the reviewed fields.
 gaps.push('INDEPENDENT_REFERENCE_CHAIN_TIME_AND_DEPTH_REVIEW_REQUIRED','COMPLETE_FLOW_WINDOW_REVIEW_REQUIRED','HOLDER_OUTFLOW_ATTRIBUTION_REVIEW_REQUIRED','TOKEN_SAFETY_REVIEW_REQUIRED');
 const replayEligible=snapshot.reviewStatus==='MATCHED_HASHES_UNVERIFIED'&&diagnostic.review?.status==='STRUCTURE_PRESENT_UNVERIFIED';
 if(!replayEligible)gaps.push('MATCHED_REVIEWED_OBSERVATIONS_REQUIRED');
 const body={schemaVersion:1,scope:'RESEARCH_CANDIDATE_ONLY',pool:market.pool,mintX:market.mintX,mintY:market.mintY,marketSlot:market.slot,marketRawHash:market.rawHash,snapshotId:snapshot.snapshotId,createdAt,clock,sourceErrors,gaps,observed:{swapSample:diagnostic.swapSample??null,holder:diagnostic.holderFeatures??null,reference:diagnostic.externalQuote??null},reviewStatus:snapshot.reviewStatus,replayEligible,modelInputReady:false,decisionReady:false,executionReady:false};
 return {...body,candidateId:sha(JSON.stringify(body))};
}
export function reviewStructureRequired(review,market,now){
 const r=reviewShape(review,market,now);assert(r.status==='STRUCTURE_PRESENT_UNVERIFIED','REVIEW_STRUCTURE_INCOMPLETE');return r;
}

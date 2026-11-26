// Historical research replay identity checks. Never produces a current or executable binding.
import {createHash} from 'node:crypto';
import {currentMarket,requestFromDraft,reviewMatches} from './terminal-core.mjs';
import {verifySnapshotManifest,reviewEvidenceRefs} from './research-snapshot.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m)};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function replayRequest(manifest,files,{pool,snapshotId,draft,now=Date.now()}){
 assert(manifest?.snapshotId===snapshotId&&hash(snapshotId)&&manifest.pool===pool&&Number.isSafeInteger(manifest.createdAt)&&manifest.createdAt<=now,'REPLAY_SCOPE_INVALID');
 verifySnapshotManifest(manifest,files);
 assert(manifest.reviewStatus==='MATCHED_HASHES_UNVERIFIED'&&files.has('review.json'),'REPLAY_REVIEW_REQUIRED');
 const state=JSON.parse(files.get('state.json')),review=JSON.parse(files.get('review.json')),diagnostic=JSON.parse(files.get('diagnostic.json'));
 const m=currentMarket(state,pool,manifest.createdAt,600000);
 assert(m.slot===manifest.marketSlot&&m.rawHash===manifest.marketRawHash&&m.mintX===manifest.mintX&&m.mintY===manifest.mintY&&m.capture===manifest.marketCapture&&diagnostic.pool===pool&&diagnostic.marketSlot===m.slot&&diagnostic.marketRawHash===m.rawHash&&diagnostic.modelInputReady===false,'REPLAY_SNAPSHOT_MISMATCH');
 reviewMatches(review,m,manifest.createdAt);
 assert(diagnostic.review?.status==='STRUCTURE_PRESENT_UNVERIFIED','REPLAY_REVIEW_STRUCTURE_INCOMPLETE');
 const capture=JSON.parse(files.get('capture-manifest.json'));
 assert(capture.pool===pool&&capture.contextSlot===m.slot&&capture.commitment==='finalized'&&capture.raw?.file==='accounts.json'&&capture.raw.sha256===m.rawHash,'REPLAY_CAPTURE_MISMATCH');
 return {market:m,request:requestFromDraft(draft,m),review,evidence:reviewEvidenceRefs(review)};
}
export function replayResult({manifest,request,report,sourceHashes,generatedAt}){
 assert(report?.pool===manifest.pool&&report.decisionReady===false&&report.executionReady===false&&report.calibrated===false&&report.protocolExact===false&&['BLOCKED','RESEARCH_DIAGNOSTIC_UNVERIFIED'].includes(report.status),'REPLAY_REPORT_CONTRACT');
 if(report.market)assert(report.market.slot===manifest.marketSlot&&report.market.rawHash===manifest.marketRawHash,'REPLAY_REPORT_SNAPSHOT_MISMATCH');
 assert(report.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||report.market&&Number.isSafeInteger(report.asOf),'REPLAY_REPORT_MISSING_CONTEXT');
 assert(!report.terminalBinding&&!report.reviewId&&Array.isArray(sourceHashes)&&sourceHashes.length>0&&sourceHashes.every(x=>typeof x.path==='string'&&hash(x.sha256))&&Number.isSafeInteger(generatedAt),'REPLAY_RESULT_BINDING_INVALID');
 const body={schemaVersion:1,scope:'HISTORICAL_RESEARCH_ONLY',pool:manifest.pool,snapshotId:manifest.snapshotId,marketSlot:manifest.marketSlot,marketRawHash:manifest.marketRawHash,requestHash:sha(JSON.stringify(request)),reportHash:sha(JSON.stringify(report)),sourceHashes,generatedAt,status:report.planPreview?.status==='RESEARCH_PLAN_PREVIEW_UNVERIFIED'?'REPLAY_RESEARCH_UNVERIFIED':'REPLAY_BLOCKED',decisionReady:false,executionReady:false,pnlReady:false};
 return {...body,runId:sha(JSON.stringify(body))};
}

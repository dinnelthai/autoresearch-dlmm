// Immutable-by-content diagnostic snapshot contract, not an approved model input.
import {sha} from './evidence-digest.mjs';
import {assert,hash} from './research-contract.mjs';
const allowedFiles=new Set(['state.json','diagnostic.json','review.json','external.json','holder.json','capture-manifest.json']);
export function snapshotFileList(m){
 assert(Array.isArray(m?.files)&&m.files.length>=3&&m.files.length<=6,'SNAPSHOT_FILE_LIST_INVALID');
 const seen=new Set();let total=0;
 for(const f of m.files){assert(allowedFiles.has(f?.name)&&!seen.has(f.name)&&hash(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=64*1024*1024,'SNAPSHOT_FILE_INVALID');seen.add(f.name);total+=f.bytes}
 assert(total<=80*1024*1024&&['state.json','diagnostic.json','capture-manifest.json'].every(x=>seen.has(x)),'SNAPSHOT_FILE_BUDGET');
 assert((m.reviewStatus==='MATCHED_HASHES_UNVERIFIED')===seen.has('review.json'),'SNAPSHOT_REVIEW_BINDING_INVALID');return m.files;
}
export function snapshotManifest({pool,market,createdAt,files,reviewStatus,diagnostic}){
 assert(market?.pool===pool&&Number.isSafeInteger(market.slot)&&market.slot>=0&&hash(market.rawHash)&&Number.isSafeInteger(createdAt),'SNAPSHOT_IDENTITY_INVALID');
 assert(diagnostic?.pool===pool&&diagnostic.marketSlot===market.slot&&diagnostic.marketRawHash===market.rawHash&&diagnostic.modelInputReady===false,'SNAPSHOT_DIAGNOSTIC_MISMATCH');
 snapshotFileList({files,reviewStatus});
 const manifest={schemaVersion:1,scope:'IMMUTABLE_RESEARCH_DIAGNOSTIC',pool,mintX:market.mintX,mintY:market.mintY,marketSlot:market.slot,marketRawHash:market.rawHash,marketCapture:market.capture,createdAt,reviewStatus,files:files.slice().sort((a,b)=>a.name.localeCompare(b.name)),modelInputReady:false,decisionReady:false,executionReady:false};
 return {...manifest,snapshotId:sha(JSON.stringify(manifest))};
}
export function verifySnapshotManifest(m,files){
 const {snapshotId,...body}=m??{};assert(hash(snapshotId)&&sha(JSON.stringify(body))===snapshotId&&m.scope==='IMMUTABLE_RESEARCH_DIAGNOSTIC'&&m.modelInputReady===false&&m.decisionReady===false&&m.executionReady===false&&Array.isArray(m.files),'SNAPSHOT_MANIFEST_HASH_MISMATCH');
 snapshotFileList(m);
 assert(files instanceof Map&&files.size===m.files.length&&m.files.every(f=>{const b=files.get(f.name);return b&&b.length===f.bytes&&sha(b)===f.sha256}),'SNAPSHOT_FILE_HASH_MISMATCH');
 return true;
}
export function reviewEvidenceRefs(review){
 assert(Array.isArray(review?.observations)&&review.observations.length>=3&&review.observations.length<=100,'SNAPSHOT_REVIEW_BUDGET');
 const refs=[review.marketTimeEvidence];if(review.operations)refs.push(review.operations.evidence);
 for(const o of review.observations){assert(Array.isArray(o.references)&&o.references.length>=2&&o.references.length<=16,'SNAPSHOT_REFERENCE_BUDGET');refs.push(o.evidence,...o.references.map(r=>r.evidence))}
 const result=new Map();for(const r of refs){assert(typeof r?.path==='string'&&r.path.length<=1024&&hash(r.sha256),'SNAPSHOT_REVIEW_EVIDENCE_INVALID');assert(!result.has(r.path)||result.get(r.path)===r.sha256,'SNAPSHOT_EVIDENCE_CONFLICT');result.set(r.path,r.sha256)}
 assert(result.size<=256,'SNAPSHOT_REVIEW_BUDGET');return [...result].map(([path,sha256])=>({path,sha256}));
}

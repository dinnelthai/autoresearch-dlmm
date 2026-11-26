// Shared read-only research boundary primitives. No evidence acceptance by shape alone.
export const assert=(v,m)=>{if(!v)throw Error(m)};
export const poolAddress=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
export const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export const finite=(v,lo,hi=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
export function errorCode(error,fallback='INPUT_OR_EVIDENCE_VALIDATION_FAILED'){
 const message=typeof error==='string'?error:error?.message;
 return typeof message==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(message)?message:fallback;
}
export function sameSnapshot(a,b){
 return !!a&&!!b&&Number.isSafeInteger(a.slot)&&a.slot>=0&&hash(a.rawHash)&&a.slot===b.slot&&a.rawHash===b.rawHash;
}
export function blockedResponse(pool,reason){return {schemaVersion:1,pool,status:'BLOCKED',decisionReady:false,executionReady:false,gaps:[reason]}}
export function blockAnalysis(report,reason){
 report.status='BLOCKED';
 report.decisionReady=false;report.executionReady=false;report.calibrated=false;report.protocolExact=false;
 delete report.planPreview;delete report.managementPreview;
 report.gaps.push(reason);
 return report;
}

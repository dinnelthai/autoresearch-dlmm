// T13 read-only monitoring ledger. No trading actions, recommendations or signing.
const assert=(v,m)=>{if(!v)throw Error(m)};
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const code=v=>typeof v==='string'&&/^[A-Z0-9_:-]{1,120}$/.test(v)?v:'MONITOR_VALIDATION_FAILED';
export function observationKey(body){
 assert(Number.isSafeInteger(body.marketSlot)&&Number.isSafeInteger(body.positionSlot)&&[body.marketRawHash,body.positionRawHash,body.reviewHash,body.policyHash].every(hash),'MONITOR_INPUT_INVALID');
 return [body.marketSlot,body.marketRawHash,body.positionSlot,body.positionRawHash,body.reviewHash,body.policyHash].join(':');
}
export function summarizeRisk(report,body,now){
 const m=report?.managementPreview,b=report?.terminalBinding;
 if(report?.decisionReady!==false||report?.executionReady!==false||report.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||m?.status!=='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED')return {status:'BLOCKED',reason:code(m?.reason??report?.gaps?.[0]),flags:[]};
 assert(m.decisionReady===false&&m.executionReady===false&&b?.scope==='RESEARCH_ONLY'&&b.position===body.position&&b.marketSlot===body.marketSlot&&b.positionSlot===body.positionSlot&&b.marketRawHash===body.marketRawHash&&b.positionRawHash===body.positionRawHash&&b.reviewHash===body.reviewHash&&b.policyHash===body.policyHash&&Number.isSafeInteger(b.expiresAt)&&b.expiresAt>now,'MONITOR_BINDING_INVALID');
 assert(Array.isArray(m.alerts)&&Array.isArray(m.currentRisk?.violations),'MONITOR_RISK_INVALID');
 const flags=[...new Set([...m.alerts,...m.currentRisk.violations].map(code))].sort();
 const hard=m.currentRisk.violations.length>0||flags.includes('MANUAL_RISK_REVIEW_REQUIRED');
 const ratio=m.currentRisk.worstRatio,loss=m.currentRisk.stressLoss;
 assert(Number.isFinite(ratio)&&ratio>=0&&Number.isFinite(loss)&&loss>=0,'MONITOR_RISK_INVALID');
 return {status:hard?'RISK_REVIEW_REQUIRED':flags.length?'REVIEW_FLAGS':'NO_MODEL_FLAGS',reason:hard?'MANUAL_RISK_REVIEW_REQUIRED':null,flags,stressLossSol:loss,worstInventoryRatio:ratio,expiresAt:b.expiresAt,key:observationKey(body),slot:body.positionSlot};
}
export function emptyLedger(pool){return {schemaVersion:1,pool,nextId:1,current:{},events:[]}}
export function recoverLedger(raw,pool){
 assert(raw?.schemaVersion===1&&raw.pool===pool&&Number.isSafeInteger(raw.nextId)&&raw.nextId>0&&Array.isArray(raw.events)&&raw.events.length<=500,'MONITOR_LEDGER_INVALID');
 let prev=0;for(const e of raw.events){assert(Number.isSafeInteger(e.id)&&e.id>prev&&e.id<raw.nextId&&typeof e.position==='string'&&typeof e.status==='string'&&Array.isArray(e.flags)&&e.flags.every(x=>typeof x==='string')&&Number.isSafeInteger(e.at),'MONITOR_LEDGER_INVALID');prev=e.id}
 // Never restore an old observation as current. Historical transitions only.
 return {...emptyLedger(pool),nextId:raw.nextId,events:raw.events};
}
export function record(ledger,position,obs,now){
 const previous=ledger.current[position],current={...obs,observedAt:now};
 // Pending is transient, not a new risk transition. Compare against last settled event.
 if(obs.status==='PENDING')return {...ledger,current:{...ledger.current,[position]:current}};
 const settled=previous?.status==='PENDING'?ledger.events.findLast(e=>e.position===position):previous;
 const signature=o=>JSON.stringify([o?.status,o?.reason??null,o?.flags??[]]);
 const changed=signature(settled)!==signature(current);
 const event=changed?{id:ledger.nextId,position,at:now,status:current.status,reason:current.reason??null,flags:current.flags??[],previousStatus:settled?.status??'UNKNOWN',slot:current.slot??null}:null;
 return {...ledger,nextId:ledger.nextId+(event?1:0),current:{...ledger.current,[position]:current},events:event?[...ledger.events,event].slice(-500):ledger.events};
}
export function visibleObservation(o,now){
 if(!o)return {status:'UNKNOWN',flags:[]};
 if(o.expiresAt!=null&&o.expiresAt<=now)return {status:'BLOCKED',reason:'MONITOR_OBSERVATION_EXPIRED',flags:[],observedAt:o.observedAt};
 return o;
}

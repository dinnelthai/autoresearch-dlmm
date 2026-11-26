// Frozen forward observation window; never claim independent coverage or realized returns.
import {assert} from './research-contract.mjs';
export function freezePaperWindow(frozenAt,days,maxGapSeconds){
 assert(Number.isSafeInteger(frozenAt)&&[7,30].includes(days)&&Number.isSafeInteger(maxGapSeconds)&&maxGapSeconds>=10&&maxGapSeconds<=3600,'PAPER_WINDOW_POLICY');
 return {days,startAt:frozenAt,endAt:frozenAt+days*86400000,graceMs:maxGapSeconds*1000,status:'OBSERVING'};
}
export function paperWindowCapture(window,proof){
 assert(window?.status==='OBSERVING','PAPER_WINDOW_NOT_ACTIVE');
 const requested=Date.parse(proof?.requestedAt),received=Date.parse(proof?.receivedAt);
 assert(Number.isFinite(requested)&&Number.isFinite(received)&&requested<=received,'PAPER_WINDOW_TIME');
 if(received>window.endAt+window.graceMs)return 'MISSED_ENDPOINT';
 return requested>=window.endAt?'ENDPOINT':'OBSERVATION';
}
export function paperWindowExpired(window,now){return window?.status==='OBSERVING'&&now>window.endAt+window.graceMs}
export function finishPaperWindow(window,status,at){
 assert(window?.status==='OBSERVING'&&['ENDPOINT_OBSERVED','MISSED_ENDPOINT','PAUSED','SNAPSHOT_LIMIT_REACHED'].includes(status)&&Number.isSafeInteger(at),'PAPER_WINDOW_TERMINATION');
 return {...window,status,finishedAt:at};
}

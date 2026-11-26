// Aggregate event evidence classification, never fabricated per-bin fills.
import {assert,hash,poolAddress} from './research-contract.mjs';
const raw=v=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<(1n<<64n);
const signature=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v);
export function collapseSingleSwapTwin(rows,calls){
 if(calls!==1||rows.length!==2)return rows;
 const old=rows.find(r=>r.event==='Swap'),rich=rows.find(r=>r.event==='Swap2Evt');
 if(!old||!rich||old.source!==rich.source||old.outerIndex!==rich.outerIndex)return rows;
 const fields=['pool','from','startBinId','endBinId','swapForY','direction','amountInRaw','amountOutRaw','feeBpsFieldRaw','protocolFeeRaw','hostFeeRaw'];
 if(!fields.every(k=>old[k]===rich[k]))return rows;
 return [rich];
}
export function classifySwapCandidate(row,tx){
 const base={id:row.id,signature:row.signature,slot:row.slot,txIndex:row.txIndex,eventIndex:row.eventIndex,startBinId:row.startBinId,endBinId:row.endBinId,feeToken:row.feeToken??null,mmFeeRaw:row.mmFeeRaw??null,modelEligible:false,perBinStatus:'UNAVAILABLE'};
 const block=reason=>({...base,status:'RAW_SWAP_ONLY',reason});
 if(!tx||tx.success!==true||tx.signature!==row.signature||tx.slot!==row.slot||tx.txIndex!==row.txIndex||tx.eventCount!==1||tx.swapCalls!==1||row.source!=='CPI'||!signature(row.signature)||!Number.isSafeInteger(row.slot)||row.slot<0||!Number.isSafeInteger(row.txIndex)||row.txIndex<0||!Number.isInteger(row.outerIndex)||!Number.isInteger(row.innerIndex)||!Number.isInteger(row.startBinId)||!Number.isInteger(row.endBinId))return block('TRANSACTION_OR_INSTRUCTION_SCOPE_UNVERIFIED');
 if(row.startBinId!==row.endBinId)return block('CROSS_BIN_ALLOCATION_REQUIRED');
 if(row.event!=='Swap2Evt'||!['X','Y'].includes(row.feeToken)||!raw(row.mmFeeRaw)||!raw(row.amountInRaw)||!raw(row.amountOutRaw)||!raw(row.amountLeftRaw)||!raw(row.protocolFeeRaw)||!raw(row.hostFeeRaw)||!raw(row.limitOrderFeeRaw)||typeof row.feeOnInput!=='boolean'||typeof row.swapForY!=='boolean')return block('RICH_FEE_FIELDS_REQUIRED');
 if(row.feeToken!==(row.feeOnInput===row.swapForY?'X':'Y')||BigInt(row.amountLeftRaw)!==0n||BigInt(row.limitOrderFeeRaw)!==0n||BigInt(row.amountInRaw)===0n||BigInt(row.amountOutRaw)===0n)return block('PARTIAL_LIMIT_ORDER_OR_FEE_SIDE_UNSUPPORTED');
 return {...base,status:'SINGLE_BIN_FEE_CANDIDATE_ONLY',bin:row.startBinId,side:row.swapForY?'LP_BUY':'LP_SELL',reason:'PRE_SWAP_BIN_STATE_AND_PRINCIPAL_RECONCILIATION_REQUIRED'};
}
export function captureObservation({pool,market,marketProof,history,historyProof,decoded,manifest,observedAt}){
 assert(poolAddress(pool)&&Number.isSafeInteger(observedAt)&&observedAt>=0,'PAPER_OBSERVATION_SCOPE');
 const gaps=[];let marketRef=null,historyRef=null,candidates=[];
 if(market){assert(market.pool===pool&&hash(market.rawHash)&&Number.isSafeInteger(market.slot)&&market.slot>=0&&hash(marketProof?.sha256),'PAPER_MARKET_SCOPE');marketRef={slot:market.slot,rawHash:market.rawHash,mintX:market.mintX,mintY:market.mintY,receivedAt:market.receivedAt,evidence:marketProof};}
 else gaps.push('MARKET_NOT_CAPTURED');
 if(history&&manifest&&decoded){assert(decoded.pool===pool&&decoded.position===null&&manifest.pool===pool&&manifest.position===null&&manifest.indexAddress===pool&&manifest.commitment==='finalized'&&hash(historyProof?.sha256)&&Array.isArray(decoded.events)&&Array.isArray(decoded.transactions)&&Array.isArray(decoded.gaps)&&Array.isArray(manifest.signatures),'PAPER_HISTORY_SCOPE');
 const tx=new Map(decoded.transactions.map(r=>[r.signature,r]));assert(tx.size===decoded.transactions.length,'PAPER_DUPLICATE_TRANSACTION');
 const ids=new Set();for(const row of decoded.events){assert(row.pool===pool&&typeof row.id==='string'&&!ids.has(row.id),'PAPER_DUPLICATE_EVENT');ids.add(row.id);candidates.push(classifySwapCandidate(row,tx.get(row.signature)))}
 historyRef={evidence:historyProof,head:manifest.before===null,signatures:manifest.signatures.map(s=>s.signature),status:decoded.status,historyStatus:history.historyStatus??null,repairCapture:history.repairCapture===true,sourceGaps:decoded.gaps.length};
 if(decoded.gaps.length||manifest.gaps?.length||history.historyGapObserved||history.repairCapture||decoded.status!=='EVENTS_DECODED_UNVERIFIED')gaps.push('HISTORY_PARTIAL_OR_BACKFILL');
 }else gaps.push('HISTORY_NOT_CAPTURED');
 return {schemaVersion:1,scope:'PAPER_CAPTURE_EVIDENCE_ONLY',pool,observedAt,market:marketRef,history:historyRef,candidates,gaps,coverageVerified:false,modelEligible:false,executionReady:false,pnlReady:false};
}
export function nextJournal(previous,observation,pointer,limit=256){
 assert(hash(pointer.sha256)&&typeof pointer.path==='string'&&Number.isSafeInteger(limit)&&limit>=1&&limit<=256,'PAPER_JOURNAL_POINTER');
 const prior=previous??{schemaVersion:1,pool:observation.pool,entries:[],head:[],gapObserved:false,retentionTruncated:false};
 assert(prior.pool===observation.pool&&Array.isArray(prior.entries)&&prior.entries.length<=limit&&Array.isArray(prior.head)&&typeof prior.gapObserved==='boolean'&&typeof prior.retentionTruncated==='boolean','PAPER_JOURNAL_SCOPE');
 const entries=[...prior.entries],last=entries.at(-1);if(last?.sha256===pointer.sha256)return prior;
 assert(!last||observation.observedAt>=last.observedAt,'PAPER_JOURNAL_TIME_REVERSED');
 const head=observation.history?.head&&!observation.history.repairCapture&&observation.history.sourceGaps===0?observation.history.signatures:null;
 const disjoint=head&&head.length&&prior.head.length&&!head.some(s=>prior.head.includes(s));
 entries.push({...pointer,observedAt:observation.observedAt,marketSlot:observation.market?.slot??null,historyStatus:observation.history?.status??null,candidateCount:observation.candidates.length});
 const truncated=entries.length>limit;if(truncated)entries.shift();
 return {...prior,entries,head:head?.length?head:prior.head,gapObserved:prior.gapObserved||!!disjoint||observation.gaps.length>0,retentionTruncated:prior.retentionTruncated||truncated};
}

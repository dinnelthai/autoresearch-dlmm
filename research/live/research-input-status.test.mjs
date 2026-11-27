import test from 'node:test';import assert from 'node:assert/strict';import {boundedSwapObservation,inputStatus,reviewShape} from './research-input-status.mjs';
const pool='A'.repeat(32),mintX='B'.repeat(32),mintY='C'.repeat(32),rawHash='a'.repeat(64),now=1700000000000,t=now/1000;
const market={pool,mintX,mintY,slot:1,rawHash,receivedAt:now-1000};
const history={status:'CAPTURED_UNVERIFIED',receivedAt:now-1000,evidence:{decoded:{pool,position:null,status:'EVENTS_DECODED_UNVERIFIED',gaps:[],transactions:[{signature:'a',success:true,slot:1,blockTime:t-1}],events:[{pool,id:'a:0',signature:'a',slot:1,blockTime:t-1,swapForY:false,direction:'Y_TO_X',amountInRaw:'10',amountOutRaw:'100'},{pool,id:'a:1',signature:'a',slot:1,blockTime:t-1,swapForY:true,direction:'X_TO_Y',amountInRaw:'90',amountOutRaw:'9'}]}}};
test('observed sample exact gross flow but never certified window',()=>{const x=boundedSwapObservation(history,pool,now,10000);assert.equal(x.grossLamports,'19');assert.equal(x.buyLamports,'10');assert.equal(x.sellLamports,'9');assert.equal(x.modelFlowEligible,false);assert.equal(boundedSwapObservation({...history,status:'PARTIAL'},pool,now,10000),null);assert.equal(boundedSwapObservation(history,pool,now+20000,10000),null)});
test('pending refresh can expose only a still-fresh prior successful observation',()=>{const p={status:'PENDING',previousStatus:history.status,previousReceivedAt:history.receivedAt,previousEvidence:history.evidence};let v=boundedSwapObservation(p,pool,now,10000);assert.equal(v.grossLamports,'19');assert.equal(v.collectionReceivedAt,history.receivedAt);assert.equal(boundedSwapObservation(p,pool,now+20000,10000),null);assert.equal(boundedSwapObservation({...p,previousStatus:'PARTIAL'},pool,now,10000),null);assert.equal(boundedSwapObservation({...p,previousReceivedAt:null},pool,now,10000),null)});
test('missing and mismatched evidence cannot produce readiness',()=>{const r=inputStatus({pool,market,history,now});assert.equal(r.modelInputReady,false);assert.equal(r.review.status,'MISSING');assert.equal(r.swapSample.grossLamports,'19');assert.equal(inputStatus({pool,market:{...market,pool:mintX},history,now}).swapSample,null);assert.equal(reviewShape({pool},market,now).status,'STRUCTURE_INCOMPLETE')});

test('old and backfill events cannot look like recent market flow',()=>{const old={...history,evidence:{...history.evidence,decoded:{...history.evidence.decoded,events:history.evidence.decoded.events.map(x=>({...x,blockTime:t-86400})),transactions:history.evidence.decoded.transactions.map(x=>({...x,blockTime:t-86400}))}}};const a=inputStatus({pool,market,history:old,now});assert.equal(a.swapSample.sampleKind,'OLDER_EVENT_SAMPLE');assert.equal(a.tasks.find(x=>x.id==='history').state,'HISTORICAL_ONLY');const b=inputStatus({pool,market,history:{...history,evidence:{...history.evidence,repairCapture:true}},now});assert.equal(b.swapSample.sampleKind,'HISTORICAL_BACKFILL');assert.equal(b.tasks.find(x=>x.id==='history').state,'HISTORICAL_ONLY');assert.equal(b.swapSample.modelFlowEligible,false)});

test('duplicate transaction records fail closed even when events are distinct',()=>{const d=history.evidence.decoded;assert.equal(boundedSwapObservation({...history,evidence:{...history.evidence,decoded:{...d,transactions:[...d.transactions,...d.transactions]}}},pool,now,10000),null)});

// The automatic paper bridge does not manufacture observations from absent diagnostics.
test('collected paper inputs reject missing sources and incomplete warmup',async()=>{
 const {collectedPaperObservation,collectedPaperInputs}=await import('./review-observations.mjs');
 const m={pool:'A'.repeat(32),mintX:'B'.repeat(32),mintY:'C'.repeat(32),slot:10,rawHash:'a'.repeat(64),binStep:100,decimalsX:6,decimalsY:9};
 assert.throws(()=>collectedPaperObservation({m,now:100000}),/PAPER_HOLDER_FEATURES_UNAVAILABLE/);
 assert.throws(()=>collectedPaperInputs({m,req:{goal:'balanced',horizonSeconds:600,riskConfig:{}},samples:[],asOf:100}),/PAPER_COLLECTED_MODEL_WARMUP/);
});

test('collected paper bridge derives bounded features and three causal reference observations',async()=>{
 const {collectedPaperObservation,collectedPaperInputs}=await import('./review-observations.mjs');
 const m={...market,binStep:100,decimalsX:6,decimalsY:9};
 const refs=['raydium','orca'].map((venue,i)=>({venue,pool:String.fromCharCode(68+i).repeat(32),midSolPerMeme:.001,bestTestedExit:{minOutRaw:'3000000000'}}));
 const e={...m,marketSlot:m.slot,marketRawHash:m.rawHash,expiresAt:now+1000,fetchedAt:now-1000,evidenceHash:'b'.repeat(64),rawEvidenceCheck:{scope:'RAW_QUOTE_RECHECK_ONLY',venues:refs},evidence:['ask.json','bid-0.json','orca-ask.json','orca-bid-0.json'].map(file=>({file,receivedAt:now-2000,sha256:'c'.repeat(64)})),raydium:{pool:refs[0].pool},orca:{pool:refs[1].pool}};
 const h={pool,mint:mintX,genesis:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',slot:1,requestMarketSlot:1,receivedAt:now-1000,evidenceHash:'d'.repeat(64),scope:'HOLDER_DIAGNOSTIC_ONLY',distribution:{supplyConserved:true,topShare:.25},cohort:{netDecreaseShare:.01},safety:{flags:[],mintAuthorityRevoked:true,freezeAuthorityRevoked:true}};
 const sample=collectedPaperObservation({m,external:e,holder:h,history,now});
 assert.equal(sample.event.flowSol,19/1e9);assert.equal(sample.event.holderOutflow,.01);assert.equal(sample.event.references.length,2);
 const samples=[0,1,2].map(i=>({...sample,event:{...sample.event,id:'obs'+i,t:t-2+i,references:sample.event.references.map(r=>({...r,availableAt:t-2+i,observedAt:t-3+i}))}}));
 const x=collectedPaperInputs({m,req:{goal:'balanced',horizonSeconds:600,riskConfig:{}},samples,asOf:t});
 assert.equal(x.observations.length,3);assert.equal(x.latest.ref.valid,true);assert.throws(()=>collectedPaperInputs({m,req:{goal:'balanced',horizonSeconds:600,riskConfig:{}},samples,asOf:t+200}),/PAPER_COLLECTED_MODEL_WARMUP/);
 assert.throws(()=>collectedPaperObservation({m,external:{...e,rawEvidenceCheck:{...e.rawEvidenceCheck,venues:[refs[0]]}},holder:h,history,now}),/PAPER_TWO_REFERENCE_QUOTES_REQUIRED/);
});

test('shared evidence reader returns matching bytes and rejects invalid digests',async()=>{const {sha,verifiedEvidence}=await import('./evidence-digest.mjs');const b=Buffer.from('observed'),read=async()=>b;assert.equal(await verifiedEvidence(read,'data/raw/a',sha(b)),b);await assert.rejects(()=>verifiedEvidence(read,'data/raw/a','0'.repeat(64)),/EVIDENCE_HASH_MISMATCH/);await assert.rejects(()=>verifiedEvidence(read,'data/raw/a',null),/EVIDENCE_HASH_MISMATCH/)});

test('Meteora reference bridge recomputes SDK quotes, rejects stale or target references and duplicate capture warmup',async()=>{
 const {meteoraReferenceInputs,collectedPaperInputs}=await import('./review-observations.mjs'),{quoteMath}=await import('./reference-math.mjs');
 const m={pool:'A'.repeat(32),mintX:'B'.repeat(32),mintY:'C'.repeat(32),decimalsX:6,decimalsY:9,binStep:100,slot:10};
 const now=100000,iso=t=>new Date(t).toISOString(),bid={status:'FULL_QUOTE',inRaw:'10000000',outRaw:'10000000',minOutRaw:'9950000'},ask={status:'FULL_QUOTE',inRaw:'10010000',outRaw:'10000000',minOutRaw:'9950000'},ladder=[bid,{status:'FULL_QUOTE',inRaw:'3000000000',outRaw:'3000000000',minOutRaw:'2985000000'}],math=quoteMath(bid,ask,ladder,200);
 const refs=['D','E'].map(k=>({pool:k.repeat(32),venue:'METEORA_DLMM',status:'QUOTES_CAPTURED_UNVERIFIED',before:{slot:1,receivedAt:iso(now-2000)},after:{slot:2,receivedAt:iso(now-1000)},bid,ask,...math}));
 const reference={capture:'data/raw/ref',manifestHash:'a'.repeat(64),report:{pool:m.pool,mint:m.mintX,decimals:6,commitment:'finalized',status:'REFERENCE_EVIDENCE_UNVERIFIED',completedAt:iso(now-500),maxDiscountBps:200,references:refs}};
 const rs=meteoraReferenceInputs({m,reference,now});assert.equal(rs.length,2);assert.equal(rs[0].depth,2.985);assert.throws(()=>meteoraReferenceInputs({m,reference,now:now+121000}),/METEORA_REFERENCE_UNAVAILABLE/);
 assert.throws(()=>meteoraReferenceInputs({m,reference:{...reference,report:{...reference.report,references:[{...refs[0],pool:m.pool},refs[1]]}},now}),/METEORA_REFERENCE_STALE_OR_INVALID/);
 const samples=[0,1,2].map(i=>({basis:'COLLECTED_MARKET_FEATURE_PROXY_V1',slot:i+1,evidence:{reference:{source:'METEORA_DLMM_SDK',sha256:'a'.repeat(64)}},event:{type:'MARKET',pool:m.pool,t:100+i,id:'ref'+i,references:rs}}));
 const req={goal:'balanced',horizonSeconds:600,riskConfig:{}};assert.throws(()=>collectedPaperInputs({m,req,samples,asOf:102}),/PAPER_COLLECTED_MODEL_WARMUP/);
 for(let i=0;i<3;i++)samples[i].evidence.reference.sha256=String(i).repeat(64);
 assert.equal(collectedPaperInputs({m,req,samples,asOf:102}).observations.length,3);
});

test('Paper takes only validated recent head swaps, not old events or historical gaps as full coverage',()=>{
 const d=history.evidence.decoded,older={...d.events[0],id:'old:0',signature:'old',blockTime:t-600,amountInRaw:'99999'};
 const head={...history,status:'PARTIAL',evidence:{...history.evidence,historyStatus:'UNRESOLVED_GAP',decoded:{...d,transactions:[...d.transactions,{signature:'old',success:true,slot:1,blockTime:t-600}],events:[older,...d.events]}}};
 assert.equal(boundedSwapObservation(head,pool,now,10000),null);
 const s=boundedSwapObservation(head,pool,now,10000,{recentOnly:true});assert.equal(s.grossLamports,'19');assert.equal(s.eventCount,2);assert.equal(s.sourceEventCount,3);assert.equal(s.coverageVerified,false);assert.equal(s.historyCoverage,'UNRESOLVED_GAP');
 const backfill={...history,evidence:{...history.evidence,repairCapture:true,recentHead:head}};
 assert.equal(boundedSwapObservation(backfill,pool,now,10000,{recentOnly:true}).grossLamports,'19');
 assert.equal(boundedSwapObservation({...backfill,evidence:{...backfill.evidence,recentHead:null}},pool,now,10000,{recentOnly:true}),null);
 assert.equal(boundedSwapObservation({...head,evidence:{...head.evidence,decoded:{...head.evidence.decoded,gaps:[{reason:'MISSING'}]}}},pool,now,10000,{recentOnly:true}),null);
});

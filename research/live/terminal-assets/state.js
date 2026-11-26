'use strict';
// Pure data contracts and scope checks. No DOM or network access.
function sameScope(startEpoch,startTarget,currentEpoch,currentTarget){return startEpoch===currentEpoch&&startTarget===currentTarget;}
const posActions=['HOLD','REDUCE','REPOSITION','REMOVE_AND_HOLD'],actionNames={HOLD:'Hold · 保持',REDUCE:'Reduce · 减少',REPOSITION:'Reposition · 调仓',REMOVE_AND_HOLD:'Remove · 撤池保留'};
const nonnegative=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const addr=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const raw=v=>typeof v==='string'&&/^\d{1,80}$/.test(v);
function exactAmount(v,d){if(!raw(v)||!Number.isInteger(d)||d<0||d>18)return '—';let s=BigInt(v).toString().padStart(d+1,'0');if(!d)return s;const fraction=s.slice(-d).replace(/0+$/,'');return s.slice(0,-d)+(fraction?'.'+fraction:'')}
function approx(v,d){if(!raw(v)||!Number.isInteger(d)||d<0||d>18||BigInt(v)>BigInt(Number.MAX_SAFE_INTEGER))return null;return Number(v)/10**d}
function checkAccounting(p){
 const a=p.accounting,s=p.snapshot;
 if(!a||a.pool!==p.pool||a.position!==p.position||a.slot!==p.slot||a.status!=='CALCULATED_UNVERIFIED'||a.protocolReplayVerified!==false||!Array.isArray(a.rows)||!a.rows.length||!Array.isArray(s.bins)||a.rows.length!==s.bins.length||a.rows.length!==p.upperBinId-p.lowerBinId+1||a.rows.length>1500)throw Error('逐 Bin 本金明细缺失或不匹配');
 const keys=['principalX','principalY','feeX','feeY'],seen=new Set(),sourceIds=new Set(s.bins.map(b=>b.binId)),totals=Object.fromEntries(keys.map(k=>[k,0n]));
 for(const b of a.rows){if(!Number.isSafeInteger(b.binId)||b.binId<p.lowerBinId||b.binId>p.upperBinId||seen.has(b.binId)||!sourceIds.has(b.binId))throw Error('逐 Bin 区间或身份不符');seen.add(b.binId);for(const k of keys){if(!raw(b[k]))throw Error('逐 Bin 原始整数无效');totals[k]+=BigInt(b[k])}}
 for(const [k,v] of Object.entries({principalX:p.currentPrincipalRaw.x,principalY:p.currentPrincipalRaw.y,feeX:p.pendingFeeRaw.x,feeY:p.pendingFeeRaw.y}))if(!raw(a.totals?.[k])||BigInt(a.totals[k])!==totals[k]||BigInt(v)!==totals[k])throw Error('逐 Bin 合计与仓位本金或费用不符');
 return a.rows;
}
function validatePosition(r,pool){
 if(!r||r.schemaVersion!==1||r.status!=='POSITION_CALCULATED_UNVERIFIED'||r.pool!==pool||!addr(r.position)||!addr(r.owner)||!Number.isSafeInteger(r.slot)||r.slot<0||!hash(r.rawHash))throw Error('仓位快照身份或状态不符');
 const s=r.snapshot;
 if(!s||s.pool!==pool||s.position!==r.position||s.slot!==r.slot||s.tokenOrientation!=='MEME_X_SOL_Y'||s.tokenExtensions!==false||!Number.isInteger(s.decimalsX)||s.decimalsX<0||s.decimalsX>18||s.decimalsY!==9)throw Error('仓位快照单位不符');
 if(!Number.isSafeInteger(r.lowerBinId)||!Number.isSafeInteger(r.upperBinId)||r.upperBinId<r.lowerBinId)throw Error('区间无效');
 for(const k of ['currentPrincipalRaw','pendingFeeRaw','claimedLifetimeRaw'])if(!raw(r[k]?.x)||!raw(r[k]?.y))throw Error('缺少原始整数 '+k);
 checkAccounting(r);return r;
}
function validateManagement(r,pool,p){
 const m=r?.managementPreview;
 if(!p||r.schemaVersion!==1||r.pool!==pool||r.status!=='RESEARCH_DIAGNOSTIC_UNVERIFIED'||r.executionReady!==false||r.decisionReady!==false||!m||m.status!=='RESEARCH_MANAGEMENT_PREVIEW_UNVERIFIED'||m.executionReady!==false||m.decisionReady!==false||m.scope!=='EXISTING_POSITION_ONLY'||m.position?.address!==p.position||m.position?.owner!==p.owner||r.market?.slot!==p.slot||r.market?.rawHash!==p.rawHash||r.market?.decimalsX!==p.snapshot.decimalsX||r.market?.decimalsY!==9||!Number.isSafeInteger(r.asOf)||r.asOf<0||!nonnegative(r.referencePriceSolPerMeme)||r.referencePriceSolPerMeme===0)throw Error('管理报告与仓位快照身份、Slot 或哈希不一致');
 if(!Array.isArray(m.candidates)||m.candidates.length>100||!Array.isArray(m.alerts)||!Array.isArray(m.currentRisk?.violations)||!nonnegative(m.currentRisk.stressLoss)||!nonnegative(m.currentRisk.worstRatio))throw Error('管理报告结构不符');
 for(const row of m.candidates){if(!posActions.includes(row?.action?.type)||row.action.acquireSol||typeof row.feasible!=='boolean')throw Error('不支持的管理动作');if(row.feasible&&(!Array.isArray(row.allocation?.bins)||row.allocation.bins.length>1500||!row.allocation.bins.every(b=>Number.isSafeInteger(b.binId)&&nonnegative(b.sol)&&nonnegative(b.meme))||!Number.isFinite(row.score)||!nonnegative(row.postRisk?.stressLoss)||!nonnegative(row.inventoryAfterAction?.x)||!nonnegative(row.inventoryAfterAction?.y)||!nonnegative(row.estimatedOperationCostSol)||!Number.isFinite(row.scenarioEstimates?.pnlSol)))throw Error('可行方案数值无效')}
 if(m.selected&&(!m.selected.feasible||!m.candidates.some(x=>JSON.stringify(x)===JSON.stringify(m.selected))))throw Error('选中动作不属于候选');
 if((m.alerts.includes('MANUAL_RISK_REVIEW_REQUIRED')||m.currentRisk.violations.length)&&m.selected)throw Error('硬风控下不允许自动选中');
 return r;
}
function monitorFresh(x,now=Date.now()){return x?.status==='CAPTURED_UNVERIFIED'&&Number.isSafeInteger(x.expiresAt)&&x.expiresAt>now}
function rangeFresh(x,now=Date.now()){return monitorFresh(x,now)&&x.commonMarketCapture===true&&Number.isSafeInteger(x.rangeExpiresAt)&&x.rangeExpiresAt>now}
function manageReady(x,o,now=Date.now()){
 const g=x?.managementGate,b=o?.snapshot;
 return !!b&&o.source==='service'&&rangeFresh(x,now)&&x.commonMarketCapture===true&&x.slot===b.slot&&x.rawHash===b.rawHash&&g?.status==='PREFLIGHT_MATCHED_UNVERIFIED'&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt>now&&hash(g.reviewHash)&&hash(g.policyHash);
}
function matchesManagementBinding(b,x,o,market,now=Date.now()){
 return !!b&&manageReady(x,o,now)&&b.scope==='RESEARCH_ONLY'&&b.position===x.position&&b.positionSlot===x.slot&&b.positionRawHash===x.rawHash&&b.marketSlot===market?.slot&&b.marketRawHash===market?.rawHash&&b.reviewHash===x.managementGate.reviewHash&&b.policyHash===x.managementGate.policyHash&&hash(b.requestHash)&&Number.isSafeInteger(b.expiresAt)&&b.expiresAt>now;
}

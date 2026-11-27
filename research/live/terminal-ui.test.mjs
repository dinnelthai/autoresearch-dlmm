// Minimal DOM stub exercises the ordered frontend asset scripts and handlers, not a real browser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {terminalScriptNames} from './terminal-assets.mjs';
const html=readFileSync(new URL('./terminal.html',import.meta.url),'utf8');
const sources=terminalScriptNames.map(n=>readFileSync(new URL('./terminal-assets/'+n,import.meta.url),'utf8'));
function mount(){
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);
 function element(){return {value:'',textContent:'',hidden:false,open:false,disabled:false,style:{},dataset:{},classList:{add(){},remove(){}},children:[],listeners:{},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)},setAttribute(){},removeAttribute(){},append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},querySelector(){return element()},scrollIntoView(){},showModal(){this.open=true},close(){this.open=false}}}
 const elements=new Map(ids.map(id=>[id,element()])),document={getElementById:id=>{assert.ok(elements.has(id),'missing DOM ID '+id);return elements.get(id)},createElement:element,createElementNS:element,querySelectorAll:()=>[]};
 const extra=`
 return {
  changePool:v=>{target=v;handleTargetChange();return poolEpoch},
  scope:(epoch,v)=>sameScope(epoch,v,poolEpoch,target),
  currentScope:()=>perfPositionScope,
  mountPositions:()=>{
   const snapshot=id=>({position:id,owner:'owner',slot:1,rawHash:'x',lowerBinId:0,upperBinId:0,snapshot:{decimalsX:6},currentPrincipalRaw:{x:'1',y:'1'},pendingFeeRaw:{x:'0',y:'0'},claimedLifetimeRaw:{x:'0',y:'0'},accounting:{rows:[]}});
   for(const id of ['A','B'])positions.set(id,{source:'archive',snapshot:snapshot(id),management:null});
   positionSelected='A';renderPosition();return positionGeneration
  },
  choosePosition:i=>{$('positionRows').children[i].children.at(-1).children[0].listeners.click[0]();return positionGeneration},
  ready:manageReady,
  matchesReviewResponse,
  pinComparison:r=>{pinPaperComparison(r);return paperComparisons.size},
  comparisonSize:()=>paperComparisons.size,
  reportReset:()=>{researchReport={id:'old'};$('paperReportContent').hidden=false;clearPaperReport();return researchReport===null},
  expireReport:()=>{report={terminalBinding:{marketSlot:1,marketRawHash:'h',expiresAt:0},reviewId:'old',planPreview:{families:[]}};archiveExpiredReport(null,null);return {preserved:!!report.planPreview,bound:!!report.terminalBinding,review:!!report.reviewId}},
  reviewScope:()=>target,
  accountingEpoch:()=>accountingGeneration,
  refreshIndexOnly:()=>clearWalletPositions({preserveAccounting:true}),
  resetIndex:()=>clearWalletPositions()
 };
 `;
 const context=createContext({document,window:{scrollTo(){}},fetch:()=>new Promise(()=>{}),setInterval:()=>0,AbortSignal:{timeout:()=>null}});
 for(const [i,source] of sources.entries())runInContext(source,context,{filename:terminalScriptNames[i]});
 const api=runInContext('(function(){'+extra+'})()',context);
 return {api,elements};
}
test('asset startup and Pool A-B-A invalidate old request scope',()=>{
 const {api,elements}=mount(),epoch=api.changePool('A');assert.equal(api.scope(epoch,'A'),true);
 api.changePool('B');api.changePool('A');assert.equal(api.scope(epoch,'A'),false);assert.equal(api.currentScope(),'[null,null]');assert.equal(elements.get('reviewDialog').open,false);
});
test('position A-B-A invalidates pending management and performance scope',()=>{
 const {api}=mount();api.changePool('P');const g=api.mountPositions();
 assert.equal(api.currentScope(),'["A","owner"]');assert.equal(api.choosePosition(1),g+1);assert.equal(api.currentScope(),'["B","owner"]');assert.equal(api.choosePosition(0),g+2);assert.equal(api.choosePosition(0),g+2);
});
test('management disabled when common market expires before position',()=>{
 const {api}=mount(),h='a'.repeat(64),o={source:'service',snapshot:{slot:1,rawHash:h}},x={status:'CAPTURED_UNVERIFIED',commonMarketCapture:true,slot:1,rawHash:h,expiresAt:2000,rangeExpiresAt:1200,managementGate:{status:'PREFLIGHT_MATCHED_UNVERIFIED',expiresAt:2000,reviewHash:h,policyHash:h}};
 assert.equal(api.ready(x,o,1100),true);assert.equal(api.ready(x,o,1300),false);assert.equal(api.ready({...x,commonMarketCapture:false},o,1100),false);
});

test('index expiration does not invalidate ongoing accounting, explicit scope reset does',()=>{const {api}=mount(),g=api.accountingEpoch();api.refreshIndexOnly();assert.equal(api.accountingEpoch(),g);api.resetIndex();assert.equal(api.accountingEpoch(),g+1)});

test('expired research remains visible as historical instead of clearing the result',()=>{const {api}=mount();const r=api.expireReport();assert.equal(r.preserved,true);assert.equal(r.bound,false);assert.equal(r.review,false)});

test('report state is cleared when pool context changes',()=>{const {api,elements}=mount();assert.equal(api.reportReset(),true);assert.equal(elements.get('paperReportContent').hidden,true);assert.equal(elements.get('paperReportJSON').disabled,true)});

test('pinned cross-experiment reports survive pool scope reset and refresh replaces same run',()=>{const {api,elements}=mount(),r={pool:'A',id:'one',startAt:1,endAt:2,strategies:[],environments:[],experimentConfig:{configHash:'a'},gapMs:0,observations:1};assert.equal(api.pinComparison(r),1);api.changePool('B');assert.equal(api.comparisonSize(),1);assert.equal(api.pinComparison({...r,pool:'B',id:'two'}),2);assert.equal(api.pinComparison({...r,endAt:3}),2);assert.equal(elements.get('paperCompareRows').children.length,2);elements.get('paperCompareClear').listeners.click[0]();assert.equal(api.comparisonSize(),0)});

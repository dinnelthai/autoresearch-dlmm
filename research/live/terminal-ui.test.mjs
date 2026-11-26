// Minimal DOM stub exercises actual inline script and handlers, not a real browser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./terminal.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
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
  reviewScope:()=>target
 };
 `;
 const api=new Function('document','window','fetch','setInterval','AbortSignal',script+extra)(document,{scrollTo(){}},()=>new Promise(()=>{}),()=>0,{timeout:()=>null});
 return {api,elements};
}
test('inline startup and Pool A-B-A invalidate old request scope',()=>{
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

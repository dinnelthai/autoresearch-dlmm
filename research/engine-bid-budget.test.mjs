import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
test('bid budget respects exact bin conversion, inventory and stress limits',()=>{
 const c=E.config({anchorPrice:1,binStepBps:100,maxInventoryRatio:1,maxInventoryTokens:2,minSolReserve:1,maxLossSol:100});
 const s=E.newState({entry:'sol',meme:0,sol:10,initialPrice:1},c);
 s.market={ref:{valid:true},exitDepth:100};
 const unit=[{id:-2,y:1}];
 const cap=E.bidCap(s,c,1,unit);
 assert.ok(Math.abs(cap-2*E.price(c,-2))<1e-9);
 const depth=E.bidCap({...s,market:{ref:{valid:true},exitDepth:1}},c,1,unit);
 assert.ok(Math.abs(depth-E.price(c,-2))<1e-9);
 const stressConfig=E.config({...c,maxLossSol:.1,maxInventoryTokens:100});
 const stress=E.bidCap(s,stressConfig,1,unit);
 assert.ok(Math.abs(stress-.1/(1-.4/E.price(c,-2)))<1e-9);
});

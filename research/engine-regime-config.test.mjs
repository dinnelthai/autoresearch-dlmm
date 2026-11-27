import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
test('regime thresholds have validated defaults and overrides',()=>{
 const c=E.config();
 assert.equal(c.regimeLookback,12);
 assert.equal(c.trendEfficiencyThreshold,.65);
 assert.equal(c.stressLogReturnThreshold,.20);
 assert.equal(E.config({trendLogReturnThreshold:.08}).trendLogReturnThreshold,.08);
 assert.throws(()=>E.config({regimeLookback:2}));
 assert.throws(()=>E.config({regimeMinObservations:13}));
 assert.throws(()=>E.config({trendEfficiencyThreshold:1.1}));
 assert.throws(()=>E.config({toxicMarkoutMinSamples:0}));
});

test('configured thresholds change actual classification on the same observations',()=>{
 const cfg=E.config(),history=[1,1.02,1.04].map(price=>({ref:{price}}));
 const state={market:{t:10,ref:{valid:true,price:1.04,expiresAt:20},tokenSafe:true,holderShare:.1,exitDepth:100,flowSol:10,holderOutflow:0,buyImbalance:0},lastTime:10,history,marks:[],fills:[]};
 assert.equal(E.classify(state,cfg).regime,'UPTREND');
 assert.equal(E.classify(state,E.config({trendLogReturnThreshold:.08})).regime,'HEALTHY_RANGE');
 assert.equal(E.classify(state,E.config({regimeMinObservations:4})).regime,'UNKNOWN');
});

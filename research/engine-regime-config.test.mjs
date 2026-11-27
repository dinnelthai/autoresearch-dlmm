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

import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from './engine.mjs';
test('shared market admission is exhaustive and concentration overrides regime',()=>{
 for(const regime of ['HEALTHY_RANGE','UPTREND','DOWNTREND']) {
  assert.equal(Engine.marketAdmission({regime,flags:[]}),true);
  assert.equal(Engine.marketAdmission({regime,flags:['HOLDER_CONCENTRATION']}),false);
 }
 for(const regime of ['UNKNOWN','STRESS','DISTRIBUTION_RANGE','DEAD_RANGE','UNRECOGNIZED']) assert.equal(Engine.marketAdmission({regime,flags:[]}),false);
});

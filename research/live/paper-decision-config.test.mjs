import test from 'node:test';
import assert from 'node:assert/strict';
import {paperDecisionConfig} from './paper-adaptive-core.mjs';
test('experiment loss and cooldown constrain tuned decisions',()=>{
 const risk={maxLossSol:6};
 const controls={cooldownSeconds:120,maxRebalances:8,maxTurnoverSol:30};
 const policy={maxLossSolRaw:'2000000000'};
 const a=paperDecisionConfig(risk,controls,{cooldownSeconds:30,lambda:.7},policy);
 assert.equal(a.maxLossSol,2);
 assert.equal(a.cooldownSeconds,120);
 assert.equal(a.lambda,.7);
 assert.equal(a.maxRebalances,8);
 assert.equal(paperDecisionConfig(risk,controls,{cooldownSeconds:240},policy).cooldownSeconds,240);
 assert.equal(paperDecisionConfig({maxLossSol:1},controls,{},policy).maxLossSol,1);
 assert.throws(()=>paperDecisionConfig(risk,controls,{}, {maxLossSolRaw:'0'}));
});

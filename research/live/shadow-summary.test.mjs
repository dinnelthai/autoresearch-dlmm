import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from './shadow-summary.mjs';
const row=(id,group,capital,adaptive,base)=>({id,group,split:'test',runs:[{mode:'adaptive',status:'HYPOTHETICAL_REPLAY',initialNavSol:capital,pnlSol:adaptive},{mode:'hodl',status:'HYPOTHETICAL_REPLAY',initialNavSol:capital,pnlSol:base}]});
test('missing groups remain in denominator and incomplete groups are not reported as complete',()=>{
 const rows=[row('a','A',10,2,1),row('b','B',100,20,10),{id:'c',group:'B',split:'test',runs:[]},{id:'d',group:'C',split:'test',runs:[]}];
 const r=summarize(rows,'test','hodl');
 assert.equal(r.plannedWindows,4);assert.equal(r.validPairs,2);assert.equal(r.invalidOrMissing,2);assert.equal(r.declaredGroups,3);assert.equal(r.completeGroups,1);assert.equal(r.incompleteGroups,2);assert.equal(r.meanGroupDeltaSol,1);assert.equal(r.meanGroupReturnDelta,.1);
});
test('group return normalizes differing capital; mismatched capital invalidates pair',()=>{
 const rows=[row('a','A',10,2,1),row('b','B',100,20,10)];
 const r=summarize(rows,'test','hodl');assert.equal(r.meanGroupDeltaSol,5.5);assert.equal(r.meanGroupReturnDelta,.1);
 rows[0].runs[1].initialNavSol=11;const x=summarize(rows,'test','hodl');assert.equal(x.validPairs,1);assert.equal(x.completeGroups,1);assert.equal(x.declaredGroups,2);
 const y=summarize([{id:'x',group:'X',split:'test',runs:[]}],'test','hodl');assert.equal(y.meanGroupDeltaSol,null);assert.equal(y.positiveGroupFraction,null);
});

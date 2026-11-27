import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine as E} from './engine.mjs';
test('shared selection requires strict margin, finite feasible scores and stable ties',()=>{
 const c=E.config({minImprovementSol:.125,uncertaintySol:.125});
 for(const key of ['utility','score']){
  const row=(value,feasible=true)=>({feasible,[key]:value});
  const base=row(1),equal=row(1.25),best=row(1.5),tie=row(1.5);
  const choose=(rows,b=base,extra={})=>E.selectByUtility(rows,b,c,{scoreKey:key,...extra});
  assert.equal(choose([base,equal]),base);
  assert.equal(choose([base,best,tie,row(100,false),row(Infinity)]),best);
  const blocked=row(0,false);
  assert.equal(choose([blocked,best],blocked),null);
  assert.equal(choose([blocked,best],blocked,{requireBaseline:false}),best);
  assert.equal(choose([blocked],blocked,{requireBaseline:false}),null);
 }
});

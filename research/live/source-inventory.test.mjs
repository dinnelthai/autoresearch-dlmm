import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sourceInventory,auditRelativeImports,paperModelFingerprint} from './source-inventory.mjs';
test('service change alters backend hash, test changes do not',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-inventory-'));
 try{
  const live=join(root,'research','live');await mkdir(live,{recursive:true});
  await writeFile(join(root,'research','engine.mjs'),'export const Engine={};');
  await writeFile(join(live,'terminal-server.mjs'),"import './service.mjs';");
  await writeFile(join(live,'service.mjs'),'export const x=1;');
  const a=await sourceInventory(root);assert.match(a.backendHash,/^[0-9a-f]{64}$/);assert.equal(auditRelativeImports(a.modules).missing.length,0);
  await writeFile(join(live,'service.test.mjs'),'// test');assert.equal((await sourceInventory(root)).backendHash,a.backendHash);
  await writeFile(join(live,'service.mjs'),'export const x=2;');const b=await sourceInventory(root);assert.notEqual(b.backendHash,a.backendHash);assert.equal(b.paperModelHash,a.paperModelHash);
  await writeFile(join(root,'research','engine.mjs'),'export const Engine={newModel:true};');assert.notEqual((await sourceInventory(root)).paperModelHash,a.paperModelHash);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('audit detects absent relative modules and cycles',()=>{
 const a='/tmp/a.mjs',b='/tmp/b.mjs';const graph=new Map([[a,"import {b} from './b.mjs';"],[b,"export {a} from './a.mjs';\nimport './missing.mjs';"]]);
 const r=auditRelativeImports(graph);assert.equal(r.missing.length,1);assert.equal(r.cycles.length,1);assert.equal(r.missing[0].to,'/tmp/missing.mjs');
});

test('paper version tracks accounting and dependency lock, not archive and terminal',()=>{const entries=[{path:'research/live/paper-fee-core.mjs',sha256:'a'},{path:'research/live/package-lock.json',sha256:'b'},{path:'research/live/terminal-paper-service.mjs',sha256:'c'},{path:'research/live/paper-history-store.mjs',sha256:'d'}];const h=paperModelFingerprint(entries);assert.equal(paperModelFingerprint(entries.map((x,i)=>i>=2?{...x,sha256:'new'}:x)),h);assert.notEqual(paperModelFingerprint(entries.map((x,i)=>i===0?{...x,sha256:'new'}:x)),h)});

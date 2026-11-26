// Stable checkout source fingerprint and lightweight relative-import inventory.
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,dirname,resolve} from 'node:path';
import {sha} from './evidence-digest.mjs';
export async function sourceInventory(root){
 const paths=[];
 async function walk(dir){
  for(const e of await readdir(dir,{withFileTypes:true})){
   if(e.name==='node_modules'||e.name.startsWith('.'))continue;
   const p=join(dir,e.name);
   if(e.isDirectory())await walk(p);
   else if(e.isFile()&&(e.name.endsWith('.mjs')||['package.json','package-lock.json'].includes(e.name)))paths.push(p);
  }
 }
 await walk(join(root,'research'));paths.sort();
 const entries=[],modules=new Map();
 for(const p of paths){const bytes=await readFile(p),path=relative(root,p).replaceAll('\\','/');if(path.endsWith('.mjs'))modules.set(p,bytes.toString('utf8'));if(!path.endsWith('.test.mjs')&&path!=='research/test.mjs')entries.push({path,sha256:sha(bytes)})}
 if(!entries.some(e=>e.path==='research/live/terminal-server.mjs')||!entries.some(e=>e.path==='research/engine.mjs'))throw Error('SOURCE_INVENTORY_INCOMPLETE');
 return {backendHash:sha(JSON.stringify(entries)),entries,modules};
}
// This is a literal static import audit, not a JS parser or native ESM link check.
export function auditRelativeImports(modules){
 const missing=[],edges=new Map();
 for(const [p,source] of modules){
  const deps=[];
  for(const m of source.matchAll(/^\s*(?:import\s+(?:[^;\n]+?\s+from\s+)?|export\s*\{[^}]*\}\s*from\s*)['"](\.{1,2}\/[^'"\n]+\.mjs)['"]/gm)){
   const target=resolve(dirname(p),m[1]);if(!modules.has(target))missing.push({from:p,to:target});else deps.push(target);
  }
  edges.set(p,deps);
 }
 const visited=new Set(),active=new Set(),stack=[],cycles=[];
 function visit(p){if(active.has(p)){cycles.push([...stack.slice(stack.indexOf(p)),p]);return}if(visited.has(p))return;active.add(p);stack.push(p);for(const d of edges.get(p)??[])visit(d);stack.pop();active.delete(p);visited.add(p)}
 for(const p of edges.keys())visit(p);
 return {moduleCount:modules.size,missing,cycles};
}

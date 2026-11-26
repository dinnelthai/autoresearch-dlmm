// Read-only bounded storage inventory. Never deletes, follows symlinks, or certifies full accounting coverage.
import {opendir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const DATA=fileURLToPath(new URL('../../data/',import.meta.url));
const roots=['raw','research-snapshots','research-candidates','research-runs','position-observations','position-accounting','feature-series','research-catalog','position-ledger-index','paper','paper-captures','paper-intervals','live','live-preview'];
export async function archiveInventory(data=DATA,{maxEntries=50000,maxMs=10000,warningBytes=5*1024**3}={}){
 const start=Date.now();let scanned=0,bytes=0,truncated=false;const groups=[];
 for(const name of roots){
  const group={name,files:0,bytes:0,symlinksSkipped:0,errors:0,oldestMtime:null};groups.push(group);
  const stack=[join(data,name)];
  while(stack.length){
   if(scanned>=maxEntries||Date.now()-start>=maxMs){truncated=true;break}
   const path=stack.pop();let st;try{st=await lstat(path)}catch(e){if(e.code!=='ENOENT')group.errors++;continue}scanned++;
   if(st.isSymbolicLink()){group.symlinksSkipped++;continue}
   if(st.isFile()){group.files++;group.bytes+=st.size;bytes+=st.size;group.oldestMtime=group.oldestMtime===null?st.mtimeMs:Math.min(group.oldestMtime,st.mtimeMs);continue}
   if(!st.isDirectory())continue;
   try{const d=await opendir(path);for await(const entry of d){if(scanned+stack.length>=maxEntries||Date.now()-start>=maxMs){truncated=true;break}stack.push(join(path,entry.name))}}catch{group.errors++}
  }
  if(truncated)break;
 }
 return {scope:'READ_ONLY_ARCHIVE_INVENTORY',scanned,bytes,groups,truncated,warning:bytes>=warningBytes?'ARCHIVE_SIZE_WARNING':truncated?'INVENTORY_PARTIAL':'BELOW_WARNING_IN_SCANNED_SCOPE',deletionPerformed:false,historyComplete:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await archiveInventory(),null,2));

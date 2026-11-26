// Host-local shared grant budget for the project's read-only RPC transports.
import {mkdir,open,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const root=fileURLToPath(new URL('../../data/rpc-budget/',import.meta.url));
export function nextGrant(previous,now,spacing){
 if(!Number.isSafeInteger(now)||!Number.isInteger(spacing)||spacing<250||spacing>5000||!Number.isSafeInteger(previous)||previous<0||previous>now+60000)throw Error('RPC_SHARED_BUDGET_STATE_INVALID');
 return Math.max(now,previous);
}
export function sharedRpcBudget({directory=root,spacingMs=250,clock=Date.now,sleep=pause}={}){
 return async deadline=>{
  await mkdir(directory,{recursive:true,mode:0o700});
  const lock=join(directory,'grant.lock'),file=join(directory,'next.json'),tmp=join(directory,'next.tmp');
  while(clock()<deadline){
   let h;try{h=await open(lock,'wx',0o600)}catch(e){if(e.code!=='EEXIST')throw Error('RPC_SHARED_BUDGET_IO');await sleep(Math.min(25,Math.max(0,deadline-clock())));continue}
   let delay=0;
   try{
    let previous=0;try{const raw=await readFile(file,'utf8');if(raw.length>128)throw Error('RPC_SHARED_BUDGET_STATE_INVALID');previous=JSON.parse(raw).nextAt}catch(e){if(e.code!=='ENOENT')throw e}
    const now=clock(),grant=nextGrant(previous,now,spacingMs);if(grant>=deadline)throw Error('RPC_SHARED_BUDGET_TIMEOUT');
    if(grant<=now){await writeFile(tmp,JSON.stringify({nextAt:now+spacingMs}),{mode:0o600});await rename(tmp,file);return}
    delay=grant-now;
   }finally{try{await h.close()}finally{await unlink(lock)}}
   await sleep(Math.min(delay,Math.max(0,deadline-clock())));
  }
  throw Error('RPC_SHARED_BUDGET_TIMEOUT');
 };
}

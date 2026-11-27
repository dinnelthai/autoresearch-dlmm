// Read-only local history verification. No chain or PnL acceptance.
import {join,resolve} from 'node:path';
import {openSync,writeFileSync,closeSync} from 'node:fs';
import {link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createTerminalRuntime} from './terminal-runtime.mjs';
import {createPaperHistoryStore} from './paper-history-store.mjs';
import {assert,poolAddress,errorCode} from './research-contract.mjs';
import {sha} from './evidence-digest.mjs';
import {readSnapshotCheckpoint} from './paper-snapshot.mjs';
import {createPaperReport} from './paper-report-core.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),DATA=join(ROOT,'data'),io=createTerminalRuntime({ROOT,DATA});
const {values}=parseArgs({options:{pool:{type:'string'},id:{type:'string'},report:{type:'boolean'},'history-out':{type:'string'},help:{type:'boolean'}}});
async function main(){
 if(values.help){console.log('node research/live/paper-history-audit.mjs --pool ADDRESS --id auto-UUID [--report] [--history-out history.jsonl]');return}
 assert(poolAddress(values.pool)&&typeof values.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(values.id),'PAPER_HISTORY_ARGUMENTS');
 const dir=await io.safeDataPath(join(DATA,'paper-auto',values.pool,values.id)),read=async(p,n)=>io.boundedRead(await io.safeDataPath(p),n),target=join(dir,'checkpoint.json');
 const bytes=await read(target,32*1024*1024),state=readSnapshotCheckpoint(JSON.parse(bytes),values.id,values.pool);
 const report=values.report?createPaperReport(state):null;
 const out=values['history-out']?resolve(values['history-out']):null,tmp=out?out+'.'+randomUUID()+'.tmp':null;
 let fd=null,created=false;
 try{
  if(tmp){fd=openSync(tmp,'wx',0o600);created=true}
  const result=await createPaperHistoryStore({read}).verify(dir,state,{committedPrefix:!!out,onRecord:r=>{report?.add(r);if(fd!==null)writeFileSync(fd,JSON.stringify(r)+'\n')}});
  if(!out)assert(sha(await read(target,32*1024*1024))===sha(bytes),'PAPER_HISTORY_CHECKPOINT_CHANGED_RETRY_WHEN_PAUSED');
  const summary=report?{...report.finish(),historyVerification:result}:{...result,pool:state.pool,id:state.id,window:state.window,gapCount:state.gapCount,executionReady:false,rankingReady:false};
  if(fd!==null){closeSync(fd);fd=null;await link(tmp,out);summary.historyExport={path:out,records:result.records,headHash:result.headHash,format:'JSONL_FULL_COMMITTED_HISTORY'}}
  console.log(JSON.stringify(summary,null,2));
 }finally{if(fd!==null)closeSync(fd);if(created)await unlink(tmp)}
}
main().catch(e=>{console.error(JSON.stringify({status:'PAPER_HISTORY_AUDIT_BLOCKED',reason:errorCode(e,'PAPER_HISTORY_AUDIT_FAILED'),pnlReady:false}));process.exitCode=1});

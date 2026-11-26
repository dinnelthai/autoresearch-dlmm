// T17: repeatable offline verification; does not contact RPC or authorize execution.
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),research=join(root,'research');
const sha=b=>createHash('sha256').update(b).digest('hex');
const records=[];
function execute(id,args,timeout=120000){
 const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:16*1024*1024});
 const result={id,command:[process.execPath,...args],status:r.status===0&&!r.error?'PASS':'FAIL',exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''};records.push(result);return result;
}
async function walk(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name.startsWith('.'))continue;const p=join(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else if(e.isFile())files.push(p)}return files.sort()}
async function main(){
 const major=Number(process.versions.node.split('.')[0]);if(major<20)throw Error('Node >=20 required');
 const files=await walk(research),modules=files.filter(p=>p.endsWith('.mjs')),tests=modules.filter(p=>p.endsWith('.test.mjs')),sourceHashes={};
 for(const p of modules){sourceHashes[relative(root,p)]=sha(await readFile(p));execute('syntax:'+relative(root,p),['--check',p],15000)}
 const htmlPath=join(research,'live','terminal.html'),html=await readFile(htmlPath,'utf8');sourceHashes[relative(root,htmlPath)]=sha(html);
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];let domError=null;
 try{if(!script)throw Error('inline script missing');new Function(script);const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);const refs=[...script.matchAll(/\$\('([^']+)'\)/g)].map(x=>x[1]);if(ids.length!==new Set(ids).size||refs.some(x=>!ids.includes(x)))throw Error('duplicate or missing DOM IDs')}catch(e){domError=e.message}
 records.push({id:'terminal-inline-structure',status:domError?'FAIL':'PASS',error:domError});
 for(const p of files.filter(p=>p.endsWith('.example.json')||p.endsWith('/package.json'))){try{const b=await readFile(p);sourceHashes[relative(root,p)]=sha(b);JSON.parse(b.toString('utf8'));records.push({id:'json:'+relative(root,p),status:'PASS'})}catch(e){records.push({id:'json:'+relative(root,p),status:'FAIL',error:e.message})}}
 if(records.every(r=>r.status==='PASS')){
  execute('node-test-suite',['--test',...tests],180000);
  execute('legacy-research-suite',[join(research,'test.mjs')],120000);
 }else records.push({id:'node-test-suite',status:'BLOCKED',reason:'STATIC_CHECK_FAILED'});
 const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}),dirty=spawnSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'});
 const report={schemaVersion:1,scope:'OFFLINE_CODE_CHECK_ONLY',status:records.every(r=>r.status==='PASS')?'OFFLINE_CHECKS_PASSED':'OFFLINE_CHECKS_FAILED',decisionReady:false,executionReady:false,pnlReady:false,liveAcceptance:false,node:process.version,platform:process.platform,commit:git.status===0?git.stdout.trim():null,dirty:dirty.status===0?Boolean(dirty.stdout.trim()):null,sourceHashes,generatedAt:new Date().toISOString(),counts:{modules:modules.length,testFiles:tests.length,passed:records.filter(r=>r.status==='PASS').length,failed:records.filter(r=>r.status==='FAIL').length,blocked:records.filter(r=>r.status==='BLOCKED').length},records};
 const dir=join(root,'data','acceptance');await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,'offline-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,counts:report.counts,report:relative(root,path),liveAcceptance:false},null,2));if(report.status!=='OFFLINE_CHECKS_PASSED')process.exitCode=1;
}
main().catch(e=>{console.error('Offline checks blocked: '+e.message);process.exitCode=1});

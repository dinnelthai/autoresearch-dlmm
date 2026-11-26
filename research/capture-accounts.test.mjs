// Transport/archival tests only. Fixtures are NOT Solana data or Gate A evidence.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const pool='6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb';
const owner='11111111111111111111111111111111';
const script=fileURLToPath(new URL('./capture-accounts.mjs',import.meta.url));
const account={owner,data:['AA==','base64']};
const valid={jsonrpc:'2.0',id:1,result:{context:{slot:123},value:[account]}};
const cases=[
 ['present',200,valid,'CAPTURED_UNVERIFIED',0],
 ['missing',200,{...valid,result:{...valid.result,value:[null]}},'PARTIAL',1],
 ['rpc-error',200,{jsonrpc:'2.0',id:1,error:{code:-32000,message:'test-only'}},'BLOCKED',1],
 ['wrong-id',200,{...valid,id:2},'BLOCKED',1],
 ['malformed-data',200,{...valid,result:{...valid.result,value:[{...account,data:['not base64','base64']}]}},'BLOCKED',1],
 ['http-error',429,{},'BLOCKED',1],
];
for(const [name,httpStatus,payload,status,exit] of cases){
 const cwd=await mkdtemp(join(tmpdir(),'dlmm-capture-test-'));
 let request;
 const body=JSON.stringify(payload);
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;request=JSON.parse(raw);res.writeHead(httpStatus,{'content-type':'application/json'});res.end(body);});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,'--pool',pool,'--provider','fixture-test'],{cwd,env:{...process.env,SOLANA_RPC_URL:'http://127.0.0.1:'+server.address().port+'/test-secret'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});
  assert.equal(result.code,exit,name);assert.equal(request.method,'getMultipleAccounts');assert.deepEqual(request.params,[[pool],{encoding:'base64',commitment:'finalized'}]);
  const report=JSON.parse(result.stdout);assert.equal(report.status,status,name);
  const manifestText=await readFile(join(cwd,report.directory,'manifest.json'),'utf8');const manifest=JSON.parse(manifestText);assert.equal(manifest.status,status);assert.ok(!manifestText.includes('test-secret'));
  if(status==='BLOCKED'){assert.ok(manifest.failureStage);assert.equal(manifest.raw,undefined);}
  else{assert.equal(manifest.contextSlot,123);const raw=await readFile(join(cwd,report.directory,'accounts.json'));assert.equal(raw.toString('utf8'),body);assert.equal(manifest.raw.sha256,createHash('sha256').update(raw).digest('hex'));}
  console.log('PASS '+name);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(cwd,{recursive:true,force:true});}
}
console.log('6 CLI fixture cases passed; live RPC acceptance remains separate.');

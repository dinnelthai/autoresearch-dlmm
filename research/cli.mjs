import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {Engine} from './engine.mjs';
import {IntegerKernel} from './integer.mjs';
const [command='help',file,mode='adaptive']=process.argv.slice(2);
const defaultRequest={entry:'holding',pool:'DEMO_POOL',sol:5,meme:50000,initialPrice:.0001,goal:'balanced'};
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function output(value,manifest){console.log(JSON.stringify({manifest,...value},null,2));}
try{
 if(command==='help'){console.log('node research/cli.mjs demo [range|up|down|crash]\nnode research/cli.mjs analyze|compare|run DATASET.json [adaptive|manual|spot|curve|bid_ask|hybrid|asymmetric|hodl]\nnode research/cli.mjs shadow REQUEST.json < events.ndjson\nnode research/cli.mjs opportunities DATASET.json\nnode research/cli.mjs suite\nnode research/cli.mjs evaluate SAMPLES.json');}
 else if(command==='reconcile'){console.log(IntegerKernel.stringify(IntegerKernel.reconcile(read(file))));}
 else if(command==='suite'){output(Engine.scenarioSuite(defaultRequest),{source:"SYNTHETIC_DEMO",calibrated:false,protocolExact:false});}
 else if(command==='evaluate'){const d=read(file);output(Engine.evaluateSamples(d.samples,d.config||{}),{source:"IMPORTED_UNVERIFIED",datasetSha256:hash(d),calibrated:false,protocolExact:false});}
 else if(command==='shadow'){
   const d=read(file),s=Engine.createSession(d.request,d.config||{},d.mode||'adaptive');
   for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){if(!line.trim())continue;const e=JSON.parse(line);if(e.type==='ACTION')s.action(e.action,e.options||{});else s.push(e);console.log(JSON.stringify({source:'UNVERIFIED_EVENT_STREAM',snapshot:s.snapshot()}));}
 } else {
   const d=command==='demo'?{request:defaultRequest,events:Engine.demo(file||'range'),config:{}}:read(file);
   const manifest={engine:'offline-v1',source:command==='demo'?'SYNTHETIC_DEMO':'IMPORTED_UNVERIFIED',datasetSha256:hash(d),eventCount:d.events?.length??null,calibrated:false,protocolExact:false};
   if(command==='analyze')output(Engine.analyzeRequest(d.request,d.asof?d.events.slice(0,d.asof):d.events,d.config||{}),manifest);
   else if(command==='compare'||command==='demo')output(Engine.compare(d.request,d.events,d.config||{}),manifest);
   else if(command==='run')output(Engine.run(d.request,d.events,d.config||{},mode,d.manual||[]),manifest);
   else if(command==='opportunities')output({opportunities:Engine.opportunities(d.pools||[{id:d.request.pool,events:d.events}],d.config||{})},manifest);
   else throw Error('Unknown command');
 }
}catch(e){console.error(e.message);process.exitCode=1;}

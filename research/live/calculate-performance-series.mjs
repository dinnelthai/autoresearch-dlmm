// T16 B: recompute from original input files, not previously exported diagnostic totals.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {loadPerformanceWindow} from './performance-input.mjs';
import {calculateSeries} from './performance-series.mjs';
const assert=(v,m)=>{if(!v)throw Error(m)};
async function main(){
 const {values}=parseArgs({options:{input:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/calculate-performance-series.mjs --input data/performance-series.json');return}
 const root=await realpath(resolve('data')),p=await realpath(resolve(values.input)),rel=relative(root,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'PERF_DATA_PATH_REQUIRED');
 const b=await readFile(p);assert(b.length<=32768,'SERIES_FILE_TOO_LARGE');const cfg=JSON.parse(b);
 assert(cfg.schemaVersion===1&&cfg.scope==='EXISTING_POSITION_SERIES_RETAIN_DISTRIBUTIONS'&&Array.isArray(cfg.windows)&&cfg.windows.length>=1&&cfg.windows.length<=100,'SERIES_INPUT_REQUIRED');
 const windows=[];for(const path of cfg.windows)windows.push(await loadPerformanceWindow(path));
 const seriesHash=createHash('sha256').update(JSON.stringify({configHash:createHash('sha256').update(b).digest('hex'),windows:windows.map(w=>w.bindings)})).digest('hex');
 const result=calculateSeries({windows,maxIntervalSeconds:cfg.maxIntervalSeconds,seriesHash});console.log(JSON.stringify(result,null,2));if(result.status==='BLOCKED')process.exitCode=1;
}
main().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'SERIES_INPUT_FAILED',decisionReady:false,executionReady:false,pnlReady:false}));process.exitCode=1});

// T16 offline existing-position window diagnostic, not accepted live PnL.
import {loadPerformanceWindow} from './performance-input.mjs';
import {parseArgs} from 'node:util';
import {calculateWindow} from './performance-core.mjs';
async function main(){
 const {values}=parseArgs({options:{input:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node research/live/calculate-performance.mjs --input data/performance-window.json');return}
 const result=calculateWindow(await loadPerformanceWindow(values.input));
 console.log(JSON.stringify(result,null,2));if(result.status==='BLOCKED')process.exitCode=1;
}
main().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'PERF_INPUT_FAILED',decisionReady:false,executionReady:false,pnlReady:false}));process.exitCode=1});

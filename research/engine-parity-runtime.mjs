// Diagnose frozen fingerprints against the original implementation on the same runtime.
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {Engine} from './engine.mjs';
const baseline='5dc94379869fe3dbb28bbaa88222f2f68ed5d479';
const path='research/engine.mjs';
const source=execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'});
const blob=execFileSync('git',['hash-object','--stdin'],{input:source,encoding:'utf8'}).trim();
if(blob!=='2da429e85e32abb54dfd9d2705a6654304d652b6')throw Error('Unexpected baseline blob');
const {Engine:original}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const requests=[{entry:'holding',meme:50000,sol:5,initialPrice:.0001},{entry:'sol',meme:0,sol:10,initialPrice:.0001},{entry:'position',meme:1000,sol:5,initialPrice:.0001,positionBins:[{id:-1,x:0,y:1},{id:1,x:5000,y:0}],pendingFeeX:1,pendingFeeY:.001}];
function fingerprint(x){const s=JSON.stringify(x);let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return {length:s.length,fnv1a:(h>>>0).toString(16).padStart(8,'0')}}
function firstDiff(a,b,path='$'){
 if(Object.is(a,b))return null;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return {path,baseline:a,current:b};
 const ak=Object.keys(a),bk=Object.keys(b);if(!isDeepStrictEqual(ak,bk))return {path,baselineKeys:ak,currentKeys:bk};
 for(const k of ak){const d=firstDiff(a[k],b[k],path+'.'+k);if(d)return d}
 return null;
}
let failed=0;
for(const kind of ['range','up','down','crash'])for(const req of requests){
 const config={executionDelaySeconds:0,forecastSteps:4};
 const a=original.compare(structuredClone(req),original.demo(kind),config);
 const b=Engine.compare(structuredClone(req),Engine.demo(kind),config);
 const equal=JSON.stringify(a)===JSON.stringify(b)&&isDeepStrictEqual(a,b);
 if(!equal)failed++;
 console.log(JSON.stringify({kind,entry:req.entry,equal,baseline:fingerprint(a),current:fingerprint(b),firstDifference:equal?null:firstDiff(a,b)}));
}
console.log(JSON.stringify({baseline,blob,node:process.version,platform:process.platform,arch:process.arch,passed:12-failed,failed}));
if(failed)process.exitCode=1;

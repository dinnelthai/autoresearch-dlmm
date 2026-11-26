// Frozen output fingerprints from pre-refactor commit 5dc94379869fe3dbb28bbaa88222f2f68ed5d479; synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createResearchEngine} from './engine.mjs';
import {engineSourcePaths} from './engine-source-paths.mjs';
import {readFile,readdir} from 'node:fs/promises';
const requests=[{"entry":"holding","meme":50000,"sol":5,"initialPrice":0.0001},{"entry":"sol","meme":0,"sol":10,"initialPrice":0.0001},{"entry":"position","meme":1000,"sol":5,"initialPrice":0.0001,"positionBins":[{"id":-1,"x":0,"y":1},{"id":1,"x":5000,"y":0}],"pendingFeeX":1,"pendingFeeY":0.001}];
const fixtures=[
  {
    "kind": "range",
    "entry": "holding",
    "expected": {
      "length": 417812,
      "fnv1a": "be39574c"
    }
  },
  {
    "kind": "range",
    "entry": "sol",
    "expected": {
      "length": 466291,
      "fnv1a": "2a57ebe9"
    }
  },
  {
    "kind": "range",
    "entry": "position",
    "expected": {
      "length": 455258,
      "fnv1a": "3516b41a"
    }
  },
  {
    "kind": "up",
    "entry": "holding",
    "expected": {
      "length": 268729,
      "fnv1a": "c148e236"
    }
  },
  {
    "kind": "up",
    "entry": "sol",
    "expected": {
      "length": 287730,
      "fnv1a": "7f8745a9"
    }
  },
  {
    "kind": "up",
    "entry": "position",
    "expected": {
      "length": 289111,
      "fnv1a": "61209e4b"
    }
  },
  {
    "kind": "down",
    "entry": "holding",
    "expected": {
      "length": 286543,
      "fnv1a": "deaf9119"
    }
  },
  {
    "kind": "down",
    "entry": "sol",
    "expected": {
      "length": 305913,
      "fnv1a": "f29a9cc5"
    }
  },
  {
    "kind": "down",
    "entry": "position",
    "expected": {
      "length": 294892,
      "fnv1a": "0fbb235c"
    }
  },
  {
    "kind": "crash",
    "entry": "holding",
    "expected": {
      "length": 262842,
      "fnv1a": "df9afbf0"
    }
  },
  {
    "kind": "crash",
    "entry": "sol",
    "expected": {
      "length": 244835,
      "fnv1a": "101e9c6c"
    }
  },
  {
    "kind": "crash",
    "entry": "position",
    "expected": {
      "length": 264680,
      "fnv1a": "4ff74cb0"
    }
  }
];
function fingerprint(x){const s=JSON.stringify(x);let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return {length:s.length,fnv1a:(h>>>0).toString(16).padStart(8,'0')}}
for(const f of fixtures)test('engine output parity '+f.kind+' '+f.entry,()=>{const req=requests.find(x=>x.entry===f.entry);assert.deepEqual(fingerprint(Engine.compare(req,Engine.demo(f.kind),{executionDelaySeconds:0,forecastSteps:4})),f.expected)});
test('facade shape and source inventory',async()=>{const a=createResearchEngine(),b=createResearchEngine();assert.notEqual(a,b);assert.deepEqual(Object.keys(a),["DEFAULTS","config","requestConfig","candidatePlans","compareWithHold","price","binId","cvar","newState","balances","nav","hodl","reportAt","reference","classify","risk","exitExposure","bidCap","weights","planBins","applyAction","swap","event","submit","executePending","forecast","evaluate","decide","liquidation","run","compare","demo","opportunities","createSession","analyzeRequest","evaluateSamples","scenarioSuite"]);assert.ok(Object.isFrozen(a.DEFAULTS));const files=(await readdir(new URL('./engine/',import.meta.url))).filter(x=>x.endsWith('.mjs')).sort();assert.deepEqual(engineSourcePaths.filter(x=>x.startsWith('research/engine/')).map(x=>x.split('/').at(-1)).sort(),files);for(const p of engineSourcePaths)assert.ok((await readFile(new URL('../'+p,import.meta.url))).length)});

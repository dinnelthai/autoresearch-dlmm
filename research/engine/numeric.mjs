// Extracted from the offline research engine; calculations unchanged.

const EPS=1e-9, clone=o=>JSON.parse(JSON.stringify(o)), sum=a=>a.reduce((s,v)=>s+v,0), clip=(x,l,h)=>Math.min(h,Math.max(l,x));
const DEFAULTS=Object.freeze({binStepBps:100,anchorPrice:0.0001,maxInventoryRatio:.65,maxInventoryTokens:200000,minSolReserve:1,maxLossSol:6,stressDrop:.6,maxBinShare:.1,lambda:.5,kappaSol:.2,targetRatio:.45,beta:.95,minImprovementSol:.005,uncertaintySol:.005,operationCostSol:.002,cooldownSeconds:120,executionDelaySeconds:10,maxRebalances:8,maxTurnoverSol:30,maxReferenceAge:120,maxReferenceDivergence:.05,minDepthSol:2,maxHolderShare:.55,minFlowSol:1,markoutSeconds:30,forecastSteps:8,forecastHorizonSeconds:480,feeBps:30,protocolShare:.05,slippageBps:50,referencePrice:0.0001});
const assert=(b,m)=>{if(!b)throw Error(m)};
const finite=(v,n,min=0,max=Infinity)=>{assert(typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max,n+" invalid");return v};
function config(overrides={}) {
  for(const k of Object.keys(overrides))assert(k in DEFAULTS,"Unknown parameter "+k);
  const c={...DEFAULTS,...overrides};
  for(const [k,v] of Object.entries(c))finite(v,k);
  for(const k of ["maxInventoryRatio","stressDrop","maxBinShare","targetRatio","beta","maxReferenceDivergence","maxHolderShare","protocolShare"])finite(c[k],k,0,1);
  assert(c.beta<1&&c.maxBinShare>0&&c.binStepBps>0&&c.anchorPrice>0&&c.referencePrice>0&&c.feeBps<10000&&c.slippageBps<10000&&c.forecastSteps>=2&&Number.isInteger(c.forecastSteps)&&c.forecastSteps<=100&&c.forecastHorizonSeconds>0&&Number.isInteger(c.maxRebalances),"invalid config domain");
  return c;
}
function price(c,id){assert(Number.isInteger(id),"bin id must be integer");let p=c.anchorPrice*Math.pow(1+c.binStepBps/10000,id);return finite(p,"bin price",Number.MIN_VALUE);}
function binId(c,p){return Math.round(Math.log(finite(p,"price",Number.MIN_VALUE)/c.anchorPrice)/Math.log(1+c.binStepBps/10000))}
function cvar(losses,beta){assert(losses.length>0,"empty loss sample");finite(beta,"beta",0,1);assert(beta<1&&losses.every(v=>Number.isFinite(v)&&v>=0),"invalid loss sample");const a=losses.slice().sort((x,y)=>y-x),mass=a.length*(1-beta);let s=0;for(let i=0;i<a.length&&i<mass;i++)s+=a[i]*Math.min(1,mass-i);return s/mass}
function requestConfig(request,overrides={}){
  const goals={defensive:{lambda:1,kappaSol:.3,targetRatio:.25},balanced:{},growth:{lambda:.25,kappaSol:.4,targetRatio:.65}};assert(Object.hasOwn(goals,request.goal??"balanced"),"invalid goal");
  return config({...goals[request.goal??"balanced"],...(request.horizonSeconds!=null?{forecastHorizonSeconds:finite(request.horizonSeconds,"horizon",1)}:{}),...overrides});
}
export {EPS,clone,sum,clip,DEFAULTS,assert,finite,config,price,binId,cvar,requestConfig};

// Only decision preferences can be searched; capital, fees, risk limits and market facts stay fixed.
const TUNING_KEYS=['lambda','kappaSol','targetRatio','minImprovementSol','uncertaintySol','cooldownSeconds'];
export function strategyTuning(overrides={}){
 assert(overrides&&typeof overrides==='object'&&!Array.isArray(overrides)&&Object.keys(overrides).every(k=>TUNING_KEYS.includes(k)),'invalid strategy tuning keys');
 for(const [k,v] of Object.entries(overrides)){finite(v,k,k==='cooldownSeconds'?15:0,k==='targetRatio'?1:k==='cooldownSeconds'?86400:100);if(k==='cooldownSeconds')assert(Number.isInteger(v),'integer cooldown required')}
 return {...overrides};
}

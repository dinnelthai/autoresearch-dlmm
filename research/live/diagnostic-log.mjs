// Structured diagnostic events: never include URLs, request bodies, raw errors or child stderr.
const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(v)?v:'UNCLASSIFIED';
export function diagnosticEvent({component,event,status,reason,durationMs,requestId,stream,script}){
 const safe=(v,re)=>typeof v==='string'&&re.test(v)?v:null;
 return {schemaVersion:1,at:new Date().toISOString(),component:code(component),event:code(event),status:code(status),reason:reason==null?null:code(reason),durationMs:Number.isSafeInteger(durationMs)&&durationMs>=0?durationMs:null,requestId:safe(requestId,/^[a-f0-9-]{36}$/),stream:safe(stream,/^(market|references|position:[1-9A-HJ-NP-Za-km-z]{32,44}|history:[1-9A-HJ-NP-Za-km-z]{32,44})$/),script:safe(script,/^[a-z0-9-]{1,60}\.mjs$/)};
}
const recent=[];
export function diagnosticRecent(){return recent.slice()}
export function diagnosticLog(x){const e=diagnosticEvent(x);recent.push(e);if(recent.length>500)recent.shift();console.log(JSON.stringify(e))}

// Bounded independent research services. No pooled capital, signing or execution.
import {assert,poolAddress,errorCode} from './research-contract.mjs';
import {paperStatus,paperEnvelope} from './paper-auto-core.mjs';
export function paperPoolConfig(primary,additional,reviews={}){
 assert(poolAddress(primary)&&Array.isArray(additional)&&additional.length<=8&&additional.every(poolAddress)&&new Set([primary,...additional]).size===additional.length+1,'PAPER_POOL_CONFIG');
 assert(reviews&&typeof reviews==='object'&&!Array.isArray(reviews)&&Object.keys(reviews).every(p=>additional.includes(p))&&Object.values(reviews).every(p=>typeof p==='string'&&p.startsWith('data/')&&p.length<=1024)&&new Set(Object.values(reviews)).size===Object.keys(reviews).length,'PAPER_POOL_REVIEW_CONFIG');
 return [primary,...additional].map(pool=>({pool,review:pool===primary?null:reviews[pool]??null}));
}
export function createPaperPoolManager({entries,makeService,intervalMs=15000,concurrency=2}){
 assert(Array.isArray(entries)&&entries.length>0&&entries.length<=9&&Number.isSafeInteger(concurrency)&&concurrency>=1&&concurrency<=2,'PAPER_POOL_MANAGER_CONFIG');
 const services=new Map(entries.map(e=>[e.pool,makeService(e)]));assert(services.size===entries.length,'PAPER_POOL_DUPLICATE');
 let timer=null,flight=null,closed=false;
 const service=pool=>{assert(services.has(pool),'PAPER_POOL_NOT_CONFIGURED');return services.get(pool)};
 const blocked=(pool,e)=>paperStatus(pool,'BLOCKED',{reason:errorCode(e,'PAPER_POOL_STATUS_UNAVAILABLE'),running:null});
 async function list(){const pools=[];for(const [pool,s] of services){try{pools.push(await s.get(pool))}catch(e){pools.push(blocked(pool,e))}}return {...paperEnvelope,scope:'PAPER_MULTI_POOL_RESEARCH_ONLY',pools}}
 async function tick(){
  if(closed||flight)return;
  const queue=[...services.values()];let cursor=0;
  const worker=async()=>{while(!closed&&cursor<queue.length){const s=queue[cursor++];try{await s.tick()}catch{}}};
  const task=Promise.all(Array.from({length:Math.min(concurrency,queue.length)},worker));flight=task;
  try{await task}finally{if(flight===task)flight=null}
 }
 function startScheduler(){if(closed||timer)return;timer=setInterval(()=>{void tick()},intervalMs);void tick()}
 async function stop(){closed=true;if(timer)clearInterval(timer);timer=null;await Promise.all([...services.values()].map(s=>s.stop()));if(flight)await flight}
 return {get:pool=>service(pool).get(pool),context:pool=>service(pool).context(pool),start:body=>{assert(body?.draft?.pool,'PAPER_POOL_REQUIRED');return service(body.draft.pool).start(body)},pause:body=>{assert(body?.pool,'PAPER_POOL_REQUIRED');return service(body.pool).pause(body)},list,tick,startScheduler,stop};
}

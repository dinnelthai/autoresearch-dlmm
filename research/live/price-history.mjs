// Display-only market history, never used for research or execution decisions.
import {fetchIndexedJson} from './market-api.mjs';
function validateCandles(payload,now=Math.floor(Date.now()/1000)){
 if(!payload||payload.timeframe!=null&&payload.timeframe!=='1h'||!Array.isArray(payload.data)||payload.data.length>200)throw Error('INVALID_HISTORY');
 let previous=-1;
 return payload.data.map(({timestamp,open,high,low,close,volume})=>{
  if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp<=previous||timestamp>now+3600||![open,high,low,close,volume].every(Number.isFinite)||low<=0||volume<0||low>Math.min(open,close)||high<Math.max(open,close)||high<low)throw Error('INVALID_CANDLE');
  previous=timestamp;return {timestamp,open,high,low,close,volume};
 });
}
async function getPriceHistory(pool){
 const end=Math.floor(Date.now()/3600000)*3600,start=end-47*3600;
 const p=await fetchIndexedJson('/pools/'+pool+'/ohlcv?timeframe=1h&start_time='+start+'&end_time='+end);
 const candles=validateCandles(p);
 if(candles.some(c=>c.timestamp<start||c.timestamp>end))throw Error('HISTORY_WINDOW_MISMATCH');
 const missingIntervals=candles.slice(1).reduce((n,c,i)=>n+Math.max(0,Math.floor((c.timestamp-candles[i].timestamp)/3600)-1),0);
 return {pool,source:'Meteora DLMM Data API',scope:'INDEXED_DISPLAY_ONLY',priceUnit:'PROVIDER_UNIT_UNVERIFIED',timeframe:'1h',fetchedAt:Date.now(),startTime:start,endTime:end,missingIntervals,candles};
}
export {validateCandles,getPriceHistory};

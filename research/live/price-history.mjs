// Display-only market history, never used for research or execution decisions.
function validateCandles(payload,now=Math.floor(Date.now()/1000)){
 if(payload?.timeframe!=='1h'||!Array.isArray(payload.data)||payload.data.length>200)throw Error('INVALID_HISTORY');
 let previous=-1;
 return payload.data.map(({timestamp,open,high,low,close,volume})=>{
  if(!Number.isSafeInteger(timestamp)||timestamp<=previous||timestamp>now+3600||![open,high,low,close,volume].every(Number.isFinite)||low<=0||volume<0||low>Math.min(open,close)||high<Math.max(open,close)||high<low)throw Error('INVALID_CANDLE');
  previous=timestamp;return {timestamp,open,high,low,close,volume};
 });
}
async function getPriceHistory(pool){
 const url='https://dlmm.datapi.meteora.ag/pools/'+encodeURIComponent(pool)+'/ohlcv?timeframe=1h';
 const res=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error'});if(!res.ok)throw Error('HISTORY_HTTP_ERROR');
 const bytes=await res.arrayBuffer();if(bytes.byteLength>256*1024)throw Error('HISTORY_TOO_LARGE');
 const candles=validateCandles(JSON.parse(new TextDecoder().decode(bytes)));
 return {pool,source:'Meteora DLMM Data API',timeframe:'1h',fetchedAt:Date.now(),candles};
}
export {validateCandles,getPriceHistory};

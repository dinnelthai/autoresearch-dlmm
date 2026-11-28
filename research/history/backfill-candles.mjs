// Indexed candles are price/volume research only, not LP accounting inputs.
import {mkdir,writeFile,readFile,rename,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {fetchIndexedJson} from '../live/market-api.mjs';
import {windows,auditCandles} from './core.mjs';
const {values:v}=parseArgs({options:{pool:{type:'string'},start:{type:'string'},end:{type:'string'}}});
const date=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s??''))throw Error('DATE_INVALID');const n=Date.parse(s)/1000;if(!Number.isSafeInteger(n)||new Date(n*1000).toISOString().slice(0,10)!==s)throw Error('DATE_INVALID');return n;};
const start=date(v.start),end=date(v.end);
if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.pool??'')||end>Math.floor(Date.now()/3600000)*3600)throw Error('usage: --pool ADDRESS --start YYYY-MM-DD --end YYYY-MM-DD');
const dir=fileURLToPath(new URL('../../data/historical/'+v.pool+'/candles-'+v.start+'-'+v.end+'/',import.meta.url));
await mkdir(dir,{recursive:true,mode:0o700});
const lock=join(dir,'run.lock'),handle=await open(lock,'wx',0o600);
const atomic=async(path,body)=>{await writeFile(path+'.tmp',body,{mode:0o600});await rename(path+'.tmp',path);};
const sha=s=>createHash('sha256').update(s).digest('hex');
const report={pool:v.pool,source:'Meteora DLMM Data API',scope:'INDEXED_PRICE_VOLUME_ONLY',priceUnit:'PROVIDER_UNIT_UNVERIFIED',timeframe:'1h',start,end,windows:[],missing:[],rows:0,historyComplete:false};
try{
 for(const w of windows(start,end)){
  const file='window-'+w.start+'.json',path=join(dir,file);
  let evidence;
  try{evidence=JSON.parse(await readFile(path,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;
   const request='/pools/'+v.pool+'/ohlcv?timeframe=1h&start_time='+w.start+'&end_time='+w.end;
   const payload=await fetchIndexedJson(request);
   evidence={request,fetchedAt:new Date().toISOString(),payload,sha256:sha(JSON.stringify(payload))};
   auditCandles(payload,w);await atomic(path,JSON.stringify(evidence)+'\n');
  }
  if(evidence.request!=='/pools/'+v.pool+'/ohlcv?timeframe=1h&start_time='+w.start+'&end_time='+w.end||evidence.sha256!==sha(JSON.stringify(evidence.payload)))throw Error('EVIDENCE_MISMATCH');
  const a=auditCandles(evidence.payload,w);
  report.windows.push({file,...w,rows:a.rows.length,sha256:evidence.sha256});report.rows+=a.rows.length;report.missing.push(...a.missing);
 }
 report.status=report.missing.length?'MISSING_INTERVALS':'REQUESTED_HOURLY_BUCKETS_PRESENT';
 await atomic(join(dir,'manifest.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({directory:dir,status:report.status,rows:report.rows,missing:report.missing.length,historyComplete:false}));
}finally{await handle.close();await unlink(lock);}

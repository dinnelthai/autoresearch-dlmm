import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCandles} from './price-history.mjs';
test('validates real OHLCV shape and rejects invalid or out-of-order candles',()=>{
 const now=1800000000, row={timestamp:now-3600,open:1,high:2,low:0.5,close:1.5,volume:4};
 assert.deepEqual(validateCandles({timeframe:'1h',data:[row]},now),[row]);
 assert.throws(()=>validateCandles({timeframe:'1h',data:[row,{...row}]},now));
 assert.throws(()=>validateCandles({timeframe:'1h',data:[{...row,high:0.1}]},now));
 assert.throws(()=>validateCandles({timeframe:'1h',data:[{...row,timestamp:now+3601}]},now));
 assert.throws(()=>validateCandles({timeframe:'5m',data:[row]},now));
});

test('official optional timeframe field is accepted',()=>{const now=1800000000,row={timestamp:now,open:1,high:2,low:1,close:2,volume:0};assert.deepEqual(validateCandles({data:[row]},now),[row])});

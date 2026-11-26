// Verify address-index evidence separately from transaction/block contents.
const assert=(v,m)=>{if(!v)throw Error(m)},sig=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v);
export function verifyIndexPages(manifest,pages){
 assert(manifest&&manifest.indexAddress===(manifest.position??manifest.pool)&&Number.isInteger(manifest.pagesRequested)&&manifest.pagesRequested>=1&&manifest.pagesRequested<=20&&Number.isInteger(manifest.pageLimit)&&manifest.pageLimit>=1&&manifest.pageLimit<=1000&&(manifest.before===null||sig(manifest.before))&&Array.isArray(manifest.signatures)&&Array.isArray(pages)&&pages.length>=1&&pages.length<=manifest.pagesRequested,'HISTORY_INDEX_MANIFEST_INVALID');
 let cursor=manifest.before,previousSlot=Infinity;const observed=[],seen=new Set();
 for(let i=0;i<pages.length;i++){
  const {file,request,rows}=pages[i],cfg=request?.params?.[1];
  assert(file==='signatures-'+i+'.json'&&request.method==='getSignaturesForAddress'&&request.params.length===2&&request.params[0]===manifest.indexAddress&&cfg?.commitment==='finalized'&&cfg.limit===manifest.pageLimit&&(cfg.before??null)===cursor&&Object.keys(cfg).every(k=>['commitment','limit','before'].includes(k)),'HISTORY_INDEX_REQUEST_MISMATCH');
  assert(Array.isArray(rows)&&rows.length<=manifest.pageLimit&&(i===pages.length-1||rows.length===manifest.pageLimit),'HISTORY_INDEX_PAGE_INVALID');
  for(const row of rows){assert(sig(row?.signature)&&!seen.has(row.signature)&&row.signature!==cursor&&Number.isSafeInteger(row.slot)&&row.slot>=0&&row.slot<=previousSlot&&Object.hasOwn(row,'err')&&Object.hasOwn(row,'blockTime'),'HISTORY_INDEX_ROW_INVALID');seen.add(row.signature);previousSlot=row.slot;observed.push({signature:row.signature,slot:row.slot,err:row.err,blockTime:row.blockTime})}
  if(rows.length)cursor=rows.at(-1).signature;
 }
 assert(JSON.stringify(observed)===JSON.stringify(manifest.signatures.map(x=>({signature:x.signature,slot:x.slot,err:x.err,blockTime:x.blockTime})))&&manifest.nextBefore===cursor,'HISTORY_INDEX_ROWS_MISMATCH');
 return {pages:pages.length,signatures:observed.length,coverageVerified:false};
}

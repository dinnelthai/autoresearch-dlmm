// Fixed, immutable-at-startup frontend assets. Never resolve arbitrary request paths.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const terminalScriptNames=Object.freeze(["state.js","dom.js","api.js","session.js","strategy.js","navigation.js","position.js","shadow.js","scope.js","research.js","market.js","strategy-report.js","market-state.js","strategy-request.js","monitor.js","wallet.js","wallet-position.js","external.js","review.js","performance.js","app.js"]);
export const terminalAssetNames=Object.freeze(['terminal.css',...terminalScriptNames]);
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function loadTerminalAssets(root){
 const dir=join(root,'research','live','terminal-assets'),assets=new Map(),hashes=[];
 for(const name of terminalAssetNames){
  const bytes=await readFile(join(dir,name));if(bytes.length===0||bytes.length>512*1024)throw Error('TERMINAL_ASSET_SIZE');
  assets.set('/assets/'+name,{bytes,type:name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});
  hashes.push({name,sha256:sha(bytes)});
 }
 return {assets,assetHash:sha(JSON.stringify(hashes)),hashes};
}
export function terminalScriptSource(assets){return terminalScriptNames.map(n=>assets.get('/assets/'+n).bytes.toString('utf8')).join('\n')}
export function verifyTerminalMarkup(html,script){
 const links=[...html.matchAll(/<script defer src="\/assets\/([^"]+)"><\/script>/g)].map(x=>x[1]);
 if(JSON.stringify(links)!==JSON.stringify(terminalScriptNames)||[...html.matchAll(/<script\b/g)].length!==links.length||!html.includes('<link rel="stylesheet" href="/assets/terminal.css">'))throw Error('TERMINAL_ASSET_MARKUP');
 new Function(script);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),refs=[...script.matchAll(/\$\('([^']+)'\)/g)].map(x=>x[1]);
 if(ids.length!==new Set(ids).size||refs.some(x=>!ids.includes(x)))throw Error('TERMINAL_DOM_IDS');
 return {ids:ids.length,scripts:links.length};
}

// Terminal infrastructure; explicit checkout roots, no business policy.
import {realpath,open} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
export const assert=(x,m)=>{if(!x)throw Error(m)},sha=x=>createHash('sha256').update(x).digest('hex');
export function createTerminalRuntime({ROOT,DATA}){
async function safeDataPath(path){const root=await realpath(DATA),p=await realpath(resolve(ROOT,path)),rel=relative(root,p);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'INVALID_DATA_PATH');return p}
async function boundedRead(path,limit){const h=await open(path,'r');try{const st=await h.stat();assert(st.isFile()&&st.size<=limit,'EVIDENCE_SIZE_EXCEEDED');const bytes=Buffer.alloc(st.size+1);let n=0;while(n<bytes.length){const r=await h.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}assert(n===st.size,'EVIDENCE_SIZE_CHANGED');return bytes.subarray(0,n)}finally{await h.close()}}
async function jsonBody(req){assert(req.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED');let size=0,parts=[];for await(const b of req){size+=b.length;assert(size<=32768,'BODY_TOO_LARGE');parts.push(b)}return JSON.parse(Buffer.concat(parts).toString('utf8'))}
function run(args,script='analyze-state.mjs',timeout=30000){return new Promise((ok,fail)=>{const p=spawn(process.execPath,[join(ROOT,'research/live',script),...args],{cwd:ROOT,stdio:['ignore','pipe','ignore']});let parts=[],size=0,failed=false;const timer=setTimeout(()=>{failed=true;p.kill('SIGKILL')},timeout);p.stdout.on('data',b=>{size+=b.length;if(size>8*1024*1024){failed=true;p.kill('SIGKILL')}else parts.push(b)});p.once('error',e=>{clearTimeout(timer);fail(e)});p.once('close',()=>{clearTimeout(timer);try{assert(!failed,'ANALYSIS_TIMEOUT_OR_SIZE');ok(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){fail(e)}})})}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}

 return {safeDataPath,boundedRead,jsonBody,run,send};
}

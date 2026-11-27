import {createHash} from 'node:crypto';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// One read and digest check for each artifact; callers choose the relevant byte limit.
export async function verifiedEvidence(read,path,digest,reason='EVIDENCE_HASH_MISMATCH'){
 if(typeof digest!=='string'||! /^[0-9a-f]{64}$/.test(digest))throw Error(reason);
 const bytes=await read(path);if(sha(bytes)!==digest)throw Error(reason);return bytes;
}

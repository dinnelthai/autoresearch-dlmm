import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditReport} from './sample-quality-core.mjs';
const file=process.argv[2];if(!file)throw Error('usage: node research/history/sample-quality.mjs DECODED_REPORT.json');
const bytes=await readFile(file);const report=JSON.parse(bytes);const result=auditReport(report);console.log(JSON.stringify({...result,inputSha256:createHash('sha256').update(bytes).digest('hex')},null,2));
if(result.status!=='BOUNDED_EVENTS_USABLE_FOR_SCHEMA_RESEARCH')process.exitCode=1;

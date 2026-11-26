import test from 'node:test';
import assert from 'node:assert/strict';
import {freezePaperWindow,paperWindowCapture,paperWindowExpired,finishPaperWindow} from './paper-window-core.mjs';
const w=freezePaperWindow(1000,7,60),proof=(a,b)=>({requestedAt:new Date(a).toISOString(),receivedAt:new Date(b).toISOString()});
test('window frozen and only post-deadline requested sample can end it',()=>{assert.equal(w.endAt,604801000);assert.equal(paperWindowCapture(w,proof(w.endAt-1,w.endAt+1)),'OBSERVATION');assert.equal(paperWindowCapture(w,proof(w.endAt,w.endAt+1000)),'ENDPOINT');assert.equal(paperWindowCapture(w,proof(w.endAt,w.endAt+60001)),'MISSED_ENDPOINT');assert.equal(paperWindowExpired(w,w.endAt+60001),true);assert.throws(()=>freezePaperWindow(1000,1,60));assert.equal(finishPaperWindow(w,'PAUSED',2000).status,'PAUSED')});

import test from 'node:test';
import assert from 'node:assert/strict';
import {freezePaperWindow,paperWindowCapture,paperWindowExpired,finishPaperWindow} from './paper-window-core.mjs';
const w=freezePaperWindow(1000,7,60),proof=(a,b)=>({requestedAt:new Date(a).toISOString(),receivedAt:new Date(b).toISOString()});
test('window frozen and only post-deadline requested sample can end it',()=>{assert.equal(w.endAt,604801000);assert.equal(paperWindowCapture(w,proof(w.endAt-1,w.endAt+1)),'OBSERVATION');assert.equal(paperWindowCapture(w,proof(w.endAt,w.endAt+1000)),'ENDPOINT');assert.equal(paperWindowCapture(w,proof(w.endAt,w.endAt+60001)),'MISSED_ENDPOINT');assert.equal(paperWindowExpired(w,w.endAt+60001),true);assert.equal(freezePaperWindow(1000,1,60).endAt,86401000);assert.throws(()=>freezePaperWindow(1000,0,60));assert.equal(finishPaperWindow(w,'PAUSED',2000).status,'PAUSED')});

test('short business smoke windows use the same endpoint rules',()=>{for(const seconds of [300,1800,3600,86400]){const s=freezePaperWindow(1000,seconds/86400,60);assert.equal(s.endAt,1000+seconds*1000);assert.equal(paperWindowCapture(s,proof(s.endAt,s.endAt+1000)),'ENDPOINT')}assert.throws(()=>freezePaperWindow(1000,31,60));assert.throws(()=>freezePaperWindow(1000,1/86400,60))});

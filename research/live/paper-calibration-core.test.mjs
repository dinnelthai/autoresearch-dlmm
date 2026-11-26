import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOpenSimulation} from './simulation-core.mjs';
import {calibratePaperOpening} from './paper-calibration-core.mjs';
function fixture(){
 const bins=[{binId:1,version:3,priceQ64Raw:'18446744073709551616',openOrderAmountRaw:'0',totalProcessingOrderAmountRaw:'0',processedOrderRemainingAmountRaw:'0',beforeX:'1000',beforeY:'0',afterX:'1100',afterY:'0',beforeSupply:'1000',supply:'1100',share:'100'}];
 const simulation=reconcileOpenSimulation({before:{memeRaw:'100',wsolRaw:'0',nativeRaw:'10000',vaultXRaw:'1000',vaultYRaw:'0'},after:{memeRaw:'0',wsolRaw:'0',nativeRaw:'8900',vaultXRaw:'1100',vaultYRaw:'0',positionRentRaw:'1000'},bins,expected:{amountXRaw:'100',amountYRaw:'0',rows:[{binId:1,memeRaw:'100',solRaw:'0'}]},feeRaw:'100',rentCapRaw:'1000',reserveRaw:'0',maxAmountErrorBps:0});
 return {simulation,bins,activeId:0,tolerance:{shareErrorBps:0,principalErrorBps:0,costErrorBps:0},declaredCostRaw:'100'};
}
test('matched local simulation is only a conditional sample, rent separate',()=>{const r=calibratePaperOpening(fixture());assert.equal(r.status,'LOCAL_OPEN_SAMPLE_WITHIN_TOLERANCE_UNVERIFIED');assert.equal(r.rows[0].share.differenceRaw,'0');assert.equal(r.rows[0].observedPathX.differenceRaw,'0');assert.equal(r.cost.positionRentRaw,'1000');assert.equal(r.calibrated,false);assert.equal(r.pnlReady,false)});
test('share mismatch, cost mismatch and unsupported order state cannot pass',()=>{const x=fixture();x.bins[0].supply='1099';x.bins[0].share='99';x.simulation.rows[0].principalXRaw='99';const r=calibratePaperOpening(x);assert.equal(r.status,'LOCAL_OPEN_SAMPLE_DISCREPANCIES');assert.equal(r.rows[0].share.differenceRaw,'1');const c=fixture();c.declaredCostRaw='0';assert.equal(calibratePaperOpening(c).status,'LOCAL_OPEN_SAMPLE_DISCREPANCIES');const o=fixture();o.bins[0].openOrderAmountRaw='1';assert.equal(calibratePaperOpening(o).rows[0].status,'PROXY_UNSUPPORTED')});
test('missing simulation evidence or tolerance and inconsistent raw amounts block',()=>{for(const mutate of [x=>x.simulation.status='SIMULATION_NOT_RUN',x=>x.tolerance.shareErrorBps=null,x=>x.bins[0].afterX='1101',x=>x.simulation.rows[0].principalXRaw='99']){const x=fixture();mutate(x);assert.equal(calibratePaperOpening(x).status,'BLOCKED')}});

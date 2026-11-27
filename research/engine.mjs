/* Offline normalized-event research engine. No RPC, wallet, or protocol-exact claim. */
import {DEFAULTS,config,requestConfig,price,binId,cvar} from './engine/numeric.mjs';
import {newState,balances,nav,hodl,reportAt} from './engine/accounting.mjs';
import {reference,classify,marketAdmission} from './engine/market.mjs';
import {risk,exitExposure,bidCap,liquidation} from './engine/risk.mjs';
import {weights,planBins,applyAction} from './engine/liquidity.mjs';
import {swap,event,submit,executePending} from './engine/events.mjs';
import {forecast} from './engine/forecast.mjs';
import {compareWithHold,evaluate} from './engine/evaluation.mjs';
import {candidatePlans,decide} from './engine/decision.mjs';
import {run,compare,createSession,analyzeRequest} from './engine/session.mjs';
import {demo,opportunities,evaluateSamples,scenarioSuite,optimizeSamples} from './engine/experiments.mjs';
// Stateless calculation modules share frozen defaults; each factory returns a new public facade.
function createResearchEngine(){
  return {DEFAULTS,config,requestConfig,candidatePlans,compareWithHold,price,binId,cvar,newState,balances,nav,hodl,reportAt,reference,classify,marketAdmission,risk,exitExposure,bidCap,weights,planBins,applyAction,swap,event,submit,executePending,forecast,evaluate,decide,liquidation,run,compare,demo,opportunities,createSession,analyzeRequest,evaluateSamples,scenarioSuite,optimizeSamples};
}
export const Engine=createResearchEngine();
export {createResearchEngine};

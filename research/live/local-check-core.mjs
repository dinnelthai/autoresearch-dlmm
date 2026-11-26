// Read-only local diagnostics. No readiness promotion.
export function classifyLocal({health,state,collector,input,pool,htmlHash,serverHash,now=Date.now()}){
 const checks=[],known=typeof pool==='string'&&pool.length>=32;
 const add=(id,ok,reason)=>checks.push({id,status:ok?'PASS':'BLOCKED',reason:ok?null:reason});
 add('terminal-version',known&&health?.status==='RUNNING'&&health.apiVersion==='flow-data-v8'&&health.pool===pool&&health.htmlHash===htmlHash&&health.serverHash===serverHash&&health.decisionReady===false&&health.executionReady===false,'TERMINAL_UNAVAILABLE_OR_STALE');
 add('collector',known&&collector?.pool===pool&&collector?.decisionReady===false,'COLLECTOR_UNAVAILABLE_OR_WRONG_POOL');
 const valid=known&&state?.pool===pool&&state?.decisionReady===false&&state.executionReady===false&&state.status==='CAPTURED_UNVERIFIED'&&Number.isSafeInteger(state.market?.slot)&&state.market.slot>=0&&Number.isSafeInteger(state.market?.expiresAt)&&state.market.expiresAt>now;
 add('market-snapshot',valid,'MARKET_UNAVAILABLE_OR_STALE');
 add('input-diagnostic',known&&input?.pool===pool&&input?.status==='DIAGNOSTIC_ONLY'&&input.modelInputReady===false&&input.decisionReady===false&&input.executionReady===false&&Array.isArray(input.tasks),'MODEL_INPUT_DIAGNOSTIC_UNAVAILABLE');
 return {status:checks.every(c=>c.status==='PASS')?'LOCAL_READ_CHECKS_PASSED':'LOCAL_READ_CHECKS_BLOCKED',checks,modelInputReady:false,decisionReady:false,executionReady:false,reviewGate:state?.reviewGate?.status??null,marketSlot:valid?state.market.slot:null};
}

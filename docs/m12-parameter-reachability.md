# M12 parameter reachability audit

Static audit of main 1741d12. Not a test pass or profitability claim.

| Parameters | Calculation path | Paper qualification |
|---|---|---|
| binStepBps, anchorPrice | numeric.price/binId, liquidity.planBins, forecast | derived from pool identity, not tuning |
| maxInventoryRatio, maxInventoryTokens, minSolReserve, maxLossSol, stressDrop | risk.risk/bidCap, liquidity.deploy | effective in candidate sizing and evaluation |
| maxBinShare | preview allocation, events.swap, paper remap | effective; observed-share proxy |
| lambda, kappaSol, targetRatio, beta | evaluation.evaluate | utility and CVaR; beta currently default |
| minImprovementSol, uncertaintySol | decision.selectByUtility, evaluation.compareWithHold | effective |
| operationCostSol | liquidity.applyAction, paper remap | modeled operation cost |
| cooldownSeconds, maxRebalances, maxTurnoverSol | paper reentryBlock, previewManagement, remap | effective |
| executionDelaySeconds | events.submit, updateAdaptiveSnapshot/adaptiveIntent | default, minimum one second in Paper |
| maxReferenceAge, maxReferenceDivergence, minDepthSol, maxHolderShare, minFlowSol | market.reference/fresh/classify | effective; reference age supplied by adapter |
| regimeLookback, regimeMinObservations, trendEfficiencyThreshold, trendLogReturnThreshold, stressLogReturnThreshold, holderOutflowThreshold | market.classify, observation retention | optional draft.marketModel overrides |
| markoutSeconds, toxicMarkoutBps, toxicMarkoutMinSamples | accounting.mature, market.classify | offline or synthetic fill path; observed-share Paper does not restore attributable fills/marks |
| forecastSteps, forecastHorizonSeconds | forecast.forecast | steps default, horizon request |
| feeBps, protocolShare | forecast.forecast | modeled fees; observed Paper ledger uses actual snapshot fee growth instead |
| slippageBps | liquidity.spot, risk.liquidation | hypothetical liquidation; no implicit spot trades in Paper |
| referencePrice | experiments.demo | offline fixture, not live pool reference |

39 defaults total. Static reachability is not sensitivity coverage. Do not tune market facts or fixture parameters. For Markout, retain explicit unavailable status rather than invent attributable fills. For all other parameters, run tests and report conditional output changes separately. Existing model still uses synthetic equal-weight scenarios and endpoint fill proxies.

## Main-flow acceptance
Run node research/live/verify-offline.mjs and the real-data steps in docs/codex-dynamic-main-flow.md. Record all failures and actual selected pool; no automatic pool selection. A no-deployment result is valid, but does not prove the opening/management execution chain; use offline fixtures for missing action cases.

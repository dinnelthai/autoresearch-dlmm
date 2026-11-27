# Offline Adaptive Inventory LP — business entry and model integration

Status: runnable offline research prototype. No RPC, API subscription, wallet, signing, transactions, or parameter calibration. Existing Python OHLCV engine remains unchanged and must not be treated as protocol PnL.

## Run

Requires Node.js 20+ (no npm dependencies).

- `node research/serve.mjs` then open http://127.0.0.1:8787
- `node research/test.mjs` — core and integration assertions.
- `node research/cli.mjs demo range > result.json`
- `node research/cli.mjs analyze dataset.json` — as-of analysis only; optional dataset.asof limits visible events.
- `node research/cli.mjs compare dataset.json`
- `node research/cli.mjs run dataset.json manual`
- `node research/cli.mjs shadow request.json < events.ndjson` — incremental offline input, not a connected live stream.
- `node research/cli.mjs opportunities dataset.json`

The browser terminal has five entrances: opportunities, LP plan, virtual position, experiment comparison, PnL review. All call the same research engine; it runs on localhost, no outbound request.

## Business contract

request: {entry: holding|sol|position, pool, sol, meme, initialPrice, goal: defensive|balanced|growth, horizonSeconds, allowDispose, positionBins?}. SOL/MEME are wallet balances, existing position bins are separate. All amounts in human units; initial pendingFeeX/Y optional. Price unit SOL/MEME. Goal presets are explicit illustrative assumptions, not calibrated. Default allows no discretionary inventory disposal. Manual disposal is an explicit simulated instruction.

Config: validated parameters; see Engine.DEFAULTS. Risk constraints include wallet SOL reserve, maximum MEME quantity/value share, worst stress loss, exit capacity, per-bin participation cap, rebalance count and turnover. Scenario CVaR uses five deterministic equally weighted scenarios; not an estimated market probability. Hybrid search includes 25 independent side-alpha combinations, fixed width and allocation candidates; finite candidate grid, not global optimization. Ask normalized quote-value weights convert by 1/P. Active bin split explicit.

## Normalized event input (not raw Solana data)

Dataset JSON: {request, config?, asof?, events, manual?}. Each event has unique id and monotonically ordered numeric t in seconds. Equal t preserves input order. Event types:

- MARKET: pool, references [{pool,price,depth,availableAt}], exitDepth, tokenSafe, holderShare, holderOutflow, buyImbalance, flowSol. Two distinct non-target reference pools required; stale/divergent references invalid. Depth fields SOL notionals.
- SWAP: bin integer, side LP_BUY or LP_SELL from LP perspective, baseQty gross modeled base traded before LP allocation, externalLiquiditySol or latest normalized pool snapshot; mmFeeX/mmFeeY ordinary LP fee amounts after protocol deductions, nonnegative. No fees inferred from OHLCV. Frozen-path fraction is own bin liquidity/(external+own); capped by actual inventory and share threshold. Skipped over-cap fills invalidate share-assumption status.
- POOL_STATE: bins [{id,externalLiquiditySol}]; LIQUIDITY_UPDATE: bin,externalLiquiditySol. These are normalized external liquidity inputs, not on-chain state reconstruction.
- REWARD: x/y explicitly allocated reward credits (synthetic; not a protocol entitlement calculator).
- Manual schedule: [{t,action:{type,...},options:{fail?,partial?,expiresAfterSeconds?}}]. Virtual action becomes due after configured delay; operation applies after the next observed event, not backdated. Failed operation may incur modeled fee. OPEN/ADD/REPOSITION require admission and risk checks; REMOVE_AND_HOLD retains inventory; DISPOSE separately models exit depth; partial disposal leaves unsold inventory. FUND/WITHDRAW are external matched flows; withdrawal cannot exceed matched benchmark inventory.

## Accounting and validation

M1: NAV = wallet + bin principal + pending fee/reward inventory, SOL mark. Alpha vs matched initial HODL = signed fills × (terminal reference − execution) + fees + rewards − explicit costs. Fair/adverse attribution splits that inventory contribution, not additional cash flows. Claim transfers pending amounts; fee recognized once. Rebalance releases old assets, pays modeled cost, redeploys remaining balances, counts turnover. No invented capital on position replacement.

M2: bid cap then exact candidate stress/quantity checks under normalized model; runtime breaches logged. No-LP can be correct. M3: independent Bid/Ask budgets, fixed grid, template and hybrid optimization. M4: feasible candidate expected Alpha minus absolute-loss CVaR and inventory penalty, marginal threshold vs baseline, cooldown, risk-based remove. Markout matures only with later valid independent observations. Snapshot/report status distinguishes stale reference, pending action, invalid share assumption. Static strategies make a fixed allocation at first eligible state, do not run the adaptive exit optimizer. They are comparators, not a safety guarantee. SOL hold is a hypothetical frictionless opportunity benchmark.

## Explicitly not complete

This is a floating-point normalized-event synthetic/frozen-path model. No Meteora version-pinned integer swap replay, exact share mint/burn and fee growth checkpoint reconciliation, Token-2022 transfer extensions, real route simulation, real network execution, historical raw acquisition or statistically calibrated forecasting. Dynamic fees must be supplied as normalized MM fees; forecast fee rate is a parameter assumption. Scenario forecast is deterministic, not probabilistically validated. No real simulated-income claim until Gate A–C (raw account, swap, actual position reconciliation) and model fidelity are validated. User's current goal is to implement offline business pathways; real-data adapter, protocol exactness and calibration remain explicit gates. The legacy Python engine is not wired into this one.

Source specifications: v0.2–v1.1 in docs. All outputs label fidelity. Sample results must not be used for funding decisions.

## Extended review

`node research/cli.mjs suite` runs four synthetic scenarios. `node research/cli.mjs evaluate SAMPLES.json` accepts `{samples:[{id,group,split,request,events}],config}`; groups cannot cross train/validation/test, and paired Adaptive minus Bid-Ask results are aggregated by declared group. No confidence interval or evidence of profitability is claimed for unverified data. There is no parameter training or selection. Data quality, true historical timestamp boundaries and independent grouping still require real data validation. The browser includes a four-scenario comparison action. Unknown market during warmup does not force withdrawal of a risk-compliant existing position; hard risks and invalid reference are separate decisions. Synthetic reward events apply only while an LP is active; allocation entitlement remains unverified.

## Safety review

Reference observations may include observedAt (defaults to availableAt for legacy normalized input); expiry is measured from observed time, not polling or receipt time. Invalid events are applied to a trial state and rejected atomically at the session boundary. Adaptive hard-risk checks run before normal cooldown, cancel pending exposure-increasing virtual actions, and request removal while preserving spot inventory. Capital-time and SOL-hour net return are reported as time-weighted estimates. This remains a floating-point normalized-event model.

## Integer snapshot verification (offline)

Run `node research/integer.test.mjs` and `node research/cli.mjs reconcile snapshot.json`. The snapshot is a decoded, same-boundary pool/position input with SDK commit, pool, position, slot, bins and optional expected totals. All raw amounts and Q64 fields are decimal integer strings; see integer.test.mjs for the fixture. Reconciliation status only means comparison with supplied expected values, not actual RPC verification. Formulas follow [SDK index.ts](https://github.com/MeteoraAg/dlmm-sdk/blob/1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1/ts-client/src/dlmm/index.ts) (position calculation), helpers/math.ts, helpers/fee.ts, helpers/bin.ts, and helpers/u64xu64_math.ts at the same commit. Ordinary MM input-fee bin quote refuses limit orders and Token-2022 extensions. No bin traversal, fee-growth write simulation, mint/burn or full counterfactual replay. The main business engine continues to consume normalized events, not this kernel's raw snapshot output. The candidate evaluator now runs the same delayed virtual execution path as replay; immediate allocation is a preview, not confirmed execution.

## Existing position entry: integer snapshot bridge

`node research/position-input.test.mjs` validates the bridge. `node research/cli.mjs position-analysis dataset.json` takes `{snapshot,request,events,config?,asof?}`. In browser Existing LP entry, paste either the existing normalized Bin array or a decoded integer snapshot object into the position input. The snapshot requires sdkCommit, pool, position, slot, asOf, tokenOrientation (`MEME_X_SOL_Y`), tokenExtensions:false, decimalsX, decimalsY:9, binStep (integer string), bins, optional expected. All event timestamps strictly after snapshot.asOf; absolute bin IDs expected; no duplicate principal/fee source. SDK raw amount arithmetic stays integer until conversion into the normalized replay; safe integer range enforced, and snapshot evidence remains unverified. This adapter explicitly does not support Token-2022 extensions yet and rejects inconsistent expected totals. See position-input.test.mjs for example.

## AutoResearch development round

`node research/cli.mjs optimize SAMPLES.json > optimization.json` uses the existing normalized-event engine. Supply at least two distinct train groups and two later validation groups with absolute event timestamps; test rows are not evaluated. Optional `optimizer.candidates` contains at most 15 decision-parameter overrides. The incumbent is the provided config, with one challenger selected on training and compared once on validation. The objective is normalized net alpha minus sampled drawdown penalty, with no increase in risk breaches. Costs are already included in alpha. A proposal is not a deployed or proven strategy. A new paper experiment can explicitly pass the proposed tuning through `policy.tuning` with Adaptive enabled; keep its timestamp later than the validation end. Never reuse validation results as an unbiased test or mix Python OHLCV and normalized-event PnL.

## Paper handoff

`node research/cli.mjs paper-next paper-request.json optimization.json` starts a fresh virtual experiment only when the imported optimizer output contains an accepted proposal. The request file contains `{draft,policy,port?}` (same draft and policy as paper-start; Adaptive must be enabled). The server requires a target pool included in validation, a capture requested strictly after the validation cutoff and after any previous experiment's last capture, and persists the proposal digest and tuning. No automatic wallet activity or assertion of proven performance. The imported result is a research hypothesis, not independently authenticated validation evidence. Automatic collected market inputs are explicitly paper-only proxies: receipt-time direct quotes and tested exit notionals, observed bounded swap sample (not full volume), top-holder net balance change (not sell flow) and mint-authority diagnostics (not comprehensive token safety). Three fresh model observations and two distinct reference pools are still required. 

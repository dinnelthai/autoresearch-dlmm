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

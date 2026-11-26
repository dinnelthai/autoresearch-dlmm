# Real-environment integration handoff (Codex)
Updated 2026-11-26. This is the only integration backlog. Implement in roadmap order; environment-blocked tests do not stop subsequent code authoring, but do block production enablement and downstream acceptance. Do not mark a check passed without actual evidence. No mock data, synthetic income, invented account addresses, or silent fallback. Test fixtures may only test software behavior and must be explicitly isolated. Do not store RPC URLs containing credentials, API keys, wallet secrets or signed transaction secrets in Git.
 
## Current blockers and later required checks
| ID | Task | State | Required environment / evidence |
|---|---|---|---|
| I01 | T01 raw Pool capture | BLOCKED: RPC DNS in chat environment | Real finalized RPC response, raw bytes, slot, SHA256, manifest |
| I02 | T02 SDK/IDL identity and mint/vault decoding | Code draft committed; dependencies and real runtime unverified | Install exact SDK version; validate program owner, token mints, decimals, vault mint/owner and extensions against real accounts |
| I03 | T03 BinArray/bitmap | Code draft committed; SDK install and actual account validation pending | Real pool arrays, coverage, SDK comparison, same-slot or explicitly separate snapshots |
| I04 | T04 swaps/fees | Capture and event inspection code draft; live reconciliation pending | Actual getTransaction/getBlock data, event order, raw amounts, fee and vault balance deltas; gaps |
| I05 | T05 Position ledger | Position index, snapshot and lifecycle event drafts; cash-flow reconciliation pending | Public or user-approved read-only positions; shares, principal, fee checkpoints and lifecycle receipts |
| I06 | T06 reference and exits | Direct DLMM quote capture draft; freshness/independence and live validation pending | Non-target pools, valid timestamps, depth and read-only executable quotes; missing data must reject decision |
| I07 | T07 live service | Polling orchestrator, local API and persistence drafts; recovery and live integration pending | Real subscriptions/polling, reconnect, backfill, persistence, fresh state, duplicate suppression |
| I08 | T08–T11 decision/shadow | T08 diagnostic bridge draft; T09–T11 pending | Real event adapter, independent references, risk constraints, comparable baselines, frozen test samples, costs and actual deviations |
| I09 | T12–T13 UI/monitoring | Standalone prototype committed; review pending | Actual read-only API, no fabricated values; stale/unknown/error states; human review |
| I10 | T14–T15 execution | Pending implementation | Test network or explicitly approved small funded trial; preview, simulation, explicit signer confirmation, confirmed receipts; no automatic signing |
| I11 | T16–T17 performance and end-to-end | Pending implementation | Actual net PnL and matched HODL, transaction costs, failure recovery, safety gates; no profitability guarantee |

## I01 commands (run in repository root on network-enabled machine)
```bash
git pull origin main
node research/capture-accounts.test.mjs
node research/capture-accounts.mjs --pool 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb
```
Optional: set SOLANA_RPC_URL via local environment to authorized RPC, not in command logs or Git. The sample pool is only a candidate; do not assume eligibility. Return sanitized manifest and raw public accounts.json under data/raw (gitignored). Verify capture hash and context slot. CAPTURED_UNVERIFIED is transport evidence only, not Gate A; check identities with pinned SDK next. Historical state cannot be inferred from current snapshot. If no data, record exact error stage and keep blocked. If real RPC lacks required history, report coverage and alternatives before any paid data purchase.

## Codex integration report format
For each Ixx: code commit, exact command, environment / SDK version (no secrets), input address and time/slot, expected result, observed result, artifact path/hash, PASS/FAIL/BLOCKED, remaining gap. Update this file after each result. Keep unrelated code and approved UI untouched. Never substitute research fixture results for live acceptance. Real transactions require explicit approval and user signing.

## Business workflow rule
First create a standalone UX prototype (manual pool entry → analysis/plan → position monitoring → PnL). Review information structure and interactions before editing official business pages. Prototype is not a production execution surface. Existing research engine remains separate.

## I02 commands — pinned protocol identity
After I01 returns actual capture, install dependencies (review generated lockfile, commit it only after verification):
```bash
npm install --prefix research/live
mkdir -p data/raw
curl -fLsS https://raw.githubusercontent.com/MeteoraAg/dlmm-sdk/1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1/ts-client/src/dlmm/idl/idl.json -o data/raw/dlmm-idl.json
node research/live/inspect-pool.mjs --capture data/raw/accounts-REPLACE --idl data/raw/dlmm-idl.json
```
The decoder checks the IDL Git blob SHA 6715f5cf19dffa8651a185ac0dd823218c6a2a75, the capture SHA256, program owner and LbPair discriminator. First run returns mintX, mintY, vaultX, vaultY and missing addresses (exit 1 is expected when missing). Re-capture the pool AND all four discovered accounts in ONE getMultipleAccounts call:
```bash
node research/capture-accounts.mjs --pool POOL --account MINT_X --account MINT_Y --account VAULT_X --account VAULT_Y
node research/live/inspect-pool.mjs --capture data/raw/accounts-NEW --idl data/raw/dlmm-idl.json
```
Replace placeholders with decoded real addresses and capture directories. Verify all fields against SDK output and actual RPC. Check anchor coder field names, package import/peer compatibility, IDL/actual account version, vault authority rule and token extension TLV. Direct dependency versions are pinned; transitive lockfile not yet generated. No actual execution or dependency install performed in chat. Unsupported Token-2022 or reverse orientation is an explicit blocked engine input, not successful strategy support. Gate A also requires T03. Record real output or error; fix adapter if actual protocol evidence disagrees.
 
## Business prototype review
Open docs/prototypes/terminal-v0.html locally in browser. Independent static prototype; tabs and form controls are for review only, no fake prices/positions/returns and no trade execution. Review empty states and layout before editing formal UI. Browser rendering and business acceptance still pending.

## I03 commands — BinArray and bitmap coverage
Dependencies now additionally pin @meteora-ag/dlmm 1.9.15 (verify published package and helper compatibility with pinned source commit). Install/update lockfile as part of I02.
```bash
npm install --prefix research/live
node research/live/bitmap.test.mjs
node research/live/inspect-bins.mjs --capture data/raw/accounts-REPLACE --idl data/raw/dlmm-idl.json
```
First run returns bitmap PDA if not already captured. Capture pool + bitmap in one request, then run inspector again. Explicit null bitmap is valid absence at that slot; absent from request is unknown. Next output lists expected bitmap-marked BinArray PDAs. Re-capture pool + bitmap + all expected arrays together (up to 98 arrays with current CLI). Re-run inspector on the new capture; membership is recomputed from that snapshot, not previous output. A null optional bitmap can make T01 return PARTIAL; inspect-bins distinguishes null from not requested. Do not treat exit 1 from initial discovery as success.
```bash
node research/capture-accounts.mjs --pool POOL --account BITMAP --account ARRAY_1 --account ARRAY_2
node research/live/inspect-bins.mjs --capture data/raw/accounts-NEW --idl data/raw/dlmm-idl.json
```
Replace placeholders with real discovered addresses; include all expected arrays, not just two. Save stdout reports under gitignored data/raw. Compare signed indices/PDA/bounds with SDK, active id, per-bin raw x/y, price Q64, shares and fee growth; check real layout and version 3 semantics. Compare bitmap membership against SDK getBinArrays (may include allocated empty arrays not marked in bitmap); document difference rather than claim all allocated arrays covered. More than 98 arrays or changing membership requires separate collection/reconstruction strategy; no multi-slot merge. Non-v3 arrays remain explicitly unsupported pending protocol evidence. Token-2022/orientation restriction from T02 remains. Verify MM principal separate from protocol fees, reward and limit-order balances; do not treat summed bins as executable depth or full vault reconciliation. Status BITMAP_COVERAGE_CHECKED_UNVERIFIED means internally covered supplied snapshot only, not live Gate A. Pure bitmap boundary checks executed in JS; repository test file and installed SDK CLI not run in chat. No live data or PnL claimed.

## I04 commands — historical transactions and swap events
```bash
npm install --prefix research/live
node research/live/capture-swaps.mjs --pool 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb --pages 1 --limit 20
node research/live/inspect-swaps.mjs --capture data/raw/swaps-REPLACE --idl data/raw/dlmm-idl.json --identity data/raw/pool-identity.json
```
Generate pool-identity.json from a successfully decoded I02 report and replace capture path. The optional identity report is needed to observe transaction vault deltas; its current slot does not prove historical identity. Collector archives getSignaturesForAddress pages, getTransaction and getBlock signature lists with raw response hashes, pagination cursors and explicit gaps. It never signs. Start with small samples; RPC history/429/unsupported versions are explicit gaps. Continue pagination using --before from nextBefore; bounded sample is not complete historical coverage.
 
Verify installed Anchor 0.31 coder/event parser and bs58 6.0.0 imports, pinned IDL names, CPI event tag and event authority against actual transactions; compare decoded Swap and Swap2Evt events with explorer/SDK and instruction paths. Verify pagination raw page contents vs manifest, same-slot block order and transaction signature, v0 loaded addresses, failed transactions, multiple swaps, CPI/log mirrored events, truncated logs and unsupported program upgrades. Verify historical mint/vault identity and Token-2022 transfer semantics. Swap2Evt exposes raw MM, protocol, host and limit-order fees and flags identifying fee asset; legacy Swap retains reported fee fields without inferring MM fee. Confirm fee units and gross/net semantics against protocol and token transfers. Transaction-level pre/post vault balances are observations, not per-swap reconciliation; implement instruction-level token transfer attribution and account for other operations in the same transaction before Gate B. Start/end bin IDs do not specify fills per bin; actual historical states/ordered replay or verified per-bin data are required. Do not generate normalized SWAP events for the strategy engine from these aggregate events alone. No real data, runtime tests, or Gate B pass in chat. Both CLI files are unexecuted code drafts pending integration and further reconciliation work.

## I05 commands — actual LP position accounting
```bash
npm install --prefix research/live
node research/live/discover-positions.mjs --pool POOL --owner WALLET
node research/capture-accounts.mjs --pool POOL --account POSITION
node research/live/inspect-position.mjs --capture data/raw/accounts-REPLACE --idl data/raw/dlmm-idl.json --position POSITION --owner WALLET
```
Replace placeholders with real addresses; owner is optional for public pool-scoped research. Position index uses official PositionV2, lbPair and optional owner filters; getProgramAccounts may be limited by provider. It captures 72-byte prefixes and slot, not assets; verify discriminator and index completeness against SDK. Select a real Position from index; first snapshot inspection returns missing mint and BinArray addresses. Re-capture pool + position + both mints + all arrays covering position range in ONE RPC response, then repeat inspection. Missing or closed position is not zero assets. No implicit cross-slot join. Current adapter supports only ordinary SPL tokens, MEME X / WSOL Y, V3 BinArray and width supported by pinned SDK. Validate extended position decoding, fee checkpoint field names, createProgram/wrapPosition imports, SDK version and actual account layout. Verify per-bin and total principal and pending fees against SDK at a consistent slot; check lock, operator, feeOwner and ownership implications before any execution. Rewards not valued. Lifetime claimed fees are not added to current NAV.
```bash
node research/live/capture-swaps.mjs --pool POOL --position POSITION --pages 1 --limit 20
node research/live/inspect-swaps.mjs --capture data/raw/swaps-REPLACE --idl data/raw/dlmm-idl.json --identity data/raw/pool-identity.json
```
Position-indexed bounded history includes PositionCreate/Close, Add/RemoveLiquidity, ClaimFee/ClaimFee2 and Rebalancing events when decoded. Verify mirrored CPI/log events, instruction path, historical pool identity (close has no pool field), owner changes, extensions, rebalances and reward events. Reconcile actual transfers, cash flows, network fees and rent, ownership and entire selected lifecycle; do not infer missing cash flows or aggregate event fields as net received amounts. Current output is evidence only, not final historical PnL. Snapshot does not set asOf from local time; derive valid chain-time boundary for replay. Existing integer kernel is reused, not assumed protocol verified. Code drafts not run with installed SDK or real RPC in chat; no Gate C pass. Record results and unresolved differences here.

## I06 commands — independent reference and exit quote evidence
```bash
npm install --prefix research/live
node research/live/reference-math.test.mjs
node research/live/capture-references.mjs --pool TARGET --reference POOL_A --reference POOL_B --probe-sol-raw LAMPORTS --sell-raw MEME_RAW_SMALL --sell-raw MEME_RAW_LARGE --max-discount-bps 200 --slippage-bps 50
```
Replace all placeholders with actual user-selected pool addresses and raw integer amounts (WSOL lamports, MEME smallest units). Same mint and supported SPL token orientation required; target excluded; reference pools distinct. No automatic discovery or transaction construction. Verify SDK 1.9.15 default import, connection custom fetch, supported RPC methods, quote return fields and quote fees against actual network. The SDK reads multiple accounts at different contexts; before/after finalized slot and blockTime are only brackets, not proof of exact observation time. Check raw RPC response contexts, account state/identity, slot/clock skew, quote latency, max age and divergence before any engine adaptation. Quote fee depends on live SDK state/time. Confirm actual probe size and amount-unit conversion. The conservative ladder uses minOut vs two-sided probe midpoint, reports largest tested qualifying size only, never interpolates or sums across pools; no quote is unknown, not zero depth. 200/50 bps are CLI defaults for testing, not calibrated strategy thresholds. Cross-protocol source validation and historical reference trade collection are still required for robust economic independence and historical Markout. Same-protocol distinct pools are merely candidates. Quote availability is not transaction execution, net realizable proceeds or guaranteed exit. No raw chain quote, installed SDK integration or repository test execution in chat; three pure arithmetic checks ran in JS. Do not convert output into MARKET events until freshness, source independence, valuation, capacity and remaining holder/flow quality contracts are met.

## I07 commands — local read-only live service
```bash
npm install --prefix research/live
node research/live/state-core.test.mjs
cp research/live/live-config.example.json data/live-config.json
# edit data/live-config.json: real pool, selected positions, manually chosen external pools and raw quote sizes; RPC credentials only in environment
node research/live/state-service.mjs --config data/live-config.json --once
node research/live/state-service.mjs --config data/live-config.json --port 8788
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8788/api/state
```
I01–I06 prerequisites and pinned IDL apply. Service polls sequentially, discovers missing account dependencies by re-capture, refuses more than 100 accounts per atomic response, persists state via temp-file rename, keeps raw capture references and deduplicates signatures by address. Position addresses and reference pools are manual. Separate streams have distinct slots; receipt age is not chain observation age. No strategy-ready state or trading endpoints. Start with --once and small history page settings. Sequential cycles may be much longer than configured poll delay; no realtime SLA. History collects bounded recent pages, does not automatically repair missing overlap; sticky OVERLAP_MISSING, decoder gaps and capture failures must remain visible. Implement verified cursor backfill and repair, retention/size limits, chain-time freshness and websocket support if needed; don't silently clear gaps. Confirm atomic persistence/restart, duplicate/conflicting signature rejection, stale data, child timeout, RPC rate limits, API loopback binding, partial status, changed config, SIGTERM and interrupted writes. A hard crash leaves writer.lock; confirm no process owns it before manually removing it, then restart. Do not remove a live lock. Verify source evidence hashes before downstream use. Existing service has no auth/TLS and must not be exposed publicly. No production decision readiness; no live service process started in chat. Three pure state logic checks executed; full test file, process orchestration, dependency compatibility and real RPC remain untested here. Record actual evidence and remaining issues.

## I08 — T08 read-only math integration
```bash
node research/live/engine-input.test.mjs
node research/live/analyze-state.mjs --state data/live/POOL/state.json
# With externally reviewed evidence and explicit allocation request:
node research/live/analyze-state.mjs --state data/live/POOL/state.json --request data/analysis-request.json --review data/research-evidence.json
```
Replace POOL with actual address. State-only mode checks T07 market identity/slot/raw capture archive hash and outputs observation metadata; exits 1/BLOCKED if reviewed evidence and budget absent. The optional research diagnostic path is not a bypass of Gate A–F. It checks evidence file hashes under data/, not authenticity or semantic review. T06 direct same-venue pool quotes cannot satisfy the stricter independent venue/source requirement. Collect validated cross-venue reference observations, exit sizes/quotes and holder/flow/token risk features before making a research evidence bundle. No arbitrary synthetic default values. All time values below are Unix seconds, not receipt milliseconds.

Request JSON contract: pool, entry ("sol"|"holding"|"position"), capitalScope ("USER_DECLARED_ALLOCATION"), memeRaw, solRaw (nonnegative decimal integer strings), goal ("balanced"|"defensive"|"growth"), horizonSeconds (positive integer), optional riskConfig (Engine.config fields), position (required for position entry). Declared allocation is NOT verified spendable balance. Goal preset/horizon/cost calibration must be resolved in T09; T08 only calculates classification/risk with explicit overrides and engine defaults, no forecast. Existing position current principal and fees are recomputed via IntegerKernel, with declared extra capital separate. No history PnL.
 
Research evidence JSON contract: pool,mintX,mintY,marketSlot,marketRawHash,asOf,maxAgeSeconds,marketObservedAt,marketAvailableAt,marketTimeEvidence:{path,sha256},observations:[{id,t,evidence:{path,sha256},tokenSafe,holderShare,holderOutflow,buyImbalance,flowSol,exitDepth,references:[{pool,mintX,mintY,venue,source,price,depth,observedAt,availableAt,evidence:{path,sha256}}]}]. Paths relative to repository data/ (gitignored). Reference price = SOL/MEME, depth and exitDepth SOL notionals; holderShare/outflow 0..1, imbalance -1..1; semantics/window and exit valuation must be independently validated. Require >=3 strictly ordered market observations; >=2 distinct non-target pools, venues and sources per observation, no future/stale timestamps, reference divergence check, latest observation not before market availability. Explicit reviewed evidence may be historical as-of; never label it live. Do not create fake artifacts to satisfy the contract.
 
T07 now attempts same-response market + configured Position collection with SDK-derived arrays when within 100-account limit, reuses shared capture for position streams, otherwise separate capture is display-only for T08. Verify all position and market data match same raw hash/slot, actual position principal excluded from external bin amount, empty/missing bin handling, correct price anchor and integer conversion. Inputs exceeding JS safe integer bounds are rejected (later precision enhancement). Verify identity/report decoding against archived accounts, chain observation time and availability, economic independence, actual token balances and evidence completeness. Historical observations warm up model features only; no past swaps replayed against current holdings. No per-bin swap normalization or historical PnL without actual T04/T05 reconciliation. Engine calls: config/newState/reference/event/classify/risk/balances/nav. No trading, no strategy-ready output. decisionReady and executionReady always false. Five pure input checks executed in JS; repository test file, SDK and CLI end-to-end not executed here. Record gaps and actual integration results.

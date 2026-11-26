# Real-environment integration handoff (Codex)
Updated 2026-11-26. This is the only integration backlog. Implement in roadmap order; environment-blocked tests do not stop subsequent code authoring, but do block production enablement and downstream acceptance. Do not mark a check passed without actual evidence. No mock data, synthetic income, invented account addresses, or silent fallback. Test fixtures may only test software behavior and must be explicitly isolated. Do not store RPC URLs containing credentials, API keys, wallet secrets or signed transaction secrets in Git.
 
## Current blockers and later required checks
| ID | Task | State | Required environment / evidence |
|---|---|---|---|
| I01 | T01 raw Pool capture | BLOCKED: RPC DNS in chat environment | Real finalized RPC response, raw bytes, slot, SHA256, manifest |
| I02 | T02 SDK/IDL identity and mint/vault decoding | Code draft committed; dependencies and real runtime unverified | Install exact SDK version; validate program owner, token mints, decimals, vault mint/owner and extensions against real accounts |
| I03 | T03 BinArray/bitmap | Pending implementation | Real pool arrays, coverage, SDK comparison, same-slot or explicitly separate snapshots |
| I04 | T04 swaps/fees | Pending implementation | Actual getTransaction/getBlock data, event order, raw amounts, fee and vault balance deltas; gaps |
| I05 | T05 Position ledger | Pending implementation | Public or user-approved read-only positions; shares, principal, fee checkpoints and lifecycle receipts |
| I06 | T06 reference and exits | Pending implementation | Non-target pools, valid timestamps, depth and read-only executable quotes; missing data must reject decision |
| I07 | T07 live service | Pending implementation | Real subscriptions/polling, reconnect, backfill, persistence, fresh state, duplicate suppression |
| I08 | T08–T11 decision/shadow | Pending implementation | Real event adapter, independent references, risk constraints, comparable baselines, frozen test samples, costs and actual deviations |
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

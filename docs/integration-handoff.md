# Real-environment integration handoff (Codex)
Updated 2026-11-26. This is the only integration backlog. Implement in roadmap order; environment-blocked tests do not stop subsequent code authoring, but do block production enablement and downstream acceptance. Do not mark a check passed without actual evidence. No mock data, synthetic income, invented account addresses, or silent fallback. Test fixtures may only test software behavior and must be explicitly isolated. Do not store RPC URLs containing credentials, API keys, wallet secrets or signed transaction secrets in Git.
 
## Current blockers and later required checks
| ID | Task | State | Required environment / evidence |
|---|---|---|---|
| I01 | T01 raw Pool capture | BLOCKED: RPC DNS in chat environment | Real finalized RPC response, raw bytes, slot, SHA256, manifest |
| I02 | T02 SDK/IDL identity and mint/vault decoding | Pending implementation | Install exact SDK version; validate program owner, token mints, decimals, vault mint/owner and extensions against real accounts |
| I03 | T03 BinArray/bitmap | Pending implementation | Real pool arrays, coverage, SDK comparison, same-slot or explicitly separate snapshots |
| I04 | T04 swaps/fees | Pending implementation | Actual getTransaction/getBlock data, event order, raw amounts, fee and vault balance deltas; gaps |
| I05 | T05 Position ledger | Pending implementation | Public or user-approved read-only positions; shares, principal, fee checkpoints and lifecycle receipts |
| I06 | T06 reference and exits | Pending implementation | Non-target pools, valid timestamps, depth and read-only executable quotes; missing data must reject decision |
| I07 | T07 live service | Pending implementation | Real subscriptions/polling, reconnect, backfill, persistence, fresh state, duplicate suppression |
| I08 | T08–T11 decision/shadow | Pending implementation | Real event adapter, independent references, risk constraints, comparable baselines, frozen test samples, costs and actual deviations |
| I09 | T12–T13 UI/monitoring | Pending prototype and implementation | Actual read-only API, no fabricated values; stale/unknown/error states; human review |
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

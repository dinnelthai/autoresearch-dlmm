# Semi-automatic DLMM MVP — implementation ledger

2026-11-26. Scope: Solana / Meteora DLMM / Meme-SOL. Human selects pool, risk budget, funding and confirms transactions. System plans, monitors, recommends adjustments and reconciles actual returns. No opportunity discovery, automatic pool selection, copy trading, vault, multi-chain or billing. Reuse existing SDK and Adaptive Inventory mathematics; never substitute mock for live acceptance.

## Sequence
| ID | Task | Acceptance | State |
|---|---|---|---|
| T01 | Raw RPC account acquisition | Real finalized Pool response, raw bytes, context slot, hash, timing and explicit gaps | In progress; environment DNS failure |
| T02 | SDK/IDL pinned pool/mint/vault decoding | Verified owner, mint orientation, decimals, extensions and vaults | Pending |
| T03 | Bin arrays and bitmap | Complete declared snapshot and consistency checks | Pending |
| T04 | Swap and dynamic fee events | Raw transaction ordering, fee and vault deltas reconcile, gaps explicit | Pending |
| T05 | Position ledger | Shares, principal, pending/claimed fees and lifecycle reconcile | Pending |
| T06 | Independent reference/exit depth | Target excluded, depth and timestamp quality, missing data gates | Pending |
| T07 | Live state service | Persistence, deduplication, recovery, freshness and logs | Pending |
| T08 | Existing math integration | Real event adapter, as-of boundaries and unsupported cases rejected | Pending |
| T09 | Candidate LP plans | Budget, bins, strategy comparison, executable constraints | Pending |
| T10 | Inventory, rebalance and exit decisions | Risk limits, no-LP, removal vs disposal, cost-aware decisions | Pending |
| T11 | Live shadow validation | Real events, frozen test, risk and costs versus fair baselines | Pending |
| T12 | Single-pool terminal | Manual pool entry and plan preview | Pending |
| T13 | Position monitoring | Actual position, suggestions, alerts and recovery | Pending |
| T14 | Human-confirmed execution | Wallet, preview, simulation, limits, explicit signing and confirmation | Pending |
| T15 | Execution reconciliation | Confirmed on-chain outcomes; failure/idempotency checks | Pending |
| T16 | Performance | Actual net PnL, fees, costs and HODL-relative attribution | Pending |
| T17 | End-to-end acceptance | Safety and evidence; any funded trial requires separate approval | Pending |

## Gates
T01–T06 implement the v0.8/v1.1 raw-data and reconciliation requirements; do not assert full Gate A until T02–03 pass, nor B/C until T04–05 pass. T07 onward requires accepted upstream evidence. T11 requires out-of-sample evaluation and quality thresholds; successful software execution does not prove profitability. Missing or unsupported data stops dependent decisions rather than producing invented metrics. No unauthorized signing, no private keys in logs or repository. Preserve research engine and old Python heuristic separately.

## Current action
First obtain a real read-only finalized Pool snapshot, then derive and validate mint/vault/bitmap/bin-array addresses using pinned SDK. Sample candidate from prior research: 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb; not a promise of eligibility or availability. Local RPC network access is required. Historical state cannot be recovered from the current snapshot alone. Record actual acceptance results and advance only on evidence.

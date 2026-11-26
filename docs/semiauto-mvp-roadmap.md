# Semi-automatic DLMM MVP — implementation ledger

2026-11-26. Scope: Solana / Meteora DLMM / Meme-SOL. Human selects pool, risk budget, funding and confirms transactions. System plans, monitors, recommends adjustments and reconciles actual returns. No opportunity discovery, automatic pool selection, copy trading, vault, multi-chain or billing. Reuse existing SDK and Adaptive Inventory mathematics; never substitute mock for live acceptance.

## Sequence
| ID | Task | Acceptance | State |
|---|---|---|---|
| T01 | Raw RPC account acquisition | Real finalized Pool response, raw bytes, context slot, hash, timing and explicit gaps | CLI tests passed; BLOCKED on real RPC evidence |
| T02 | SDK/IDL pinned pool/mint/vault decoding | Verified owner, mint orientation, decimals, extensions and vaults | Code draft; live integration pending |
| T03 | Bin arrays and bitmap | Complete declared snapshot and consistency checks | Code draft; bitmap pure checks passed; live integration pending |
| T04 | Swap and dynamic fee events | Raw transaction ordering, fee and vault deltas reconcile, gaps explicit | Capture/event decoding draft; per-instruction reconciliation and live validation pending |
| T05 | Position ledger | Shares, principal, pending/claimed fees and lifecycle reconcile | Position index/snapshot/lifecycle drafts; transfer reconciliation and live validation pending |
| T06 | Independent reference/exit depth | Target excluded, depth and timestamp quality, missing data gates | Direct pool quote draft; arithmetic checks passed; independent source/freshness and live validation pending |
| T07 | Live state service | Persistence, deduplication, recovery, freshness and logs | Polling/API/persistence draft; automatic gap repair and live integration pending |
| T08 | Existing math integration | Real event adapter, as-of boundaries and unsupported cases rejected | Read-only snapshot/risk bridge draft; normalized per-bin history and live evidence pending |
| T09 | Candidate LP plans | Budget, bins, strategy comparison, executable constraints | Research preview draft; source fixture checks passed; SDK feasibility/calibration/live evidence pending |
| T10 | Inventory, rebalance and exit decisions | Risk limits, no-LP, removal vs disposal, cost-aware decisions | Read-only management preview draft; source fixture checks passed; live reconciliation and validation pending |
| T11 | Live shadow validation | Real events, frozen test, risk and costs versus fair baselines | Shadow framework draft; source fixture checks passed; actual reconciled samples and out-of-sample validation pending |
| T12 | Single-pool terminal | Manual pool entry and plan preview | V4.5 approved; formal read-only terminal + local state/plans API code ready; live/browser integration pending |
| T13 | Position monitoring | Actual position, suggestions, alerts and recovery | V4.5 configured-position capture/range monitoring and manual T10 management API code ready; continuous model alerts, recovery and live acceptance pending |
| T14 | Human-confirmed execution | Wallet, preview, simulation, limits, explicit signing and confirmation | Pending |
| T15 | Execution reconciliation | Confirmed on-chain outcomes; failure/idempotency checks | Pending |
| T16 | Performance | Actual net PnL, fees, costs and HODL-relative attribution | V4.5 actual-vs-shadow view retained; actual accounting implementation pending |
| T17 | End-to-end acceptance | Safety and evidence; any funded trial requires separate approval | Pending |

## Gates
T01–T06 implement the v0.8/v1.1 raw-data and reconciliation requirements; do not assert full Gate A until T02–03 pass, nor B/C until T04–05 pass. Implementation may proceed in dependency order using explicit contracts even if live environment evidence is blocked. Runtime activation, live acceptance, and funded operations still require accepted upstream evidence. T11 requires out-of-sample evaluation and quality thresholds; successful software execution does not prove profitability. Missing or unsupported data stops dependent decisions rather than producing invented metrics. No unauthorized signing, no private keys in logs or repository. Preserve research engine and old Python heuristic separately.

## Current action
First obtain a real read-only finalized Pool snapshot, then derive and validate mint/vault/bitmap/bin-array addresses using pinned SDK. Sample candidate from prior research: 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb; not a promise of eligibility or availability. Local RPC network access is required. Historical state cannot be recovered from the current snapshot alone. Record actual acceptance results in [integration-handoff.md](integration-handoff.md). Advance code independently of environment blockers; advance acceptance only on evidence.

## T01 verification — 2026-11-26
- Node v22.16.0; local capture file Git blob SHA matched main: 281a6b5b622dee86b021409442ad526f88f3e420.
- Syntax check, help, invalid-address rejection and failure manifest verified.
- CLI transport/archival integration: 6/6 local fixture cases passed (present, missing, RPC error, wrong ID, malformed data, HTTP 429). Test-only fixtures are not real-chain evidence and are not used by production research.
- Actual public mainnet RPC request: DNS resolution failed in execution environment. CLI exit 1, status BLOCKED, failureStage network. No account data or slot received.
- On a network-enabled machine, run `node research/capture-accounts.mjs --pool 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb` (optionally set SOLANA_RPC_URL to an authorized RPC). Provide the resulting manifest.json and accounts.json, if present; do not include credentials. Confirm source/slot before T02; captured bytes alone are not a verified Meteora account.
- Gate A remains unpassed. No strategy or PnL claims.

## Workflow amendment (2026-11-26)
- Maintain two independent statuses: implementation (pending / in progress / code ready) and live integration (pending / blocked / pass / fail). Code ready is not live pass.
- Centralize all environment-dependent work in [integration-handoff.md](integration-handoff.md) for Codex. Continue code in dependency order with no fabricated production data.
- Before modifying business UI (T12–T13), produce a separate prototype, review it, and keep the official research interface unchanged until the business layout is accepted.

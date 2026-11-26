# Codex integration handoff — CR-15 / T17

## Objective and scope
Finish local verification of the single manually selected Meteora DLMM MEME/WSOL pool MVP. Preserve approved V4.5 LP Terminal, Position Manager, Performance. AutoResearch is a separate frozen research diagnostic. No pool discovery, other DEX, new business modules, autonomous trading or funded execution. T14 C (actual approval/signing/confirmation) and production management transactions are not implemented and not authorized in this handoff. Do not invent data, lower risk/freshness thresholds, substitute fixtures for live evidence, or claim profit from code tests.

## Starting point
Use latest main of dinnelthai/autoresearch-dlmm. Code review closure baseline before this document: b69c0461f0559b7054fe93a7bf92d11a7160e718. Record actual HEAD and worktree status. Inventory: 86 .mjs files, 33 .test.mjs entries plus research/test.mjs; no research/live/package-lock.json at baseline. Python uv.lock exists but legacy optimizer is exploratory, not accepted OOS. All 17 live task gates unaccepted. Connector-based latest source checks: 15 selected entry modules parsed after stripping import/export wrappers; engine guard/path/volume/liquidity/rebalance/exit and T09/T10 238 isolated assertions, Shadow 26, legacy engine 75 (32 initial plus 43 cumulative additional), all passed. Not full Node test execution. Chat runtime Node 22.16.0 available but git ls-remote DNS failed again. Local Codex must execute tests with real checkout. No SDK, browser, public RPC or validator acceptance inferred.

## Ordered work packages
| ID | Priority | Work | Exit condition |
|---|---|---|---|
| C00 | P0 | Checkout and record environment | Exact commit, clean/dirty, OS, Node/npm, git; no credentials in artifacts |
| C01 | P0 | Run complete offline verifier | All 33 required test files and additional discovered tests pass, no skip/cancel/todo, legacy suite passes, syntax/JSON/DOM checks pass; repair reproducible failures with regressions |
| C02 | P0 | Pin dependency and protocol provenance | Review generated npm lock and transitive integrity, npm ci, pinned SDK 1.9.15, pinned IDL commit/blob, helper exports, record hashes; reject mismatches |
| C03 | P0 | T01–T05 raw data and ledger inputs | Authorized finalized read-only RPC, independently verify genesis; raw bytes, mint/vault/bitmap/bin/position decode, transaction order and transfer/fee reconciliation; explicit gaps |
| C04 | P0 | T06–T08 references/state/model adapter | Independent causal price and side-specific exit-depth evidence; explicit flowWindowSeconds, correct units, freshness, real target-bin liquidity and capture identity, no fabricated fills |
| C05 | P0 | T09–T10 model integration | Matched NO_LP/HOLD, risk/fees/path coverage, integer budget, cost and retained inventory; compare actual protocol evidence, no income claim |
| C06 | P0 | T12–T13 local terminal and monitor | Browser end-to-end, including A-B-A, expired evidence, invalid files, position owner, wallet switches, HTTP 409/503, slow/failed children, restart/retention; preserve UI |
| C07 | P0 | T14 A–B6 unsigned local diagnostic | Isolated validator/test assets only, exact SDK BPS/inverse, account roles, raw bytes/fee/rent, unsigned simulation and independently reconciled debit/share; no signing, sending or real mutation |
| C08 | P0 | T15–T16 evidence-backed accounting | Position flows, failure fees, claims, rent, boundaries and marks; independent raw/share reconciliation and coverage. No actual cash PnL claim from retained distributions |
| C09 | P0 | T11 frozen forward research | External precommit and independent test custody, one split at a time, complete group denominator, enough representative real data, report uncertainty and all trials; no test tuning |
| C10 | P0 | T17 final acceptance | Repeat C01 after fixes, attach per-gate evidence, record unresolved production blockers; no readiness flag promotion without separate review |

C06 can run alongside independent offline work but actual acceptance requires upstream evidence. C07 is strictly diagnostic, not a production transaction path. C09 can collect precommitted future samples once inputs are valid; evaluate only completed windows. Stop dependent gates on failure, continue independent offline checks.

## Exact startup and regression commands
Run from repository root. Do not overwrite user's uncommitted changes.
```sh
git status --short
git rev-parse HEAD
node --version
npm --version
node research/live/verify-offline.mjs
```
Verifier discovers modules and requires the 33 baseline tests, executes each test file independently with TAP, rejects missing/zero/fail/cancel/skip/todo counts, runs legacy suite, and writes data/acceptance/offline-*.json. Inspect every record. Do not count fixture assertions as real acceptance. If dependency-related failure, perform C02 and repeat.
```sh
cd research/live
npm install --package-lock-only
# Review lockfile and dependency integrity before installing.
npm ci
cd ../..
node research/live/verify-offline.mjs
```
Pinned upstream: MeteoraAg/dlmm-sdk commit 1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1; ts-client IDL blob 6715f5cf19dffa8651a185ac0dd823218c6a2a75; SDK 1.9.15. Obtain pinned IDL locally and compare blob. No secrets committed.

Prepare local config from example JSON (replace placeholders using actual authorized evidence; never invent values). Detailed per-module commands in integration-handoff.md and t17-acceptance-runbook.md.
```sh
node research/live/state-service.mjs --config data/live-config.json --once
node research/live/state-service.mjs --config data/live-config.json --port 8788
# In a second terminal:
node research/live/terminal-server.mjs --config data/terminal-config.json --port 8790
```
Open http://127.0.0.1:8790. Service is read-only. Do not expose beyond loopback. Keep raw evidence locally, record exact genesis and provider, and protect credentials.

## Schema migration and test traps
- Shadow freeze includes summary hash; request/config horizons match; chronological train/validation/test isolation. Re-freeze changed code, separate sample index for each split. Run:
  `node research/live/shadow-run.mjs --code-hashes`
  `node research/live/shadow-run.mjs --freeze data/shadow/freeze.json --freeze-hash PRECOMMITTED_SHA256 --samples data/shadow/validation-index.json --split validation`
  Independently control untouched test. Older combined reports rejected.
- Flow observations require explicit positive flowWindowSeconds for a deployment forecast; missing target-bin path evidence blocks. Path CVaR differs from historical terminal CVaR; never compare scores across code versions as if identical.
- T16 valuation references must bind mintX, mintY and priceUnit SOL_PER_HUMAN_MEME_E18. Window ledger rows must carry explicit success/decisionReady/executionReady and gap arrays. Regenerate from evidence, not manual relabeling. Negative fee accrual requires reconciliation; do not clamp to zero.
- Raw history retention is bounded cache only, never proof of coverage. No automatic evidence deletion. If service crash leaves writer lock, verify process and inspect before manual recovery.
- SDK weight vectors must equal reviewed vector and captured bin bytes; local builder is unsigned, opt-in simulation, loopback only. No permission to sign or submit.
- Wallet read is public-account observation, not spendability or approval. API/readiness flags remain false.

## Required gate report
For each C00–C10 and associated T01–T17 record exact commit, clean/dirty, Node/npm, SDK/IDL/lock hashes where applicable, non-secret provider and genesis, input hashes, command, UTC start/end, expected, observed, artifact paths/hashes, PASS/FAIL/BLOCKED/NOT_RUN, blocker, and affected downstream gates. A PASS must cite actual artifacts and independent comparator when required. Do not commit keys, endpoint tokens, raw personal data or private evidence. Maintain only non-sensitive test results and code changes in Git.

## Unimplemented or unaccepted production scope
T14 C human authorization/signing and confirmed execution; production management messages; complete historical per-bin replay and cluster-bound provenance; reference semantic validation and fill/cost calibration; full history and actual wallet-level cash PnL including reused/disposed distributions; independent real OOS evidence; load/long-running browser/runtime acceptance. These are not completed by passing offline tests. Any next phase requires separate scope and review.

Source of truth: [roadmap](semiauto-mvp-roadmap.md), [ordered acceptance](t17-acceptance-runbook.md), [detailed integration history](integration-handoff.md).

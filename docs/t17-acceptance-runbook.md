# T17 — integration acceptance runbook

Scope frozen: single manually selected Meteora DLMM MEME/WSOL pool; V4.5 terminal, position manager, performance. No discovery, new DEX, auto-trading, wrapping/swap expansion or paid trial in this runbook. Implementation state is not acceptance. Baseline reviewed: main at 547a04c1d11d664d9788ea49c8f2ae4d7dca1828; subsequent T17 commits fix history merge and configuration binding, add offline verifier. Review was targeted cross-module contract inspection, not exhaustive security audit.

## Rules for Codex

Work on the user's local checkout of main. Record exact commit and dirty status. Keep RPC credentials, keys and raw account history under local data/; never commit secrets or data. Use read-only authorized RPC for public-chain evidence. Use isolated local validator and test assets for unsigned simulation. Do not enable signing or submission, send a funded transaction, or promote readiness based on a fixture, missing evidence, an imported report or a passing syntax check. T14 C is not implemented. Stop dependent acceptance when upstream gate fails; independent offline tests may continue. Fix reproducible defects with tests before re-running the gate. Preserve approved UI except necessary defects.

## Ordered acceptance sequence

| Gate | Dependency | Run / input | Required evidence and pass condition | Initial live state |
|---|---|---|---|---|
| E00 Environment | none | Node >=20, npm, git; install exact dependencies under research/live, generate and review lockfile; verify SDK 1.9.15 and pinned IDL commit/blob; then npm ci | exact Node/npm, package-lock hash, package integrity, SDK exported helpers, IDL hash; no dependency mismatch | BLOCKED: npm lock absent / runtime not verified |
| E01 Offline verification | none | node research/live/verify-offline.mjs | source hashes, all syntax, JSON, DOM structure, node:test suites and legacy research suite; no failed/skipped unexpected cases | NOT RUN |
| T01 capture | E00 | capture-accounts.mjs --pool manually chosen pool | finalized slot, raw hash, independently verified genesis, owner/addresses and timestamps | BLOCKED: chat DNS/RPC |
| T02 identity | T01 | inspect-pool.mjs --capture ... --idl ... | known program, classic SPL mints/vaults, correct orientation/decimals; compare independent decode | NOT RUN |
| T03 bins | T02 | inspect-bins.mjs --capture ... --idl ... | same slot/hash, exact bitmap/array coverage and signed bin IDs, no missing arrays | NOT RUN |
| T04 history | T02 | capture-swaps.mjs + inspect-swaps.mjs | raw tx/block order, event and transfer linkage, per-bin history; missing data explicit | NOT RUN |
| T05 positions | T02,T03,T04 | discover-positions.mjs and inspect-position.mjs | independent shares/principal/fees, ownership, position lifecycle, exact accounting | NOT RUN |
| T06 references | T02 | capture-references.mjs, independent cross-venue data | causal independent price, executable depth evidence, spread and freshness, target excluded | NOT RUN |
| T07 state | T01–T06 | state-service.mjs --config data/live-config.json --once, then service mode | valid state, atomic persistence, recovery, partial decode never merged, history gap sticky, market freshness under slow calls | NOT RUN |
| T08 adapter | T07,T06 | analyze-state.mjs --state ... --request ... --review ... | evidence-bound causal normalized model inputs; unsupported data rejected, no fabricated per-bin fills | NOT RUN |
| T09 plans | T08 | analyze-state.mjs ... --plans | feasible candidates, correct bin orientation, budget, no-LP baseline, independently checked actual math | NOT RUN |
| T10 management | T05,T08 | analyze-state.mjs ... --management | correct position/owner, risk/exit vs disposal, cooldown/turnover; no unsupported reposition | NOT RUN |
| T11 research | T04–T10 | shadow-run.mjs --code-hashes, then frozen windows and evidence per handoff | precommitted code/windows, valid sample coverage, fair baselines, uncertainty and costs; no profitability claim from execution alone | NOT RUN |
| T12 terminal | T07–T09 | terminal-server.mjs --config data/terminal-config.json | browser at 127.0.0.1:8790; manual pool, plan review, scope/expiry/host/origin, no stale report, layout matches V4.5 | NOT RUN |
| T13 monitor | T05,T10,T12 | configured management policy and opt-in monitor | range, alerts, risk observations, journal/restart, wallet/position changes, no autonomous action | NOT RUN |
| T14 A–B6 | T05,T08–T13,E00 | explicit wallet read; optional SDK weights/inverse; local-open.example.json + build-local-open.mjs with isolated test validator | exact raw wallet, SDK mapping, message role/debit/rent, exact unsigned simulation, zero real state mutation; compare independent protocol math | NOT RUN |
| T15 ledger | T02,T04,T05 | reconcile-position.mjs on finalized position archives | direct lifecycle events + wallet/vault transfers, failed fees, rent, dedup, coverage independently confirmed | NOT RUN |
| T16 performance | T05,T06,T15 | calculate-performance.mjs, calculate-performance-series.mjs, calculate-lifecycle.mjs | original evidence marks, exact claim counters, HODL, retained vs sold assets, lifecycle coverage; diagnostics not actual PnL | NOT RUN |
| T17 integration | all preceding applicable gates | repeat E01 after fixes; demonstrate end-to-end read-only and isolated unsigned test workflow | signed-off evidence report; no fake live PASS; unresolved gaps explicitly recorded | NOT RUN |

T14 C (human authorization and actual confirmation) requires a separate design and acceptance after independent upstream verification. Production management transaction paths also remain absent. No funded execution is authorized by this runbook.

## P0 blockers before any production readiness

- P0-01: Node runtime dependency/lockfile and SDK exports/IDL compatibility; actual CLI invocation, not source assertions. Package metadata alone is not source integrity. Review transitive dependencies.
- P0-02: bind the chain genesis to each raw capture; current T01/T04 archives and review declarations do not independently establish cluster provenance. Verify provider and actual network across every stage.
- P0-03: complete historical raw per-bin replay, transfer attribution and independent position-accounting comparison; current bounded evidence cannot prove this.
- P0-04: produce causal independent reference price/depth and full real review inputs; current manual review files and hashes are not semantic validation.
- P0-05: actual SDK conversion and unsigned local message construction; validate account layout, optional account semantics, message bytes, rent, inner instructions, simulation fee/share behavior. No fallback to fabricated values.
- P0-06: confirmed ledger scope currently narrow; complex/combined flows, wrapping, rebalancing and third-party flows remain blocked. Full historical coverage and verified cash-realization/utilization are not implemented. Provider pagination cannot prove completeness.
- P0-07: actual authorization/confirmation and production management paths are missing. Keep disabled. Do not treat the local unsigned builder as production support.
- P0-08: frozen real out-of-sample research with independently reviewed risk, fee, markout and profitability thresholds; no accepted samples here.

## P1 local engineering verification

- Long history fetches can make market receipt stale or block a full polling cycle. Verify recovery, scheduling, independent stream freshness, history retention and gap repair under slow/failing RPC; refactor only when reproduced. Never relax stale-data gates.
- Real browser interactions: target switch, strategy selection, archive invalidation, wallet switch/disconnect, review expiry during async calls, monitor restart, report owner/pool scoping, responsive layout. Browser smoke test is separate from DOM ID check.
- Empty-history interval handling, multiple-window boundaries and actual active-liquidity utilization remain missing. Use independent proof of no transactions before permitting zero-flow reports.
- Local data path/permissions, bounded archive size, state locks and stale lock recovery; no automatic deletion of evidence.

## Evidence log format

Write one record per gate with gate ID, commit, clean/dirty, Node/SDK/IDL/lock hashes, non-secret provider label and verified genesis, input file hashes, command, UTC start/end, expected result, observed result, evidence paths/hashes, PASS/FAIL/BLOCKED/NOT_RUN and reason. A PASS must cite actual artifacts and independent comparator where specified. Re-run affected downstream gates after changing evidence or code. Keep diagnostic flags false until a separate authorized release review.

## Start commands

From repository root:
```sh
git status --short
git rev-parse HEAD
node --version
npm --version
node research/live/verify-offline.mjs
```

Offline verifier writes data/acceptance/offline-*.json; it runs actual Node syntax checks and test suites, not a substitute for SDK/RPC/browser tests. Review report, fix failures, repeat. Install pinned dependency tree under research/live, generate/review lockfile before npm ci. Then follow T01 through T17 and detailed commands in integration-handoff.md.

## Status at handoff

76 pre-T17 .mjs modules and 26 test entry files found by GitHub tree inspection; verifier adds one module. 25 .test.mjs files and one legacy research/test.mjs. No npm lockfile at inspected revision. Local Node 22.16.0 available; git ls-remote failed because github.com DNS resolution failed. Full checkout/test run not performed. Two source-confirmed integration issues fixed: mismatched/partial decoded history was eligible for history merge; valuation window config bytes were not included in source binding. Full suite and regressions pending local execution. All 17 live task gates remain unaccepted; code coverage does not imply product readiness.

## CR-15 closure update
Use [final Codex handoff](codex-final-handoff.md) as the current task entry point. Supersedes the initial inventory: 86 .mjs files, 33 node test files + one legacy suite. Verifier now checks mandatory inventory and TAP counts per file. Latest source-only rechecks: 15 selected entry modules parsed, 238 engine/T09/T10 assertions, 26 Shadow assertions and 75 legacy engine assertions passed. Full checkout still blocked by DNS; actual runtime and all live gates remain unaccepted. No signing/production execution in this handoff.

# Current integration runbook

Primary path: real Meteora DLMM observations → collected features → existing mathematical engine → virtual Paper positions → matched HODL evaluation → parameter research. No funded trade, wallet signature or transaction submission.

## Start existing services

Use the installed/pinned Node 22 and SDK from the existing local setup. From the repository root:

```sh
git status --short
git rev-parse HEAD
node --version
node research/live/verify-offline.mjs
# Separate terminals; use your configured RPC and existing local configuration files:
node research/live/state-service.mjs --config data/live-config-basket.json --port 8788
node research/live/terminal-server.mjs --config data/terminal-config-basket.json --port 8790
node research/live/check-local.mjs --terminal-config data/terminal-config-basket.json --live-config data/live-config-basket.json
```

Open http://127.0.0.1:8790. Select the configured Pool, set virtual capital/risk preferences, and start a Paper experiment on the performance page. Adaptive is optional. Fixed controls can run without reviewed reference inputs. Adaptive uses available reviewed or explicitly labeled collected proxy observations; it must not fabricate absent data. Current model still requires fresh dual-reference quotes and sufficient observations. Do not mix actual position reports with Paper results.

Observe increasing snapshots, eight strategy rows, fees, NAV, alpha vs HODL, drawdown, open/reposition/exit, and completed-window scoring. Test restart and archive integrity. A completed observation window is not independently validated profitability. No full live Adaptive acceptance has been established by this documentation.

## Final local integration backlog (business first)

Reviewed code revision: [0ab3d2f](https://github.com/dinnelthai/autoresearch-dlmm/commit/0ab3d2faa61a076776026025f6e1c369d286de2c). Keep the existing local SDK tarball, RPC configuration, captures, experiments and uncommitted work. Sync without force-resetting the local checkout. Run full offline verification on that exact revision; the two dependency-light CI jobs are not substitutes for the SDK-enabled test suite. The historical C02 direct-ESM issue need not prevent a working CJS read-only path.

| Task | Acceptance evidence |
|---|---|
| L01 Runtime | Actual collector and terminal running, SDK combined decoder matches the existing separate CLI identity and bin reports on the same raw capture. Record revision, Node version and test result. |
| L02 Real capture | At least three advancing captures from the configured pool with matching slot/raw hash, complete supported bins and observed fee growth. Distinguish zero real growth from missing data. |
| L03 Fixed Paper | Explicit virtual budget, seven fixed/HODL rows plus Adaptive; observe multiple intervals without Review. At least one eligible LP path must show correct principal/fee/cost/NAV and paired alpha; report individually blocked paths. |
| L04 Adaptive | Start with Adaptive enabled, inspect collected source status, freshness, two independent reference quotes, holder cohort and recent swap sample. Accumulate at least three usable causal observations. Demonstrate model decisions and, when the market supports them, virtual open/reposition/remove and re-entry. If the opportunity does not occur, report it as unobserved, not passed. |
| L05 Persistence | Restart services on the same model revision and verify continued snapshots, fee continuity, no duplicate action or history record, and audit the paused/completed history. Older model checkpoints remain historical; start a new run rather than force a schema migration. |
| L06 Forward experiment | Observe genuine 7-day or 30-day evaluation window; compare common-capital matched alpha, fees, costs, drawdown and blocked-path counts. No fabricated endpoint, time compression or claimed return from a short smoke run. |
| L07 Parameter loop | Use genuine normalized-event train and later validation groups for the existing optimizer and handoff. Report proposed tuning and later new Paper window only if accepted. The automated live archive-to-optimizer sampling and unattended repeated optimization loop are still unimplemented; do not mark them complete. |

For a stable paused or completed experiment:

```sh
node research/live/paper-history-audit.mjs --pool POOL_ADDRESS --id auto-UUID
```

Preserve local evidence and report exact observed statuses and metrics. A missing feature or unavailable SDK diagnostic is a specific integration finding, not a reason to abandon the other executable business checks. Never substitute synthetic data for the real-market acceptance. Do not add a second simulator or a new diagnostic framework to complete these tasks.

## Research and diagnostics

- [Math, normalized events, optimizer and Paper handoff](../research/README.md)
- [Real-source startup evidence](business-first-live-2026-11-27.md)
- [Historical single fixed-bin observation](one-case-live-2026-11-27.md)
- [Detailed offline/local acceptance procedure](t17-acceptance-runbook.md)
- [SDK source build](sdk-source-build.md) and [C02 status](final-integration-c02-status-2026-11-27.md) (direct ESM and dependency debt remain separate from the CJS research runtime).
- [Earlier full Codex handoff](codex-final-handoff.md) is historical; its implementation-status statements and ordered gates predate the current business-first path.

Use the existing CLI diagnostics for raw account inspection, exact integer/share reconciliation, SDK weight/message checks, historical replay and archive audit. Do not add these as prerequisites for fixed Paper runs. Keep local evidence and credentials out of Git.

## Historical engineering records

The original detailed 116 KB T01–T17/CR handoff is preserved at [the immutable prior revision](https://github.com/dinnelthai/autoresearch-dlmm/blob/aa5deb7b131df06b0e6fbbdd600d6b4cdfb8a632/docs/integration-handoff.md). All earlier phase notes, prototype reviews and acceptance records remain accessible in [the historical docs tree](https://github.com/dinnelthai/autoresearch-dlmm/tree/aa5deb7b131df06b0e6fbbdd600d6b4cdfb8a632/docs). They are evidence of earlier work, not current operating instructions. Core mathematical specifications, real observation records, and detailed acceptance runbooks remain in the current tree.

The legacy Python optimizer is separate OHLCV exploration; use it for historical research, not as a substitute for the current JS Paper accounting.

25 completed implementation and partial acceptance notes were retired from the active tree. See [their original versions](https://github.com/dinnelthai/autoresearch-dlmm/tree/b55608f2f3de5f6a9dca313b7e48b9d1708460df/docs). The current runbook and revision-specific tests supersede historical phase statuses.

New evidence-builder requests archive the collection clock and source errors in the snapshot's hashed `diagnostic.json`. The response still includes a candidate summary for compatibility; its `capture` points to the snapshot, not a separate candidate directory. The catalog lists each snapshot once and retains old candidate-only pointers. Existing candidate directories are untouched.

The Paper page starts directly with fixed observed-bin controls and an optional flat Adaptive row. The automatic decision path prefers collected observations, falling back to a matched reviewed observation if needed. Explicit legacy API review-bound opening remains available. The observation basis remains visible; neither source implies calibrated profitability.

Wallet observations do not run integer-allocation or SDK weight/inverse diagnostics. Those diagnostics are reserved for explicit strategy review and the existing independent audit tools. Shared wallet capture verifies identity, freshness and raw bytes before returning read-only balances.

## Research report priority (RP01–RP09)
Automatic optimization is deferred. First preserve one observation log per committed market capture: market regime and causal input status, candidate counts/best scores/rejection reasons per strategy or action, selected candidate and actual operation, before/after virtual assets and the existing accounting points. All runs collect market features for research, including fixed-only experiments. Missing or warmup inputs remain UNKNOWN. Raw bin data stays in referenced capture files. Full individual candidate-grid enumeration is not included in the compact history. No fabricated regime or synthetic return is added to real-market reports.

### Research report (RP04–RP06)
Run `node research/live/paper-history-audit.mjs --pool POOL_ADDRESS --id auto-UUID --report > report.json` against a stable checkpoint. The report aggregates verified local history in one pass. Each interval uses the prior capture's fresh classification; unavailable/expired inputs are UNKNOWN and capture gaps are excluded. It includes all eight strategies, eligible and missing intervals, observed duration, net/alpha and fee/cost attribution, opening costs, and a bounded sampled chart series. Raw integer SOL amounts are lamports, price is raw Y/X Q64. Fee accrual is marked at the interval end, prior holdings at the new price, and remaining inventory conversion/rounding is a residual, not protocol-exact IL. No automated optimization. Report generation does not claim independently verified market coverage or profitability. Retry on concurrent checkpoint change or pause first.

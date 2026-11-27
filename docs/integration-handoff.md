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
node research/live/check-local.mjs
```

Open http://127.0.0.1:8790. Select the configured Pool, set virtual capital/risk preferences, and start a Paper experiment on the performance page. Adaptive is optional. Fixed controls can run without reviewed reference inputs. Adaptive uses available reviewed or explicitly labeled collected proxy observations; it must not fabricate absent data. Current model still requires fresh dual-reference quotes and sufficient observations. Do not mix actual position reports with Paper results.

Observe increasing snapshots, eight strategy rows, fees, NAV, alpha vs HODL, drawdown, open/reposition/exit, and completed-window scoring. Test restart and archive integrity. A completed observation window is not independently validated profitability. No full live Adaptive acceptance has been established by this documentation.

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

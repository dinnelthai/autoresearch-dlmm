# Paper Trading — feature freeze and Codex local acceptance
Scope: read-only real market inputs and virtual funds only. No real wallet signing, mainnet submission or actual PnL claims. Stop adding features until integration gates pass. Preserve existing configurations, archives and local changes. Never fabricate evidence or relax review/coverage gates.

## 1. Native checkout and tests
Worktree: /Users/leon/Documents/work/autoresearch-dlmm. Inspect git status, preserve local changes, fetch origin main and fast-forward only when safe. Record exact HEAD. Use approved Node 22.23.4 and existing pinned Meteora SDK 1.9.15 tarball SHA256 7e8da2ee2e528a5aba4c1efd3909dcd74ac94cfed380fa9636f256ade1a41b3b. Follow docs/sdk-source-build.md if artifact absent; no silent downgrade or lockfile change. Verify dependencies and run:
```sh
node research/live/verify-offline.mjs
node research/live/check-local.mjs
```
Record actual test totals, failures, stderr and hashes. Fix reproduced failures only; rerun suite.

## 2. Restore local services
Inspect port listeners with lsof -nP -iTCP:8788 -sTCP:LISTEN and likewise 8790. Do not kill unknown processes. Use existing data/live-config.json and data/terminal-config.json, match pool, IDL and review, keep RPC environment private. Start in separate terminals if absent:
```sh
node research/live/state-service.mjs --config data/live-config.json --port 8788
node research/live/terminal-server.mjs --config data/terminal-config.json --port 8790
```
curl -fsS http://127.0.0.1:8788/health and http://127.0.0.1:8790/health. Rerun check-local. Investigate actual RPC, SDK, unsupported mint, missing accounts, reference or review errors. Do not bypass evidence checks. Each configured additional pool needs its own collector and review file.

## 3. First virtual smoke
Open http://127.0.0.1:8790/, use supported classic SPL MEME-X/WSOL-Y pool, prepare hypothetical capital and explicit risks/costs, choose seven-day experiment. Enable T10 only with fresh reviewed inputs. Start Paper Trading. Record actual /api/terminal/paper-status and /api/terminal/paper-pools; confirm at least three strictly increasing finalized market slots with matching raw hashes; all eight rows and blocked paths retained, HODL comparison, fee dilution, costs and max sampled drawdown. Actual zero rebalances is valid; report evidence blockers. Audit archive:
```sh
node research/live/paper-history-audit.mjs --pool POOL --id RUN_ID
node research/live/archive-audit.mjs
```
Prefer quiescent experiment for audit; concurrent writes may legitimately block. Check disk budget without deleting evidence. No ranking or PnL readiness promotion.

## 4. Fault tests on isolated fixtures
Synthetic regressions cover high/low/reversal marks, fee regression, missing bins, supply collapse, order states, gap and archive corruption. Latest batch 16 isolated logic tests passed (not native Node suite). Run them natively; inject RPC outage, process restart, file write failure between shard and checkpoint on disposable test environment only, not active user processes. Exact orphan retry permitted, conflicting orphan blocks; no silent overwrite. Verify pending intent cleared on exit/block, cost deducted once, old pre-freeze capture cannot wait forever after deadline, stopped experiment cannot be overwritten by pause. Check stale lock with operator, never blindly remove it. Record timings, CPU, memory, disk, logs and real browser/HTTP verification. Full historical audit remains needed; active shard validation is bounded, not global on each append.

## 5. Local protocol sample calibration
Use isolated unsigned simulation per docs/paper-trading-phase-10.md, test-only accounts, exact program provenance. Compare share/principal/fees/rent with predetermined tolerance. LiteSVM, complete swap/withdrawal replay, independent protocol validation and dynamic cost calibration remain open. No fabricated calibration results; no real funds.

## 6. Forward evaluation
Seven-day smoke then distinct thirty-day windows. Freeze budget, policy and costs; retain blocked/missed/paused paths. Same-window HODL, no cross-pool ranking, no annualizing partial observations. Report endpoint timing, gaps, full hash audit, no independently verified coverage claims. Historical OOS/stress evaluation must avoid tuning on evaluation windows. Do not report future results before observation window elapsed.

## Deliverable
One local acceptance report: exact HEAD, Node/SDK hashes, native tests passed/failed/skipped, service health, raw capture proof, experiment ID/count, review gates, actual logs (redact credentials), reproduced fixes and outstanding blockers. Commit reviewed non-secret fixes to main; preserve raw archives and private configuration locally. Feature freeze is an engineering decision, not live acceptance.

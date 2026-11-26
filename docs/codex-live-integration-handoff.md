# Codex local read-only integration handoff
Goal: connect real data, not add trading logic. Preserve acceptance and execution gates. Browser previously displayed old HTML and Failed to fetch. Do not assume latest source is running.

1. Sync main with git pull --ff-only origin main. Do not discard local changes. Inspect Node version (22 recommended), pinned IDL, vendor tarball checksum, dependency lock and SDK import. Do not substitute SDK version.
2. Run node research/live/verify-offline.mjs. Fix failures, re-run, record commit, test counts and artifact.
3. Identify listeners with lsof -nP -iTCP:8788 -sTCP:LISTEN and same for 8790. Inspect actual local config paths and process ownership. Restart only project-owned stale processes in separate shells using existing configs and private RPC environment. No RPC secrets in output. Do not delete writer locks without confirming ownership and stopped processes.
4. Run node research/live/check-local.mjs --live-config data/live-config.json --terminal-config data/terminal-config.json (substitute actual local paths if different). Exit zero is local read-only acceptance only.
5. Browser hard refresh and check Bin rows, balances after explicit wallet connection, K line, TVL, A-B-A pool switch, wallet position detail, external quote and input status. Record statuses and raw evidence hashes.
6. Capture bounded Swap sample; compare V1 fields with independent provider. V2 position observation needs exact SDK principal/fee cross-check. Do not mark actual PnL ready. Collect missing holder, flow-window, token safety and second independent source evidence, not defaults.
7. Re-run full verifier and local check after fixes. Report pass/fail/blocked separately, with commit, slots, evidence hashes and remaining blockers. No transaction building, signing, submission or readiness promotion.

Expected API version flow-data-v8. The script does not restart services or execute external RPC. No local acceptance was performed by this remote commit.

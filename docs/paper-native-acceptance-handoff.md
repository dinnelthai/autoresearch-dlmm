# Native acceptance complete for targeted suites; local integration handoff

## Recorded evidence
- Latest native CI run: https://github.com/dinnelthai/autoresearch-dlmm/actions/runs/45870937661
- Tested commit: 1cfa4c70b330b19f3aceeca033da8f627aa7fd9b (Node 22.16.0, Linux x64).
- Native engine: 65 pass, 0 fail, 0 skip. Native paper service/local HTTP probe: 7 pass, 0 fail, 0 skip.
- Earlier four targeted batches reported 38 passes; not rerun together here. Do not treat 110 cumulative reported passes as a full checkout verification.
- Exact same-runtime baseline parity passed 12/12 in run 45869816274. Historical fingerprints remain diagnostics because pinned original and current implementations produced identical output in that runtime.
- Real paper service exercised start, two advancing observations, restart, fee accrual, archive verification and pause with injected decoded synthetic snapshots, not live RPC or the installed SDK.
- Current observed browser at http://127.0.0.1:8790/ still reports Failed to fetch. No Mac terminal access or direct service/process evidence was available in chat.

## Stop feature work. Execute on the actual Mac.
Preserve local changes, existing archives, configs, RPC credentials and vendor tarball. Do not use real wallet funds, sign transactions, or bypass review gates. Run commands in order and stop at the first failing prerequisite.

```sh
cd ~/Documents/work/autoresearch-dlmm
git status --short
git fetch origin main
git merge --ff-only origin/main
git rev-parse HEAD
node --version
node --test research/live/sdk-runtime.test.mjs
node research/live/check-local.mjs
```

If SDK test fails, inspect the installed dependency tree and vendor tarball against docs/sdk-source-build.md and the existing consumer lock. No silent SDK downgrade or lock rewrite. If local read checks fail, inspect named endpoint reasons, then:
```sh
lsof -nP -iTCP:8788 -sTCP:LISTEN
lsof -nP -iTCP:8790 -sTCP:LISTEN
```
Identify existing processes first; do not kill unidentified listeners. Confirm the actual config filenames and that both target the same intended pool. For absent listeners only, use two separate terminals from the repository root with the existing RPC environment:
```sh
node research/live/state-service.mjs --config data/live-config.json --port 8788
```
```sh
node research/live/terminal-server.mjs --config data/terminal-config.json --port 8790
```
If these are not the existing config filenames (for example a .local.json config), use the real filenames and pass --live-config and --terminal-config to check-local accordingly. Do not create guessed configs or expose credentials. Check both /health endpoints and rerun check-local. HTTP health is not market readiness.

## Independent SDK evidence
The independent Linux build workflow is `.github/workflows/sdk-independent-build.yml`. It checks the pinned upstream source blobs, uses the recorded Node/pnpm versions, disables install lifecycle scripts, and fails closed if the rebuilt tarball or existing consumer lock differs. Only an identical artifact can enter the consumer test; no registry downgrade or lock rewrite. Even an exact rebuild and successful ESM check would not independently close the dependency/security or protocol gates. No RPC or wallet operations in this workflow.

## Acceptance gates remaining
1. C02: installed pinned SDK adapter and actual CLI import pass **and** the required direct ESM contract passes, artifact integrity is verified, and the outstanding dependency risk/compatibility review is resolved or explicitly approved by the risk owner. Adapter success alone does not pass C02. See docs/c02-source-build-results-2026-11-26.md and docs/c02-runtime-security-review.md. No new T01–T06 capture before formal C02 acceptance.
2. C03: fresh finalized market account capture with verified SDK/IDL provenance, same pool/mints/slot/raw hash and decoded bitmap/bin coverage.
3. C04: both services, current state and input diagnostic agree; collect independently reviewed reference/flow/risk inputs as required by the existing engine. No readiness promotion on missing evidence.
4. Paper: start virtual capital only; verify eight strategy rows, at least three distinct finalized snapshots, fees/costs and HODL accounting, audit the archive. Retain blocked strategies. Complete seven-day window before a window-level conclusion. See docs/paper-final-local-acceptance.md.

Return actual SDK test output, check-local report, relevant redacted service errors and exact HEAD. Never commit data/ or secrets. No claimed live PnL or end-to-end real-market pass until observed.

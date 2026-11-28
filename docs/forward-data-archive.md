# H05: forward observation archive
2026-11-28. Reuse live collector. No new RPC service or database, no changes to main or strategy. state-service.mjs calls capture-accounts.mjs and retains raw finalized single-context captures in data/raw/accounts-*; the rolling signature history retention limit is not the same as raw capture retention. Existing archive-audit.mjs inventories storage but does not measure time coverage.

## Run after normal collector has accumulated data
From repository root with existing pinned SDK/IDL installed:
```sh
node --test research/history/archive-core.test.mjs
node research/history/archive-snapshots.mjs --pool YOUR_POOL --day 2026-11-27 --idl data/raw/dlmm-idl.json --cadence 60
```
Use UTC day and the actual collector target cadence. It reads only existing files, verifies raw hash and pinned decoder, filters the chosen pool, rejects partial/unsupported market observations and conflicting same-slot states, deduplicates identical raw hashes and equivalent same-slot states. Output data/historical/POOL/snapshots/YYYY-MM-DD/manifest.json and content-addressed gzip NDJSON, including raw decimal strings (X/Y, Q64 price, supply, fee growth), slot, receive time, SDK/IDL, token decimals and raw capture reference. Original raw evidence stays in place. Scan defaults to 50,000 candidate directories and refuses over-budget rather than silently omitting coverage. Run after a UTC day closes; a rerun produces a new immutable-by-name gzip if evidence changed. Do not delete old versions until manually verified and backed up. Stale run.lock requires confirming no running process before manual removal.

## Interpretation
Bucket coverage = distinct eligible observation time buckets / expected buckets in requested UTC day. It uses local RPC receipt time, not chain time; includes initial and final gaps. It is not proof of continuous events or full historical Bin state; bitmap-marked arrays are not all allocated arrays. Same-slot conflicts exclude the entire slot. Unsupported versions, missing bins and failed decodes are recorded, not filled. Raw fee growth is observed, not attributed yield. Never bridge missing time with fabricated observations or treat this export as exact replay. A100 can consume this separate observed-snapshot research format after dataset validation.

## Operational acceptance (pending real host)
1. Select one pool and run the existing live service with intended cadence, no separate collector. Observe 24 hours and collect disk usage, RPC request/failure counts, process uptime and actual observation cadence. Do not promise the configured cadence is achieved.
2. Run this archive tool, verify gzip digest, sample raw capture links, inspect missing buckets and rejection classes; compare against collector logs. Require field coverage and appropriate observation density before expanding to 3–5 operator-selected pools. Initial quality target (proposal): 95% buckets at measured cadence, no unexplained identity/slot conflicts; never a substitute for completeness.
3. Confirm backup restore of raw and normalized files. No automatic deletion. Estimate compressed daily bytes and retain raw checkpoint evidence. Export one day at a time; scanning many directories and memory cost should be measured before a long-run index or streaming partition writer is introduced.
4. H06 Parquet/Colab manifest next: typed raw integers or strings; separate observation and swap datasets; freeze split times and pool identities; retain provenance and missingness. Do not mix legacy OHLCV PnL.

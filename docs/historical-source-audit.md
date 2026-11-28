# H02/H03: Source audit and historical reconstruction feasibility
2026-11-28. Documentation-level review only; sample files and live RPC not downloaded here. No target pool selected; no spending.

## Source evidence
- [Meteora API](https://dlmm.datapi.meteora.ag/swagger-ui/): pool metadata, OHLCV, volume history, position history. No documented complete per-pool swap feed or historical BinArray state stream. Use existing RPC capture for current state.
- [Datastore HF sample](https://huggingface.co/datasets/DataStore/meteora-dlmm-historical-data): dataset card reports 74 tables, 59,575 rows; legacy swap_event capped at 1000 events, 114 pools, only 17 seconds (2026-06-10 09:38:33–09:38:50). Use schema/parser testing, not training or volume trends. Instructions and events are separate representations; never union to count swaps. Retain slot/tx_index/ix_path, sig, raw amounts as strings, fee fields separately. Do not deduplicate distinct events just by signature. Full commercial coverage and targeted cut price not verified.
- [Bitquery](https://bitquery.io/datastore/datasets/meteora-dlmm): public 82-column trades and 64-column pools schema; website lists $150/31 days, $750/184 days, $1500/365 days, as of review. Despite bin-level marketing, the published pools column list does not explicitly expose bin ID, Q64 fee growth or liquidity supply; reserve ratio is not DLMM price. Do not purchase until provider delivers representative exact-field samples or confirms unavailable fields. Ask for selected-pool custom cut, not full market.
- [Meteora event docs](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/events.mdx) and [account docs](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/accounts.mdx): swap events report start/end bins and aggregate amounts; BinArray accounts hold state. Aggregate amounts alone do not uniquely determine how much executed in every crossed bin or fee growth.

## H02 real sample run
Use existing capture with user-provided pool, RPC and pinned IDL. Start with 50 signatures.
```sh
node research/history/backfill-swaps.mjs --pool YOUR_POOL --since 2026-11-26 --batches 1 --limit 50
node research/live/inspect-swaps.mjs --capture data/raw/swaps-REPLACE --idl data/raw/dlmm-idl.json > data/decoded-sample.json
node research/history/sample-quality.mjs data/decoded-sample.json > data/sample-quality.json
node --test research/history/sample-quality.test.mjs
```
Inspection can return nonzero for partial evidence while still producing JSON; audit it rather than discarding it. Quality report includes event identity/count checks, field presence by version, observed time span, gap classes, raw integer validity, hash. This is not full window coverage. Do not derive fee rate from feeBpsFieldRaw without validating its scale and fee side; legacy fee not silently mapped to MM fee. Track actual RPC charges from provider dashboard, elapsed time, gaps and archive depth before expanding. Rough logical requests per one batch of N signatures: one index call + N tx calls + U distinct-slot block calls (U <= N); retries extra. This does not predict billed credits or calendar coverage.

## H03 reconstruction gate
For exact historical replay obtain a same-slot initial account checkpoint (all relevant BinArrays, pool dynamic fee parameters, bitmap, mints, liquidity supply and cumulative fee growth), complete ordered successful state transitions across all affected accounts (including add/remove, swaps, limit orders, rebalances and protocol upgrades), version-correct arithmetic and rounding, and independently observed later account checkpoints. Prove conservation and reconcile raw X/Y, supply and fee growth per bin, not just pool totals. A present-day account snapshot cannot initialize past state. RPC signatures are an address index, not a complete account-write archive. If no historical checkpoint or full transitions exist, mark exact replay blocked; use observed forward snapshots plus separate statistical aggregate swap features with explicit limitations. No fabricated fills, yields or fee growth; no GPU-ready claim until evidence accepted.

## Next
H02 execute with operator-selected pool; H03 audit forward archive retention and cadence; H04 decide between free selective RPC vs paid targeted historical cut based on cost and field coverage. No automatic parameter optimization, main changes or GPU jobs.

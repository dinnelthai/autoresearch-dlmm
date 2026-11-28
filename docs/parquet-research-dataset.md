# H06: immutable Parquet research dataset
This stage converts existing H02/H05 evidence only. No network, no GPU, no new trading model. Use operator-selected pools only (maximum five). The original raw evidence is retained. No automatic promotion to model-ready data.

## Build
Node collection/inspection remain unchanged. Python uses existing project PyArrow dependency; a minimal isolated venv is also sufficient (Python 3.10+ and pyarrow>=14).
```sh
uv sync
cp research/history/dataset-spec.example.json research/history/dataset-spec.local.json
# Edit pool, UTC boundaries, actual manifest and report/quality paths.
# Paths are relative to spec file; keep local spec with data (not tracked).
uv run python research/history/build_dataset.py --spec research/history/dataset-spec.local.json --output data/historical/datasets/study-001
uv run python -m unittest discover -s research/history -p 'test_build_dataset.py' -v
```
Alternatively place the spec in data/ and adjust relative paths. The example uses illustrative dates and placeholders; cannot run until replaced. Input snapshots must have a H05 manifest, matching gzip hash and row count. Input swap reports must have no gaps, a matching H02 quality digest and validated CPI identity. If overlapping capture reports contain the same transaction for the same pool, export rejects them rather than double count. Resolve overlaps from original evidence first. No silent filtering of rows outside the frozen time window.

## Output
Separate bin_snapshots and swaps directories, then split/pool/UTC day, with bounded 4096-row Parquet chunks compressed using Zstandard. All protocol uint64/uint128 fields are canonical decimal strings, avoiding float rounding and Arrow signed-decimal limits; explicit conversion needed for GPU. Nullable version-specific fields stay null. Snapshot clock is local receipt UTC; swap clock is chain block time. They are not a common synchronized sample and no as-of join is performed. No per-bin Swap inference, fee differencing, or model labels. Snapshot output includes raw capture reference, slot, SDK/IDL, mint/decimals, array and bin identity, original raw hash and source manifest hash. Swap output preserves transaction and instruction order and fee semantic fields.

Dataset manifest records frozen UTC boundaries, input hashes, snapshot coverage/issue count, file hashes, row counts and fidelity flags. The split is global time-based; do not use validation or test for parameter fitting. A single split may be empty at this stage; check coverage before any experiment. Same-slot overlap across daily archives is rejected. Train/test cut points are midnight UTC, but snapshot arrival vs chain time may differ; H08 needs an explicit availability-time contract and embargo before joint use. Output is staged and published only on successful validation; use a new output directory for each experiment. No overwrite in normal single-process use; avoid concurrent builders targeting the same path. Per-partition chunks bound write buffers; global identity sets and number of touched days still consume memory, so measure scale before large backfills.

## Acceptance
Synthetic integration tests cover Parquet round-trip, uint128 max, >2^53 values, split boundaries, null fees, duplicate slots/transactions, input hash binding and failed build cleanup. The historical-data CI runs on this research branch only. Actual host acceptance remains: operator pool, real inputs, verify actual byte hashes and schema, record row counts, validate chronological coverage, measure speed/memory, and back up source evidence. No claim of complete history, exact protocol replay, calibrated return or profit. H07 transfers an immutable dataset to Drive with a verified manifest; H08 computes only after dataset and parity gates.

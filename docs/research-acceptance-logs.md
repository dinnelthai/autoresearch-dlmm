# H09 / L01: exportable research acceptance evidence
User priority: logs and evidence before GPU. No new DB or RPC, no change to main. Existing source manifests remain the evidence of each completed stage. All timestamps UTC. Stage logs record actual wall duration, start/end, code commit and exit code; no environment, argv, raw stdout/stderr, RPC endpoint or wallet private key is written into logs. Direct existing CLI invocations still work but won't have wrapper start/end records.

## Run with logging
From repository root using existing Node/Python environment:
```sh
uv run python research/history/acceptance_log.py run candles -- --pool YOUR_POOL --start 2026-11-01 --end 2026-11-02
uv run python research/history/acceptance_log.py run swaps -- --pool YOUR_POOL --since 2026-11-26 --batches 1 --limit 50
uv run python research/history/acceptance_log.py run decode -- --capture data/raw/swaps-REPLACE --idl data/raw/dlmm-idl.json > data/decoded-sample.json
uv run python research/history/acceptance_log.py run quality -- data/decoded-sample.json > data/sample-quality.json
uv run python research/history/acceptance_log.py run archive -- --pool YOUR_POOL --day 2026-11-27 --idl data/raw/dlmm-idl.json --cadence 60
uv run python research/history/acceptance_log.py run dataset -- --spec data/dataset-spec.json --output data/historical/datasets/study-001
uv run python research/history/acceptance_log.py run sync -- sync data/historical/datasets/study-001 "YOUR_DRIVE/dlmm-research/datasets/study-001"
```
Replace example addresses and dates. Each run has a separate JSONL in data/historical/logs. A killed run has a start without end. Child output stays in terminal or explicit redirect; no secrets from it are included in log export. Existing live service logs/diagnostic export remain separate; do not run duplicate collector. The wrapper is a finite research-stage runner, not a 24-hour daemon.

## Export one small JSON at every checkpoint
```sh
uv run python research/history/acceptance_log.py export --pool YOUR_POOL --output data/historical/acceptance-H02.json
uv run python research/history/acceptance_log.py export --pool YOUR_POOL --quality data/sample-quality.json --output data/historical/acceptance-H05.json
uv run python research/history/acceptance_log.py export --pool YOUR_POOL --quality data/sample-quality.json --dataset data/historical/datasets/study-001 --output data/historical/acceptance-H06.json
```
Repeat --pool for up to five operator-selected pools and --quality for each report. Use new output filename each time; optional --history points to existing collector's historical directory; optional --logs points to wrapper log directory. For separate Git worktrees ensure the chosen collector archives/data are accessible to the research worktree; do not assume ignored data is shared. Export can run with partial stages and records missing evidence. Dataset export checks hashes, actual Arrow schema and row counts, partition identity, per-pool/split/day coverage, distinct observed slots/times, interior time gaps, field non-null counts, buy/sell direction counts and multi-bin swap counts. H05 manifest adds full-day time buckets including edge gaps. Stage artifact summaries do not revalidate raw evidence; dataset verification does not prove upstream authenticity. Sum of daily distinct slots is not a global unique-slot guarantee. No automatic statistical sufficiency verdict or GPU authorization: missing days, poor coverage, lack of varied regimes, missing protocol fields and weak sample independence need human review. Do not count millions of bin rows as millions of independent observations. No exact replay or profitability claim.

## Review checkpoints
H02: source sample quality, actual observed span, gap reasons and field coverage; H04: backfill progress and time reach, no complete-window claims; H05: daily cadence and conflicts; H06: distinct snapshot times vs bin rows, per split/pool days, raw field presence; H07: run sync then export against the destination dataset to verify local bytes; remote Colab propagation must be checked separately. H08 deferred until data sufficiency reviewed. Reports include public pool identifiers and research metadata; inspect before sharing. No raw transaction payloads, private config, arbitrary logs or absolute local paths included in JSON body. CI covers synthetic logs and dataset report; actual user data remains pending.

# autoresearch-dlmm

Meteora DLMM adaptive liquidity research on Solana, inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) and adapted from [miolini/autoresearch-macos](https://github.com/miolini/autoresearch-macos).

## Primary workflow

Real market observations → market features → JS mathematical strategy engine → virtual Paper accounting → matched HODL comparison → parameter research.

The terminal uses virtual SOL/MEME capital; it does not sign or submit transactions. Observed-bin fee accounting is a proxy, not protocol-exact income. Automatic Adaptive uses collected market features or matched reviewed evidence. A missing input does not fabricate an observation.

Follow the [current integration runbook](docs/integration-handoff.md) for the installed Node 22 runtime, pinned SDK, collector configuration, terminal and local verification. The terminal normally runs at http://127.0.0.1:8790.

For standalone normalized-event research (no SDK or RPC required):

```sh
node research/test.mjs
node research/cli.mjs demo range
node research/cli.mjs compare dataset.json
node research/cli.mjs optimize samples.json > optimization.json
node research/cli.mjs paper-next paper-request.json optimization.json
```

The final command requires an already running local terminal and an accepted proposal with a later market capture. It starts a new virtual experiment, not a funded trade. The optimizer consumes genuine normalized event samples supplied by the caller; automatic conversion from archived live snapshots into such samples is not implemented. Read [research/README.md](research/README.md) for the event schema, parameter search and limitations.

## Code ownership

| Area | Responsibility |
|---|---|
| `research/engine/`, `research/engine.mjs` | Canonical strategy, risk, normalized-event simulation and optimizer |
| `research/integer.mjs` | Exact integer reconciliation |
| `research/live/` | Raw captures, market/feature normalization, observed-share Paper, local terminal |
| `docs/` | Current runbooks, mathematical specifications and acceptance evidence |
| Root Python scripts | Separate historical candle exploration and LP benchmark collection |

## Legacy Python research

The Python pipeline is intentionally separate: OHLCV candles cannot reconstruct actual per-bin swap fills, fee growth or liquidity shares. Its approximate PnL and rolling-window metrics must not be fed into the JS optimizer or promoted to live results. Python keeps the original market-data collection, LP Agent benchmark acquisition, heuristic simulator, strategy, learning history and optional agent-edit loop.

```sh
uv sync
cp .env.example .env
uv run prepare.py --horizon swing
uv run backtest.py --horizon swing --eval-mode rolling --split both
uv run loop.py --horizon swing --rounds 20 --agent-cmd 'codex exec $(cat {prompt_file})'
```

Use the same pool and horizon across all three legacy commands. The old agent loop repeatedly uses validation for development and cannot establish unbiased out-of-sample performance. See [program.md](program.md) and the [full historical Python guide](https://github.com/dinnelthai/autoresearch-dlmm/blob/d35b9301a38d0fee9bb3cf545c367149dac6a069/README.md) for every flag, horizon preset, benchmark description and original project structure. Neither Python nor its dependencies are required for the primary JS Paper workflow.

## Validation

- [Local acceptance runbook](docs/t17-acceptance-runbook.md)
- [Real-source startup evidence](docs/business-first-live-2026-11-27.md)
- [Historical fixed-bin experiment](docs/one-case-live-2026-11-27.md)
- [SDK source build](docs/sdk-source-build.md)

Native CI tests do not establish actual chain execution, calibrated returns, or full live Adaptive acceptance.

License: MIT.

# autoresearch-dlmm

Meteora DLMM adaptive liquidity research on Solana, inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) and adapted from [miolini/autoresearch-macos](https://github.com/miolini/autoresearch-macos).

## Core business contract / 核心业务契约

This contract governs new development, refactoring and acceptance. Prefer a complete, working research path over broader market coverage or more infrastructure.

- **Research goal:** determine whether Dynamic LP improves net return and risk-adjusted performance against HODL and fixed LP controls using real Meteora market observations and virtual SOL/MEME capital. Study market admission, capital allocation, bin range, liquidity shape, and dynamic position management.
- **Meteora first:** prioritize Meteora SDK + Solana RPC for account/bin/share/fee facts and Meteora Data API for pool discovery, market history and volume. Prefer other eligible Meteora pools for independent reference prices. DEX Screener, Jupiter, Raydium and other providers are optional supplements when the primary sources cannot satisfy a demonstrated research need. Do not build a general cross-DEX data platform or duplicate existing Meteora capabilities.
- **Market selection before expansion:** begin with the most suitable, mature, liquid and consistently active pools. Prefer sufficient usable bins, meaningful fee activity and volatility, reliable reference prices and complete model inputs. Start with one suitable pool to establish the full workflow, then expand to a small basket (initial suggested target: 3–5) only after the first experiment works. Do not target all MEME tokens, newly launched thin pools or other edge markets; do not weaken model requirements merely to increase coverage.
- **B01 data feasibility first:** verify real source availability, freshness, model-field coverage, valid reference depth, request cost and model-input readiness before changing adapters or buying data. Size quote probes to the research capital/inventory and relevant depth when needed. Missing observations must remain missing; the target pool price must not masquerade as an independent reference.
- **One primary path:** select pool and virtual budget → collect real market data → identify regime → use existing math to decide admission/allocation/range/shape → open, hold, reduce, reposition, remove and re-enter as supported → calculate observed virtual NAV, fees, costs and HODL alpha → produce a research report for manual analysis. Desired actions are acceptance requirements, not a claim that every action is already implemented.
- **Fair research:** use matched initial assets and observation windows, common declared risk/capital-budget constraints, and disclose actual deployment, missing samples, blocked paths and estimation assumptions. Keep market, decision and operation logs traceable to raw captures. Reports explain strategy strengths and weaknesses; they are not a separate product.
- **Control code growth:** reuse the canonical engine, existing collectors, Paper accounting and history/report path. Fix demonstrated business gaps first; consolidate repeated code and avoid speculative extensions, extra layers, databases or new streaming architecture without measured need. Keep accounting correctness and honest evidence boundaries without letting unrelated diagnostics block the core research path.
- **Scope freeze:** no automatic optimization loop, real-money execution, wallet-management expansion or general market coverage work in this phase. Generate reports first, manually inspect findings, then adjust parameters in a new experiment. Native CI is not real-market acceptance; advance based on actual experimental evidence.

## Primary workflow

Real market observations → market features → JS mathematical strategy engine → virtual Paper accounting → matched HODL and fixed LP comparison → research report → manual parameter research.

The terminal uses virtual SOL/MEME capital; it does not sign or submit transactions. Observed-bin fee accounting is a proxy, not protocol-exact income. Automatic Adaptive uses collected market features or matched reviewed evidence. A missing input does not fabricate an observation.

Follow the [current integration runbook](docs/integration-handoff.md) for the installed Node 22 runtime, pinned SDK, collector configuration, terminal and local verification. The terminal normally runs at http://127.0.0.1:8790.

For standalone normalized-event research (no SDK or RPC required):

```sh
node research/test.mjs
node research/cli.mjs demo range
node research/cli.mjs compare dataset.json
```

Existing optimizer and `paper-next` commands are retained for future research but deferred from the primary workflow. Automatic conversion of archived live snapshots into normalized optimizer samples is not implemented. Read [research/README.md](research/README.md) for the event schema and limitations.

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
```

Use the same pool and horizon across legacy research commands. The optional legacy automatic loop is deferred. The old agent loop repeatedly uses validation for development and cannot establish unbiased out-of-sample performance. See [program.md](program.md) and the [full historical Python guide](https://github.com/dinnelthai/autoresearch-dlmm/blob/d35b9301a38d0fee9bb3cf545c367149dac6a069/README.md) for every flag, horizon preset, benchmark description and original project structure. Neither Python nor its dependencies are required for the primary JS Paper workflow.

## Validation

- [Local acceptance runbook](docs/t17-acceptance-runbook.md)
- [Real-source startup evidence](docs/business-first-live-2026-11-27.md)
- [Historical fixed-bin experiment](docs/one-case-live-2026-11-27.md)
- [SDK source build](docs/sdk-source-build.md)

Native CI tests do not establish actual chain execution, calibrated returns, or full live Adaptive acceptance.

License: MIT.

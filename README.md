# autoresearch-dlmm

Meteora DLMM adaptive liquidity research on Solana, inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) and adapted from [miolini/autoresearch-macos](https://github.com/miolini/autoresearch-macos).

## Core business contract / 核心业务契约

This contract governs new development, refactoring and acceptance. Prefer a complete, working research path over broader market coverage or more infrastructure.

- **Research goal:** improve the net return and risk-adjusted performance of one Dynamic LP strategy using real Meteora market observations and virtual SOL/MEME capital. Study market admission, capital allocation, bin range, liquidity shape, and dynamic position management.
- **Meteora first:** prioritize Meteora SDK + Solana RPC for account/bin/share/fee facts and Meteora Data API for selected-pool metadata, same-pair auxiliary reference discovery, market history and volume. Prefer other eligible Meteora pools for independent reference prices. DEX Screener, Jupiter, Raydium and other providers are optional supplements when the primary sources cannot satisfy a demonstrated research need. Do not build a general cross-DEX data platform or duplicate existing Meteora capabilities.
- **User-selected research pool:** the operator alone chooses the target Pool, capital and parameters. No token selection, pool ranking, automatic switching or broad scans. Begin with the most suitable, mature, liquid and consistently active pools. Prefer sufficient usable bins, meaningful fee activity and volatility, reliable reference prices and complete model inputs. Start with one suitable pool to establish the full workflow, then expand to a small basket (initial suggested target: 3–5) only after the first experiment works. Do not target all MEME tokens, newly launched thin pools or other edge markets; do not weaken model requirements merely to increase coverage.
- **B01 data feasibility first:** verify real source availability, freshness, model-field coverage, valid reference depth, request cost and model-input readiness before changing adapters or buying data. Size quote probes to the research capital/inventory and relevant depth when needed. Missing observations must remain missing; the target pool price must not masquerade as an independent reference.
- **One primary path:** select pool and virtual budget → collect real market data → identify regime → use existing math to decide admission/allocation/range/shape → open, hold, reduce, reposition, remove and re-enter as supported → calculate observed virtual NAV, fees, costs and HODL alpha → produce a research report for manual analysis. Desired actions are acceptance requirements, not a claim that every action is already implemented.
- **Single Adaptive strategy (stage 2):** one virtual position lifecycle per operator-selected Pool. Spot, Curve, Bid-Ask, Hybrid, Asymmetric and Hybrid Grid are internal candidate shapes of the same strategy, not separate experimental portfolios. No parallel fixed-strategy control groups unless explicitly requested later. Initial-assets HODL valuation remains an accounting identity and opportunity-cost metric, not an additional strategy. Preserve historical reports; do not migrate active old-model runs.
- **Math-to-implementation completeness:** every in-scope model feature, parameter, decision, allocation, action and accounting effect must have a traceable implementation and test. Prioritize the canonical mathematical model and parameter adjustment, not new strategy variants or infrastructure. Distinguish code/test coverage from protocol accuracy and actual real-market acceptance. Achieve full declared-scope implementation coverage before optimizing parameters; do not claim 100% while action paths are missing.
- **Fair research:** compare successive Adaptive experiments only when needed; disclose initial assets, observation windows, risk/capital-budget constraints, actual deployment, missing samples, blocked paths and estimation assumptions. Keep market, decision and operation logs traceable to raw captures. Reports explain strategy strengths and weaknesses; they are not a separate product.
- **Control code growth:** reuse the canonical engine, existing collectors, Paper accounting and history/report path. Fix demonstrated business gaps first; consolidate repeated code and avoid speculative extensions, extra layers, databases or new streaming architecture without measured need. Keep accounting correctness and honest evidence boundaries without letting unrelated diagnostics block the core research path.
- **Scope freeze:** no automatic optimization loop, real-money execution, wallet-management expansion or general market coverage work in this phase. Generate reports first, manually inspect findings, then adjust parameters in a new experiment. Native CI is not real-market acceptance; advance based on actual experimental evidence.

- **Business gates and mathematical integrity:** distinguish core data/accounting invariants from optional enrichment and engineering diagnostics. Automatic Paper accepts current target-pool observations without mandatory independent references, Holder completeness or history completeness; missing inputs remain unavailable and reduce confidence. Never bypass capital conservation, correct price/bin mapping, fee accounting or user risk budgets. Short smoke-test windows (5 minutes to 30 days) run the same strategy and accounting as long experiments; short reports do not establish long-term performance. Record deferred checks in [Paper business gate policy](docs/paper-business-gates.md). Preserve old experiments under their original model; do not mix model versions silently.

- **Current integration acceptance (highest priority, 2026-11-27):** the active Codex task is to run the existing single Adaptive Paper loop on user-selected Meteora pools (DLMM / requested DLMM V2, verify actual protocol identity). Accept the core path when real target-pool inputs reach the math engine, a feasible plan maps into a virtual LP position, and subsequent snapshots continuously update fees, NAV and adaptive decisions. Do not wait for the experiment endpoint or force an exit. A legitimate NO_LP decision is not a failure, but does not by itself prove opening. Diagnose actual candidate rejection and use existing offline fixtures for unobserved actions. Fix only demonstrated blockers in this path. Full-suite cleanup, exhaustive parameter sweeps, experiment lifecycle, version migration, report expansion, recovery infrastructure and unsupported market coverage are deferred unless directly blocking the core loop. Never fabricate inputs, force deployment or weaken mathematical/accounting invariants. Follow [the focused Codex handoff](docs/codex-dynamic-main-flow.md); it supersedes older broad integration checklists for this phase.

## 一键启动

在仓库根目录执行 `./start.sh`（或 `bash start.sh`）。默认使用现有 basket 配置和 8788/8790 端口，自动识别并正常停止本仓库占用端口的旧服务，再依次启动采集服务及 Web 服务，检查 HTTP 健康接口（不误杀其他程序；旧服务无法正常退出时提示日志），日志保存在 `data/run-logs/` 下本次启动目录。保持终端打开；Ctrl+C 同时停止两个服务。HTTP 就绪不代表行情已经就绪。可通过 `NODE_BIN`、`LIVE_CONFIG`、`TERMINAL_CONFIG` 指定现有本地运行环境与配置；不自动安装依赖、不修改配置、不自动发起实验。

## 联调日志导出

在 Terminal 的 Performance / 自动快照模拟区域点击 **导出联调日志**，无需停止实验。也可访问 `/api/terminal/diagnostics?pool=POOL_ADDRESS`。JSON 包含当前池采集状态、Paper 实验参数、仓位及账本、最近 128 条已提交业务记录（市场、候选拒绝原因、动作和收益）和 Terminal 进程最近 500 条结构化事件。历史尾部未做全链审计；读取失败单独标记，导出不依赖完整报告。采集器独立进程的完整 stdout 不在该文件内，必要时另外保留终端输出。重启会清空内存事件，已提交业务记录保留。分享前检查文件，勿附带 RPC 密钥、环境变量或私钥。

## 核心数学算法与优化路线

[Dynamic LP 算法原理与数学优化路线](docs/dynamic-lp-algorithm-and-roadmap.md)：当前快照输入、市场识别、库存预算、Bin 权重、情景预测、效用函数、Paper 账本及 O01–O08 后续数学研究。先完成 C01–C03 核心业务联调并持续积累真实数据，再开展数学优化；路线不是当前开发前置任务。

## Primary workflow

Real market observations → market features → JS mathematical strategy engine → one Adaptive virtual position → Paper accounting → research report → manual parameter research.

The terminal uses virtual SOL/MEME capital; it does not sign or submit transactions. Observed-bin fee accounting is a proxy, not protocol-exact income. Automatic Adaptive uses collected market features or matched reviewed evidence. A missing input does not fabricate an observation.

Follow the [current integration runbook](docs/integration-handoff.md) for the installed Node 22 runtime, pinned SDK, collector configuration, terminal and local verification. The terminal normally runs at http://127.0.0.1:8790.

For standalone normalized-event research (no SDK or RPC required):

```sh
node research/test.mjs
node research/cli.mjs demo range
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

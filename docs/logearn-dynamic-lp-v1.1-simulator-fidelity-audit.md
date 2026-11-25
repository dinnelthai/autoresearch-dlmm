# LogEarn Dynamic LP v1.1 — 现有模拟器保真度审计与真实回放落地门槛

日期：2026-11-25。基于仓库 main 分支审计，审计基线 commit：8dec2db0840bb4fc3d2610253ce8362ec4f1a487。承接 v0.6 数据可得性审计、v0.7 4CHAN 样本审计、v0.8 原始数据合同、v0.9 Position 账本、v1.0 多池参考市场。本版本只审计现有代码并定义下一阶段验收；不修改程序、不执行 RPC、不签名、不发送交易、不采购数据。

## 1. 执行摘要

**当前仓库的 simulator.py 是 OHLCV 驱动的启发式收益代理，不是协议级 Meteora DLMM 历史模拟器。** 它可以用于快速探索区间宽度、价格指标和调仓触发器，但现阶段的 net_pnl_pct、net_apr、total_fees_usd、total_il_usd 和 final_portfolio_value_usd 均不能作为真实 Position 收益、可实现收益或资金效率结论。

本轮检查的主要文件：

- prepare.py：Meteora OHLCV / volume 与 LP Agent 数据抓取、清洗和缓存。
- simulator.py：合成 Bin 权重、估算费用、估算 IL、替换 Position。
- strategy.py：每根 Candle 调用一次的策略逻辑。
- backtest.py：单路径 / 重叠 rolling windows 评估与结果保存。
- config.py、program.md、README.md：参数、Agent 约束和项目说明。

现有实现没有读取 LbPair、BinArray、Position、Mint、Vault 原始账户，没有消费逐笔 Swap / Liquidity 指令，也没有重建 Position shares / fee checkpoints。因此不能把现有引擎的输出与 v0.9 的真实 Position 账本混用。

## 2. 代码审计发现

状态定义：
- P0：会直接破坏收益、资产或协议状态正确性；在修复前禁止真实 PnL 结论。
- P1：会显著影响策略比较、样本质量或实验解释；在进入样本外策略验收前必须处理。
- P2：工程和可观测性改进，可在核心账本正确后处理。

### F01 — 手续费单位存在 100 倍换算风险（P0）

证据：
- prepare.py 的 get_pool_runtime_config() 返回字段 base_fee_pct，默认值为 0.25，并以百分数格式打印。
- backtest.py 的 make_pool_config() 将 runtime["base_fee_pct"] 直接传入 PoolConfig.base_fee_bps。
- simulator.py 的 simulate_candle_fees() 使用 fee_rate_decimal = pool.base_fee_bps / 10000。

若 Meteora API 返回的 0.25 表示 0.25%，正确小数费率应为 0.0025；当前路径得到 0.25 / 10000 = 0.000025，即 0.0025%，低 100 倍。

本项属于代码单位接口不一致；API 的真实字段语义仍须用一个原始池响应确认。修复原则：内部只保留明确单位字段（例如 base_fee_percent 或 base_fee_bps），在单一边界转换一次；禁止 percent / bps 混用。增加 0.25% → 25 bps → 0.0025 的单元测试。

### F02 — Candle 成交量被人为分配到 Bin（P0）

证据：simulator.py 的 simulate_candle_fees()：
- 用 price_open 与 price_close 的区间，选出两者之间的全部 Bin；
- 即使价格没有实际穿越，也会把开盘和收盘所在 Bin 强制加入；
- 把该段 volume_usd 平均分配给所有被选中的 Bin；
- 用固定 tvl_estimate_usd / num_bins 估算每个 Bin 的外部流动性；
- 以 our_liq / (est_bin_tvl + our_liq) 估算份额。

问题：
- OHLCV 没有提供每个 Bin 的实际成交数量；
- 价格经过某个 Bin 不等于该 Bin 一定发生对应规模的 Swap；
- 不同 Bin 的深度并不均匀；
- 真实 fee 取决于 Swap 指令、Bin 路径、Bin 状态、费用参数与协议拆分；
- 当前公式不使用 Bin 的真实 amount_x / amount_y / liquidity_supply 或历史 fee growth。

结论：现有 total_fees_usd 是启发式分摊结果，不是 Position 可领取手续费。

### F03 — Position 没有真实 X/Y 资产和 Shares（P0）

证据：simulator.py 的 Position 只保存 center_price、num_bins、shape、capital_usd、bin_prices 和 bin_liquidity。initialize() 把 capital_usd 按 spot / curve / bid_ask 权重分配到各 Bin。

缺失：
- token_x_mint / token_y_mint、decimals、token program；
- 每 Bin X/Y 本金数量；
- Position liquidity_shares；
- Bin liquidity_supply；
- Position 版本、fee owner、fee checkpoints、pending fees；
- Token-2022 transfer fee / hook 等扩展处理；
- 每次 Add / Remove / Rebalance 后的实际份额变化。

结论：它表示的是“USD 资本权重曲线”，不是可对账的 DLMM Position。

### F04 — IL 与 NAV 不是实际资产会计（P0）

证据：
- simulate_candle_il() 对每个被价格区间选中的 Bin 使用 bin_liquidity × (bin_step_bps / 10000)^2 / 4 累加。
- estimate_portfolio_value(state, current_price) 返回 position.capital_usd + total_fees_usd - abs(total_il_usd)，current_price 未参与计算。
- prepare.py 的 compute_metrics() 使用 total_fees - abs(total_il) 作为 net_pnl。

问题：
- IL 不是按 Position X/Y 库存相对 HODL 的真实差额计算；
- 没有实际买入 / 卖出数量和成交价格；
- 没有把 MEME 库存按当前独立参考价估值；
- 没有钱包资产、未领取费用、奖励、外部资金流和负债的组合账本；
- 不能计算实际可执行清算价值。

结论：当前 final_portfolio_value_usd 只是一个基于假设的资本减值指标，不是 NAV；net_pnl_pct 不能解释为真实策略净收益。

### F05 — Rebalance 直接替换 Position，没有撤出与重新部署结算（P0）

证据：simulator.py 的 run_backtest() 在 action == "rebalance" 时新建 Position 并直接执行 state.position = new_pos。

没有处理：
- 旧 Position 逐 Bin 资产撤出；
- 未领取手续费的结算与归属；
- 撤出后得到的 X/Y 数量；
- 新 Position 的资金来源与资本守恒；
- Composition Fee、网络费、Priority Fee、滑点；
- 部分成功、失败、过期、确认延迟；
- 旧仓撤出未确认时仍存在的风险；
- 新仓部署前的资金闲置和双重承诺。

结论：当前 rebalance_log 只能记录策略参数变化，不能作为真实资金调仓记录。

### F06 — 初始动作与 Exit 语义不完整（P0）

证据：run_backtest() 调用 strategy_fn() 获得 initial_decision 后，不检查其 action，而是无条件创建 Position。后续 action == "exit" 仅 break 循环，没有执行撤池、库存处置、最终结算或清算估值。

因此：
- 初始 NO_LP / HOLD / EXIT 不能被正确表达；
- REMOVE 不存在独立语义；
- EXIT 不等于成功退出；
- 无法核算撤池后仍持有 MEME 的剩余风险。

### F07 — OHLC 内部路径被固定为 O→H→L→C（P1）

证据：run_backtest() 将每根 Candle 固定拆为 O→H、H→L、L→C 三段，并按 50% / 30% / 20% 分配 volume。

OHLC 不包含真实高低点先后顺序，也不包含逐笔成交时刻。另一条合法路径可能是 O→L→H→C。该假设会改变被访问 Bin、估算费用与 IL。不能从 Candle 推断真实的逐 Bin Swap 路径。

### F08 — bid_ask 只是对称权重曲线（P1）

证据：Position.initialize() 的 bid_ask 权重使用关于中心对称的 1 - exp(-0.5 x²) + 0.1。

它没有：
- Bid / Ask 两侧独立资本预算；
- SOL 与 MEME 两种资产的数量约束；
- 每 Bin 的 token composition；
- Bid 承接后的库存增加；
- Ask 成交后的库存减少；
- 两侧独立 Markout / 风险限额。

因此不能把 SHAPE="bid_ask" 解释成已实现双边做市或 Bid-Ask 库存管理。

### F09 — LP Agent benchmark 存在选择偏差（P1）

证据：
- prepare.py 按 total_pnl 降序获取有限页的 Top LPers；
- filter_lpers_for_horizon() 在目标持有时长过滤后为空时回退为全部 LPers；
- extract_lper_features() 再只保留 total_pnl > 0 的钱包计算中位数、分位数和 APR。

这些数据可以作为“被筛选出的盈利头部钱包画像”，不能代表全体 LP、策略基准或可复制收益。空 horizon cohort 回退后，报告还可能把不匹配持有期的 LP 当作目标周期基准。

改进：分别报告全样本、亏损/盈利分组、匹配持有期样本和头部样本；空匹配组必须显示 unavailable，不得静默回退；保存请求排序、分页范围、抓取时间和供应商过滤说明。

### F10 — Rolling windows 不等于独立样本外实验（P1）

证据：prepare.py 的 generate_rolling_windows() 按固定 step 生成窗口；backtest.py 对每个窗口重复运行同一池的 Candle 数据。窗口可大量重叠，例如 168h 窗口每 12h 启动一次。

Rolling 适合检查不同入场时间的路径敏感性，但重叠窗口不是独立样本，不能直接用 window_count 作为统计样本量。当前 train/val 也没有跨 Token 冻结测试和基于标签期限的 embargo。

改进：保留 rolling 分布；同时报告窗口重叠率和有效独立区块；最终结论使用时间分组 / Token 分组的冻结测试集，并用 block bootstrap 或分组方法估计不确定性。

### F11 — Candle 清洗未验证连续性（P1）

证据：process_ohlcv() 排序并删除 OHLC 缺失行，但没有显式检查重复 timestamp、缺失 Candle、时间间隔异常、异常 OHLC 关系或数据源覆盖缺口。

改进：每个数据窗口生成 expected timestamps、missing intervals、duplicates、out-of-order、invalid OHLC 和 source coverage 报告。缺口不能默认为零成交或正常行情。

## 3. 当前代码允许与禁止的用途

### 允许（仅研究代理）

- 对同一 Candle 数据集比较区间宽度、中心价、指标与简单触发器；
- 做策略逻辑的 smoke test；
- 检查参数是否过度依赖单一入场时点；
- 把结果称为 heuristic score / candle proxy，不称为真实 LP PnL。

### 禁止（在真实账本验收前）

- 把 total_fees_usd 称为链上实际赚取的手续费；
- 把 total_il_usd 称为协议级 IL；
- 把 final_portfolio_value_usd 称为真实 Position NAV；
- 把 net_apr 作为预期实盘 APR；
- 以现有结果证明 Adaptive Inventory 优于 Static Bid-Ask；
- 把 rebalance_log 解释为已完成的链上调仓；
- 把 top LPers 的盈利分位数解释为全体 LP 的收益分布。

## 4. 双引擎边界

### Engine A — Candle Heuristic（保留现有）

定位：低成本策略假设筛选器。继续使用现有 OHLCV 与参数优化流程，但报告字段应标记为 heuristic / proxy。不得向真实收益账本写入结果。

建议输出名称：
- heuristic_fee_estimate；
- heuristic_inventory_penalty；
- heuristic_path_score；
- candle_window_score。

在未完成单位修复前，连手续费 proxy 也应标记为 unit-unverified。

### Engine B — DLMM Event Replay（新建、独立）

定位：以原始链上数据和锁定版本 Meteora SDK 为基准的事件状态回放与虚拟 Position 账本。

逻辑层次：
1. Raw ingestion：原始账户、交易、事件、供应商响应不可覆盖保存。
2. Canonical event parser：解码程序指令、inner instructions、Anchor events，并保留原始 bytes / path。
3. Ordered event stream：按 slot、transaction index、outer instruction、inner instruction、event index 排序。
4. Pool / Bin state engine：重建 LbPair、bitmap、BinArray、Bin 状态及费用参数。
5. Position accounting：识别 Position V1/V2，逐 Bin shares、checkpoint、pending / claimed fee。
6. Virtual LP engine：在明确的反事实假设下运行虚拟 Position。
7. Portfolio ledger：钱包、Position 本金、未领取费用、已领取费用、奖励、外部资金流、成本和负债。
8. Reference market：排除目标池，保存外部实际成交、深度和报价。
9. Replay / evaluation：输出可追溯的状态差分、收益归因、风险和数据质量。

Engine B 不直接复用 Engine A 的 fee / IL / NAV 公式。可以复用纯数据工具，但每个复用模块必须有单位和精度测试。

## 5. Engine B 的最小 Proof of Data 顺序

### P0-A — Pool identity 与原始账户

围绕 4CHAN 样本池：
- Pool：6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb
- 4CHAN Mint：DVdWuNK8ncn79B6z8nCiwcNAiwyFcmBPfChgxJGTpump
- WSOL Mint：So11111111111111111111111111111111111111112
- Meteora DLMM Program：LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo

只读获取并保存：
- LbPair raw account bytes、owner、lamports、data length、context slot；
- X/Y mint 顺序、decimals、Token Program；
- reserve vault addresses 与 vault raw balances；
- active_id、bin_step、status、pair type、fee parameters、volatility parameters；
- bitmap 与 Bitmap Extension；
- 全部已初始化 BinArray raw bytes；
- 4CHAN Mint 的 Token-2022 TLV extensions。

验收：原始账户与锁定 IDL 解码结果可复现；mint / vault / owner / decimals 对应关系一致；X/Y 顺序不靠网页猜测；保存原始 payload hash、RPC endpoint、请求时间和 context slot。

### P0-B — 一笔真实 Swap 的逐笔核验

从目标池交易中选择真实成功 Swap，至少覆盖：
- 双向交易；
- 穿越多个 Bin 的交易；
- 同一交易含多个相关 inner instructions / event 的情况；
- Token-2022 相关 transfer（如适用）。

每笔保存：
- signature、slot、block time、transaction index；
- outer / inner instruction path、event index；
- raw transaction、logs、meta、pre/post token balances；
- input/output mint 与 raw integer amount；
- pool vault token balance deltas；
- Swap2Evt 的实际字段与 fee components；
- parser / IDL / SDK version。

验收：
- 指令方向、mint、输入输出 raw amount 可与事件及余额差分解释；
- 失败交易不计为成功 Swap，但自身真实网络成本独立记录；
- 多事件按 instruction/event path 保留，不把 signature 当作唯一事件键；
- MM fee、protocol fee、host fee、limit-order fee 和 Token-2022 transfer fee 分开；
- 如果无法获得交易前后同一 transaction boundary 的账户状态，只能标记 slot-boundary / partial reconciliation，不得声称 tx-boundary exact match。

### P0-C — BinArray 状态差分

- 从 LbPair bitmap 和 Bitmap Extension 找到已初始化 BinArray；
- 读取每个相关 Bin 的 amount_x、amount_y、liquidity_supply、fee growth 和 limit-order fields；
- 对选中的 Swap 前后状态做差分；
- 结合原始指令顺序、事件和账户写入历史解释变化；
- 与供应商逐 Bin post-reserve / change 记录交叉核对。

验收：能解释选定交易影响的 Bin 集合和账户状态变化；若供应商只给 slot 聚合或 post-state，不把它伪装成 instruction 级路径；缺少中间状态时明确标记边界限制。

### P0-D — 真实 Position 份额与费用

先从 PositionCreate / AddLiquidity 交易或程序账户索引发现一个公开 Position。优先选择仍然 active、可读取 Position account、且生命周期有多次 Add / Remove / Claim 的样本。若有多个样本，再覆盖 Rebalance / Close。

必须识别 Position V1 / V2、动态扩展、width、lower / upper Bin、每 Bin shares、fee checkpoints、pending fees、claimed totals、fee owner 与 lock / permissionless 字段。

验收：
- 原始 Position account 与锁定版本 SDK getPosition() 输出一致；
- 每 Bin shares 与 Bin liquidity_supply 在同一状态版本下可交叉检查；
- Position shares 变动与 Add / Remove / Resize / Rebalance 指令顺序一致；
- pending fee、claim fee 与钱包 token balance delta 守恒；
- Claim 只把应计费用从 Position 资产转到钱包，不得重复增加 NAV；
- 若只有当前 Position 快照而无历史账户状态 / 完整变更链，历史 PnL 保持 BLOCKED。

如用户希望核对自己的 LP，只需要公开 Position address 或 wallet address；不需要私钥、助记词或签名授权。没有用户地址时使用第三方公开 Position，并明确不是用户持仓。

### P0-E — Reference market 与 Markout

沿用 v1.0 的 registry：
- Target pool 6Hfg 不得进入自身独立参考价；
- 初始候选 PumpSwap Ak4...1e6H 与 Meteora 3zd6...kThk 仍是候选，不是已验收来源；
- 65Yer...7VbK 仅诊断；
- Orca E9Rf...KRdy 低流动性排除主参考。

验收前先核对 pool account、mint 顺序、decimals、交易历史、真实深度和时间精度。每个来源保存 event_time、observed_at、available_at、slot、transaction order、source、raw response hash。

只有满足时间精度、深度、可用时间和目标池排除条件的 horizon 才能计算 Markout；否则输出 unavailable / invalid_reason。不能用 OHLCV 高低价补成逐笔 Markout。

### P0-F — 数据包与 Manifest

最小交付：
- pool_accounts.json：LbPair、Mint、Vault、Bitmap、BinArray 原始账户与解码；
- transactions.jsonl：签名、slot、交易原文、meta、instruction path；
- swap_events.jsonl：规范化 Swap 与 fee components；
- bin_state_snapshots.jsonl：Bin 级状态及快照边界；
- position_snapshots.jsonl：Position 原始账户、SDK 输出和逐 Bin shares；
- position_lifecycle.jsonl：创建、加池、撤池、Rebalance、Claim、Close；
- reference_trades.jsonl：非目标池成交；
- quote_samples.jsonl：不同规模的只读报价（如已采集）；
- manifest.json：数据范围、来源、版本、哈希、分页、缺口、许可、请求/响应时间；
- reconciliation.md：逐笔差异、残差、失败原因、通过范围。

任何 secrets、API keys、私钥或助记词不得进入数据包或 Git 仓库。

## 6. 历史样本与前瞻样本分工

4CHAN 目标池在 v0.7 / v1.0 中被记录为 2026-11-25 新近创建，公开页面快照不能提供完整 7 天历史。因此：
- 4CHAN：用于当前账户结构、实时采集、外部多池参考和前瞻数据集；
- 历史 7d / 30d 实验：另选真实存在足够历史的 Meteora DLMM 池，必须从供应商实际返回结果中选择，不在文档中预设虚构地址；
- 4CHAN 与成熟池的结果分开报告，不把不同 Token / 生命周期直接混成同一收益样本。

## 7. 虚拟 Position 仿真的两级假设

### Level 1 — Small-LP / Frozen Historical Path

假设虚拟 Position 足够小，不显著改变历史市场路径。用真实历史 Swap 与 Bin 状态，按照 Position 的实际 shares / fee rules 计算理论归属和库存变化。

用途：第一阶段筛选、验证账本与比较候选策略。

限制：这是小资金近似，不证明更大资本加入后市场路径不变；需报告虚拟 LP 相对各 Bin 深度的比例，并设置影响上限。

### Level 2 — Counterfactual AMM Replay

把虚拟流动性加入池状态，按锁定版本协议逻辑重新计算每笔交易的输出、Bin path、fee 和库存。必须保留交易原始约束（如 exact-in / exact-out、minimum output、maximum input、账户列表与程序版本），如果反事实状态下交易不再满足约束，则标记失败或不可执行。

限制：它只能回答“固定历史交易意图在新池状态下会怎样”，不能推断真实交易者会不会改路由、改金额或取消交易。Level 2 不能伪装成真实历史市场。

## 8. 实验放行 Gate

| Gate | 通过条件 | 失败后允许做什么 |
|---|---|---|
| A — Raw Data | Pool / Mint / Vault / BinArray 身份和版本可复现；数据范围、缺口明确 | 继续修数据采集，不做 PnL |
| B — Swap Replay | 成功 Swap 的 raw amount、事件、vault / user balance delta 可对账 | 只做解析器修复，不做策略回测 |
| C — Position Ledger | Shares、X/Y 本金、pending / claimed fee、Claim 和余额变化守恒 | 只做协议会计研究，不做收益结论 |
| D — Virtual LP | Level 1 小份额假设透明，资产守恒；Level 2 独立验证协议重算 | 只报告假设性模拟，不报告实盘可复制收益 |
| E — Strategy Evaluation | 同起始 NAV / 库存 / 成本 / 事件路径；冻结测试集；分 Token / Regime；统计不确定性 | 保留简单基准或 INCONCLUSIVE |
| F — Shadow | 实时数据缺口、延迟、报价、执行回执与模型误差可测 | 不进入真实资金阶段 |

任何 Gate 未通过，都不能通过更复杂的策略模型来绕过。

## 9. 代码实施边界与下一步顺序

当前不修改 Engine A，不在旧 simulator.py 中继续叠加真实 Position 逻辑。

建议后续实现按独立模块分阶段：
1. data_contract / raw archive：只读数据获取、manifest、哈希、缺口和版本；
2. meteora_decoder：锁定 IDL / SDK 的账户与事件解码；
3. event_normalizer：原始指令、inner CPI、事件顺序与幂等键；
4. pool_state_replay：LbPair / BinArray / Vault 状态重建；
5. position_ledger：Position shares、费用、奖励、X/Y 本金与 claim；
6. reconciliation tests：用真实样本对账；
7. virtual_position：通过 Gate C 后再加入虚拟仓位；
8. strategy evaluator：通过 Gate D 后再接入 v0.3–v0.5 的风险与决策模型。

**下一次实际执行只做一件事：取得 4CHAN 的 Pool / Mint / Vault / Bitmap / BinArray 原始账户包，并保存 context slot、raw bytes 和 manifest。** 若当前执行环境无法访问 RPC，就在用户已有网络的本机环境执行只读导出；不得把网络访问失败解释成供应商没有数据。

## 10. 最终结论

- 现有 Engine A 可保留为启发式筛选器，但当前收益指标不可用于真实 LP 盈利结论。
- 当前最明确的代码问题包括手续费单位接口不一致、合成 Bin 成交量分配、虚拟 Position 无 X/Y 库存、IL / NAV 非真实账本、Rebalance / Exit 未结算。
- v0.6–v1.0 已经定义数据源、样本池、原始数据合同、Position 账本和外部参考市场；v1.1 不重复这些设计，而是将它们映射到当前仓库的实际代码缺口与执行顺序。
- 4CHAN 适合做前瞻采集；历史回测需另找具有足够历史的成熟池。
- 在 Gate A–C 通过之前，不报告真实 LP 收益；在 Gate D–F 通过之前，不把策略优势视为可部署结论。

本版本是代码审计和执行验收规格，不代表已获取原始链上数据、已运行新引擎、已修复现有模拟器或已验证任何盈利策略。

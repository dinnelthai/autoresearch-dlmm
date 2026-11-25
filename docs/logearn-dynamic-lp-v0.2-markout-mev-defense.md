# LogEarn Dynamic LP v0.2 — Markout、逆向选择防御及 Hybrid 验证规范

日期：2026-11-25。状态：研究规范增补；尚未完成逐笔回放、Shadow 或实盘验证。适用范围：Solana Meme / Meteora DLMM，仅现货、虚拟账本、主网只读。明确排除衍生品对冲、抢跑、夹击、自成交及任何人为制造成交量。本文承接 2026-11-22 v0.1《数据模型与项目设计方案》第 3.1–3.7、4、6、7、9、10 章；不替代既有库存、Ask 优先、选盘及退出模型。

## 1. 研究结论与边界

HawkFi Precision Hybrid 的公开宣传为 50% Spot + 50% Bid-Ask，配合 Rebalance、Reshape 与 MEV Boost，并声称手续费、交易盈亏、MEV 盈亏三类收益。具体执行、收益与防御成功率未独立验证。50/50 仅作为对照假设，不是 LogEarn 最优参数。常规 LP 的被动库存转换已经包含买低卖高或不利成交，不能将其再次加到 NAV 上。避免损失不是已实现收入。MEV Boost 在本设计仅指保护己方流动性，不能保证在套利成交前撤出。

## 2. 统一总账：精确收益归因

所有价格 P 为 SOL / MEME，数量 q 为 MEME；SOL 为主计价单位。设 X 为钱包+可提取 LP 本金中的 MEME 数量，Y 为相应 SOL；F_X、F_Y 为未领费用余额。NAV=(X+F_X)P+(Y+F_Y)，另有资产/负债时单列。加池、撤池、领取费用是内部转移，不创造收益。外部出入金按发生时公允价值调整。价格源、估值时点和初始库存必须一致。

将事件按 slot、transaction_index、instruction_index、event_index 排序；每次事件分为估值变化和账本变化。令 x_k,y_k 表示含已赚费用的合并库存，p_k 为独立参考价格，k 前后变化分别为 Δx、Δy：

```text
NAV_k - NAV_(k-1) = x_(k-1)*(p_k-p_(k-1)) + p_k*Δx_k + Δy_k
交易项 = Σ q_i*(p_i - e_i)
手续费项 = Σ (fee_SOL_i + fee_MEME_i*p_i)
成本项 = Σ (network + priority + nonrecoverable_rent + separately_charged_cost)
净 PnL = 库存盯市 + 交易项 + 手续费项 - 成本项
```

q_i 是 LP 视角带符号的本金交易量（买入正、卖出负）；e_i 是剔除单列手续费后的实际成交价。若成本已反映在成交价或账户余额，禁止再扣；可退租金作为资产而非成本。Token 手续费之后的涨跌进入后续库存盯市。事件拆解必须与账户余额变化一致；手续费如果已经计入本金数量，则先拆出再归因。转账税等无法拆出时记入独立残差并标记，不得强行归为利润。外部现金流单列。所有策略事件与 LP 外的实际现货换仓均计入同一账本。对账残差须在协议整数精度与可解释四舍五入范围内。

无外部资金流且起始资产一致时：
```text
Alpha_HODL = NAV_strategy(T) - [Y_0 + X_0*P_T]
Alpha_SOL  = NAV_strategy(T) - NAV_0
Alpha_HODL = 库存相对初始 HODL 的盯市差 + 交易项 + 手续费项 - 成本项
```
v0.1 §3.1 中 Incremental_Execution_Costs 只有在 NAV 尚未扣除该成本时才另扣；完整 NAV 已包含时不得二次扣减。IL / divergence loss 是相对持币基准的比较量，不是另一项现金支出。LVR 是相对按参考市场价格执行同样库存交易的基准损失；实证估计依赖参考价、交易归因与成本模型，不能与 IL 或负 Markout 直接相加。防御贡献定义为匹配样本中开启和关闭防御的净 Alpha 差值（包含少赚的手续费和操作成本），不是独立加到 NAV 的 MEV PnL。

## 3. 双侧 Markout：从 v0.1 毒性公式到可审计指标

每笔属于己方头寸的 LP 本金成交拆到 Bin，记录真实份额、数量和执行价。设 h∈{1,5,30,60}s 为候选观察期限，p_ref(t) 为交易前可见的独立参考价格，p_ref(t+h) 为该期限后的参考价格；以固定、预先声明的时点采样规则匹配，不允许用未来价格填补决策时点。成交价 e_i 不包含单独入账的 LP 手续费。

```text
gross_markout_SOL(i,h) = q_i * (p_ref(t+h) - e_i)
net_markout_SOL(i,h) = gross_markout_SOL(i,h) + LP_fee_SOL_equivalent_i
gross_markout_bps(i,h) = 10000 * gross_markout_SOL(i,h) / (abs(q_i)*e_i)
immediate_edge_i = q_i * (p_ref(t) - e_i)
post_trade_drift_i(h) = q_i * (p_ref(t+h) - p_ref(t))
gross_markout = immediate_edge + post_trade_drift
```

买入 1 MEME @100，5s 后参考价 90：gross=-10 SOL；卖出 1 MEME @100，5s 后参考价 90：gross=+10 SOL。若各自费用 1 SOL，net 分别 -9/+11。以上是单位测试的虚构价格，并非真实 Meme 价格。

按 side、bin、pool、regime、horizon 分组，输出成交额加权 markout bps（Σmarkout/Σnotional）、净 markout SOL、负值成交额占比、尾部分位数、覆盖率、样本量及参考价置信度。不可把不同 h 的同一成交累加。Markout 是事后质量指标，不是独立收益项，不能直接加到总账。负 markout 不证明 MEV 身份；将不利成交与已证实套利分开标记。交易费用只按己方实际可得份额归属。

对于在线毒性估计，沿用 v0.1 的 Bid/Ask 方向，使用已到期样本、按时间衰减与成交额加权，计算 T_side = E[max(0,-gross_markout_bps)|side,regime]，另报告有符号均值避免仅统计亏损的偏差。训练标签仅使用已经成熟且价格有效的样本，按 event-time 处理迟到数据；样本不足则回退保守规则，不设默认零毒性。

## 4. 防御控制器（只管理己方头寸）

参考价质量：排除己方池直接定价，检查独立来源的时效、有效深度、可执行报价、跨源偏差及交易方向。缺少独立市场的极早期 Meme 不声称可识别套利或计算可靠 Markout；不增加风险敞口，按既有风控考虑减池/撤池。参考价不是保证可成交的价格。普通买卖流、市场价格变动与套利行为不强行混同。

保留 v0.1 E_A/E_B = Fee - Toxicity - Cost + Inventory Benefit 的候选边际模型；全部项统一为每一控制期预期 SOL 收益，毒性以已成熟的 Markout 估计，不能与已经包含相同损失的交易收益预测叠加。库存 benefit 是风险目标中的效用项而非已赚收益。动作仍为 HOLD、REPOSITION、REDUCE、REMOVE、NO_LP，库存偏高时优先降低 Bid，必要时冻结 Bid；退出后是否卖出由独立库存决策决定。

风险优先级：
1. 数据缺失、参考价异常、退出路径失效、库存上限、止损和重大安全风险优先，暂停增加暴露。
2. 对现有头寸评估两侧预期净成交质量；若风险升高，降低或暂停相关侧的流动性，必要时撤池。
3. 正常条件下仅当预期净收益改善覆盖成本、少赚手续费及风险预算时才重新布置己方流动性；加入冷却、迟滞、SOL 储备、最大换手和最大仓位约束。
4. 执行回执未确认不得当作撤池成功；模拟失败、延迟、成交先于撤池、价格跳空与无法卖出均必须计入压力测试。不得假定可以预知其他交易或控制其排序。

所有阈值由训练集校准，验证集用于选型，测试集冻结；硬风险限额独立于收益优化，不通过优化收益放宽。

## 5. Precision Hybrid 对照与 Dynamic LP 优化

按 v0.1 Spot、Curve、Bid-Ask、Custom 分布模板生成归一化 Bin 权重。用 alpha=0.5 的固定 Spot/Bid-Ask 混合做竞品灵感基准，独立评估 alpha=0、0.25、0.5、0.75、1 以及状态自适应。alpha 表示分配的资本比例，而非简单平均原始流动性单位；两侧按当前可用 SOL/MEME 分别满足预算和协议约束，不能凭空转换资产。若混合需要换仓，须记录成本、滑点、成交失败。单侧 LP 与原生 Limit Order 分账。

保持 Ask 优先、健康/派发/死亡盘整分类和 Launch LP 与 Range LP 分开评价。初期以选盘、分批（此前 0.2 SOL 仅为研究参数）、风险退出为主；优化器不因高费用放松库存、流动性及尾部风险限制。目标为样本外净 Alpha 与风险约束，而非手续费最大。

## 6. 数据合同及现有仓库接入

新增逻辑数据集（字段名为工程提案）：
- lp_fill: run_id, pool_id, position_id, signature, slot, tx_index, ix_index, event_index, bin_id, event_time, side, signed_base_raw, quote_raw, decimals, exec_price_ex_fee, attributed_fee_base_raw, attributed_fee_quote_raw, share_before, source_version。
- reference_price: mint_pair, observed_at, available_at, slot, source_id, price_SOL, depth, age_ms, confidence, quality_flag；保存原始数据及修订版本。
- fill_markout: fill_id, horizon_ms, ref_before_id, ref_after_id, gross_SOL, net_SOL, notional_SOL, bps, label_available_at, valid, invalid_reason；唯一键 (fill_id,horizon_ms,reference_version)。
- risk_decision: run_id, decision_time, asof_slot, side, inventory, reference_quality, mature_sample_count, expected_net_edge, proposed_action, reason_codes, risk_config_version。
- execution_receipt: decision_id, submitted_at, confirmed_at, status, tx_or_sim_id, actual_fee, balance_deltas, failed_reason；未确认不得虚增本金。
- pnl_attribution: run_id, event_id, inventory_mtm, trade_edge, fee_income, separately_charged_cost, external_cash_flow, nav_before, nav_after, residual；原子单位对账。

当前远程 README 和 simulator.py 的结构仍是 OHLCV/candle 近似回测，不能从 candle 重建真实 Bin 份额、逐笔 Markout、MEV 防御执行结果。接入顺序：
- prepare.py：保留 OHLCV 筛选；另建逐事件输入及独立参考价数据加载；校验顺序、初始快照、缺口、decimals。
- simulator.py：保留旧近似模式；新增独立逐事件 Paper replay，真实状态校验后才计算 fill；按 v0.1 §7 对账。
- strategy.py：仅接收截至决策时点已可见特征；增加防御动作的影子决策，不连接主网签名。
- backtest.py：新增事件模式的收益归因、配对消融实验、Markout 与尾部指标；candle 模式明确标记 unsupported，而非填零。
- memory.py / loop.py：保存数据版本、代码提交、风险配置、训练/验证/测试分割与结果；不可用数据不得参与自动优化。

## 7. 验证矩阵与放行规则

相同池、时间起点、初始库存、资本、费用及延迟假设；多 Token、不同生命周期，包括失败项目。比较 HODL、SOL、Static Spot、Curve、Bid-Ask、固定 Hybrid、Dynamic 无防御、Dynamic 有防御；另用固定 Hybrid ± 防御隔离单项贡献。对各组使用相同时间滚动窗口，重叠窗口统计用区块/池级 bootstrap 或非重叠检验，避免虚假独立。按时间切分，边界隔离最长 label horizon；参数调优不能读取测试集。

必须通过：
- 账本：买卖符号、费用计入一次、领费不改变 NAV、加撤池不创造收益、外部资金流不算利润、已含成本不重复扣；对账残差可解释。
- 时间：未来参考价格禁止进入决策；1/5/30/60s 未成熟样本不训练；乱序、重复事件、缺价、同槽多成交正确处理。
- 风险：下跌与流动性消失、参考价失效、执行失败、撤池未确认、库存上限、交易成本上升；无报价时不得虚构退出成交。
- 比较：报告 SOL 净 PnL、Alpha vs HODL/SOL、静态 LP 差值、费用、交易归因、库存盯市、成本、回撤、CVaR、最坏窗口、库存峰值、成交额加权 Markout、覆盖率、撤池失败及延迟。
- 研究放行：完整事件及参考数据通过对账；样本外净收益改善达到预先登记的经济阈值且尾部风险不超预算；报告防御开关的配对差及不确定性。无显著/经济改善则保留基础策略；数据不足则结果为 INCONCLUSIVE。不能用展示案例代替检验。

先实现逐笔归因与数据质量门槛（P0），再加只读风险控制与 Paper 消融（P0），最后做混合比例优化（P1）。本次提交仅为研究规范，不声称已实现或回测通过。真实资金、生产签名及交易执行不在本阶段。

## 参考

- HawkFi 官方终端：https://www.hawkfi.ag/meteora （三类收益宣传；具体机制未核实）；用户提供的两页 Precision Hybrid / MEV Boost 材料。
- Meteora 官方 DLMM SDK 示例：https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx
- Milionis et al., Automated Market Making and Loss-Versus-Rebalancing: https://arxiv.org/abs/2208.06046
- Measuring Arbitrage Losses and Profitability of AMM Liquidity: https://arxiv.org/abs/2404.05803

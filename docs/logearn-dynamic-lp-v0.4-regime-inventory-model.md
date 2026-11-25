# LogEarn Dynamic LP v0.4 — 趋势、震荡与 Bin 分布推演

日期：2026-11-25。研究设计增补，承接 [v0.3](logearn-dynamic-lp-v0.3-research-requirements.md) 与 [v0.2](logearn-dynamic-lp-v0.2-markout-mev-defense.md)。仅数学、数据及需求；不修改程序，不使用真实资金，不进行衍生品对冲。所有算例为理论情景，策略候选并非最优性或盈利证明。Range LP（二段 Meme）为主，Launch LP 独立评价。

## 1. 统一终点收益恒等式

以 SOL 为计价单位，x0,y0 为初始 MEME、SOL 数量；q_i 为 LP 及独立现货库存交易带符号数量（买正卖负），e_i 为实际成交价格（剔除单列费用），P_T 为终点参考价格。无外部资金流、无其他资产时：

x_T = x0 + Σq_i + Σf_MEME_i - Σc_MEME_i
y_T = y0 - Σq_i e_i + Σf_SOL_i - Σc_SOL_i
Alpha_HODL(T) = Σq_i(P_T-e_i) + F_T - C_T

F_T 与 C_T 为已赚费用、单列真实支出按终点 P_T 估值；若成本嵌入成交价或余额已扣则不再重复扣。费用资产之后参与交易须计入 q；所有账户内部转移相消。若存在外部现金流须进行匹配基准调整。该终点恒等式是 v0.2 逐事件归因的另一表达；不能再叠加 Markout、IL、LVR 或库存盯市项。它能够说明同一费用率下，成交的方向、价格和终点价格怎样影响相对持币表现。事后 P_T 不能作为事前决策输入。

## 2. 单边上涨：Ask 机会成本

假设没有新增 Bid，Ask 成交数量 a_i>0，终点 P_T 不低于成交价：
Alpha = F_T - C_T - Σa_i(P_T-e_i)。
跑赢 HODL 的必要充分条件（本简化情景）是 F_T-C_T > Σa_i(P_T-e_i)。
示例：10 SOL 初始本金，5 SOL + 50 MEME，P0=.1，终点=.2。若全部 50 MEME 以平均 .14 成交，则本金终值12 SOL、HODL 15 SOL，未计费用/成本的 Alpha=-3 SOL。即使赚取0.5 SOL净费，Alpha仍为-2.5 SOL。
候选：保留未部署的趋势库存；减少近端 Ask 资本；研究分层远端 Ask；不机械追价重建双边仓位。库存超过硬上限时 Ask 优先约束仍然有效，趋势观点不能豁免风控。直接持币或 NO_LP 是必要基准。远端成交概率降低、错过高点和价格反转须计入，不能用事后最高价优化 Ask。

## 3. 单边下跌：Bid 库存风险

无新增 Ask 时，Bid 买入数量 b_i>0，终点 P_T 不高于成交价：
Alpha = F_T-C_T - Σb_i(e_i-P_T)。
单笔名义金额 n_i=b_i e_i，若终点比成交价低 r_i=(e_i-P_T)/e_i，则相对 HODL 额外损失为 n_i r_i（未计手续费）。最坏 P_T=0 时，所有已承接 Bid 的本金价值归零；原有 MEME 库存也会损失，撤池不等于清仓。

示例：10 SOL初始本金，5 SOL+50 MEME @.1，终点=.05，HODL=7.5 SOL。若 Bid 承接2 SOL @.08，得到25 MEME，则终值3+75*.05=6.75 SOL；相对HODL损失.75 SOL，绝对损失3.25 SOL。若净费.15 SOL，终值6.9 SOL，仍不覆盖损失。
v0.3 的库存比例限制之外，新增绝对损失预算：对压力场景 ω，假设已有库存 x 和可成交 Bid 总名义额 n_i，终点价格 P_ω，保守不计预期费用及尚未确认的 Ask 卖出：
D_ω = max(0,x(P_now-P_ω)) + Σ n_i max(0,1-P_ω/e_i) + C_ω。
要求 max_ω D_ω ≤ L_max，且最低 SOL 储备、可执行清算价值及库存数量上限同时满足。D_ω 是给定当前参考价、简化成交假设下的压力损失估计，不是普适最坏上界；跳空、实际成交路径、现有在途承诺、深度与执行失败另外建模。若原有库存已耗尽风险预算，不增加 Bid；按风险约束决定减少仓位、撤池及独立现货处置。
若统一压力跌幅 r 适用于新增 Bid，剩余损失预算 R=L_max-D_existing-C_buffer，则新增 Bid 的简化名义上限 max(0,R/r)，与 v0.3 资本/库存约束取最小值。r=0 时该压力项不构成限制，仍需其他场景。示例 R=.3 SOL，r=.6，最多.5 SOL，非生产参数。
候选：下降时冻结新增 Bid，保留储备，按可退出性减池，独立评估现货库存；禁止假设反弹或机械补仓。未确认撤池前仍计入全部可成交暴露。

## 4. 健康震荡：两类收益机制严格区分

同一 Bin 上买入和随后卖出同数量 q，若执行本金价格相同 e，则本金买卖价差为0；忽略中间资产变化、额外成本后，收益来自实际手续费。不能把价格在不同 Bin 之间穿越直接等同于已经实现了高卖低买价差。
若实际先在 e_b 买入 q，随后在 e_a>e_b 卖出同数量，则库存闭环本金毛利 q(e_a-e_b)，净值增益=q(e_a-e_b)+F-C（两次成交费仅归属一次）。不同 Bin 的交易配对须由真实库存账本验证；迁移流动性、协议限制、费用、延迟和未成交概率须计入，不能假设无成本或一定成交。
算例：5 MEME @.09 买入、@.11 卖出，本金毛利.10 SOL；若累计实际LP费.02 SOL、另行支出.03 SOL，净增.09 SOL。若后续卖出未发生且 P_T=.06，毛损.15 SOL（再按实际费及成本调整），不应把目标价差当成已赚收益。
研究比较：静态 Spot、Curve、Bid-Ask 与实际跨 Bin 库存闭环的非对称/动态分布。区间重复穿越只意味着潜在成交机会，必须以逐笔份额和净利润证明。

## 5. 行情状态与分布决策

状态集合为 healthy_range、uptrend、downtrend、distribution_range、dead_range、stress、unknown。基于决策时可见的趋势、波动、买卖流、成交深度、筹码净流、参考价质量及成熟 Markout；事后标签只用于评估。输出各状态概率或置信等级；若资料缺失/分类冲突，不把 unknown 当作健康震荡。
健康震荡：双向流与流动性均足够、无明显持续派发，比较 Spot/Curve/Bid-Ask/Hybrid；以实际净费和库存闭环验证。
上涨：近端 Ask 减量与未部署库存作为候选；保留风险上限；比较直接持币。
下跌：停止新增 Bid，减少风险、评估撤出及现货处置。
派发/死亡盘整：低波动不是健康证据，按流动性、筹码与逆向选择风险暂停或退出。
压力/未知：不新增暴露；风险预算优先，不能保证退出成交。
状态不必互斥于风险标志；risk flags 独立覆盖策略判断。设 π_s 为当前状态概率，候选动作以 Σπ_s E[Alpha|s,a] 估算收益，在联合场景损失分布计算 CVaR（不能简单平均各状态 CVaR）；使用 v0.3 的库存惩罚与硬约束。概率未经校准时采用保守场景比较，不虚构置信度。

## 6. Hybrid 比例研究与可辨识性

alpha=Spot 资本权重，1-alpha=Bid-Ask；Bid/Ask 分侧预算，资本守恒。对固定外部路径、小份额、不改变成交行为且费用与风险成本可加的近似，E[Alpha_mix]=alpha E[Alpha_spot]+(1-alpha)E[Alpha_BA]；单纯期望收益线性优化通常取端点，不能推出50/50。混合的理论价值来自风险分散、库存/成交约束或非线性执行。
用简化均值方差例子说明：若 R_s,R_b 为相同风险资本的净收益率，目标 J=E[R_mix] - λ Var(R_mix)/2，则在 V=Var(R_s-R_b)>0 时
alpha* = clip((E[R_s-R_b]/λ + Var(R_b)-Cov(R_s,R_b))/V,0,1), λ>0。
这是线性混合的示意闭式解，不是 DLMM 实际最优分配；λ及协方差必须估计，方差不能替代尾部风险。真实共用 Bin 的份额、价格冲击、调仓成本、共享库存预算、尾部损失均可使结果非线性，最终使用 v0.3 联合路径/风险目标；相同时间窗口测试 alpha=0,.25,.5,.75,1 与状态自适应，样本外验证。

## 7. 新增数据需求与产品需求

在 v0.3 分层模型基础上新增逻辑实体：
- regime_observation: pool_id, asof_slot, available_at, horizon, feature_version, trend_score, volatility, signed_flow, depth, holder_flow, markout_quality, state_probabilities, uncertainty_flags。
- liquidity_budget: run_id, decision_id, side, capital_budget_raw, existing_commitment_raw, pending_commitment_raw, inventory_limit, reserve, risk_budget_SOL, pressure_scenario_id。
- stress_scenario: scenario_id, price_path, expected_depth_path, execution_delay, failure_assumption, reference_source, version；不将假设冒充市场事实。
- inventory_lot_match: run_id, buy_fill_id, sell_fill_id, matched_base_raw, buy_cost_SOL, sale_proceeds_SOL, fee_link, matching_rule, residual_open_qty。FIFO 等规则仅用于诊断，不改变 NAV；严禁把同一批库存重复配对。
- strategy_comparison: run_id, regime_group, template, alpha_bid, alpha_ask, inventory_constraint_version, net_alpha, absolute_pnl, fee, cost, max_drawdown, CVaR, turnover, fill_coverage, markout_coverage。
所有数据必须区分发生时间与当时可获得时间；缺失、无独立报价、无法确认 Bin 分配时不输出伪精确结论。

新增需求 R09 行情分类及 unknown 回退；R10 趋势库存保留方案与风险上限；R11 压力路径 Bid 预算及未确认承诺；R12 同 Bin 往返与跨 Bin 库存闭环分别统计；R13 Hybrid 配比敏感性及同池同窗口对照；R14 退出可执行性与清算价值。R09-R12/R14 为风险和数据验收优先，R13 在事件数据可用后推进。阈值、周期与样本数量尚未确定。

## 8. 验收与研究限制

用相同初始库存、风险资本、市场窗口、可用信息和成本对比所有策略；另设全 SOL 和直接持币，选择 NO_LP 不是失败。保留上涨、下跌、健康震荡、派发、死亡及异常样本；验证不同时点、跨池、不同生命周期，不能只挑后来成功的 token。无成交、单边未闭环、成交早于撤池、参考价缺失必须纳入。
数学验收：终点 Alpha 与 v0.2 逐事件账本一致；同 Bin 同价闭环本金价差为0；跨 Bin 配对仅使用实际成交且数量守恒；下跌例子与压力预算可复算；Hybrid 线性近似在等风险资本条件下正确，极端比例还原基准。
研究验收：风险上限、净收益经济改善、误判成本、样本外不确定性及数据覆盖均明确；没有独立报价或完整事件不能宣称有效。此轮完成推导及需求，尚未完成数据源审计、参数估计或任何回测。下一轮深入研究状态判定、Rebalance/退出决策的风险调整边界，随后整理数据可得性与最终研究评审。
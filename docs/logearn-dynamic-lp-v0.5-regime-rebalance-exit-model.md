# LogEarn Dynamic LP v0.5 — 状态识别、Rebalance 与退出决策

日期：2026-11-25。研究设计文档；承接 v0.2 Markout/收益归因、v0.3 数据与需求模型、v0.4 趋势/震荡/库存推演。仅数学、数据与产品需求，不写代码、不连接签名、不执行交易。范围为 Solana Meme / Meteora DLMM 现货；Range LP（二段）为主，Launch LP 单独评价；排除衍生品对冲、操纵交易、自成交、抢跑及夹击。所有参数和阈值均待数据校准，不能视为已回测或盈利证明。

## 1. 设计原则与决策层次

策略决策严格分三层：
1. Market Regime：市场正在发生什么，输出概率分布与不确定性。
2. Risk Overlay：当前组合有什么不可被收益信号覆盖的风险，输出独立硬约束与风险标记。
3. Action Evaluator：在满足硬约束的动作中，比较继续持有、调仓、减仓和退出的风险调整后净价值。

价格趋势不等于库存安全；手续费高不等于净收益高；价格离开 active Bin 不自动触发 Rebalance；撤出 LP 不等于清算 MEME 库存。NO_LP、HOLD、NO_ACTION 都是合法决策。

## 2. Regime 识别模型（M01/M02）

### 2.1 状态和风险标记分离

Regime 类别：
- HEALTHY_RANGE：双向成交与可用深度足够、价格在有效区间震荡，筹码没有明显持续派发证据。
- UPTREND：多周期价格趋势持续向上，外部市场买方需求与成交结构支持该判断。
- DOWNTREND：多周期价格趋势持续向下，卖方成交压力占优。
- DISTRIBUTION_RANGE：价格表面横盘或波动收窄，但筹码流、外部成交方向、持仓变化等显示潜在派发。
- DEAD_RANGE：有效成交、深度和可交易机会持续衰退；低波动本身不足以证明死亡盘整。
- STRESS：价格跳空、流动性急剧坍塌、价格源严重分歧、异常失败或其他市场/池级压力事件。
- UNKNOWN：数据缺失、质量不足、状态冲突或模型不确定性过高。

Risk flags 与 Regime 正交，例如 HIGH_INVENTORY、BID_COMMITMENT_HIGH、EXIT_DEPTH_LOW、HOLDER_CONCENTRATION_HIGH、TOP_HOLDER_OUTFLOW、REFERENCE_PRICE_STALE、REFERENCE_PRICE_DIVERGENCE、EXECUTION_UNAVAILABLE、TOKEN_RISK_EVENT、DATA_GAP。一个池可以同时为 UPTREND + EXIT_DEPTH_LOW；任何风险标记不得被趋势概率覆盖。STRESS 可同时触发多个 flags。

### 2.2 特征定义与可用时间

所有特征必须同时记录 observed_at、available_at、asof_slot、source/version；决策只能使用 available_at ≤ decision_time 的数据。

价格趋势：多个观察窗口的 log return；以同期实现波动率归一化，另列趋势一致性与回撤。不要直接用未来最高/最低价。
波动与跳跃：实现波动率、下行半方差、极端收益频率、跳跃指标；单独标注短时数据不足。
交易流：按真实 Swap 输入/输出方向构造 signed notional imbalance = (buy_notional-sell_notional)/(buy_notional+sell_notional)。需统一买卖方向与计价单位，过滤重复/失败交易。目标池成交流与外部市场成交流分开，避免把目标池自身报价当独立参考。
深度与退出能力：当前价上下指定基点范围的可执行深度、预估卖出当前库存的 VWAP/price impact、报价时效与路径可用性。LP TVL 不等于可退出深度。
筹码结构：持有人集中度、集中度变化、可识别大户净转账、已验证钱包行为。转账不等于卖出，钱包标签有置信等级；不能把未知钱包强行归类为 Dev/KOL/Smart Money。
成交质量：仅使用成熟、有效、独立参考价的双侧 Markout；同时记录样本数、覆盖率和数据置信度。无独立参考市场时标记 unavailable。
活跃度：有效 Swap notional、交易间隔、活跃参与者数（如可可靠识别）、费用/资本比。成交量本身可能失真，不作为唯一健康证据。

### 2.3 概率与 Unknown

模型输出 p_s=P(Regime=s | I_t)，类别包含 UNKNOWN；概率总和为 1。另输出 calibrated_confidence、feature_coverage、age、uncertainty_reason。概率必须在时间外验证集校准；未校准模型只能输出 score，不得伪装成概率。若输入源冲突、覆盖率不足或模型超出训练分布，UNKNOWN 概率提高或直接触发 DATA_UNCERTAIN。不得把缺失特征填成 0 后继续分类。

可以研究规则模型、状态转移模型或监督分类器；选择标准为样本外校准、稳定性、可解释性和误判成本，不预设某种算法。训练标签可利用未来窗口定义“事后发生了什么”，但这些标签仅用于训练/评估；在线特征不得读取未来。按时间切分，训练/验证/测试边界隔离最大标签窗口与持仓重叠。

### 2.4 状态转换与迟滞

单个窗口的标签跳动不应引发连续调仓。记录状态概率序列、转移矩阵、持续时间和状态变更原因。普通切换要求新状态的优势超过校准后的切换边界，并持续满足最短确认窗口；退出/安全风险 flags 可立即触发，不受最短停留时间限制。迟滞阈值、确认窗口由误报/漏报成本和样本外结果确定，暂不填写固定数字。

关键错误成本不对称：
- 将 DISTRIBUTION_RANGE 误判 HEALTHY_RANGE：可能持续承接派发，损害最大。
- 将 HEALTHY_RANGE 误判 DISTRIBUTION_RANGE：可能少赚手续费/价差，属于机会成本。
- 将 STRESS 误判普通趋势：可能错过风险退出。
因此分类器优化不能只最大化 overall accuracy；须报告每类 precision/recall、混淆矩阵、危险误判率、状态持续时间、Unknown 比例及置信度校准。

## 3. 统一 Action Evaluator

候选动作集合：
- HOLD：保持当前 Bin/权重/预算。
- REPOSITION：改变 Bin 分布或权重，可能包括先撤后加。
- REDUCE：减少一侧或整体 LP 敞口。
- REMOVE：撤出 LP 头寸，但不自动卖出取回的 MEME。
- REMOVE_AND_HOLD：撤 LP 后将资产转入钱包，保留现货库存。
- REMOVE_AND_DISPOSE：撤 LP 并另行执行库存处置计划；撤 LP 与卖出分别记账和确认。
- NO_LP：不建立新仓位。

对决策时刻 t 可见的信息 I_t 和评估窗口 H，定义每个动作的终点组合价值、HODL Alpha、绝对损失和库存路径。候选目标：
J(a|I_t)=E[Alpha_HODL(a)|I_t] - λ CVaR_β(L_abs(a)|I_t) - κ E[(z_end-z_target)^2|I_t]。
J 单位为 SOL；L_abs 是绝对资本损失（SOL），CVaR 取损失尾部平均；λ 无量纲，κ 为 SOL。若加入模型不确定性惩罚，需先将不确定性换算为 SOL 风险预算，不可混用单位。跨状态风险必须由联合情景损失分布计算 CVaR，不能简单平均各状态 CVaR。

动作首先满足硬约束：最低 SOL 储备、最大 MEME 库存与 Bid 承诺、压力路径损失预算、退出深度/价格源最低质量、Token 安全限制、最大允许执行风险。硬约束不参与收益优化，不得为增加收益而自动放宽。若没有可行动作，返回 RISK_BLOCKED / NO_LP 并明确未解决的风险，而不是选取“最不差”动作假装安全。

在可行动作中选择 J 最大者；但 REPOSITION 还须通过增量证据门槛：
LCB(ΔJ)=E[J(REPOSITION)-J(HOLD)] - uncertainty_margin > min_economic_improvement。
uncertainty_margin 来自配对回测/模型误差置信界，min_economic_improvement 覆盖最小经济意义及未建模成本。两者由验证数据预登记。紧急风险动作不等待该统计门槛。若模型无可靠概率或价格源失效，普通 Rebalance 默认 HOLD/不增加暴露；硬风险事件触发 REDUCE/REMOVE 评估。

## 4. Rebalance 触发与执行模型（M05）

### 4.1 触发器不是命令

以下信号只触发“重新评估”，不能单独触发链上操作：
- active Bin 或价格偏离原分布；
- Spot/Curve/Bid-Ask 的候选边际收益排序变化；
- Bid/Ask Markout 与逆向选择风险变化；
- 库存比例、绝对 MEME 数量、未完成 Bid 承诺逼近限制；
- Regime 概率明显变化或 Risk Flag 新增；
- 费用收益变化、流动性变薄或退出深度下降。

尤其价格移动导致 active Bin 改变是 DLMM 的正常机制；若当前仓位仍有合理手续费、库存和风险预算，继续 HOLD 可能优于频繁搬仓。禁止“价格每跨一个 Bin 就 Rebalance”。

### 4.2 调仓价值的完整比较

REPOSITION 相对 HOLD 的价值必须包括：
- 预计增量成交与费用（仅实际归属己方的部分）；
- 预计成交质量与库存路径；
- 旧仓撤出、重新部署的网络费/优先费/不可回收租金；
- 撤出/加仓的真实滑点、价格冲击与失败概率；
- 交易未确认期间仍在旧仓的暴露、撤出后未部署期间的机会成本；
- 新旧仓重叠或部分成功产生的最大承诺资本；
- 冷却期内可能失去的费用和有利成交；
- 调仓后压力情景下的退出价值。

同一项费用、滑点或损失只记一次。预计费用不是已实现收益；预测 Markout 不得作为额外 PnL 再加一次。

### 4.3 Rebalance 状态机与防抖

逻辑状态：IDLE → EVALUATED → APPROVED → SUBMITTED → CONFIRMED / PARTIAL / FAILED / EXPIRED。提交不代表成功；只有链上确认和余额差异对账后才更新仓位。旧仓未确认撤出前仍计入可成交暴露；新仓未确认建立前不得计为已部署。部分撤出、部分加仓、交易过期、失败及重试均须幂等处理。

防抖约束：最小收益改善阈值、冷却期、每时间窗口最大调仓次数、最大换手率、最小持仓时间（普通动作）、最小 Bin/预算变化幅度。风险紧急动作可绕过普通冷却，但必须记录 reason code。所有限制是可配置风险参数，数值待实验。若操作成本与模型不确定性超过潜在增益，保持 HOLD。

### 4.4 何时不应调仓

- 只有 active Bin 改变，预期净价值没有显著改善。
- 当前状态概率不稳定或输入质量不足，且不存在硬风险事件。
- 预计收益改善小于执行成本、机会成本和不确定性缓冲。
- 旧仓无法可靠撤出，或新仓部署会造成双重资本承诺。
- 退出深度不足且新增操作会放大风险。
- 市场已进入 STRESS：优先执行风险预案，不做追逐式重新部署。

## 5. 退出决策：撤 LP 与处置库存是两个决策（M06）

### 5.1 两阶段退出

第一阶段：撤出 LP，停止继续接受新的池内成交风险。根据 Bin 实际余额、己方份额、未结算费用及链上状态，计算可撤出资产；不假设取回的资产全是 SOL。
第二阶段：管理撤出后的现货库存。对 MEME 可选择 HOLD、分阶段处置、在可执行报价下处置或维持人工决策；无论哪种选择，均须单独估值、单独授权、单独记录成交和成本。REMOVE 不等于 SELL；撤 LP 交易成功也不代表 Token 已经清算。

### 5.2 可执行清算价值

对待处置 MEME 数量 Q，使用当时可用的独立路由/市场深度计算分段可成交价格，得到实际可执行的预估 SOL proceeds：
V_liq(Q)=Σ_j q_j P_exec,j - fees - price_impact_cost - network_cost - other_nonrecoverable_cost。
报价需记录来源、路径、观察时间、可用时间、深度、预计成交量与有效期。仅有边际 spot price、过期报价或无足够深度时，V_liq 标记 UNKNOWN/LOW_CONFIDENCE，不能把全部 Q 按屏幕价格计价。预估报价不是保证成交；实际回执按成交后余额记账。部分成交后，剩余数量继续作为风险敞口。

同时报告：
- Mark-to-market NAV：用独立参考价估值；
- Executable liquidation value：在当前深度/成本假设下估值；
- Stress liquidation value：在延迟、价格冲击、深度收缩等场景下估值。
三者不可混淆，清算折价不是另一项已实现成本，直到实际交易发生才进入账本。

### 5.3 退出触发分层

硬退出/减险条件（立即评估保护动作）：超过库存或绝对损失硬限额；Token/池安全事件；参考价或退出路径失效且风险已不可接受；流动性/深度急剧崩塌；关键数据不可信并且无法证明风险仍在预算内。若链上执行不可用，系统应显示风险仍存在和失败原因，不能宣称退出成功。

软退出条件（风险调整后比较）：DISTRIBUTION_RANGE 概率持续升高；成熟负 Markout 与净边际收益恶化；可执行清算价值持续下降；费用收益不足以补偿库存与尾部风险；持仓资本占用的机会成本上升。软条件应比较 KEEP_LP、REDUCE、REMOVE_AND_HOLD、REMOVE_AND_DISPOSE 的 J，不以单一指标自动清仓。

### 5.4 退出后的库存决策

LP 退出后重新计算 x、y、z、绝对风险预算与清算深度。若持有 MEME 已超限，单纯撤 LP 只是停止新增交易，不解决现货风险。库存处置应比较：
- HOLD：承担后续价格风险与机会成本；
- DISPOSE：承担真实成交滑点、手续费、价格冲击与执行失败风险；
- PARTIAL：在风险预算内分阶段减少库存，但需考虑时间暴露和多次成本。
处置数量和节奏应由可执行深度、风险限额与用户授权决定，不以影响市场价格或制造表面成交为目标。无深度时不能承诺全额退出；必要时返回 MANUAL_REVIEW / EXIT_UNAVAILABLE。

## 6. 新增逻辑数据模型

在 v0.2/v0.3/v0.4 数据层基础上增加：
- regime_observation：pool_id, asof_slot, observed_at, available_at, feature_version, feature_coverage, state_scores, calibrated_probabilities, uncertainty, model_version。
- regime_transition：pool_id, from_state, to_state, decision_time, posterior_before, posterior_after, dwell_duration, confirmation_count, trigger_reason, model_version。
- risk_flag_snapshot：pool_id, position_id, asof_slot, flag_code, severity, observed_value, limit_value, source_ref, valid_until, active。
- action_evaluation：decision_id, action, expected_alpha_SOL, absolute_loss_distribution_ref, cvar_SOL, inventory_penalty_SOL, execution_cost_SOL, uncertainty_margin_SOL, hard_constraints_passed, objective_SOL, rejected_reason。
- rebalance_plan：decision_id, old_position_state, target_distribution, target_bin_weights, side_budgets, max_turnover, deadline, cooldown_key, plan_version。
- rebalance_leg_receipt：plan_id, leg_type, signature, submitted_at, confirmed_at, status, balance_delta, actual_cost, remaining_commitment, failure_reason。
- liquidation_quote：quote_id, token_amount, route/source, observed_at, available_at, expires_at, executable_depth, estimated_proceeds_SOL, price_impact, fees, confidence, status。
- exit_plan：position_id, trigger_code, lp_withdraw_plan, inventory_disposition, expected_mark_to_market, expected_liquidation_value, stress_value, risk_budget, authorization_state。
- exit_receipt：plan_id, withdraw_status, token_received, sol_received, disposed_amount, remaining_inventory, realized_proceeds, actual_cost, residual_risk, confirmation_state。

所有衍生记录需有 raw source refs、run_id、版本和 as-of key；事件唯一键保证幂等；所有时间区分发生与可获得时间。风险标记不覆盖原始事实；模型预测与实际执行回执分表。

## 7. 产品功能需求增补

| ID | 需求 | 优先级 | 验收要点 |
|---|---|---|---|
| FR09 | Regime 概率与 Unknown | P0 | 概率校准、数据覆盖、未知回退 |
| FR10 | 独立 Risk Flags | P0 | 趋势信号不能覆盖硬风险 |
| FR11 | HOLD vs REBALANCE 比较 | P0 | 成本、机会成本、风险及不确定性完整 |
| FR12 | Rebalance 状态机 | P0 | 提交/确认/部分成功/失败可区分 |
| FR13 | LP 撤出与库存处置分离 | P0 | 不把撤池等同卖出 |
| FR14 | 清算价值与压力清算价值 | P0 | 过期报价、无深度、部分成交正确处理 |
| FR15 | 状态迟滞与调仓冷却 | P1 | 普通噪声不导致频繁换仓，紧急风险可覆盖 |
| FR16 | 退出复盘 | P1 | 触发原因、实际成交、剩余库存与预测误差 |

## 8. 研究验收矩阵

Regime：
- 以时间外样本评估每类 precision/recall、危险误判、概率校准、Unknown 比例、状态持续时间与转移抖动。
- 特别评估 DISTRIBUTION_RANGE→HEALTHY_RANGE 和 STRESS→普通状态的错误率。
- 筹码特征做消融：有/无筹码信息对分类与策略净 Alpha 的增量价值。
- 数据缺失、价格源分歧、标签迟到、链上事件乱序时正确回退。

Rebalance：
- 同一事件流、相同起始库存与成本假设，比较 HOLD、固定周期 Rebalance、价格越界触发、收益阈值触发、状态/风险触发。
- 报告净 Alpha、绝对 PnL、调仓次数、换手率、真实费用、少赚手续费、未保护时间、执行失败、部分完成、尾部库存和 CVaR。
- 若 Rebalance 只增加交易次数/费用而无样本外净改善，应保留 HOLD 或更简单规则。
- 触发时的可见信息必须严格 as-of，不能回看未来 K 线决定调仓。

Exit：
- 对比 KEEP_LP、REDUCE、REMOVE_AND_HOLD、REMOVE_AND_DISPOSE；包括没有深度、过期报价、路由失败、部分成交、撤池成功但卖出失败等情况。
- 对比决策时预估清算价值与实际执行 proceeds，评估报价偏差、完成率、退出耗时、残余风险和压力折价。
- 分别报告 LP 头寸退出与 MEME 库存退出；任何一步未确认均保持风险暴露。
- 不能用理论中间价或池内边际价假设全部库存可以成交。

通用放行：
- v0.2 账本守恒、Markout 质量与防重复归因测试先通过。
- 所有风险阈值、最小经济改善、状态确认窗口和样本量在查看冻结测试集前预登记。
- 样本外净收益、绝对损失、CVaR、最大回撤、退出完成率和数据覆盖均达标；否则保留基准策略或标记 INCONCLUSIVE。
- 未完成历史数据可得性审计、完整事件重建与真实可执行深度校验前，不声称模型已有效。

## 9. 研究结论与下一步

v0.5 完成三项决策设计：市场状态概率与独立风险标记；Rebalance 的 HOLD 对照、净增益门槛及执行状态机；LP 撤出与现货库存处置分离，并增加可执行清算价值模型。

尚未完成：真实数据源可得性审计、状态标签定义校准、模型训练/校准、历史事件回放、执行延迟测量、阈值预登记及 Shadow 验证。不得将本文写成已经实现或通过回测。

下一阶段先做数据可得性与来源质量审计：逐项确认 Meteora Bin/Swap/LP 份额历史、独立价格与深度、持仓/转账历史、执行回执及时间精度能否获得；明确免费/付费、限频、历史覆盖、授权、缺口和成本。若核心逐 Bin 事件或独立退出报价不可得，需调整研究目标或承认不能验证，不能用 OHLCV 伪造逐笔结论。随后冻结数据合同、指标口径、参数待决表和产品验收清单，再决定是否进入实现阶段。

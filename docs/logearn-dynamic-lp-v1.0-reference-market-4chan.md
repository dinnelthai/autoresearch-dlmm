# LogEarn Dynamic LP v1.0 — 多池参考市场与 4CHAN 样本修订

日期：2026-11-25。承接 v0.2 Markout、v0.3 需求、v0.4 库存、v0.5 Rebalance/Exit、v0.6 数据源、v0.7 样本池、v0.8 原始数据合同、v0.9 Position 账本。本文仅做研究和数据规格，不写代码、不签名、不执行交易、不采购数据。

样本 Token：4CHAN，Mint DVdWuNK8ncn79B6z8nCiwcNAiwyFcmBPfChgxJGTpump。
目标池：Meteora DLMM 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb。
Quote mint：WSOL，So11111111111111111111111111111111111111112。

## 1. 本轮重要修订：6Hfg 的旧流动性快照过期

v0.8 记录的 GeckoTerminal 搜索摘要曾显示该池流动性约 $843.79、SOL 储备 11.33。重新打开完整池页面后，页面当前展示：
- 池龄约 6 小时；
- 流动性约 $35,153.42；
- 4CHAN 储备约 31.29M；
- SOL 储备约 244.29；
- 页面价格标注为 06:38 UTC 左右；
- 页面显示 24h Txn 4,728、Volume $306.46K。

因此，先前把 $843.79 描述为该池当前流动性的说法应更正为**旧的缓存/不同抓取时点快照**，不可作为当前值。完整页面与搜索摘要并不同步，这正是 v0.6/v0.8 要求保存 observed_at、available_at 和原始响应的原因。

来源：GeckoTerminal 目标池页面 https://www.geckoterminal.com/solana/pools/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb

所有上述值都是第三方索引页的动态快照，不是同一 Slot 的链上账户读取。也不能把池龄只有约 6 小时的页面“24h”统计理解成完整 24 小时自然日数据。

## 2. 发现同一 Token 的多池市场

完整 GeckoTerminal 目标池页面列出同 Token 的其他交易池。进一步打开链接，得到以下池地址与动态快照：

| 角色 | DEX | Pool address | 页面流动性快照 | 24h/lifetime 页面成交量 | 用途判断 |
|---|---|---|---:|---:|---|
| 目标池 | Meteora | 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb | $35.15K | $306.46K | 被研究的 LP 池，绝不能作为自身 Markout 参考 |
| 外部候选 A | PumpSwap | Ak4wr2ueEAJMqZSEcGPMX9EhCrwWRngP8CskvdEh1e6H | $63.91K | $5.99M | 第一优先参考候选，仍需历史成交/深度验证 |
| 外部候选 B | Meteora | 3zd6CXiCYPsfBCrkWEzQNNsz3yxDoW6A2CDfLwAFkThk | $46.40K | $359.34K | 第二参考候选；虽同 DEX 品牌，但为不同 pool address |
| 外部候选 C | Meteora | 65YerMPUtzXA9JzRoeUB5znbuE45S2wrLkcvv2uX7VbK | $5.64K | $111.47K | 低深度补充观察，不应自动进入主参考价 |
| 排除候选 | Orca | E9RfWWvk1yAgpbvKtygjRbciNftp7qA3eaDpSTMKRdy | $8.16 | $356.02K | 页面明确标注 Low Liquidity Pool，不能作为可执行参考价 |

数据来源：
- Target Meteora: https://www.geckoterminal.com/solana/pools/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb
- PumpSwap: https://www.geckoterminal.com/solana/pools/Ak4wr2ueEAJMqZSEcGPMX9EhCrwWRngP8CskvdEh1e6H
- Meteora candidate B: https://www.geckoterminal.com/solana/pools/3zd6CXiCYPsfBCrkWEzQNNsz3yxDoW6A2CDfLwAFkThk
- Meteora candidate C: https://www.geckoterminal.com/solana/pools/65YerMPUtzXA9JzRoeUB5znbuE45S2wrLkcvv2uX7VbK
- Orca low-liquidity: https://www.geckoterminal.com/solana/pools/E9RfWWvk1yAgpbvKtygjRbciNftp7qA3eaDpSTMKRdy

### 2.1 价格快照不可横向直接比较

这些页面的价格快照不是同一时刻：
- Target 6Hfg 页面标注约 06:38 UTC；
- PumpSwap Ak4 页面标注约 06:29 UTC；
- Meteora 3zd6 页面标注约 06:39 UTC；
- Orca E9Rf 页面标注约 07:03 UTC。

4CHAN 在该时间段波动很大。不能把页面价格差直接解释为套利价差、价格操纵或目标池偏离；需要按 slot / event-time 对齐实际成交和可用时间。

### 2.2 当前参考池候选决策

初始参考市场候选：
- Primary candidate：PumpSwap Ak4...1e6H；
- Secondary candidate：Meteora 3zd6...kThk；
- Diagnostic only：Meteora 65Yer...7VbK；
- Exclude from primary composite：Orca E9Rf...KRdy（页面显示约 $8.16 流动性并明确警告低流动性）。

这是研究候选，不是已经验证的参考价格源。必须先确认每个池地址的 mint 顺序、token program、真实 reserves、成交频率、时间精度、路由路径和历史覆盖。Primary/Secondary 角色可以随深度和质量动态变化，不能永久写死。

## 3. 参考市场的概念边界

“独立参考”是指价格来源不使用目标 LP 池 6Hfg 的自身价格/成交来证明自己的成交质量。它不意味着其他池在统计上完全独立：不同池可能被同一套利者、聚合器或同一市场冲击同时影响。

因此需要分三类：
1. Independent trade reference：其他池的实际 Swap 交易，用于成交后 Markout 的参考价格。
2. Executable exit quote：报价时点真实路由报价，用于当前清算估值。
3. Target pool state：目标池自身 Bin、Swap、Fee Growth 和 Position 数据，只用于自身库存/费用账本。

不得把三者混为一个 price 字段。

## 4. Reference Market 数据合同

新增逻辑实体 reference_pool_registry：
- pool_address, dex/program, token_x_mint, token_y_mint, quote_mint；
- pool_type, token_program_x/y, decimals_x/y；
- first_seen_slot, last_seen_slot, pool_created_at；
- current_reserves_x/y, liquidity_usd（如有）、active_bin（DLMM）；
- provider, provider_pool_id, source_url；
- candidate_role (primary/secondary/diagnostic/excluded)；
- quality_status, exclusion_reason, schema_version。

新增 reference_trade：
- signature, slot, tx_index, outer_ix_index, inner_ix_index, event_index；
- pool_address, dex/program, trader（如可靠）、input_mint/output_mint；
- amount_in_raw, amount_out_raw, decimals, transfer_fee；
- execution_price_SOL, amount_notional_SOL；
- block_time, provider_observed_at, local_received_at；
- source, parser_version, raw_event_ref, success/error。

新增 reference_pool_state：
- pool_address, slot, observed_at, available_at；
- reserves_x/y, active_bin, bin_step（DLMM）、per-bin depth；
- snapshot_hash, source, stale_flag, gap_flag。

新增 reference_price_composite：
- mint, quote_mint, decision_time, asof_slot, horizon；
- constituent_pool_ids, constituent_trade_ids；
- price_by_pool, depth_by_pool, age_by_pool；
- weighting_method, outlier_flags, target_pool_excluded；
- composite_price, confidence, sample_count, coverage_ratio；
- valid / invalid_reason, version。

新增 exit_quote：
- quote_time, input_mint, output_mint, input_amount_raw；
- output_amount_raw, price_impact, route_plan, fees；
- context_slot, quote_age, source, target_pool_in_route；
- executable_size_band, valid / invalid_reason。

所有价格与金额都保留原始单位和 decimals。若 USDC/USDT 参考池作为额外来源，需同时记录同一时刻 SOL/USD 转换价及其来源，不能把 USD 价格直接与 SOL 价格拼接。

## 5. 参考价格合成规则（研究方案，不预设阈值）

### 5.1 池资格筛选

每个时点单独检查：
- mint 必须准确匹配 4CHAN 和 WSOL（或有可靠 SOL/USD 转换路径）；
- pool 地址不能等于目标 6Hfg；
- 必须有新鲜有效的实际成交或可读状态；
- 需要可用深度，报价规模不能超过其可执行深度；
- 排除极低流动性、长时间无成交、异常价格跳变、数据延迟过高的池；
- 若 Jupiter/aggregator route 经过目标池，则该 route 不得作为独立参考；
- 同一交易被多数据源重复索引时按 signature + instruction/event path 去重，而不是只按 signature 合并所有事件。

### 5.2 合成价格

初期使用稳健聚合而非简单平均：
- 每个池先独立计算可比的价格观测；
- 价格观测必须满足 freshness 和深度门槛；
- 使用深度与数据质量约束的 weighted median / robust median；
- 不仅按成交量加权，因为短生命周期 Meme 的 volume 可能含机器人/重复流量；
- 对外部池价格分歧设置 dispersion/confidence，分歧大时输出低置信度或 UNKNOWN；
- 不满足至少两个合格参考源时，不能输出“高置信度独立价格”。

具体深度、最大 age、跨池偏差、最少成交数阈值待实测校准，不在本版本凭空指定。

### 5.3 Markout 与清算报价分开

Markout 是事后成交质量指标，基于成交前/后独立参考价格。若只有最后成交价而无深度，应称 trade-based indicative markout，不称 executable markout。

清算价值必须基于对应数量的可执行报价或历史深度重建。边际 spot price 不能替代卖出整笔库存的 VWAP。实时 Jupiter quote 若包含目标 6Hfg 池，不能作为独立参考；若不含目标池，也只是 quote-time estimate，不是成交保证。

## 6. 4CHAN Token-2022 状态修订

Barb 的公开 Token-2022 控制雷达页面显示：
- Metadata Pointer 存在；
- Transfer Hook、Permanent Delegate、Pause、Freeze、Transfer Fee、Fee switch、UI multiplier、Confidential Transfer、Non-transferable、Interest-bearing 等项目显示 Off；
- 页面称 no issuer powers。

来源：https://barb.exchange/tokens/DVdWuNK8ncn79B6z8nCiwcNAiwyFcmBPfChgxJGTpump

这比 v0.7/v0.9 的“Token-2022 extensions 具体类型未知”增加了第三方索引证据，但仍不是原始 Mint Account bytes 的直接解码。状态更新为：
- Token program = Token-2022：已由公开索引识别；
- Metadata Pointer：第三方索引显示存在；
- Transfer Fee / Hook / Permanent Delegate / UI Multiplier 等：第三方索引显示 Off；
- 原始链上 extension TLV 核验：仍 BLOCKED。

在取得原始 Mint Account 并按 Token-2022 TLV 解码前，不把第三方 Off 标记升级为链上验收通过。

## 7. Markout 质量门槛

每个 LP fill 仍须由 v0.9 的 Position/Bin 账本确认。之后对 h∈{1,5,30,60}s 分别评估：
- reference price at fill time；
- reference price at t+h；
- trade event time / reference event time；
- reference data available_at；
- sample maturity；
- pool-level and venue-level dispersion；
- fill-side and size；
- target pool exclusion；
- price/depth freshness。

若缺少每 Bin Position fill，则 Markout 不可用；若缺少足够外部价格池或时间精度，则对应 horizon 不可用。不能用 OHLCV 高低价替代实际时点价格，不向前填充未来价格，也不把未成熟标签送入训练。

## 8. 当前验收状态

| 项目 | 状态 |
|---|---|
| 目标池 6Hfg 的公开身份 | PARTIAL PASS，仍待 raw LbPair |
| 目标池当前第三方行情 | 有公开快照；旧 $843.79 结果已判为陈旧/不同抓取 |
| PumpSwap Ak4 外部池候选 | 已找到精确地址和公开页面；历史交易/时间精度未验证 |
| Meteora 3zd6 外部池候选 | 已找到精确地址和公开页面；历史交易/时间精度未验证 |
| Meteora 65Yer 低深度候选 | 已找到；只作为诊断候选 |
| Orca E9Rf | 页面明确低流动性，排除主参考 |
| Token-2022 extension | 第三方索引显示多项 Off；原始 Mint 解码仍 BLOCKED |
| 独立 reference price composite | 未实现/未验证 |
| 1s/5s/30s/60s Markout | 未验证，不能报告策略结果 |

## 9. 下一阶段执行顺序

1. 在可联网 RPC 环境分别读取目标池 6Hfg、PumpSwap Ak4、Meteora 3zd6、Meteora 65Yer、Orca E9Rf 的真实 pool account / mint / vault / reserves；核对地址与 GeckoTerminal 页面。
2. 选 6Hfg 为目标 Position 池，Ak4 与 3zd6 为初始外部参考候选；Orca 仅保留为低流动性反例。
3. 对外部池做同一时间窗交易和深度对账；建立事件时间与 available_at。
4. 只在两个外部池都通过时间/深度/数据质量门槛后，构造 reference composite。
5. 对目标池 Position 的真实 per-bin fills 通过 v0.9 验收后，再计算 Markout。
6. 同步从现在开始保存 quote-time 的 Jupiter 多规模报价；历史清算价值只能用历史池状态/交易重建。

本轮不执行链上操作、不签名、不写程序、不购买数据。该文档把 4CHAN 的多池市场从“同名交易对列表”升级为可验证的 reference pool registry 候选清单。

**最终判断：** 4CHAN 的确有足够的外部池候选可研究独立参考价格；但公开行情页只能用于发现和初筛，不能直接作为 Markout 数据。下一步仍然是原始池账户、逐笔交易、历史深度与时间精度验证。

# LogEarn Dynamic LP v0.9 — Position 账本与真实收益归因

日期：2026-11-25。承接 v0.2 Markout/收益归因、v0.3 数据与需求模型、v0.4 Regime/库存模型、v0.5 Rebalance/Exit、v0.6 数据源审计、v0.7 4CHAN 样本池、v0.8 原始数据验收合同。

范围：Solana Meme / Meteora DLMM 现货；以 Range LP（二段）为主，Launch LP 独立评估。本文只做数据模型、数学和需求规格，不写代码、不签名、不发送交易、不采购数据。样本池：4CHAN/SOL，6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb。

## 1. 本轮核心结论

**Position 账本应以链上原始账户为事实基础、以锁定版本的 Meteora 官方 SDK 作为协议计算基准、以 LogEarn 自有总账完成历史归因和独立对账。**

不能把简单的“Position share / Pool TVL”比例作为准确资产和费用账本，也不能只依靠 Swap2Evt 还原每个 Bin 的成交和每个 Position 的手续费。

本轮明确三个层次：

1. 原始事实：LbPair、BinArray、Position、Mint、Vault、交易指令、inner instructions、账户余额变化。
2. 协议计算：Meteora SDK 根据 Position shares、BinArray、FeeInfo、奖励与 Token-2022 状态计算 Position 本金、费用、奖励和转账费用处理后的数量。
3. LogEarn 账本：组合 NAV、外部资金流、手续费收入、库存变化、交易质量、成本、Markout、风险和策略 Alpha。

官方 SDK 的 getPosition(positionPubKey) 会加载 Position 覆盖的 BinArray，返回处理后的余额、费用、奖励及逐 Bin 数据；PositionData 包含 X/Y 总量、逐 Bin 数据、费用/奖励、transfer-fee-excluded amounts、owner/fee owner 和 lifetime claimed totals。它是**当前 Position 状态读取与协议计算**，不等于历史 Position 状态数据库。参考：官方 SDK Reference。

## 2. 修正 v0.8 的比例模型

v0.8 的 position_bin_amount ≈ position_share / bin_liquidity_supply × bin_amount，只能作为单 Bin、同一时点、份额口径一致时的理论 sanity check，不能作为权威金额来源，也不能用于推导历史费用。

要求：
- 资产本金以锁定版本 SDK getPosition 的 Position 逐 Bin结果为主，并与 Position 原始 liquidity_shares、Bin liquidity_supply、Bin amount_x/amount_y 交叉核对。
- 原始整数单位保留；SDK 处理后的 UI 数量另存；不能用 JS Number/浮点值覆盖原始整数。
- 份额、Bin 总供给、Bin 本金若不能在同一 Slot/同一状态版本读取，不做比例校验。
- PositionV1 与 PositionV2 的 share 整数布局不同，必须识别版本，不混用。
- Position 宽度超过默认 70 Bin 时，PositionV2 使用动态扩展数据；不得用固定账户长度过滤或只读取 inline 70 个 Bin。
- Fee checkpoints / pending fees 必须按协议整数精度和版本处理；不能用期末 share 乘历史累计 fee growth 粗略估算全部生命周期费用。

官方账户说明指出 Bin amount_x/amount_y 是 market-making token amounts，protocol fees 已排除；Bin 另有 liquidity_supply、累计 fee_amount_x/y_per_token_stored、limit-order 相关字段。PositionV2 有每 Bin shares、fee checkpoints、pending fees、lifetime claimed fees/rewards、fee_owner、lock_release_point 和 permissionless operation bits。宽度超过 70 Bin 时会追加 PositionBinData。

## 3. 官方 SDK 能力与版本控制

以本轮审计的官方公开文档为准：

- DLMM.create(connection, poolAddress)：读取 LbPair、Bitmap Extension（如已初始化）、Clock、reserve token accounts、X/Y mint、reward vault/mints，以及 Token-2022 transfer-hook metas。
- getBinArrays()：从池 bitmap 和 bitmap extension 获取已初始化 BinArray。
- getActiveBin() / getBinsAroundActiveBin() / getBinsBetweenLowerAndUpperBound()：读取价格与 Bin 窗口。
- getPosition(positionPubKey)：获取指定 Position 当前逐 Bin数据、余额、费用和奖励。
- getPositionsByUserAndLbPair(userPubKey)：按用户查 Position。
- 不传 user 时，getPositionsByUserAndLbPair 只返回 activeBin 和空 Position 列表，不能用于全池 Position 枚举。
- Token-2022 helper 包括 transfer fee included/excluded amount 与 transfer-hook extra account metas。
- 官方 changelog 的 SDK 1.9.15 加入 ScaledUiAmount extension 支持，并在 BinLiquidity / PositionBinData / PositionData 提供 scaled fields。

需求：锁定并记录实际 SDK package version、IDL commit/hash、program ID、decoder version、token program IDs 和每次读取 slot。不能跟随浮动 latest 而不留版本。1.9.15 是本轮公开 Changelog 已看到的版本能力，不代表用户本地已经安装该版本。

参考：
- SDK Reference: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx
- SDK Changelog: https://github.com/MeteoraAg/dlmm-sdk/blob/main/CHANGELOG.md
- Account Model: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/accounts.mdx

## 4. 事件链：哪些能直接证明，哪些不能

Meteora lb_clmm 事件通过 Anchor event CPI 的 inner instructions 发出。完整历史索引必须保存 outer instructions、inner instructions、logs、交易顺序和事件顺序。

### 4.1 事件注册表

| 事件 | 官方 payload 可支持的事实 | 不能单独证明的内容 |
|---|---|---|
| PositionCreate | LB pair、Position account、owner | Position 初始每 Bin shares 的全部历史状态 |
| PositionClose | Position account、owner | 关闭前所有费用和本金，仍需交易/账户变化 |
| Increase/DecreasePositionLength | Position、owner、长度变化、方向 | 每 Bin share 变化明细 |
| AddLiquidity | LB pair、sender、Position、X/Y 存入量、存入时 active bin | 每 Bin 实际分布和 shares |
| RemoveLiquidity | LB pair、sender、Position、X/Y 提取量、active bin | 逐 Bin 每一笔实际 shares 变化 |
| CompositionFee | sender、bin id、X/Y composition fee、protocol fee portion | 不能遗漏同交易 AddLiquidity/Rebalancing 的净资产变化 |
| Rebalancing | Position、owner、active bin、撤出/加入数量、claim fees/rewards、旧/新 range | 不能只当作一次普通 AddLiquidity |
| Swap2Evt | 起始/结束 Bin、方向、amount in/left/out、MM/protocol/limit-order/host fee、fee-side flags | 不包含完整的每个中间 Bin 成交分配，也不包含每个 Position 的实际 fill |
| ClaimFee2 | LB pair、Position、owner、X/Y 实际领取费用、active bin | 不代表该笔是费用产生时点 |
| ClaimReward2 | Position、owner、reward index、实际领取奖励 | 不应与 Swap Fee 合并 |
| FeeParameterUpdate / DynamicFeeParameterUpdate | 手续费参数变化 | 不提供每笔历史交易的实际每 Bin fee growth |
| GoToABin | active bin 移动 | 不等同于 Swap 或真实市场成交 |
| Place/Cancel/CloseLimitOrder | Limit Order 生命周期 | 不能当作普通 LP shares 和 LP swap fees |

官方事件说明明确：Swap2Evt 是更丰富的 Swap 事件，但只提供 start/end bin 等聚合字段；AddLiquidity/RemoveLiquidity 提供 Position 和 X/Y 总量；CompositionFee 可能和 AddLiquidity 或 Rebalancing 同交易发生，索引器需要同时处理两类事件。

### 4.2 历史 Position 重建的真实难点

**仅靠 PositionCreate + AddLiquidity/RemoveLiquidity 事件金额，不能重建每个 Bin 的准确 shares。**

原因：Add/Remove 事件只暴露总 X/Y 数量和 active bin 等信息；逐 Bin shares 还依赖 Position account 状态、指令参数、BinArray 状态和对应程序版本。

因此历史 Position 需要组合：
1. Position 原始账户快照/历史账户更新；
2. PositionCreate/Close 与 Add/Remove/Resize/Rebalance/Claim 交易；
3. 相关 instruction data 和账户列表；
4. BinArray 状态与版本；
5. 官方 SDK 对相应状态的解码和归一化；
6. 钱包/Position token balance deltas 作为独立对账证据。

如果供应商只有事件行、没有账户更新或完整交易原文，则该数据源只能完成部分 Position 生命周期统计，不得声称完整逐 Bin 历史 Position PnL。

### 4.3 Swap 与 Bin 费用分配的难点

Swap2Evt 的 start_bin_id / end_bin_id 表明 swap path 的边界，但不等于每个中间 Bin 的成交数量。MM fee 是 swap 级费用拆分，也不等于任意 LP Position 的应得费用。

要得到逐 Bin/Position 费用，需要：
- Bin 账户 fee_amount_x_per_token_stored / fee_amount_y_per_token_stored 的历史增长；
- Position 对应 Bin 的 fee_x_per_token_complete / fee_y_per_token_complete checkpoint；
- Position fee_x_pending / fee_y_pending；
- 该时点 shares；
- claim 交易及钱包余额变化。

历史 Bin fee growth 若没有账户历史或完整事件/状态回放，就无法仅凭 Swap2Evt 反推。应把这项作为 P0 数据可得性门槛。

## 5. Position 与池级账户发现方案

### 5.1 Position 发现

官方 getPositionsByUserAndLbPair 是 user-scoped，不是全池扫描接口。公开第三方 Position 的发现需要独立索引方案：

A. 事件索引：
- 从目标 Pool 交易中提取 PositionCreate，记录 Position account、owner、slot、signature；
- 追踪 Add/Remove/Resize/Rebalance/Claim/Close；
- PositionClose 后保留历史实体，不从历史表删除。

B. 程序账户扫描：
- 仅用已锁定 IDL 中 Position / PositionV2 discriminator；
- 依据生成类型核对 lb_pair 字段 offset，再做 memcmp；
- V1/V2 分开识别；
- 不用固定 dataSize 排除宽 Position；
- 扫描 RPC 的限制、响应上限和漏页必须记录；
- 当前账户扫描看不到已关闭账户，必须由历史事件补充。

A 与 B 双通道交叉核对。若 RPC 禁止/限制 getProgramAccounts，则以交易/事件索引服务作为 Position discovery，并将 completeness 限制写入报告。

### 5.2 公开第三方样本选择

不需要用户私钥或授权。先挑选目标池里至少一个公开 Position，优先覆盖：
- 有 PositionCreate + 多次 AddLiquidity；
- 有 ClaimFee / ClaimReward；
- 有 Rebalance 或 RemoveLiquidity；
- 若存在，另取一个已关闭 Position 验证 PositionClose。

第三方 Position 只验证协议会计和历史数据结构，不代表用户自己的仓位，也不能将其表现直接当作策略收益。

## 6. LogEarn 统一 Position / NAV 数据模型

以下为逻辑实体提案，不是程序实现。

### 6.1 position_snapshot

字段：
- pool_address, position_address, owner, fee_owner；
- position_version (V1/V2), lower_bin_id, upper_bin_id, width；
- lock_release_point, permissionless_operation_bits；
- account_data_hash, raw_account_data_ref；
- context_slot, observed_at, provider, SDK_version, IDL_hash。

### 6.2 position_bin_snapshot

字段：
- position_address, bin_id；
- position_liquidity_raw, bin_liquidity_supply_raw；
- position_x_amount_raw, position_y_amount_raw；
- bin_x_amount_raw, bin_y_amount_raw；
- fee_x_per_token_checkpoint_raw, fee_y_per_token_checkpoint_raw；
- fee_x_pending_raw, fee_y_pending_raw；
- reward_per_token_checkpoint_raw, reward_pending_raw；
- mint_x/y, decimals_x/y, token_program_x/y；
- scaled_ui_multiplier/version（如适用）；
- context_slot, SDK_version。

原始 raw integer 和 SDK-normalized decimal/UI amount 必须并存。

### 6.3 position_lifecycle_event

统一记录：
- event_type, position_address, pool_address, owner/sender；
- signature, slot, tx_index, outer_ix_index, inner_ix_index, event_index；
- raw_instruction_data, decoded_args, event_payload；
- token_x/y raw transfer deltas；
- position shares before/after（如有账户历史）；
- bin range before/after；
- composition_fee_x/y；
- claimed_fee_x/y, claimed_reward；
- transaction success/error；
- provider、decoder version、data completeness flags。

### 6.4 bin_state_snapshot

字段：
- pool_address, bin_id, bin_array_address, bin_array_version；
- amount_x_raw, amount_y_raw, liquidity_supply_raw；
- fee_amount_x/y_per_token_stored_raw；
- limit_order fields；
- slot, transaction position / write version, observed_at；
- source, account hash, decoder version。

Limit Order 字段与普通 LP liquidity shares、LP fee 收益分账。若 pool function_type 是 limit order 或存在相关 limit order accounts，必须单独识别，不将订单余额算作 Position 本金。

### 6.5 portfolio_nav_ledger

以 SOL 为统一计价资产，记录：
- wallet_x/y balances；
- LP principal X/Y；
- unclaimed swap fee X/Y；
- unclaimed reward assets（独立列示）；
- external cash flow；
- network/priority costs；
- composition fees；
- rent：可回收 rent 是资产，不直接记永久成本；
- transfer fee / Token-2022 fee；
- reference price source and timestamp；
- NAV before/after 与 reconciliation residual。

概念公式：
NAV = wallet_assets + LP_principal + unclaimed_swap_fees + marked_rewards + other_assets - liabilities。
其中各项先换算为 SOL 或统一计价单位；若奖励不可可靠估值，则单独报告数量和未估值标记，不强行加入 NAV。

外部资金流不算策略利润。加池/撤池/领费是组合内部资产位置变化，不创造收益。Claim Fee 时从 unclaimed fee 转到 wallet，组合 NAV 不因 claim 本身上升。Claim Reward 同理。费用若已在 Position pending 字段计入 NAV，不得再把 Swap2Evt aggregate fee 作为额外收入重复加总。

## 7. 费用分类与双重记账防护

### 7.1 费用类别

- LP / market-maker swap fee：从 Position 级 fee growth / pending / claim 归属。
- Protocol fee：Pool protocol_fee / Swap2Evt protocol fee；不是 LP 收入。Bin amount_x/y 文档说明已排除 protocol fees，不能再次从 Bin 本金扣除。
- Host/referral fee：单独列示，不自动算作 LP fee。
- Limit-order fee：与 limit-order accounts / fields 对账，不自动归入普通 Position。
- Composition fee：添加/重新部署时可能发生的成本；和同交易 AddLiquidity/Rebalancing 一起处理。
- Token-2022 transfer fee：属于 Token 转账路径成本/差额，不等于 DLMM swap fee。
- Network/priority fee：按实际交易余额变化记账。
- Rent：可回收余额保留为资产，只有不可回收部分才列成本。

### 7.2 费用只允许一个账本口径

每个 fee earning interval 选择一条 authoritative accounting path：
A. Position pending/checkpoint delta（应计口径）；或
B. 已确认 ClaimFee event + wallet delta（现金实现口径）。

如果同时保存 A 和 B，B 是 A 的结算/转移，不得将两者相加。Swap2Evt aggregate MM fee 用于池级费用交叉核对，不作为 Position 收入的直接入账来源。

### 7.3 Token-2022

必须读取 mint 的实际 extensions，不因 Token-2022 标签就假定存在 transfer tax。最少识别：
- TransferFeeConfig / TransferFeeAmount；
- TransferHook；
- ScaledUiAmount；
- 其他可能影响权限、可转移性或金额显示的 extensions。

同时保留 raw amount、transfer-fee-excluded amount、scaled UI amount、mint decimals、token program owner 和 epoch/配置。SDK 1.9.15 Changelog 已说明 ScaledUiAmount support；若本地 SDK 版本低于所需版本，必须标记 unsupported，不用自制比例覆盖。

## 8. Position 账本验收与数学对账

每个样本 Position 至少做以下对账：

1. 账户结构：Position owner / fee owner / version / range / width / lock / permissions，与原始账户一致。
2. Bin 覆盖：Position range 覆盖的所有 BinArray 完整，70 Bin array 边界和 bitmap extension 正确。
3. shares：每 Bin Position shares 与原始 Position account 和 SDK 输出一致。
4. principal：Position SDK 逐 Bin X/Y amount 汇总与 Position total X/Y 一致。
5. fees：各 Bin pending fee 汇总与 Position fee totals 一致；claim 后 pending 减少、wallet 增加，NAV 不凭空变化。
6. rewards：两种 reward slots 单独对账，不混入 swap fee。
7. liquidity changes：Add/Remove/Rebalance 的 token deltas 与账户余额变化一致；CompositionFee 同 tx 不遗漏。
8. close：PositionClose 后份额归零/账户关闭，所有本金、费用和奖励均有去向。
9. Token-2022：raw/gross/net/scaled UI amounts 按 mint extension 与 SDK 处理一致。
10. 残差：只允许程序 rounding / 已解释费用 / 未覆盖账户状态；任何未知残差不得算作 PnL。

通过标准不是“页面显示数字看起来相同”，而是 raw amount 在原子单位内对账，或明确列出协议精度范围内可解释的 rounding。

## 9. 收益归因分层：能测到什么、不能测到什么

### Level 1 — Portfolio PnL（相对容易）

有可靠 t0/t1 Position 与钱包快照、价格和外部现金流记录时，可以计算组合 NAV 变化、绝对 PnL、HODL/SOL 基准差异。它不自动解释费用和每笔 LP fill 的来源。

### Level 2 — Fee / Inventory Decomposition（要求更高）

需要 Position pending fee/checkpoints、claim、Bin state、Position share changes 和资金流对账。可以分出应计/已领手续费、本金 X/Y 变化、组合库存和成本。

### Level 3 — Per-fill Markout / Toxicity（最高要求）

还需要每个 Position 实际承接的逐 Bin 成交量、执行价和成交前后独立参考价格。Swap2Evt 只有 swap 级聚合数据和 start/end bins，不能单独产生每 Bin Position fill。缺少 per-bin state history 或可靠 replay 时，Markout/Toxicity 必须标记 unavailable，而不能按全池比例分摊伪造。

这三层不能混为一谈：Level 1 通过，不代表 Level 2/3 通过。

## 10. 4CHAN/SOL 样本池的具体执行顺序

1. D0：用 DLMM.create + 原始 getAccountInfo 读取 LbPair、mint、vault、bitmap；同一上下文 slot 保存原始响应和 SDK 归一化结果。
2. D1：获取全部已初始化 BinArray（包括 bitmap extension 外部范围）；核对 bin array index、每组 70 Bin、BinArray version 和 Position range coverage。
3. D2：读取 4CHAN mint 的实际 Token-2022 extensions；检查 TransferFee、TransferHook、ScaledUiAmount 与 TokenBadge / PairType 等约束。
4. D3：通过 PositionCreate 事件历史发现 Position；对照当前 PositionV1/V2 程序账户扫描。选择一条公开第三方 Position 生命周期。
5. D4：调用官方 SDK getPosition，保存 Position 总额、逐 Bin amounts/shares、pending fees/rewards、owner/fee owner。
6. D5：追踪该 Position 的 Add/Remove/Resize/Rebalance/CompositionFee/ClaimFee/ClaimReward/Close，核对指令参数、事件和账户余额变化。
7. D6：尝试获取历史 BinArray account updates / slot snapshots；若没有，明确无法完成历史 per-bin Markout 与 Position fee replay。
8. D7：与池级 Swap2Evt、protocol/MM/host/limit fee 汇总、Vault balance changes 对账。
9. D8：只有 D0–D7 通过后，才开始组合 NAV、Position fee attribution 和策略回放；Markout 另需独立价格源门槛。

## 11. 本轮状态与下一阶段

| 工作项 | 状态 |
|---|---|
| 官方账户模型与 PositionV2 字段 | DOCUMENTED |
| 官方 SDK 当前 Position 计算能力 | DOCUMENTED |
| Token-2022 transfer fee / hook 支持 | DOCUMENTED |
| ScaledUiAmount SDK 支持 | DOCUMENTED in SDK 1.9.15 changelog |
| PositionCreate/Close/Add/Remove/Rebalance/Claim 事件 | DOCUMENTED |
| 仅用 Swap2Evt 还原 per-bin fills | NOT SUFFICIENT |
| 全池 Position discovery | 需事件索引 + 程序账户扫描双通道 |
| 4CHAN 真实 LbPair/BinArray/Position 原始数据 | BLOCKED，尚未取得 |
| 4CHAN Position PnL 对账 | BLOCKED |
| 4CHAN per-fill Markout | BLOCKED |

下一阶段不是继续推一个“理论手续费公式”，而是验证一个真实 Position 的完整生命周期数据是否可得。若当前公开第三方 Position 发现/历史状态拿不到，优先确认 Helius/Bitquery/Alchemy 是否能提供账户更新和完整 CPI 交易原文，再决定是否购买历史数据。当前不需要用户提供私钥；如要验证用户自己的仓位，之后只需公开 Position 地址或钱包地址。

## 12. 参考资料

1. Meteora DLMM Account Model: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/accounts.mdx
2. Meteora DLMM Program Events: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/events.mdx
3. Meteora DLMM TypeScript SDK Reference: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx
4. Meteora DLMM SDK Changelog: https://github.com/MeteoraAg/dlmm-sdk/blob/main/CHANGELOG.md
5. Meteora DLMM SDK README: https://github.com/meteoraag/dlmm-sdk/blob/main/ts-client/README.md

**最终判断：** 当前最难的并不是 Position 当前余额的计算，官方 SDK 已经覆盖大部分当前状态计算。真正难点是历史 Position shares、Bin fee-growth 和 per-bin swap fills 的连续还原。只要没有这些历史状态，就只能做组合 NAV 层的有限研究，不能宣称已完成逐笔 LP 收益归因或 Dynamic LP 的真实 Markout 验证。

# LogEarn Dynamic LP v0.7 — 4CHAN/SOL 样本池专项审计

日期：2026-11-25。样本 Pool：6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb。状态：公开身份核验通过；池账户原始字段、逐笔 Swap、BinArray 与 Position 份额尚未完成原始链上对账。本文仅研究和数据审计，不写策略执行代码、不签名、不发交易、不建议买卖 Token。

## 1. 样本选择与身份核验

### 1.1 已核验身份

| 字段 | 当前结果 | 证据/状态 |
|---|---|---|
| Pool address | 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb | 用户提供；Solscan account page exact match |
| Account public name | Meteora (4CHAN-WSOL) Market | Solscan |
| Account owner program | Meteora DLMM Program：LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo | Solscan |
| Pool type | Meteora DLMM | Solscan owner + DEX Screener 明确标记 DLMM |
| Token pair | 4CHAN / WSOL | DEX Screener、Solscan public name |
| 4CHAN mint | DVdWuNK8ncn79B6z8nCiwcNAiwyFcmBPfChgxJGTpump | Solscan |
| WSOL mint | So11111111111111111111111111111111111111112 | DEX Screener |
| 4CHAN decimals | 6 | Solscan |
| 4CHAN token program | Token-2022（TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb） | Solscan |
| Token Extensions | True；具体 extension types 未核验 | Solscan |
| Pool account allocated data size | 904 bytes | Solscan |
| Bin step / active bin / X-Y mint order / fee config | 未核验 | 需解码 LbPair 原始账户 |

Solscan 将该地址标记为 Meteora DLMM Program 的 market account；DEX Screener 对同一地址也标记 Solana / Meteora / DLMM。因此本样本身份可以从“疑似 Meteora 池”升级为“公开索引已确认的 Meteora DLMM pool”。但尚未直接读取并解码 LbPair account bytes，不能把 API/Explorer 显示信息等同于原始账户字段对账。

参考：
- Solscan pool account: https://solscan.io/account/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb
- DEX Screener pair: https://dexscreener.com/solana/6hfgud7wlgeasmyr2nwu2h11qpowzq1gxqgbuzyrwrb
- Solscan token mint: https://solscan.io/token/DVdWuNK8ncn79B6z8nCiwcNAiwyFcmBPfChgxJGTpump

### 1.2 Token-2022 是必须处理的特殊项

4CHAN mint 由 Token-2022 Program 管理，Solscan 显示 Token Extensions = True。当前没有确认具体启用了哪些 extensions。进入 Swap / PnL 计算前必须解码 mint extension 列表，至少检查：
- TransferFeeConfig / TransferFeeAmount：转账税可能导致用户输入、池 vault 实收、池输出和用户实收不相等；
- TransferHook：转账可能要求额外账户或触发额外逻辑；
- PermanentDelegate、DefaultAccountState、NonTransferable、InterestBearing、ScaledUiAmount、MetadataPointer 等可能影响资产权限、显示或会计解释的扩展；
- Token-2022 mint decimals 与 UI amount 的换算必须统一。

不可仅根据 Token-2022 标签就断言有 transfer tax；必须读取实际 extension types 与配置。所有成交统一保留 raw integer amount、mint decimals、transfer fee、vault balance delta 和 user balance delta。若某个扩展影响转账/可交易性，必须纳入池资格与执行风险检查。

## 2. 市场快照与数据一致性问题

公开索引页面是动态快照，不是同步采样的事实账本。当前检索到的页面之间存在明显差异：
- DEX Screener 页面在一次抓取时显示池龄约 4h53m、流动性约 $71K、价格约 $0.001331 / 0.00001933 SOL；页面的成交统计显示约 3,395 笔、约 $152K 交易额。
- GeckoTerminal 页面在另一次抓取时显示池龄约 6 小时、流动性约 $35.2K、价格约 $0.0006021。
- Solscan Token 页面在另一次抓取时显示价格约 $0.0007235。

这些数值没有共同的精确 observed_at / slot，且页面刷新并不同步，不能平均、拼接或当作同一时点的市场快照。它们只证明第三方索引数据存在时间错位/价格快速变化的可能。之后每条行情记录都必须保存 provider、observed_at、available_at、pool、route、quote size 与原始响应。

池龄小于 24 小时，任何页面的“24h”指标实际覆盖可能只是池创建以来的生命周期窗口。不能把它误读为完整 24 小时样本。该池于 2026-11-25 新近创建，无法提供 7 天历史。它适合做实时前瞻采集，不适合单独完成 7 天回测。若需要 7 天历史实验，应另选一个成熟 DLMM 池做回溯对照；本池从现在开始采集，形成 forward dataset。

## 3. D0 Pool Identity 验收

### 已通过的部分
- Pool address 与 Solscan account page 一致。
- Owner Program 显示为 Meteora DLMM Program。
- DEX Screener 对该地址标记为 Meteora DLMM。
- Pair 为 4CHAN / WSOL；4CHAN mint 和 WSOL mint 可识别。
- 4CHAN mint decimals = 6，Token Program = Token-2022。

### 未通过 / 待直接读取的部分
1. 从 LbPair 原始账户读取并确认 token_x_mint、token_y_mint，不可仅按页面显示顺序假设 X/Y。
2. 读取 reserve_x、reserve_y vault addresses，并与 Token account owner/mint/balance 核对。
3. 读取 active_id、bin_step、status、pair_type、activation_type、activation_point、creator。
4. 读取 parameters：base factor、base fee power factor、dynamic fee controls、protocol share、fee collection mode、min/max bin ID。
5. 读取 v_parameters：volatility accumulator/reference、index reference、last update timestamp。
6. 读取 Token-2022 mint extensions 与转账费用配置。
7. 根据 bitmap 识别已初始化 BinArray；确认跨越默认 bitmap 范围时是否有 BinArrayBitmapExtension。
8. 保存原始账户 data、slot、owner program、lamports、data length、decoder/IDL version 和 decode result。

D0 结论：身份层通过；策略输入字段尚未通过。此时不允许生成准确的 bin price、active inventory、fee rate 或策略收益。

## 4. 本池的链上账户与 Bin 数据结构

Meteora 官方 DLMM account model 提供以下解码合同：
- LbPair 是根池账户，保存 mint、reserve vault、active_id、bin_step、status、pair type、fee parameters 和 bitmap。
- BinArray 每个账户包含 70 个 Bin。
- 每个 Bin 至少有 amount_x、amount_y、price、liquidity_supply、累计 fee growth 等字段。
- PositionV2 包含 lb_pair、owner、lower/upper bin、每 Bin liquidity_shares、fee checkpoints、pending fees 和 lifetime claimed fees。
- PositionV2 默认 70 个 Bin shares inline；超过 70 个 Bin 时通过 PositionBinData dynamic extension 保存额外 share / fee / reward 信息。
- Position PDA 派生包含 lb_pair、base、lower_bin_id 与 width；width 是 Bin 数量，不是 upper_bin_id。

官方账户说明：https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/accounts.mdx

### 4.1 为什么必须拿 PositionV2

池级 Bin 数据只能说明某 Bin 的总流动性和余额，不能说明我们的 LP 在该 Bin 占多少份额。要计算自己应得的费用，必须取得 Position 的逐 Bin liquidity share 和对应 fee growth checkpoint。

简化的研究关系是：某 Position 对某 Bin 的费用归属取决于该 Position 的 share、该 Bin 的 fee-per-liquidity 累积增长，以及 Position 的 checkpoint/pending 状态；实际精确值须按程序/SDK 的整数运算、rounding、protocol fee 和 claim 逻辑实现，不能用全池 TVL 比例估算。

### 4.2 BinArray 重建

BinArray 按 70 个 Bin 分组。回放某个时点的 Bin state，需要：
1. 起始时点 BinArray snapshot；
2. 按 slot、transaction index、instruction path 排序的所有 Swap / Add / Remove / Rebalance 变化；
3. 处理同一交易中多个 inner instructions / events 的事件顺序；
4. 对每个 Bin 重建 amount_x、amount_y、liquidity_supply、fee growth 与 limit-order fields；
5. 定期用历史账户快照校验重建状态。

只拿 OHLCV、交易量或当前 active bin 不能重建历史 Bin 余额。供应商的 pool-level bin changes 也不能代替 Position owner shares。

## 5. 本池数据验证任务 D1–D6

### D1 — Swap event 对账

主数据候选：Bitquery DLMM trade/event 数据；核对基准：Meteora Swap2Evt 与原始交易 inner instructions；补充：Helius/其他历史交易索引。

每笔事件保存：
- signature、slot、transaction index、instruction path；
- pool address、trader、input mint、output mint；
- raw amount in/out、mint decimals、vault balance delta、user balance delta；
- fee components：MM fee、protocol fee、host fee、limit-order fee（按事件实际字段）；
- Token-2022 transfer fee（若配置启用）；
- success/error、source/provider、decode version。

验收：抽样覆盖双向 Swap、跨 Bin、多 inner event、aggregator route、失败交易；事件行与原始交易逐笔核对；失败交易不作为成交；同一交易多事件不能重复计入总成交额。

### D2 — BinArray 状态重建

对本池识别所有已初始化 BinArray，并按 Bin ID 记录 amount_x/y、price、liquidity_supply、fee growth。至少抽样 100 个 Bin 变化事件（如池历史不足则全量覆盖可得事件并标明样本不足），对照供应商 post-reserve/change 和历史账户状态。检查：
- 同 Slot 内事件排序；
- 跨 Bin swap；
- Add / Remove / Rebalance；
- 账户初始化/关闭；
- Token-2022 net transfer amount；
- 断档、重复和解码失败。

验收：初始状态 + 所有变化可复算终点状态；与可获得的链上账户快照对账。无法对账的区间标记 gap，不允许插值伪造。

### D3 — Position share 与 LP fee attribution

本轮尚无用户的具体 Position address 或 LP wallet。池地址本身不是 Position address。

需要：
- Position account address（优先）或 LP owner wallet；
- PositionV2 / legacy Position 版本；
- lower_bin_id、upper_bin_id、width；
- 每 Bin liquidity share 与 fee checkpoint/pending；
- add/remove/resize/rebalance/claim/close 交易；
- 实际 token balances 与 fee claims。

验收：Position 初始份额 + 已确认的所有变动 = 当前份额；逐 Bin share 与账户状态一致；pending/claimed fee 与真实 claim 及钱包余额变化守恒。若未取得 Position account，D3 保持 BLOCKED，不得声称已验证个人 LP 收益。

### D4 — Independent reference price / Markout

本池本身不能作为自己的独立 Markout 参考。候选参考至少包含 PumpSwap 或其他非目标 DLMM/DEX venue 的实际成交，按可用时间、成交深度和数据质量筛选。需要验证目标池是否被 Jupiter routePlan 纳入；如包含必须剔除。

按 1s / 5s / 30s / 60s 与 slot-horizon 分开评估。若外部价格只有秒级时间戳，1s Markout 禁用或标为 unavailable；不做前视插值。记录 reference source、venue/pool、observed_at、available_at、slot、price、depth、age、route exclusion 和 confidence。

### D5 — Historical / live exit value

历史清算深度应由当时外部 DEX reserves/trades 重建；Jupiter 只能给 quote 时点的路由估值。开始前瞻采集只读报价，记录不同卖出规模的 out amount、routePlan、fee、price impact、context slot、quote time、过期时间与是否经过目标池。报价失败、过期、深度不足、部分路由和 route includes target pool 都要显式标记。

### D6 — Holder / token extension audit

Token mint 已确认 Token-2022 且有 extensions，但具体扩展未知。先解码 mint extension，再结合：
- holder balances / concentration snapshots；
- token transfers；
- 目标池及外部池 Swap；
- 相关钱包的净余额变化；
- 交易与转账的区分。

转账不等于卖出；未知钱包不能自动标为 Dev/KOL/Smart Money。Top holder 统计必须明确是否排除池 vault、Pump.fun bonding curve、burn/escrow/locker 和程序 PDA。

## 6. 本池 Regime 暂不分类

当前公开页面快照不足以生成 Regime 概率。单一页面的短期价格涨幅、成交量和买卖笔数既没有可审计的完整时间序列，也没有外部独立参考，不能据此宣布 UPTREND 或 HEALTHY_RANGE。

本池的初始数据状态应设为：
- Regime = UNKNOWN；
- DATA_GAP / DATA_UNCERTAIN = active，直到建立连续事件序列；
- Token-2022 extension review = pending；
- Position share = unavailable（未提供具体 Position）；
- Independent Markout = unavailable（未验证外部参考时间精度）。

等连续数据达到最低覆盖要求后，再计算价格趋势、真实 signed flow、深度、库存和 Markout。

## 7. 前瞻采集方案

由于该池新近创建，使用前瞻采集补足历史不足：
- T0：立即保存 Pool / LbPair / Mint / BinArray / bitmap 初始快照，记录 slot 和 observed_at。
- 实时：订阅目标池相关程序交易和账户更新；保存 raw transaction、inner instructions、logs、account write version/slot。
- 周期快照：定期保存 LbPair、所有已初始化 BinArray、相关 PositionV2 和 vault balances；具体频率由 RPC/stream 成本和 slot 更新率决定，不预设无法满足的固定频率。
- 价格：持续保存至少两个非目标池 venue 的交易和深度；另存 Jupiter 不同规模只读 quote。
- 24h：检查缺口率、重复率、解码率、Bin state 对账和外部价格覆盖。
- 72h：完成初步状态变化和 Markout 质量分析。
- 7d：形成第一个前瞻样本窗口；只有账本守恒后才能进入策略对照。

此方案是数据采集与验证，不包含任何交易执行或 LP 调仓。

## 8. 本轮验收状态

| 项目 | 状态 | 说明 |
|---|---|---|
| D0 Pool identity | PARTIAL PASS | DLMM owner / pool / pair / mint 已由公开索引确认；原始 LbPair 解码未做 |
| Token-2022 | PARTIAL | decimals、program、extensions=true 已知；具体 extension types 未知 |
| D1 Swap | BLOCKED | 尚未取得原始事件样本和逐笔对账 |
| D2 BinArray | BLOCKED | 尚未读取 BinArray snapshot / history |
| D3 Position | BLOCKED | 缺少具体 Position address / wallet |
| D4 Markout | BLOCKED | 未证明独立 venue 时间精度与覆盖 |
| D5 Exit value | PARTIAL | 可规划实时 quote 归档；历史深度未还原 |
| D6 Holder | PARTIAL | mint 可识别；历史 holder 与 swap/transfer 对账未做 |
| Regime | UNKNOWN | 单一第三方快照不足以分类 |

## 9. 下一步需要的最小输入

池级 D0–D2 可继续围绕 Pool address 完成。若要验证 D3 的个人 LP 份额和手续费，需要用户提供：
- 该池的 Position address；或
- 提供 LP 的 wallet address（仅用于读取公开链上 Position，不需要私钥）。

不需要私钥、助记词或签名授权。若没有自有 Position，可先从该池公开可查的 LP Position 中选择一个做结构验证，但必须标记为第三方样本，不能当作用户自己的仓位。

## 10. 本轮结论

本池已通过公开索引身份核验，确认是 Meteora DLMM，且其 4CHAN mint 使用 Token-2022。它是一个新池，因此更适合从现在开始做前瞻采集，而不是作为单独的 7 天历史回测样本。当前最大技术风险不是市场分类算法，而是 Token-2022 实际扩展、逐 Bin 历史状态和 PositionV2 份额/费用的可重建性。

本轮尚未调用 Meteora API 获得 JSON payload，也未直接读取 Solana raw account bytes；因此公开页面身份核验不等于原始链上状态对账。下一步必须拿到 LbPair / BinArray / Mint / Position 原始账户及交易数据，再完成 D0–D3。未完成前不进入 Dynamic LP 盈利性结论。

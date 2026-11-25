# LogEarn Dynamic LP v0.6 — 数据可得性审计与数据源选型

日期：2026-11-25。状态：公开文档审计完成，接口/样本端到端验证待做。承接 v0.2（Markout 与收益归因）、v0.3（数据模型与产品需求）、v0.4（市场状态/库存/Hybrid）、v0.5（Regime、Rebalance、Exit）。本版本只做研究、数据合同与选型，不写程序、不连接签名、不执行交易。范围为 Solana Meme / Meteora DLMM 现货；Range LP（二段）为主，Launch LP 独立评价。本文所列供应商能力以 2026-11-25 公开文档为准，套餐与报价会变化。

## 1. 审计结论

核心结论：**可获得的资料足以启动有边界的数据验证，但不能仅靠 Meteora 官方 Data API 完成 Dynamic LP 的逐笔、逐 Bin、Position 级历史回放。**

1. Meteora 官方 Data API 提供池列表/当前状态、池 OHLCV、历史成交量、钱包组合、Position 历史事件与 PnL；公开端点清单未列逐 Swap trade feed 或实时 streaming。Bitquery 的官方集成文档也明确指出 Meteora Data API 没有 per-swap feed 和 streaming。
2. Meteora 官方 lb_clmm 事件定义包含 Swap2Evt、Add/Remove Liquidity、CompositionFee、Rebalancing 等。Swap2Evt 有起止 Bin、方向、输入输出、MM fee、protocol fee、limit-order fee、host fee 等信息；事件经 Anchor event CPI 的 inner instructions 发出。单靠这些事件仍不能假设已还原每个 Position 在每个 Bin 的精确份额。
3. Bitquery 提供 DLMM 专用 GraphQL/streaming 数据与历史数据产品；其 DataStore Meteora DLMM 产品列出 meteora_dlmm_trades 和 meteora_dlmm_pools 两表，分别是一笔 Swap 和每次 Bin liquidity change，按 slot 提供数据及变更后储备。公开数据集产品当前标示 31 天 $150、184 天 $750、365 天 $1,500，一次性 Parquet 文件交付；不是 API 订阅费。
4. 免费 Hugging Face DataStore 样本仅适合了解 Schema/写解析器，不适合回测：74 张表中 56 张恰好 1,000 行，热门 swap_event 样本仅约 17 秒。
5. Position 级份额与费用归因仍需自有 Position 地址/交易记录、position/bin 账户状态与逐笔事件互相核对。Bitquery 的池级 Bin 变动数据不自动等于“某个 LP 的份额”。
6. 独立参考价、历史退出深度、实时可执行报价是三种不同数据。Birdeye 历史价格可作辅助；Jupiter 可取当前路由报价，但不能回溯三天前的实际可执行报价。必须把目标池从 Markout 参考价中排除，或证明参考路由不含目标池。
7. 1 秒 Markout 的历史时间精度尚未证实。若数据只有整数秒 block time 或 slot 顺序，不能声称拥有真实毫秒级成交后 1 秒价格；应改为 slot-horizon 或只在时间精度通过验证后启用 1s 标签。

因此数据策略采用：官方 API 做业务查询；Bitquery 做主要历史池级事实源候选；Helius/Alchemy 补链上原始交易与账户状态；Birdeye/跨 DEX 成交提供参考价格候选；Jupiter 做实时清算报价；Bitquery Holder API 做筹码历史。所有核心事实都需要交叉核验。

## 2. 数据源审计矩阵

状态定义：DOCUMENTED = 公开文档明确列出；PARTIAL = 只能解决部分需求；UNVERIFIED = 需实际样本/套餐验证；NOT PROVIDED = 公开文档未提供该能力，不可假定存在。

| 数据源 | 已文档化能力 | 主要缺口/限制 | 本项目定位 |
|---|---|---|---|
| Meteora DLMM Data API | Pools、当前池状态、OHLCV、volume history、wallet portfolio、Position historical、Position PnL、limit orders；30 RPS | 无公开 per-Swap feed/streaming；未在端点清单看到历史逐 Bin 状态序列 | 免费业务查询与 Position 复核 |
| Meteora lb_clmm Events / IDL | Swap/Swap2Evt、Add/Remove、CompositionFee、Rebalancing、ClaimFee 等事件定义 | 需获取历史原始交易并解析 inner CPI；事件不等于完整 Position 每 Bin share ledger | 解码标准与链上事实基准 |
| Bitquery DLMM GraphQL / Streams | DLMM swaps、new pools、pool reserves、Bin 变更、交易/池查询；archive/combined 可查询历史；文档称历史回溯到 mid-2024 | Archive 需 add-on；实时试用不代表含历史；Trading API 的 MEV-filtered 行不应用作无过滤原始事件总账 | 首选历史市场事件候选与后续实时数据流 |
| Bitquery DataStore Meteora DLMM | 两张 Parquet 表，146 字段；逐 Swap 与逐 Bin liquidity change；slot 分片 | 不等于 Position owner share；USD 估值不是 SOL 独立参考价；需验证完整性/许可证/具体日期 | 首个历史回测样本采购候选 |
| Hugging Face DataStore sample | 74 张表及事件 Schema 样例，免费 | 56/74 表 1,000 行封顶；swap_event 约 17 秒；不能做趋势或回测 | Schema 学习与解析器测试 |
| Helius Historical / Parsed Events | 地址历史交易回溯、slot/time filter、分页、raw transaction、Parsed Events、program/instruction scan；LaserStream 实时数据流 | 历史回溯按地址/账户查询；需要对目标池/Position 地址验证覆盖、额度和解码；不能把 Parsed 结果视为无遗漏原始事实 | 自有 Position 与原始交易补充；实时采集候选 |
| Alchemy Solana Account Archive | 付费计划支持历史 slot 账户状态、账户更新历史游标 | 账户状态历史不是 Swap 事件流；费用需看账户套餐；需验证 BinArray/Position 账户支持和历史起点 | 历史 BinArray / Position 状态交叉校验 |
| Birdeye | 历史 Token price by timestamp、OHLCV、Pair analytics、近期 Swap/钱包信息；产品页宣称约 500ms 实时价格刷新 | 产品页未证明历史价格具有 500ms 粒度；OHLCV 不可代替逐笔成交后价格；独立性需按交易对/池核验 | 价格与市场状态辅助源 |
| Jupiter Swap API v2 | /order 可只请求报价不签名；返回路由/输入输出/费用等；无 API key 的 keyless 请求有限速 | 当前报价不是历史报价；聚合路由可能包含目标 Meteora 池；报价不保证最终成交 | 当前清算估值与实时路由深度辅助 |
| Bitquery Solana Token Holders | V1 以转账全历史计算持仓；V2 近约 12h balance updates；V1 约 10 分钟延迟 | 转账不等于卖出；V1 新区块可能不完整；钱包标签仍需独立验证 | Holder 集中度与大户净流 |

## 3. 供应商与关键文档证据

### 3.1 Meteora 官方

- DLMM Data API： https://dlmm.datapi.meteora.ag ；官方文档公布 30 RPS，端点含 pools、OHLCV、volume history、portfolio、positions historical/PnL、stats 与 limit orders。
- Event Reference： https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/events.mdx 。Swap2Evt 是更丰富的 Swap 事件，包含输入/输出与费用拆分；事件经 Anchor event CPI inner instructions 发出。
- SDK / Integration Guide： https://github.com/MeteoraAg/docs/tree/main/developer-guides/dlmm 。官方说明可用公开 IDL、SDK、链上账户和 Data API 集成；解码实现需锁定 IDL/SDK 版本。

**判断：** Meteora API 是官方业务索引层，不应将它当成完整历史逐笔数据仓库。Data API 先用于查池、查 Position 和交叉核对；历史 Swap/逐 Bin 事件另找来源。

### 3.2 Bitquery

- DLMM API 文档： https://docs.bitquery.io/docs/blockchain/Solana/Meteora-DLMM-API/ 。文档说明 GraphQL、WebSocket、Kafka、gRPC 数据能力；free trial 仅 realtime，archive / combined 需要 archive add-on；历史覆盖说明回溯到 mid-2024。
- Trading API 的 Trading.Trades 提供 MEV-filtered trades，Trading.Pairs 有秒级 OHLC；它们是分析便利层。对账和完整事件总账必须选用 chain-level DEXTradeByTokens / Instructions / Pools 等相应数据层，确认过滤规则。
- DataStore： https://www.bitquery.io/datastore/datasets/meteora-dlmm 。当前产品列出 31 天 $150、184 天 $750、365 天 $1,500；两张 Parquet 表、146 字段、每日更新至前一 UTC 日。产品页面描述一笔 Swap 一行，逐 Bin liquidity change 一行，并包含变化后两侧储备。购买的是数据文件及其许可，不是 GraphQL API 订阅。
- 免费样本： https://huggingface.co/datasets/DataStore/meteora-dlmm-historical-data 。样本说明 56/74 表达到 1,000 行上限，热门 swap_event 仅约 17 秒；Swap instruction 表和 Swap event 表不可直接 union；同一签名可有多个事件，按交易/事件层级去重，避免重复计量。

**采购判断：** 不立即买 12 个月。先跑免费试用、拿两表样本、完成一个池的字段/完整性核验；若通过，再考虑买 31 天 $150 数据做第一阶段回放。API archive add-on 与 DataStore Parquet 购买是不同产品，不可混算。

### 3.3 Helius 与 Alchemy

- Helius Historical Data： https://www.helius.dev/historical-data ；getTransactionsForAddress 支持时间/slot 过滤、反向查询、分页和完整交易；Parsed Events 支持已知程序解码，缺失解码应保留 raw transaction 与 parserStatus。
- Helius SDK / Parsed Events： https://helius-labs.github.io/helius-sdk/ 。历史交易、解析和 scan 的计费/请求额度依套餐和 API 版本；新项目应使用 Parsed Events，而非已经进入 maintenance mode 的 Enhanced Transactions API。
- Helius Pricing： https://www.helius.dev/pricing 。当前公开月付档：Free $0 / 1M credits；Developer $49 / 10M；Business $499 / 100M 且含 LaserStream gRPC；Professional $999 / 200M。LaserStream 额外流量另计。这里只记录公开价，不代表推荐立即升级。
- Alchemy Account Archive： https://www.alchemy.com/docs/solana/account-archive 。历史 slot 参数只对付费计划开放，可读取某账户在历史 Slot 的状态，并用 lastUpdateBeforeSlot / firstUpdateAfterSlot 遍历更新；它不是完整事件索引器。

**判断：** 先测试已有 RPC/Alchemy 账户是否具备历史读取；Helius Free/Developer 足以评估 targeted history 和解析流程。只有需要持续 mainnet gRPC streaming 时才评估 Business，不为“可能有用”提前买 $499 套餐。

### 3.4 价格、退出与筹码

- Birdeye： https://birdeye.so/data-api/product/token-prices 。有历史时间价格、OHLCV 与 Pair analytics。必须实测历史 timestamp 的实际精度、缺失率和池来源。
- Jupiter Swap API： https://developers.jup.ag/docs/swap 。V2 /order 可不带 taker 只返回报价；文档说明无 API key 的请求有限速。实时 route quote 是报价时点的可执行性估计，不是成交保证，也不是历史 quote。
- Bitquery Holders： https://docs.bitquery.io/docs/blockchain/Solana/solana-token-holders/ 。V1 从 token launch 起按转入减转出计算地址余额，约 10 分钟延迟；V2 适合最近约 12 小时的新币余额变化。Holder 变化要与 Swap/Transfer 交叉分析。

## 4. 按 Dynamic LP 模型逐项判断可得性

| v0.2–v0.5 所需能力 | 当前可得性判断 | 缺口与放行条件 |
|---|---|---|
| Pool discovery / 当前状态 | 高 | Meteora API 可用；验证 Token-2022、异常池和字段刷新 |
| Swap direction / amounts / fees | 高（有候选数据源） | Bitquery 与官方 Swap2Evt/raw transaction 逐笔对账 |
| 每个 Bin 的历史 reserve/change | 中高 | Bitquery pools 数据需与历史 BinArray 状态抽样核验 |
| 自有 Position 每 Bin share | 中 / 未确认 | 需 position account、bin share 和自有交易完整重建；不能仅用池级变化 |
| LP Fee attribution | 中 / 未确认 | 分清 MM fee、protocol fee、host fee、limit-order fee、position entitlement、claimed/unclaimed |
| 1s / 5s / 30s / 60s Markout | 1s 未确认；较长窗口较可行 | 核验 timestamp 精度、独立市场成交密度与可用时间；1s 不合格则改 slot horizon |
| 独立参考价格 | 中高 | 至少两个外部 venue/路由候选；剔除目标池，记录 stale、depth 与 outlier |
| 历史可执行清算深度 | 中低 | 需要外部池历史 reserve/深度重建；Jupiter 只提供当前 quote，未来开始需自行留存 |
| 实时可执行报价 | 高（报价能力） | Jupiter routePlan 必须检查是否经过目标池；quote 与实际执行分开 |
| Holder concentration / historical net flow | 高（历史转账口径） | Bitquery V1/V2 组合；转账、交易、标签置信度分开 |
| Regime labels / calibrated probabilities | 衍生数据 | 由原始事件和特征生成；无标签真值，必须人工抽检及时间外校准 |
| Execution latency / failure | 需自有记录 | 历史供应商无法替代本策略自己的提交、确认、失败与余额回执 |

### 4.1 Markout 时间精度特别审计

v0.2 的 1s/5s/30s/60s 是目标观察期限，不是已确认的数据能力。Solana 的 slot、transaction index、instruction path 能提供事件顺序，但若数据时间戳只到整数秒，不能直接声称准确测量成交后 1 秒价格。必须分别保存：
- event_slot、transaction_index、instruction_path：链上顺序。
- block_time：区块时间。
- provider_observed_at：供应商观察时间。
- local_received_at：本地收到时间。
- reference_trade_time：外部市场成交时间及其精度。

只有精度与覆盖通过验证的 horizon 才生成有效 Markout；其余为 invalid/unavailable。slot-horizon 与 wall-clock horizon 分开报告，不做伪精确换算。

### 4.2 Position 与 Bin 的完整性审计

池级 Bin 的 reserve/change 不等于 LP 的份额。完整 Position 回放至少要匹配：
1. Position Create / Resize / Add / Remove / Rebalance / Claim / Close 事件；
2. 每笔 instruction 的签名、slot、tx index、inner instruction path；
3. Position account 的 liquidity shares / range / owner / operator 等状态；
4. 对应 BinArray 每 Bin 的总流动性与状态变化；
5. 费用产生、费用归属、claim 与钱包余额变化。

每个样本 Position 必须做到：初始份额 + 所有已确认变化 = 终点份额；费用账本与实际可领取/已领取金额一致；撤出后剩余份额为零或明确解释。不能证明 Position share 时，该池只能用于市场结构研究，不能用于策略 PnL 结论。

### 4.3 Markout 独立参考价合同

目标 Meteora 池的价格不能同时作为自己的独立参考价。候选参考由同 Token 的其他 DEX 池成交组成，按可用时间和流动性质量过滤；如使用聚合器报价，必须记录 routePlan 并排除目标池。至少输出：
- reference_source / venue / pool_id / route；
- observed_at、available_at、slot、tx index（如有）；
- price、executable depth、age、spread / outlier flags；
- 是否经过目标池、是否包含自身交易；
- 多来源偏差与置信等级。

目标池独占、没有外部成交或深度过低时，Markout 记 unavailable，不能用目标池自成交数据自我证明没有毒性。

### 4.4 历史退出价值合同

Jupiter quote 是报价时点的路由结果，不是历史存档。未来从数据审计开始就需定时记录不同规模的只读 quote（不签名、不执行），保存输入数量、输出数量、路由、费用、price impact、context slot、quote time、有效期与目标池包含标记。历史回测中的过去清算深度应优先由当时外部 DEX pool reserves / trades 重建；若只能取得当前报价，不得把当前深度套到历史时点。

## 5. 推荐数据组合与采购顺序

### Phase A — 免费验证（不采购）

1. Meteora Data API：池、当前状态、OHLCV、Position historical/PnL。
2. Meteora 官方事件定义与 IDL：锁定 Swap2Evt / Liquidity / Position / Fee 事件结构。
3. Hugging Face 免费样本：仅用于 Schema 了解、字段和解析规则；不得用于统计回测。
4. Helius Free/已有 Alchemy RPC：选一个真实池与自有 Position 地址做少量历史交易回溯，测试 raw transaction 和解析覆盖。
5. Bitquery free trial：验证实时查询结构与过滤逻辑；试用仅 realtime，不能把它当作历史 archive 免费额度。
6. Birdeye/Jupiter：测试价格时间精度和当前 quote route，不执行交易。

### Phase B — 小额历史样本（通过 Phase A 后）

首选 Bitquery DataStore 31 天 $150 的 DLMM 数据集，前提是供应商确认交付窗口覆盖所选池完整生命周期、meteora_dlmm_pools 逐 Bin 变化完整、字段可用且许可证允许内部研究。先做单月数据，不购买 6/12 个月。若 DataStore 不满足 Position owner share，则追加 Helius/Alchemy 历史账户数据，而不是误以为扩大 Bitquery trades 数据就能补齐 LP share。

### Phase C — 扩大历史与实时管线（通过 Phase B 后）

- 如果 31 天数据通过 E0/E1 账本和 Bin 重建验证，再采购 6/12 个月数据，做跨行情状态样本。
- 如果需要实时 DLMM 全市场 streaming，再比较 Bitquery stream 与 Helius LaserStream；以实际每秒事件数、缺口率、延迟、月费用和回放能力做基准测试。
- 只有实时 mainnet gRPC 确有必要时，再考虑 Helius Business；否则继续用现有 RPC/WSS 或较低套餐。
- 所有价格、深度与 Jupiter quotes 从进入 Paper 阶段开始持续归档，为未来历史退出价值和 Markout 建数据集。

## 6. 首轮数据验证实验（不写交易代码）

先选 1 个有活跃外部交易对、存在历史 DLMM 成交的 Meme 池，选取连续 7 天作为小样本；再选择 1 个低活跃/生命周期失败池做反例。若 7 天通过，再扩到 30 天。此处池名单须从真实返回数据选取，不在文档中虚构。

D0 Pool identity：
- 对照 Meteora /pools/{address}、Bitquery pool id、token mint、X/Y 顺序、decimals、bin step、active bin。
- 验收：所有来源使用相同池地址与 mint 顺序；Token 元数据版本留存。

D1 Swap：
- 抽取至少 100 笔交易（覆盖不同方向、跨 Bin、aggregator route、失败交易）。
- 对照 Bitquery trade rows、官方 Swap2Evt、raw transaction inner instructions。
- 验收：signature、slot、tx index、instruction path、方向、amount in/out、fee side、fee components 能对账；失败交易不记成交；同一交易多事件不重复累加。

D2 Bin state：
- 抽取至少 100 个 Bin 变化事件，覆盖 Swap、Add、Remove、Rebalance。
- 与 meteora_dlmm_pools post-reserve / change 和 Alchemy historical BinArray state 对照。
- 验收：两侧 reserve 变化及 Bin 状态可复算；同 Slot 多交易按 tx index 与 instruction path 排序；无数据缺口或明确列出 gap。

D3 Position：
- 选至少 3 个可查 Position（若真实数据可得），包含新增、移除、claim、resize/rebalance 的不同生命周期。
- 对照 Meteora /positions/{address}/historical、Helius/Alchemy 原始交易、Position account 与 BinArray。
- 验收：份额守恒、存入/取回数量、费用与 claim 归因一致；若失败，标记 Position PnL 暂不可用。

D4 Reference price / Markout：
- 同 Token 至少找 2 个非目标池外部 venue；检查成交时间、深度、价格偏差、可用延迟。
- 对照 1s/5s/30s/60s wall-clock 和 slot-horizon。
- 验收：每个 horizon 单独报告有效样本比例；1s 若不达时间精度要求，明确禁用，不向下插值或前视填充。

D5 Exit quotes：
- 用只读 Jupiter quote 对不同持仓规模取得报价，记录 routePlan、输出、费用、price impact、时间与目标池路由标记；不签名、不执行。
- 验收：无深度、过期报价、路由经过目标池、报价失败和小额可报/大额不可报均能识别；报价不是保证成交。

D6 Holder：
- 选择一个成熟 Token 测 Bitquery V1，一个新发 Token 测 V2；检查 top holders、转账流与 DEX swap 的对应关系。
- 验收：余额可对账；转账、交易、未知钱包标签不混淆；新 Token V1 延迟问题被记录。

## 7. 数据质量与放行标准

每个来源都要有 Source Registry：provider、product、plan、endpoint/dataset、schema version、retrieval time、coverage start/end、rate limit、license、known filters、parser version、cost、fallback、quality status。

统一质量指标：
- coverage ratio：预期事件中实际获取比例；
- duplicate ratio：重复签名/事件比例；
- decode success ratio：成功解码比例；
- balance reconciliation residual：账户/Position/Bin 对账残差；
- timestamp precision / lag：时间精度和到达延迟；
- price reference coverage：独立参考价可用比例；
- quote availability / quote age / executable size coverage；
- holder snapshot freshness 与 transfer reconciliation。

以下任何一项未过，不允许下游得出“策略有效”：
1. Swap/费用事件与原始链上交易不一致；
2. Bin 状态不能从初始快照连续重建；
3. Position 份额/费用不能守恒；
4. Markout 使用目标池自身报价或未来才可获得的数据；
5. 历史清算价值使用当前深度或屏幕边际价冒充历史可执行报价；
6. 数据样本存在供应商过滤/截断却未标记。

## 8. 最终建议与下一轮工作

推荐的 MVP 数据架构不是“买一堆 API”，而是：
- Meteora Data API：业务查询与官方 Position 对照；
- Bitquery：历史 Swap + Bin liquidity changes 主数据候选；
- Helius/Alchemy：raw transaction 与历史账户状态补充；
- Birdeye + 非目标池 DEX trades：独立价格候选；
- Jupiter：当前只读清算 quote，并开始保存未来报价；
- Bitquery Holders：筹码历史。

采购顺序：先免费验证；若 Bin/Swap 数据字段和完整性通过，再花 $150 买 31 天；Position share 若仍不完整，再决定历史账户归档成本。暂不买 6/12 个月数据，不升级 $499 Helius Business，不把免费样本用于回测。

v0.6 的结果是：公开数据源和公开价格已完成桌面审计，主要能力与缺口已列明；尚未调用用户账户 API、下载完整历史文件、测量实际数据覆盖、确认合同许可或完成对账。**因此当前结论是“具备验证条件”，不是“数据已验证完整”。**

下一阶段应先完成 Phase A 的数据样本验证和 D0–D6 清单，出具实测覆盖报告；再决定是否购买 31 天 Bitquery 数据。代码开发仍暂停，直到数据合同、收益归因和验收标准通过评审。

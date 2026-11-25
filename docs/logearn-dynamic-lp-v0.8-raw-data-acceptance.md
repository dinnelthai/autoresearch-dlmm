# LogEarn Dynamic LP v0.8 — 样本池原始数据验收合同

日期：2026-11-25；承接 [v0.7](logearn-dynamic-lp-v0.7-4chan-sol-sample-audit.md)。只读数据审计、数学关系、研究需求；不修改代码、不签名、不发送交易、不采购数据。样本为 4CHAN/SOL，pool 6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb。结论 PARTIAL / BLOCKED：未获得原始账户或交易 JSON，不能宣称 D0–D3 已通过。

## 1. 本轮访问实测与证据

- Meteora GET https://dlmm.datapi.meteora.ag/pools/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb ：网页读取工具报告不可访问；本地 curl 报 DNS 无法解析。
- Solana https://api.mainnet-beta.solana.com ：本地尝试只读 getAccountInfo，DNS 无法解析。
- DEX Screener https://api.dexscreener.com/latest/dex/pairs/solana/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb ：网页读取工具报告不可访问。
- GeckoTerminal https://api.geckoterminal.com/api/v2/networks/solana/pools/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb/trades ：网页读取工具报告不可访问。
以上属于当前访问环境限制，不证明供应商 API 下线或拒绝该池。

搜索索引返回的另一份 GeckoTerminal 页面（https://www.geckoterminal.com/solana/pools/6HfgUd7WLGEAsmYR2NWu2H11qpowzq1gXQGbUzYrwrb）显示池龄约2小时、4CHAN 172974.06、SOL 11.33、流动性843.79 USD、1045笔成交（544买/501卖）、成交额4465.70 USD。其时点与 v0.7 不一致，不是可保证最新的同步行情，不得拼接为连续序列、推导撤池量或计算真实 LP 收益。该页列有其他 PumpSwap、Meteora、Orca 池，可作为独立参考候选，尚未验证其地址、深度和历史成交时间精度。

## 2. 最小只读采集方案（无需个人钱包）

依据官方 SDK reference（https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx）及 Solana RPC（https://solana.com/docs/rpc/http）：

| 数据包 | 采集接口/方法 | 核心输出 |
|---|---|---|
| A Pool | getAccountInfo；SDK DLMM.create；Meteora /pools/{address} | 原始 LbPair、owner、slot、mint顺序、vault、active_id、bin_step、fee config |
| B Bin | SDK getBinArrays / getActiveBin；getMultipleAccounts | 全部已初始化 BinArray（含 bitmap extension），每 Bin 储备、share supply、价格、fee growth |
| C Mint/Vault | getMultipleAccounts / getAccountInfo | raw mint extensions、decimals、账户余额、权限 |
| D Swap | getSignaturesForAddress 按池分页；getTransaction；必要时 getBlock | 签名、slot、交易顺序、原始指令、inner CPI、日志、余额、失败状态 |
| E Position | getProgramAccounts 按已核验 IDL 的 discriminator + lb_pair 字段过滤；SDK getPosition；Meteora /positions/{address}/historical | 第三方公开 position 地址、逐 Bin shares、fee checkpoints、claimed/unclaimed、历史事件 |
| F References | 外部 DEX 交易/池状态、Jupiter 只读报价 | 排除目标池的参考价、深度与可执行报价 |

getPositionsByUserAndLbPair 无 user 时只返回 activeBin 和空 position 列表，不能当作全池 LP 扫描。全池公开仓位应使用按池过滤的程序账户查询，或从 add/remove 指令中识别 Position 地址；实际偏移和 discriminator 由锁定 IDL 验证，不能猜。动态扩展导致账户长度变化，不用固定 dataSize 排除宽仓位。RPC 可能限制扫描，应使用已知交易索引发现 Position 作为备用。第三方样本只按覆盖创建、加池、成交、领费、撤池等生命周期事件选择，不代表用户持仓。无需私钥。

## 3. 一致性与数据合同

每次采集保存 provider、endpoint、requested_at、received_at、commitment、context.slot、raw payload、hash、SDK/IDL version、错误与重试记录。多 RPC 调用的 context.slot 可能不同；minContextSlot 只是读取最低上下文要求，不是历史 slot 精确读取。批量 getMultipleAccounts 尽可能同一上下文读取；跨批次如有状态变化，要么通过事件桥接对齐到共同 slot，要么标为不同时间快照。实时采集应记录 finalized 账本并处理确认级别、断流、回补和重复。

历史采集从指定截止 slot 向前分页并记录最早/最晚签名、分页游标、失败/缺失交易。getSignaturesForAddress 只提供地址相关签名；以 getBlock 交易顺序、outer/inner instruction 路径及事件序号还原同槽顺序。不得直接把相同 signature 多个不同事件去重为一行。失败交易不计成交，但若属于策略自身，真实网络成本仍需计账。没有初始账户快照或完整从创建起的事件链，则历史 Bin 重建仍为 BLOCKED；当前快照不能直接作为过去的初始快照。

## 4. 逐 Bin 本金与费用模型

设 bin i 的可归属于 LP 本金余额为 X_i、Y_i；总流动性份额 L_i；公开样本 Position 的份额 l_i。简化连续值关系：
x_pos,i ≈ (l_i/L_i) X_i
y_pos,i ≈ (l_i/L_i) Y_i
只在 L_i>0 且份额口径一致时成立。协议可能有固定点精度、舍入、不可归属于普通 LP 的余额、limit-order 流动性和其他独立记账；实际提款与费用按锁定版本 SDK/程序计算，不能用总 vault 或全池 TVL 代替 Bin LP 本金。
费用关系（对资产 a∈{X,Y}）：
pending_pos,i,a ≈ pending_checkpoint_i,a + l_i × (G_i,a - checkpoint_i,a) / scale。
G 是协议累计每流动性单位费用；scale 是该版本固定点精度，不在文档里猜数。份额变动前后要分别结算，避免用期末份额乘整个历史 fee growth；已领取费用从 pending 转至钱包，不增加总净值第二次。
真实 Position 资产值、SDK 输出与历史 add/remove/claim 必须交叉核对；区分协议费、LP费、其他费用与 Token-2022 转账费。

反事实虚拟 LP 与第三方真实 LP 区分：第三方真实 Position 用于验证会计及份额模型；策略研究用虚拟 Position，若其加入改变池深度或成交价格，不能直接使用原历史成交数量和费用分配而不调整。小份额近似仅用于早期筛选。历史事件数据充分后再决定是否需要反事实逐笔模拟。

## 5. 最小验收包（交付物，不是已生成文件）

- pool.json、mint-vault.json、bin-arrays.json：原始账户与解码结果；每个响应附 context。
- signatures.json、transactions.jsonl：完整声明窗口的分页与逐笔原始交易。
- positions.json、position-history.jsonl：至少一个公开第三方样本（有条件优先选三种生命周期）。
- reference-trades.jsonl、quotes.jsonl：目标池以外来源及明确时间精度；没有数据时留缺失记录，不填造。
- manifest.json：来源、slot/时间范围、哈希、请求结果、缺口、版本与数据权限；secrets 不得出现在仓库。
- reconciliation.md：实际样本量、已通过项、失败原因、余额差异与无法解释的残差。

P0 门槛：pool owner/mints/decimals/vault 校验；BinArray bitmap 完整性；连续事件顺序；逐 Bin 本金和费用、Position 份额对账；Token-2022 具体 extensions 解析；不能将浮点舍入误差或缺失状态归入利润。抽样检查不足以证明整个窗口完整，必须声明验证范围。无可靠独立价格则 Markout 不可用，无历史深度则历史清算估值不可用。

## 6. 本轮新增验收状态

| 项目 | 状态 |
|---|---|
| D0 公共身份索引 | 延续 v0.7 PARTIAL |
| A/B/C 实际原始账户 | BLOCKED，网络访问未成功 |
| D1 实际交易样本 | BLOCKED，未获取 |
| D2 Bin 历史重建 | BLOCKED，未获取 |
| D3 第三方 Position | 有公开查询方案，未获取样本 |
| D4 独立参考价 | 有 venue 候选，未验证时间精度 |
| D5/D6 | 未完成 |
| 研究数据合同 | 已补充 |

下一阶段优先在具备 RPC 网络访问的环境导出最小验收包，使用现有 RPC 配额；先查当前状态和公开仓位、再判断历史可回溯范围，未通过前不买数据、不进行回测。当前没有运行持续采集，也没有预约未来任务。此轮仅新增文档。

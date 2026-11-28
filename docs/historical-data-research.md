# Historical data research / 历史数据研究（阶段 H01）
独立分支，禁止自动合并 main。不选择代币/池，不扩大到全市场，不更改 Adaptive、Paper 或现有采集服务。用户选择一个成熟池开始，先验证 1 日，再扩大 7/30/90 日。无 GPU 前置依赖。

## 数据源与可行性
- Meteora 官方 [DLMM Data API](https://dlmm.datapi.meteora.ag/swagger-ui/) 有 OHLCV、历史成交量、单仓位历史事件。现有 market-api.mjs / price-history.mjs 已采用 1h、start_time、end_time。K 线价格单位仍待验证。官方公开端点不等于历史逐 Bin 状态、累计 Q64 Fee Growth 或逐 Bin 成交记录。
- Solana finalized RPC：复用 capture-swaps.mjs、rpc-read.mjs 与 inspect-swaps.mjs，按用户池地址回补签名、交易、区块顺序；公共节点历史保留和吞吐不保证。交易事件可含起止 Bin、总成交及费用，不等于各 Bin 成交和历史供给。原始证据及失败保留。参考 https://solana.com/docs/rpc/http/getsignaturesforaddress 和 https://solana.com/docs/rpc/http/gettransaction。
- 归档候选（未采购、未验收）：[Datastore 样本](https://huggingface.co/datasets/DataStore/meteora-dlmm-historical-data)、[Bitquery](https://www.bitquery.io/datastore/datasets/meteora-dlmm)。先检查实际样本覆盖、指令版本、顺序、费用语义、许可与价格；不能承诺完整逐 Bin 状态或无遗漏。必要时才选付费供应商。
- 当前采集：复用 live 状态服务和原始快照档案；另做留存审计，不能用后来抓取的 Bin 状态填历史。持续保存 slot、active bin、raw X/Y、supply、fee growth、mint decimals、SDK/IDL version、观测时刻和缺失状态。

## 使用（仓库根目录，Node 22）
```sh
node --test research/history/core.test.mjs
node research/history/backfill-candles.mjs --pool YOUR_POOL --start 2026-11-01 --end 2026-11-02
# 按 integration-handoff.md 安装现有 research/live 依赖和配置 RPC 后：
node research/history/backfill-swaps.mjs --pool YOUR_POOL --since 2026-11-26 --batches 1 --limit 50
# 检查成本、质量后，再用同一参数重复运行；可调整 batches/limit，保持 pool/since/provider 不变。
node research/history/backfill-swaps.mjs --pool YOUR_POOL --since 2026-11-26 --batches 5 --limit 50
# 每个成功抓取目录使用既有解码器：
node research/live/inspect-swaps.mjs --capture data/raw/swaps-REPLACE --idl data/raw/dlmm-idl.json
```
日期 UTC；K 线窗口左闭右开（最多 180 天，分块 120 小时），按原始解析 JSON 保存及哈希，重复运行复用已保存窗口；缺失时不插值。RPC 默认单批 50 签名，单次至多 20 批，每批至多 100；每签名可能触发交易查询，另有区块查询及重试，因此先小量估算实际费用。checkpoint 在 data/historical/<pool>/swaps-<since>-<provider>/，引用 data/raw 原始目录。抓取失败不推进游标；时间边界或源耗尽均为 UNVERIFIED。捕获不是完整性证明；退出后如因强杀遗留 run.lock，确认没有运行进程后才人工删除锁。不要上传密钥或原始敏感配置。数据目录已 gitignore。勿同时启动多个大量回补任务占用实时采集 RPC。

## H02–H05 验收顺序（未完成）
1. H02 用用户指定池跑 1 日 K 线与 RPC 小样本；记录实际速率、缺失时间、交易 null、解析失败、费用字段覆盖、RPC 调用预算和实际可回补时间。再决定 7/30/90 日规模。
2. H03 核查已有快照留存、历史账户初始 checkpoint、跨 Bin 成交/流动性变更与 fee growth 可恢复性；历史无法恢复的字段必须缺失，不填造。核查 archive-audit.mjs 与 inspect-swaps.mjs 的证据。
3. H04 形成 Parquet：pool/time/slot/txIndex/ix/event identity；raw integer strings 或精确整数列；区分 candle、swap、bin snapshot、liquidity event；去重、缺口报告、时间冻结 train/validation/test。未证明完整性不得生成精确 LP 收益样本；优先复用 canonical JS engine，旧 Python OHLCV 不混入。
4. H05 仅在数据可用性通过后研究 Colab CPU/GPU parity、A100 批量情景计算及 CVaR。禁止自动修改参数或实时 Paper；数据和报告可通过 Drive 手动同步，按需开 GPU。

# Dynamic LP 主流程联调验收（R09/R10）

目标：仅运行用户指定 Meteora 池子的 Adaptive Paper 实验；不新增策略、不使用真实资金。NO_LP 是原始资产核算基准。以下是待执行验收，不是通过报告。

## 1. 本地预检
- 同步 main，记录 HEAD、Node 版本、SDK 版本、配置与数据源；不要覆盖用户未提交修改。
- 执行 `node research/live/verify-offline.mjs`。先修复失败的原生测试，不能通过跳过测试宣称通过。
- 重点检查 engine-admission、engine-regime-config、engine-bid-budget、engine-selection、paper-decision-config、terminal-core、preview-plans、preview-management、paper-adaptive-core、paper-snapshot-run-core。
- 本轮库存预算改变候选分配；检查旧 fixture 是否依赖旧预算，先判断数学正确性再更新断言。

## 2. 真实数据业务路径
1. 用户指定流动性良好的 Meteora 池；不自动选币。记录 pool、mint、decimals、binStep、slot、activeId。
2. 启动现有 Terminal / collector，使用 Meteora 优先的参考价、Bin 及成交数据，记录实际缺失项；不扩展供应商。确认市场观察按配置累积，区分数据缺失和策略拒绝。
3. 通过现有 Paper start API 启动单一 Adaptive 实验。验证 strategyScope=ADAPTIVE_ONLY，仅 Adaptive 与 NO_LP 核算基准两行。
4. 确认 frozen adaptiveRequest、有效 cfg、市场状态、准入原因、候选预算、效用和整数映射均可在实际日志中追踪；NO_LP 是合法结果，不强迫开仓。
5. 在实际可行的候选出现时验证后续快照重新确认、虚拟 OPEN、费用增长、NAV、HOLD/REDUCE/REPOSITION/REMOVE_AND_HOLD；不保证真实行情出现所有动作，未出现的动作以离线 fixture 验证并注明。
6. 到期结束实验，读取报告与账本；核对本金、费用、成本、NAV、相对原始持仓收益、最大回撤，检查无重复费用、无重置本金。若未到期，报告为进行中，不伪造完成窗口。

## 3. M12 参数验证
按同一输入、仅改一个参数的方法验证：regimeLookback、regimeMinObservations、trendEfficiencyThreshold、trendLogReturnThreshold、stressLogReturnThreshold、holderOutflowThreshold、toxicMarkoutBps、toxicMarkoutMinSamples；maxInventoryRatio、maxInventoryTokens、minSolReserve、maxLossSol、stressDrop、maxBinShare；lambda、kappaSol、targetRatio、beta、minImprovementSol、uncertaintySol；cooldownSeconds、executionDelaySeconds、maxRebalances、maxTurnoverSol；feeBps、protocolShare、operationCostSol、slippageBps、forecastSteps、forecastHorizonSeconds、minDepthSol、minFlowSol、maxHolderShare、maxReferenceAge、maxReferenceDivergence、markoutSeconds。区分策略配置、市场事实和固定内部常量。对每个参数记录调用位置、可触发输入、输出差异、测试证据；未接入、条件不可达或仅研究路径生效的参数分别列出。Paper 不应声称已经有实测 Markout（需要真实可归因成交路径，当前快照模型不具备该证据）。

## 4. 联调交付
输出 HEAD、命令及退出码、通过/失败测试数、实际池和时间范围、API 请求响应摘要、各动作原因、报告路径、缺失数据与下一步。区分离线通过、真实数据接通、真实数据实验完成三种状态。不要把代理收益当成真实成交收益。

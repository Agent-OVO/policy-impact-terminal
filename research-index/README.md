# 阶段十跨政策研究索引

本目录是阶段十“跨政策投资观察内核”的本地入口。它把 20 份 `manual-reports/*.json` 与阶段九 4 份新增候选报告统一为一个确定性、可追溯、零在线模型调用的查询投影。

## 文件

- `research-index.json`：由全部当前有效报告生成的统一只读索引。
- `industry-aliases.json`：离线产业别名字典；保留原名，多重命中进入 `normalizationReview`。
- `relation-events.json`：关系变化与反证事件的离线记录；不覆盖报告关系事实。
- `watchlist.json`：内部研究观察池及确定性触发/失效规则。

`research-index.json`是可重建投影，不是第二套人工事实源。报告、证据和关系事实仍来自原报告；索引通过 `reportPath`、`reportVersion`、`policyId`、`evidenceId`保持回链。

## 构建与校验

```powershell
npm run research:index -- build
npm run research:index -- validate
npm run research:index -- check
```

`build`只写本目录的生成索引；`check`比较来源指纹，不修改任何报告。当前构建输入为 24 份独立报告：20 份正式人工报告和 4 份阶段九本地候选。阶段九清单复用的 2 份正式报告只附加批次元数据，不重复装载。

## 查询

```powershell
npm run research:query -- summary
npm run research:query -- company 万华化学
npm run research:query -- industry 人工智能
npm run research:query -- policy-tool 价格
npm run research:query -- relation 许继电气
npm run research:timeline -- industry 电网
npm run research:watchlist -- list
npm run research:watchlist -- validate
```

所有查询支持 `--json`。无结果时返回 `count: 0` 和空数组，不调用在线模型补猜。公司与产业名称支持规范化和包含式模糊检索，JSON结果会保留规范化提示。

公司关系统一为：

```text
policy_named
direct_industry
indirect_industry
thematic_only
watch_only
```

政策覆盖次数始终只是一项检索事实：

```text
政策覆盖次数
≠ 订单数量
≠ 收入增量
≠ 投资价值
```

## 时间与关系边界

时间线只把报告中的结构化发布日期、施行日期和明确文本日期作为日期事实。未给出日期的名单、标准、验收、订单等等待事项保留 `date: null`、`datePrecision: unknown` 和不确定性说明。

`relation-events.json`记录“为何升级/降级”和相反证据。例如，附件直接点名可把未核验观察态升级为 `policy_named`；缺少点名、招标和订单证据可把条件性设备传导降为 `watch_only`。事件不会自动改变原报告，下一次正式修订仍需走报告版本治理。

## 验收

```powershell
npm run stage10:test
```

该命令覆盖确定性构建、去重、公司反查、产业聚合、政策工具、时间线、关系升级/降级、观察池、JSON契约、空结果、PGlite候选迁移、阶段九回归和前端构建预算。

数据库候选位于 `supabase/migrations/20260711020000_stage10_cross_policy_observation_kernel.sql`。它只增加私有视图和只读RPC，创建 0 张新表，也没有部署生产。

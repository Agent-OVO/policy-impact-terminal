# 阶段十跨政策投资观察内核 v1.0

## 实际实现

阶段十在阶段九首批六政策验证之上新增通用本地研究内核，不修改 20 份既有 `manual-reports`，不连接生产数据库，不调用在线模型。

数据流如下：

```text
manual-reports/*.json
research-batches/stage9-first-six/reports/*.json
stage9 batch-manifest（仅补元数据）
        ↓ 稳定 policyId/reportId 去重与当前版本选择
scripts/lib/research-index.mjs
        ↓
research-index/research-index.json
        ↓
公司 / 产业 / 政策 / 政策工具 / 证据 / 时间线 / 关系变化 / 观察池 CLI
```

统一索引包含：

- 政策、产业关系、公司关系、证据和政策工具索引；
- 公司—政策反向聚合及五级关系边界；
- 产业原名、规范名、别名命中和冲突复核队列；
- 日期精度和不确定性显式保存的政策事件；
- 信号、风险和反证索引；
- 关系升级/降级的离线事件历史；
- 5类对象的本地观察池、触发规则和失效规则。

当前数据规模由实际构建生成：

```text
报告/政策：24
产业聚合：58
产业关系：107
公司实体：141
公司关系：172
证据：206
政策工具：102
时间事件：455
关系变化事件：2
观察对象：5 / 容量 200
```

### 结构影响

- 新增模块：`research-index/`、通用索引库、4个CLI、阶段十测试和候选迁移。
- 最小共享入口修改：只在 `package.json`增加脚本，并对既有PGlite迁移测试增加阶段十可选迁移及关系版本样本。
- 未触碰模块：`manual-reports/*.json`正文、旧前端读取路径、生产Edge、生产Supabase和定时采集来源。
- 数据方向保持单向：报告事实 → 可重建索引；关系事件和观察池不反写报告。
- 失败模式：别名冲突进入 `normalizationReview`；来源指纹变化使 `research:index -- check`失败；无日期事件保留未知；观察池或关系事件契约错误使阶段十测试失败。

### 实现取舍与备选方案

1. 已采用“一个生成索引 + 少量配置JSON + 通用CLI”。备选是继续扩展六政策专用脚本；该方案无法覆盖全部正式报告，也会长期固化批次边界。
2. 已采用离线显式别名字典。备选是在线模型实时归并；该方案会引入费用、非确定性和不可追溯归并，因此未采用。
3. 数据库候选采用 0 张新表、私有当前态视图和只读RPC。备选是立即新增产业、时间线、关系事件和观察池表；在本地契约尚未切换为多用户工作流前会复制投影并形成双重事实源，因此未采用。
4. 生成索引保留完整证据、风险和信号。备选是只保存计数摘要；该方案无法满足报告 → 原文/附件证据 → 公司/产业关系的回链要求。

## 数据来源

报告输入：

- `manual-reports/*.json`：20份正式报告；
- `research-batches/stage9-first-six/reports/*.json`：4份本地候选报告；
- `research-batches/stage9-first-six/batch-manifest.json`：6份样本的批次角色、政策工具和来源核验元数据。

配置输入：

- `research-index/industry-aliases.json`；
- `research-index/relation-events.json`；
- `research-index/watchlist.json`。

去重以 `policyId`、`id`、规范来源URL或标题依次兜底。同一政策多修订时按有效状态、显式版本、生成时间和正式报告来源选择当前版本，并在 `generatedFrom.deduplication`记录被省略路径。当前24个输入政策键均唯一；阶段九复用的2份报告通过清单引用附加元数据，没有第二次装载。

## 查询契约

通用入口：

```powershell
npm run research:index -- build
npm run research:query -- company 万华化学
npm run research:query -- industry 人工智能
npm run research:query -- policy-tool 价格
npm run research:timeline -- industry 电网
npm run research:watchlist -- list
npm run research:watchlist -- validate
```

查询统一返回：

```json
{
  "query": {"type": "company", "input": "万华化学", "normalized": "万华化学"},
  "count": 1,
  "results": [],
  "normalizationHints": [],
  "disclaimer": "政策覆盖次数不等于订单数量、收入增量或投资价值"
}
```

公司结果包含公司名、代码/非上市状态、涉及政策、发布日期、政策工具、关系层级、官方点名、政策证据、公司业务证据、产业节点、风险与反证、观察信号、证据来源和报告版本。产业结果包含政策时间线、工具构成、方向、直接/间接关系、连续强化候选或重复表态候选、已验证/待验证公司、兑现条件和反证。

时间事件固定包含 `eventId`、`policyId`、`eventType`、`date/dateRange`、`datePrecision`、`source`、`evidenceId`、`status`、`description`、关联产业/公司和 `uncertainty`。不确定日期不补成精确日期。

数据库候选只提供当前已发布修订：

- `query_cross_policy_company(text)`；
- `query_cross_policy_industry(text)`；
- `list_company_relation_changes(text)`。

RPC均为 `SECURITY DEFINER`，先检查 `is_active_user()`，再逐行检查 `can_read_policy(policy_id)`。客户端无权直接访问 `research_private`。当前态只能通过 `policies.current_published_revision_id`选择，避免把 superseded 历史版本重复聚合。

## 已知限制

- 阶段九4份新增报告仍是本地候选，状态为 `draft`，尚未发布或装载生产。
- 别名字典当前只覆盖高价值跨政策主题；3项多重命中保留在离线复核队列，未自动裁决。
- 多数后续名单、标准、验收和订单信号没有明确日期，因此时间线中存在大量 `date: null`。
- “连续强化候选/重复表态候选”是确定性检索启发式，不是政策强度评分或投资评分。
- 政策工具同时保留报告主动作和细分动作类型，因此工具数量高于报告数量。
- 公司业务证据强度来自报告现有字段；数据库 `company_evidence_cards`尚未完成全量装载时，RPC会返回 `not_available`，不会伪装为强证据。
- 本地关系事件用于解释初始校准，不能替代下一版正式报告修订。
- 候选迁移只在PGlite通过，未修改生产数据库、未部署Edge、未接入旧前端。

## 后续阶段入口

1. 由人工处理 `normalizationReview`，按真实查询需求扩充别名，而不是批量粗归并。
2. 用新政策修订验证数据库关系变化视图，确认稳定 `relation_key`跨版本保持一致。
3. 为明确的申报截止、验收、名单和标准周期补充结构化日期来源。
4. 当观察池需要多用户协作时，先确定JSON到数据库的单向切换方案，再考虑新增一张工作流状态表；禁止双写。
5. 在阶段七至十迁移正式部署并完成新旧对照前，生产继续使用既有 `metadata.reportPayload`兼容路径。

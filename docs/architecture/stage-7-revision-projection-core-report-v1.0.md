# 阶段七版本与投影内核实施报告 v1.0

日期：2026年7月10日。
状态：仓库级核心、20份官方原文、批量影子迁移和临时PostgreSQL实测完成；生产Supabase部署待关闭。

## 一、本轮边界

本轮实施了阶段七的数据契约、可执行迁移、确定性投影器、20份报告影子迁移和自动测试，但没有：

- 执行生产`supabase db push`；
- 修改生产数据库数据；
- 修改`ingest`、`analyze`、`publish` Edge Function；
- 切换前端读取路径；
- 覆盖或改写20份报告正文；
- 停止当前`metadata`兼容写入。

## 二、数据库内核

新增迁移：

```text
supabase/migrations/20260710010000_stage7_revision_projection_core.sql
```

### 1. 原文版本

- `policy_source_documents`：保存不可变规范化原文、父版本、来源、解析版本和原文哈希；
- `policy_source_segments`：保存确定性段落、定位、段落哈希和全文检索向量；
- `policies.current_source_document_id`：指向当前原文版本。

报告修订必须通过同一`policy_id + source_document_hash`引用真实原文版本，不能提交不存在的原文哈希。

### 2. 报告修订

- `report_revisions`保存完整不可变JSON；
- `parent_revision_id`形成修订链；
- 状态支持`draft → in_review → approved → published → superseded`，拒绝无效跳转；
- 内容、模式、分析版本、投影版本、原文哈希和内容哈希创建后不可修改；
- 同一政策相同内容哈希不能重复创建；
- 发布状态必须具备审核人、审核时间、发布时间、投影哈希和成功投影运行；
- 已发布及被替代修订不得直接删除。

`policies`新增：

```text
current_published_revision_id
current_draft_revision_id
```

数据库校验当前发布修订、当前草稿修订和当前原文必须属于同一政策。新原文版本可以先于新报告到达；此时旧报告继续可读，但读取结果明确返回`isSourceCurrent=false`，从而形成原文变化待复核状态，而不是阻断原文更新。

### 3. 可重建投影

新增：

- `report_projection_runs`；
- `report_policy_actions`；
- `report_industry_nodes`；
- `report_industry_edges`；
- `report_company_relations`；
- `report_policy_network_relations`；
- `report_evidence_refs`；
- `report_signals`。

投影表使用`policy_id + revision_id + projection_version`约束，禁止投影版本与报告修订版本漂移。已发布修订的投影行不能直接增删改，但可随整个政策级联清理。

`report_company_relations`只投影权威`companyMap`；C类轻量报告在没有`companyMap`时才兼容回退`companies`。证据仍可保留对退出核心映射的兼容主体引用，但不会因此把这些主体重新升级为权威公司关系。

### 4. 证据卡、Token和配置

新增：

- `company_evidence_cards`；
- `report_company_evidence_refs`；
- `model_usage_ledger`；
- `system_config_versions`。

公司证据卡按报告需求生成，不建设全市场公司主数据仓库。Token账本记录输入、输出、缓存、有效Token、预算类别、触发原因和异常理由；身份字段不可改，调用结果只能从`planned`一次性进入终态，终态记录和成功投影运行不得事后改写。集中配置首版固化四来源白名单、采集上限、Token预算、报告契约版本和邀请制边界，但尚未替换现有代码中的硬编码。

## 三、读取与权限

新增：

```text
can_read_report_revision(uuid)
is_report_revision_source_current(uuid)
get_current_report_revision(uuid)
get_report_revision(uuid)
list_report_revisions(uuid)
get_active_system_config(text)
```

普通认证用户可以通过安全RPC读取其有权访问政策的当前版本和已发布历史版本，并直接查询对应的已发布或被替代投影；不能直接读取完整修订表。原文版本、投影运行、公司证据卡和Token账本不直接开放给普通用户，浏览器认证账户也未获得新表写权限。生产写入仍留待阶段八通过类型安全Edge Function完成。

## 四、确定性影子迁移

新增：

```text
scripts/lib/report-revision-core.mjs
scripts/build-report-revision-shadow.mjs
scripts/diff-report-revisions.mjs
scripts/export-stage7-source-documents.mjs
scripts/test-stage7-data-core.mjs
```

影子迁移器执行：

```text
原报告JSON
→ 规范化键序但不改变值和数组顺序
→ 内容SHA-256
→ revision范围确定性投影
→ 投影SHA-256
→ 引用完整性检查
→ JSON往返哈希检查
→ JSON Pointer叶级修订差异比较
```

当前20份报告结果：

| 项目 | 数量 |
|---|---:|
| 报告修订 | 20 |
| 政策动作 | 97 |
| 产业节点 | 103 |
| 产业边 | 76 |
| 权威公司关系 | 115 |
| 政策网络关系 | 58 |
| 证据引用 | 171 |
| 观察、催化、风险和边界信号 | 772 |

全部报告通过：

- JSON往返内容哈希不变；
- 相同输入重复投影哈希一致；
- 产业边节点引用有效；
- 公司关系节点引用有效；
- 证据节点及公司兼容引用有效；
- 公司关系总数继续等于权威`companyMap`口径；
- 指针发布和回滚状态模型通过。

本地影子包位于被忽略路径：

```text
artifacts/stage7/report-revision-shadow.json
```

## 五、官方原文、附件和证据摘录审计

生产管理凭据当前不可用，因此没有把旧数据库`full_text`直接视为唯一权威。阶段七改为从20份报告登记的四类官方来源重新取得：

```text
官方政策发布页面正文
＋页面直接挂载的官方附件
```

最终结果：

```text
sourceDocuments=20
verifiedSourceDocuments=20
candidateSourceDocuments=0
missingSourceDocuments=0
sourceCandidateReady=true
deploymentReady=true
```

共处理7个官方附件，其中PDF 4个、旧版Word文档3个，合计189页、5,787,735字节。PDF执行首屏渲染健康检查和逐页文本提取；Word先通过LibreOffice转为PDF，再执行相同检查。没有使用OCR补写，也没有把报告URL或证据摘录冒充完整政策原文。

这一步同时修正了旧设计：生产`full_text`是迁移对照，不天然高于官方页面及附件。尤其当政策主体位于官方附件时，目标事实源应保存可验证的网页与附件复合原文。

官方原文验证通过不代表报告中的`evidence.excerpt`全部是逐字引文。103条标为政策原文的摘录中，41条逐字匹配、27条压缩后可定位、11条仅语义相关、24条无法稳定定位；7份报告需要后续证据字段治理。迁移仍坚持零正文变化，详细结论见`docs/manual-analysis/source-evidence-audit-v1.0.md`。

## 六、临时PostgreSQL迁移实测

在本机没有可用PostgreSQL或Docker数据库服务的条件下，使用固定版本`@electric-sql/pglite@0.5.4`建立临时PostgreSQL WASM测试库。依赖只安装在系统临时目录，测试结束后删除，不进入项目依赖或锁文件。

实际验证包括：

- 全部阶段七DDL、函数、触发器、RLS策略和授权语句可执行；
- 原文版本、段落索引、修订生命周期和投影外键；
- 已发布payload和投影不可篡改；
- 新原文到达后旧报告返回`isSourceCurrent=false`；
- 两版发布、历史读取和回滚；
- Token账本身份和终态不可篡改；
- 20份真实官方影子包全量装载；
- 97项动作、103个节点、76条边、115项公司关系、58项政策网络、171条证据和772条信号计数一致；
- 重复执行不新增修订或投影行。

实测还发现并修正了发布事务顺序：同一政策通过部分唯一索引最多只能有一个`published`修订，必须先将旧版本设为`superseded`，再发布目标版本并切换指针，全部操作置于同一policy级事务。

该测试使用真实PostgreSQL语义，但不包含Supabase托管环境的全部扩展、Auth实现和PostgREST行为，因此不能替代最终暂存库验收。

同时新增受保护装载入口：

```text
scripts/lib/stage7-shadow-database-loader.mjs
scripts/apply-stage7-shadow-database.mjs
scripts/run-stage7-shadow-database-load.mjs
```

默认命令只校验影子包，不建立数据库连接。远程写入必须显式提供目标类型、精确主机、迁移账户、`--apply`和对应确认词；生产还必须提供`STAGE7_BACKUP_REFERENCE`。无数据暂存分支可使用`--seed-missing-policies`在同一事务中创建20条最小policy基线，生产目标会拒绝该参数。完整操作见`stage-7-supabase-deployment-runbook-v1.0.md`。

## 七、尚未关闭的生产门

进入生产前仍必须：

1. 在一次性Supabase项目、数据库分支或等价暂存环境运行完整迁移；
2. 使用真实Supabase Auth、RLS和PostgREST验证普通用户、管理员和服务端权限；
3. 将生产`full_text`与20份官方复合原文生成差异报告，确认旧数据是否缺附件或存在解析差异；
4. 创建生产数据库备份和明确恢复点；
5. 审查20份迁移映射、迁移账户和目标项目标识；
6. 再执行生产`db push`和影子数据装载；
7. 部署后不立即切换旧前端读取，先完成新旧双轨对照。

因此本轮没有执行任何生产数据库写入。

## 八、Schema治理修正

为避免迁移文件和`schema.sql`成为两套人工维护的数据库事实源，现明确：

```text
supabase/migrations/ = 唯一部署序列
supabase/schema.sql = 历史合并快照
```

`schema.sql`不得单独用于新建或升级生产库；后续只能从已经验证的迁移后数据库重新生成。

## 九、质量门

新增命令：

```bash
npm run stage7:source-export
npm run stage7:source-fetch -- --require-all
npm run stage7:evidence-audit
npm run stage7:shadow -- --source-documents=artifacts/stage7/official-source-documents.json --require-deployment-ready
npm run stage7:diff -- --before=<old.json> --after=<new.json>
npm run stage7:test
npm run stage7:migration-test
npm run stage7:migration-test -- --shadow-package=artifacts/stage7/report-revision-shadow.json
```

`stage7:test`已接入：

- PR人工报告质量工作流；
- GitHub Pages部署；
- 人工报告写回。

这意味着报告内容变化必须同时通过旧报告严格校验和新revision投影一致性校验。`stage7:test`同时检查SQL引号和括号平衡、关键DDL对象、RLS读取边界、无浏览器直写授权、原文分段定位、哈希稳定性和差异比较。

本轮还修复了既有本地构建清理缺陷：新增受路径保护的`scripts/clean-build-output.mjs`并作为`prebuild`运行。此前Windows工作区会保留历史哈希文件，使预算脚本误判为15个分块和1个source map；修复后每次构建先清理`dist`，最终稳定为4个JavaScript分块、总量576.79 KiB、最大217.80 KiB、source map为0。

最终本地质量结果：

```text
依赖漏洞：0
严格报告：20/20
验证器回归：通过
治理指标：不变
阶段七数据内核测试：通过
官方复合原文：20/20
影子包部署资格：通过
临时PostgreSQL迁移：通过
20份批量装载与幂等性：通过
TypeScript/Vite构建：通过
构建预算：通过
```

## 十、结论

阶段七已经完成仓库级内核、20份官方原文版本、真实影子包、临时PostgreSQL迁移、20份批量装载和幂等性验收。不可变报告、原文版本、投影、证据卡、Token账本和集中配置均已有可执行实现，且没有改写20份报告正文。

阶段七可以认定为“生产部署候选完成”，但不能认定为“生产已上线”。剩余工作集中在真实Supabase暂存环境、生产备份、生产旧原文差异核对和受控部署。阶段八的代码设计可以并行开始，但生产写入函数不得早于上述部署门禁启用。

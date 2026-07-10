# 报告版本数据库迁移草案 v1.0

状态：设计草案已转化为阶段七可执行迁移，尚未部署。
日期：2026年7月10日。
实现：`supabase/migrations/20260710010000_stage7_revision_projection_core.sql`，验收状态见`stage-7-revision-projection-core-report-v1.0.md`。

## 一、目标

把当前`policies.metadata`中的整包报告迁移为不可变修订，并为跨政策查询建立可重建投影。迁移不得修改20份报告正文或改变现有用户可见结论。

## 二、建议新增对象

### 1. `policy_source_documents`

建议字段：

- `id`、`policy_id`、`parent_document_id`；
- `source_url`、`normalized_text`；
- `source_document_hash`；
- `parser_version`、`fetched_at`、`official_published_at`；
- `is_current`或由`policies.current_source_document_id`指向；
- `metadata`仅保存解析扩展信息。

### 2. `policy_source_segments`

建议字段：

- `id`、`source_document_id`；
- `segment_key`、`sort_order`、`text`、`segment_hash`；
- 标题层级、页码或原文定位信息。

### 3. `report_revisions`

建议字段：

```text
id uuid primary key
policy_id uuid not null
parent_revision_id uuid null
status text not null
payload jsonb not null
schema_version text not null
analysis_version text not null
projection_version text not null
source_document_hash text not null
content_hash text not null
projection_hash text null
change_summary text
change_reason text
created_by uuid null
reviewed_by uuid null
created_at timestamptz not null
reviewed_at timestamptz null
published_at timestamptz null
```

约束：

- `content_hash`由规范化payload计算；
- 同一政策相同`content_hash`不得重复创建；
- 已发布修订禁止更新payload、哈希和版本字段；
- 父修订必须属于同一政策；
- published状态要求审核、投影和发布时间完整。

### 4. `report_projection_runs`

记录修订投影的版本、状态、开始/结束时间、行数摘要、投影哈希和错误。发布只接受成功且版本匹配的投影。

### 5. 修订范围投影表

不建议直接把现有只按`policy_id`唯一的表改成第二事实源。优先新建修订范围投影，例如：

- `report_policy_actions`；
- `report_industry_nodes`、`report_industry_edges`；
- `report_company_relations`；
- `report_policy_network_relations`；
- `report_evidence_refs`；
- `report_signals`。

每张表至少带`revision_id`、`policy_id`、稳定业务键和`projection_version`。所有行由投影器生成。

### 6. `company_evidence_cards`

保存按需复用的公司事实证据，字段包含公司稳定键、事实类型、摘录、来源、哈希、证据等级、观察和失效时间。报告通过关联表引用，不复制全量公司资料。

### 7. `model_usage_ledger`

按ADR-007记录调用、Token、缓存、预算、请求哈希和触发原因。

### 8. `system_config_versions`

保存非敏感集中配置及其版本、生效时间、变更原因和创建者。

## 三、`policies`调整

建议新增：

- `current_source_document_id`；
- `current_published_revision_id`；
- `current_draft_revision_id`。

过渡期保留`analysis_version`、`summary`和`metadata`，但只作为兼容字段。完成切换后：

- 详情不再读取`metadata.reportPayload`；
- 列表计数不再读取`metadata.counts`；
- 删除写入`policyReport`、`analysisStub`等镜像；
- 最后再评估删除旧字段和兼容mapper。

## 四、发布事务草案

单次发布事务应：

1. 锁定policy和目标revision；
2. 验证状态、父版本、原文哈希和模式版本；
3. 验证投影成功且`projection_hash`一致；
4. 将原current revision设为`superseded`；
5. 将目标revision设为`published`；
6. 切换`current_published_revision_id`；
7. 写入发布审计事件；
8. 提交事务。

该顺序是硬约束：数据库通过部分唯一索引保证同一政策最多只有一个`published`修订。若先发布新版本再替代旧版本，会在事务中触发唯一约束。阶段八发布函数必须以policy级锁包裹上述顺序，任一步失败均整体回滚。

失败时不改变当前指针。请求携带幂等键，重复请求返回相同发布结果。

## 五、迁移顺序

1. 只增不改地创建新表、约束和读取RPC；
2. 为20份仓库JSON创建初始revision；
3. 生成投影并执行一致性验收；
4. 开启影子读取，对比旧metadata与新revision；
5. 切换详情和聚合读取；
6. 改造写入为修订发布；
7. 观察稳定后停止metadata整包双写；
8. 新前端切换完成后删除旧兼容层。

## 六、风险与控制

- **双轨漂移：** 过渡期只允许旧写入入口生成revision，禁止两边独立编辑；
- **投影失败：** 不切换发布指针；
- **模式不兼容：** 使用显式迁移器和版本矩阵；
- **并发发布：** policy级锁和乐观版本号；
- **回滚失败：** 发布前验证目标历史投影可用；
- **存储膨胀：** 20至数百份报告规模下可接受，禁止在每次普通查看时复制payload。

## 七、本阶段边界

本文件继续保留为设计依据。阶段七已经完成DDL、RLS、领域类型、确定性影子迁移和仓库自动测试；尚未完成生产原文导出、一次性数据库实际执行、备份恢复验证和生产部署。生产读写、事务发布与生成Database类型仍属于阶段八。

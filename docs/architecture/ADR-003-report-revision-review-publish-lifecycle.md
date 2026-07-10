# ADR-003 报告修订、审核与发布生命周期

状态：已接受
日期：2026年7月10日

## 决策

报告采用不可变修订。任何编辑、证据替换、关系升降级或模式迁移都创建新修订，已发布记录不得原地覆盖。

## 核心字段

`report_revisions`至少包含：

- `id`、`policy_id`；
- `parent_revision_id`；
- `status`：draft、reviewing、approved、published、superseded、rejected；
- `payload`、`schema_version`、`analysis_version`、`projection_version`；
- `source_document_hash`、`content_hash`、`projection_hash`；
- `change_summary`、`change_reason`；
- `created_by`、`reviewed_by`；
- `created_at`、`reviewed_at`、`published_at`。

`policies`增加：

- `current_published_revision_id`；
- `current_draft_revision_id`；
- 当前原文版本指针。

## 生命周期

```text
创建不可变草稿修订
→ 严格校验
→ 差异审查
→ 审核通过
→ 生成修订投影
→ 事务性发布并切换当前指针
→ 旧发布版本标记为superseded但继续可读
```

草稿也不在原记录上持续改写；再次修改时从当前草稿创建子修订，并移动`current_draft_revision_id`。

## 增量更新

普通更新只修改受影响字段：

1. 比较新证据与当前修订；
2. 复制当前payload形成候选修订；
3. 更新受影响的证据、公司关系、风险、催化或时间字段；
4. 记录机器可读差异和人工`change_summary`；
5. 仅对变化片段运行必要复核；
6. 全量执行确定性校验，但不重新生成全文。

## 原文变化识别

抓取到相同稳定政策但`source_document_hash`变化时，不直接覆盖当前原文或报告。系统创建新的原文版本，并把相关报告标记为`source_changed_review_required`。只有确认是正文更新而非页面噪声后，才创建报告修订。

## 回滚

回滚不是删除或覆盖。管理员选择一个历史已发布修订，系统验证其投影可用后，在事务中切换`current_published_revision_id`并记录发布事件。后续需要继续修改时，以回滚后的修订作为新父版本。

## 审核规则

- 创建者与审核者原则上分离；个人单用户模式允许同一人操作，但必须显式记录`self_reviewed`；
- 发布必须通过严格报告校验、投影一致性检查和来源哈希检查；
- 模式版本不兼容时先执行显式迁移，不由前端mapper静默猜测；
- 发布失败不得改变当前发布指针。

## 后果

系统可以回答“谁在何时因何修改了什么”，支持差异比较、一键回滚和增量分析复用；代价是发布服务必须具备事务、幂等和并发控制。

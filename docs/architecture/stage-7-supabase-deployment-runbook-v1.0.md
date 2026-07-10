# 阶段七至阶段八零费用Supabase生产影子部署运行手册 v1.0

日期：2026年7月11日。
状态：运行方案已更新；当前生产写入门关闭。
成本约束：不创建Preview Branch、新Supabase项目或其他新增计费资源。

## 一、目标

在既有Supabase生产项目中，以加法、影子、可回退方式部署阶段七和阶段八数据库对象，同时：

- 不切换旧前端读取；
- 不切换现有人工写回；
- 不删除`policies.metadata`报告；
- 不部署候选Edge Function，除非数据库影子验收先通过；
- 不产生新增云资源费用；
- 发现异常时停用新路径而不是破坏性回滚。

该方案风险高于独立暂存环境，因此所有备份、确认和只读核验门必须更严格，不能因为不接受费用而降低标准。

## 二、当前阻断状态

执行：

```bash
npm run production:readiness:audit
```

2026年7月11日结果：

```text
project=ACTIVE_HEALTHY
backupGatePassed=false
pitr=false
physicalBackups=0
shadowReady=true
productionSources=false
sourceCrosscheck=false
productionWriteReady=false
```

当前阻断项：

```text
no_confirmed_restorable_backup_or_pitr
production_source_snapshot_missing
production_source_crosscheck_not_passed
database_connection_credential_missing
```

在阻断项全部消除前，不得运行`supabase db push`、数据库装载器或Edge部署。

## 三、唯一允许的验证环境

### 1. 本地PGlite

固定使用`@electric-sql/pglite@0.5.4`在系统临时目录执行全部迁移和测试。它覆盖：

- PostgreSQL DDL和PL/pgSQL；
- 触发器、约束、RLS策略和授权；
- `authenticated`、`anon`、`service_role`角色；
- JWT claim模拟；
- 事务发布、回滚和幂等；
- Token预算；
- 邀请、暂停、恢复和两阶段删除；
- 20份真实影子包批量装载。

### 2. 既有生产项目只读管理面

只允许查询：

- 项目状态；
- 已有分支列表；
- 备份和PITR状态；
- 远程迁移列表；
- Schema和类型；
- 生产政策原文只读快照。

不得通过只读核验顺带修改密码、Secrets、Auth用户、数据库或工作流。

## 四、生产前必备输入

### 1. 本地部署候选

必须全部存在且通过：

```text
artifacts/stage7/official-source-documents.json
artifacts/stage7/report-revision-shadow.json
artifacts/stage7/source-evidence-audit.json
artifacts/stage8/zero-cost-production-readiness.json
```

影子包必须满足：

```text
deploymentReady=true
reports=20
verifiedSourceDocuments=20
missingSourceDocuments=0
```

### 2. 生产只读快照

必须临时取得：

```text
policy_id
source_url
full_text
content_hash
updated_at
metadata报告哈希或完整兼容报告
```

凭据只进入当前进程，不写入仓库、命令历史、日志或长期明文文件。

### 3. 可恢复逻辑备份

当前PITR关闭且物理备份列表为空，因此生产写入前必须用既有数据库连接执行零费用逻辑导出。至少覆盖：

- `auth.users`的可恢复管理清单或Supabase允许的Auth导出；
- `profiles`；
- `policies`；
- `policy_sources`；
- `analysis_jobs`；
- 现有规范化表；
- `user_events`；
- 已部署迁移历史。

备份必须在本地隔离目录保存，不进入Git。随后在本地PostgreSQL/PGlite兼容环境完成读取或恢复验证，并记录：

```text
backup_id
生成时间
目标project ref
文件哈希
表数量
关键行数
恢复验证结果
```

仅有导出文件、没有恢复验证，不视为备份门通过。

## 五、生产原文差异核验

生产快照取得后执行：

```bash
npm run stage7:source-crosscheck -- \
  --production=artifacts/stage7/production-source-documents.json \
  --official=artifacts/stage7/official-source-documents.json
```

逐份分类：

- `exact`：完全一致；
- `format_only`：仅格式或空白差异；
- `production_subset`：生产文本缺少官方附件或正文；
- `official_subset`：生产文本包含额外有效材料；
- `navigation_noise`：生产文本混入网页导航；
- `material_difference`：实质差异，必须人工复核。

差异核验不自动覆盖`policies.full_text`。目标原文版本使用官方网页及其直接挂载附件形成的复合原文，生产旧文本仅作迁移对照。

## 六、生产写入硬门

`scripts/configure-production.mjs`默认拒绝执行。即使运行：

```bash
npm run setup:production
```

也会在读取API密钥前失败。

只有以下条件全部满足才会继续：

```text
--apply-production
PRODUCTION_CONFIRMATION=APPLY:<exact-project-ref>
24小时内生成的就绪报告
报告project ref与目标一致
additionalPaidResourcesAllowed=false
productionWriteReady=true
blockers=[]
```

自动测试：

```bash
npm run production:guard:test
```

生产装载器还要求：

- `--target=production`；
- 精确数据库主机；
- 生产确认短语；
- 备份标识；
- 禁止`--seed-missing-policies`。

## 七、加法影子迁移步骤

只有生产写入硬门开启后，按以下顺序执行。

### 1. 再次确认目标

记录并人工核对：

```text
project ref
数据库主机
区域
PostgreSQL版本
当前Git提交
本地迁移文件列表
远程迁移列表
备份ID与文件哈希
```

### 2. 推送加法迁移

只使用有序迁移：

```text
20260710010000_stage7_revision_projection_core.sql
20260710020000_stage8_transactional_revision_lifecycle.sql
20260710021000_stage8_model_budget_enforcement.sql
20260710022000_stage8_invite_account_governance.sql
20260710023000_stage8_account_deletion_workflow.sql
```

不得单独运行`supabase/schema.sql`。

### 3. 数据库对象验收

迁移后先验证：

- 新表、函数、索引和触发器存在；
- RLS已启用；
- service-role-only RPC未授予`authenticated`；
- 旧`policies`、`metadata`和现有前端查询仍正常；
- 生产页面没有变化。

失败时停止，不装载20份影子数据。

### 4. 装载20份影子数据

使用受保护装载器：

```bash
npm run stage7:db-load -- \
  --target=production \
  --actor-id=<existing-active-admin-uuid> \
  --shadow-package=artifacts/stage7/report-revision-shadow.json \
  --apply \
  --expected-host=<exact-production-db-host> \
  --backup-id=<verified-backup-id> \
  --confirm=<production-confirmation>
```

生产模式禁止创建policy基线；20个policy必须与现有生产记录一一对应。

### 5. 影子数据验收

必须满足：

```text
20/20原文版本
20/20初始published revision
20/20当前指针
97项政策动作
103个产业节点
76条产业边
115项公司关系
58项政策网络
171条证据引用
772项信号
0重复修订
0悬空引用
```

重复执行装载器，所有计数必须不变。

## 八、部署后真实权限验证

数据库和影子数据稳定后，使用现有项目内可删除测试账号验证：

- active普通用户可读取已发布报告；
- invited、suspended用户即使持有旧JWT也不可读；
- anon不可读；
- 普通authenticated不能直读完整revision表；
- 普通authenticated不能写投影；
- active管理员可执行候选管理操作；
- 非管理员调用事务、预算和账户RPC失败。

测试账号和行为事件完成后清理，并核对无残留。

## 九、候选Edge部署

只有数据库影子验收和真实权限测试通过后，才按顺序部署：

```text
revision-lifecycle
model-budget
account-governance
```

部署后仍不修改现有人工写回工作流。每个函数先执行：

- 未认证拒绝；
- 非管理员拒绝；
- 管理员正常路径；
- 幂等重放；
- 错误参数；
- RPC不存在时不回退metadata覆盖。

## 十、新旧双轨对照

旧路径继续读取：

```text
policies.metadata.reportPayload
```

新路径只读：

```text
current_published_revision_id
→ report_revisions.payload
→ revision-scoped projections
```

20份逐项比较：

- 标题、机构和日期；
- 结论和动作；
- 产业节点和边；
- `companyMap`关系；
- 政策网络；
- 证据；
- 投资方向；
- 列表计数；
- 用户可见正文。

门槛：

```text
20/20语义一致
0用户可见正文变化
0公司计数变化
0错误当前指针
0投影漂移
```

## 十一、故障处置

阶段七、阶段八迁移是加法迁移。出现故障时优先：

1. 停止新Edge调用；
2. 保持旧前端和旧人工写回；
3. 不切换任何新指针；
4. 禁用新RPC入口；
5. 保留新表用于审计；
6. 根据逻辑备份和差异报告处理。

不得在未评估外键、审计和历史数据前直接删除新表。

## 十二、当前结论

当前满足：

- 本地迁移和表级RLS测试通过；
- 20份真实影子包通过；
- 生产项目健康；
- 生产修改脚本具有硬门。

当前不满足：

- 可恢复备份门；
- 生产原文差异门；
- 数据库连接门；
- 托管Auth/PostgREST/Edge验证门。

因此现在只能继续只读核验和本地验证，不能执行生产迁移。

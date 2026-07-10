# 零费用生产就绪只读审计 v1.0

审计日期：2026年7月11日。
目标项目：`qxzspsofhmfjceuaulhu`。
执行方式：Supabase管理面只读查询＋本地仓库制品核验。
结论：`productionWriteReady=false`。

## 一、成本约束

本次审计没有：

- 创建Supabase Preview Branch；
- 新建Supabase项目；
- 升级套餐或计算规格；
- 执行数据库迁移；
- 部署Edge Function；
- 读取或输出API密钥；
- 写入生产数据。

## 二、项目状态

Supabase CLI只读项目列表显示：

```text
项目名称：policy-impact-terminal
项目ref：qxzspsofhmfjceuaulhu
状态：ACTIVE_HEALTHY
区域：ap-northeast-1
PostgreSQL：17.6.1
项目已链接：是
```

目标项目本身运行健康。

## 三、备份和恢复状态

`supabase backups list`返回：

```text
pitr_enabled=false
physical backups=0
backups=null
walg_enabled=true
```

这只能证明WAL-G机制标志存在，不能证明当前账户已有一个可以由本项目直接恢复的物理备份。当前没有PITR，也没有在管理API中取得可恢复备份记录。

因此：

```text
backupGatePassed=false
```

在形成不增加费用的逻辑备份及恢复验证前，不允许生产数据库写入。

## 四、迁移和连接状态

本地迁移序列完整，阶段七、阶段八全部迁移已在PGlite中通过。

远程`migration list --linked`尝试只读连接生产数据库时失败。当前进程没有：

- `SUPABASE_DB_PASSWORD`；
- `DATABASE_URL`；
- `SUPABASE_DB_URL`；
- `PGPASSWORD`。

审计没有重置数据库密码，也没有绕过权限获取连接凭据。

## 五、报告和原文状态

本地真实影子包：

```text
20份报告
20份官方复合原文
7个官方附件
sourceDocuments=20
verified=20
missing=0
deploymentReady=true
```

但生产`policies.full_text`只读快照尚未取得，因此尚不能完成：

- 生产原文哈希核对；
- 附件缺失识别；
- 生产解析噪声检查；
- 20份逐项差异分类。

## 六、自动就绪审计结果

执行入口：

```bash
npm run production:readiness:audit
```

当前阻断项：

```text
no_confirmed_restorable_backup_or_pitr
production_source_snapshot_missing
production_source_crosscheck_not_passed
database_connection_credential_missing
```

本地忽略制品：

```text
artifacts/stage8/zero-cost-production-readiness.json
```

## 七、生产修改硬门

`scripts/configure-production.mjs`已改为默认拒绝所有生产修改。只有同时满足以下条件才会继续到API密钥读取：

1. 显式传入`--apply-production`；
2. 环境变量为`PRODUCTION_CONFIRMATION=APPLY:qxzspsofhmfjceuaulhu`；
3. 指定的就绪报告目标项目一致；
4. 报告声明不允许新增付费资源；
5. `productionWriteReady=true`；
6. `blockers=[]`；
7. 报告生成时间不超过24小时。

自动回归：

```bash
npm run production:guard:test
```

已验证无apply、无确认词和有阻断项三种情况都会在读取API密钥前失败。

## 八、下一步

零费用条件下只能继续：

1. 由用户在需要时向当前进程临时提供既有生产只读凭据，不写入仓库；
2. 导出20份生产`full_text`；
3. 完成官方复合原文差异核验；
4. 使用既有数据库连接执行逻辑只读导出，并在本地PGlite恢复验证；
5. 重新运行生产就绪审计。

在上述门禁关闭前，不执行任何生产迁移、Edge部署或写入链切换。

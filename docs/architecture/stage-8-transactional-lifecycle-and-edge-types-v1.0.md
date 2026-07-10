# 阶段八事务生命周期、Edge类型与Token硬预算实施报告 v1.0

日期：2026年7月10日。
状态：仓库级核心实现完成，未部署Supabase生产，未切换现有人工写回。

## 一、本轮边界

本轮只实现并验证：

- 当前生产Schema的Edge Function类型基线；
- Edge Function JSON数据库边界；
- 不可变报告的事务发布和回滚RPC；
- 发布/回滚幂等与审计；
- 模型调用前Token预算预留和调用后结算；
- 专用`revision-lifecycle`、`model-budget`和`account-governance` Edge候选入口；
- Deno类型检查、共享单元测试和临时PostgreSQL测试；
- CI质量门。

本轮没有：

- 执行生产`supabase db push`；
- 部署任何Edge Function，包括新建的三个Stage 8候选入口；
- 将当前`metadata.reportPayload`写回切换为revision写回；
- 调用任何模型；
- 修改20份报告正文；
- 修改旧前端业务页面；
- 创建会产生费用的Supabase Preview Branch。

## 二、Edge Function数据库类型治理

新增：

```text
supabase/functions/_shared/database.types.ts
```

该文件按2026年7月10日链接生产Schema生成结果建立，与Supabase标准`Database`形状兼容，当前覆盖三个Edge Function实际访问的：

- `profiles`；
- `policies`；
- `policy_sources`；
- `analysis_jobs`。

它明确属于“阶段七迁移部署前生产类型基线”。阶段七、阶段八迁移进入Supabase暂存和生产后，必须重新运行官方类型生成器，替换为包含revision、投影、事务命令和Token预算对象的完整快照。

共享管理员客户端改为：

```text
createClient<Database>()
SupabaseClient<Database>
```

并将政策插入、分析任务记录直接引用`TableInsert`、`TableRow`，减少手写Schema重复。

### 类型检查结果

治理前：

```text
ingest：10个Deno错误
analyze：9个Deno错误
publish：7个Deno错误
```

独立审核时统计为26个；按当前代码重新执行得到22个，均表现为Supabase表类型被推断为`never`。

治理后：

```text
npm run edge:typecheck
三个既有Edge Function：0错误
三个Stage 8候选Edge Function：0错误
合计：6/6通过
```

没有使用`any`、`@ts-ignore`或关闭类型检查。

## 三、JSON数据库边界

类型接入后暴露5个真实错误：内部`Record<string, unknown>`不能直接写入数据库`jsonb`。

新增共享函数：

```text
toJson(value, label)
```

它在数据库写入前递归验证：

- 字符串、布尔、有限数字和null；
- 数组和普通对象；
- 忽略对象中的`undefined`字段；
- 拒绝NaN和Infinity；
- 拒绝BigInt、函数和其他非JSON值；
- 拒绝循环对象和循环数组；
- 错误包含精确字段路径。

已应用于：

- 政策采集metadata；
- 人工报告metadata兼容写回；
- 分析任务output payload。

新增：

```text
supabase/functions/_shared/http.test.ts
npm run edge:test
```

当前4项测试全部通过。

## 四、事务发布与回滚

新增迁移：

```text
supabase/migrations/20260710020000_stage8_transactional_revision_lifecycle.sql
```

新增：

- `report_revision_commands`：不可变幂等命令；
- `report_revision_events`：不可变成功事件；
- `publish_report_revision(...)`；
- `rollback_report_revision(...)`；
- `assert_active_admin_actor(...)`。

### 权限

- RPC只授予`service_role`；
- 普通`authenticated`和`anon`无执行权；
- 浏览器不能直接读写命令和事件表；
- RPC仍要求传入的执行人对应`profiles.role=admin`且`status=active`；
- 后续Edge Function必须先完成自身管理员认证，再以service role调用RPC。

### 发布事务

发布在同一事务中：

1. 校验幂等键；
2. 校验执行人；
3. 对policy行执行`FOR UPDATE`；
4. 检查`expected_current_revision_id`；
5. 检查目标修订属于policy、状态为`approved`；
6. 检查成功投影运行和投影哈希；
7. 将旧current revision改为`superseded`；
8. 将目标改为`published`；
9. 切换当前发布指针；
10. 写入不可变命令和事件；
11. 返回机器可读结果。

旧版本必须先进入`superseded`，再发布新版本，否则会触发“同一policy最多一个published revision”的部分唯一索引。

### 回滚事务

回滚只允许目标为同一policy的`superseded`修订：

```text
当前published → superseded
历史目标superseded → published
切换current_published_revision_id
写入rollback命令与事件
```

回滚不会改写payload、原文哈希或投影。

### 幂等

- 同一幂等键、同一参数重复调用返回原结果；
- 同一幂等键用于不同policy、revision、命令、expected current或actor时拒绝；
- 乐观当前指针不一致时以序列化冲突拒绝；
- 命令和事件写入后不能修改或删除。

## 五、Token硬预算

新增迁移：

```text
supabase/migrations/20260710021000_stage8_model_budget_enforcement.sql
```

新增：

- `model_budget_periods`；
- `reserve_model_usage(...)`；
- `finalize_model_usage(...)`；
- `model_usage_ledger`预算周期、预留Token和释放时间字段；
- request hash唯一幂等索引。

### 调用前预留

`reserve_model_usage`在模型调用前执行：

- L0/L1：始终阻断，Token为0；
- L2：输入＋计划输出硬上限12,000；
- L3：输入＋计划输出硬上限30,000；
- 月度有效Token初始硬预算300,000；
- 非exception调用在月度行锁下预留Token；
- 月度已消耗＋已预留＋本次预留超过预算时阻断；
- exception必须提供理由，由有效管理员发起；
- 相同request hash幂等重放；
- request hash用于不同任务时拒绝。

预算值读取`system_config_versions`中的`model.token_budget`，缺失时使用ADR默认值。

### 调用后结算

`finalize_model_usage`：

- 记录实际输入、输出、缓存和有效Token；
- 释放预留额度；
- 将实际有效Token计入当月消耗；
- 终态只允许`succeeded`或`failed`；
- L2/L3实际输入＋输出超过硬上限时强制标记`failed`并记录`budgetViolation=true`；
- exception仍完整计入月度消耗；
- 相同实际结果可幂等重放；
- 不同Token结果重复结算时拒绝；
- 终态账本不能再修改。

## 六、数据库实测

临时PostgreSQL测试现按顺序执行：

```text
阶段七revision/projection迁移
→ 阶段八事务发布迁移
→ 阶段八Token预算迁移
→ 生命周期和预算测试
→ 20份报告批量装载和幂等测试
```

已验证：

- DDL、触发器、函数、RLS和授权语句可执行；
- 使用`SET ROLE authenticated/anon`和JWT claim模拟完成表级RLS访问；
- active用户和active管理员可读取已发布/被替代投影；
- invited、suspended和anon不可读取，普通authenticated不能直读完整revision或写投影；
- 发布、回滚和同键重放；
- 错误expected current拒绝；
- 幂等键跨命令复用拒绝；
- 审计历史不可篡改；
- L0零Token阻断；
- L2单次超限阻断；
- 月度额度不足阻断；
- 预算预留和释放；
- 缓存Token结算；
- exception理由和消耗；
- 实际超限强制失败；
- 20份影子包装载和重复执行幂等。

执行入口：

```bash
npm run stage7:migration-test
npm run stage7:migration-test -- --shadow-package=artifacts/stage7/report-revision-shadow.json
```

命令名称保留`stage7`以兼容既有流程，但目前已覆盖阶段七和阶段八迁移。

## 七、邀请制与账户状态治理

新增迁移：

```text
supabase/migrations/20260710022000_stage8_invite_account_governance.sql
```

仓库级边界已经调整为：

- `supabase/config.toml`全局和邮箱signup均关闭；
- 旧前端移除注册按钮、`signUp`调用和公开注册文案，只保留登录；
- 新账号由管理员受控创建，当前不建设公众注册页；
- `can_read_policy`直接要求当前profile为`active`，`invited`和`suspended`即使持有旧会话也不能读取报告；
- 新增`account_lifecycle_events`不可变审计；
- `set_user_account_status`只允许service role调用，可暂停、恢复或激活邀请态账号；
- 管理员不能暂停自身；
- `purge_expired_user_events`按集中配置清理历史行为事件，初始保留期90天；
- 普通浏览器不能读取账户治理审计表或调用治理RPC。

新增自动测试：

```bash
npm run auth:test
```

临时PostgreSQL同时验证活跃用户读取、暂停阻断、邀请态阻断、恢复读取、自锁拒绝、90天清理和审计不可篡改。

硬删除已作为独立两阶段候选流程实现，不与普通暂停操作合并：

```text
supabase/migrations/20260710023000_stage8_account_deletion_workflow.sql
```

流程为：

1. `prepare_account_deletion`使用幂等请求键锁定目标profile；
2. 拒绝管理员自删和最后活跃管理员删除；
3. 将profile置为`deleted`并立即阻断读取；
4. Edge Function调用Supabase Auth Admin删除用户；
5. Auth失败时`finalize_account_deletion(false)`恢复此前profile状态；
6. Auth成功后，只有外键已将请求中的`target_user_id`置空，数据库才接受`completed`；
7. 成功审计保留UUID快照但不再持有Auth外键；
8. 同一请求键和相同参数可安全重放，冲突参数被拒绝。

数据库测试覆盖准备重放、失败恢复、成功前置证明、Auth级联、成功重放、自删拒绝和审计不可篡改。该能力仍未部署生产。

## 八、专用Edge入口

新增：

```text
supabase/functions/revision-lifecycle/index.ts
supabase/functions/model-budget/index.ts
supabase/functions/account-governance/index.ts
supabase/functions/_shared/database.stage8.types.ts
supabase/functions/_shared/rpcError.ts
```

共同边界：

- Supabase网关`verify_jwt=true`；
- 函数内部再次调用`auth.getUser`并核对`profiles.role=admin`、`status=active`；
- 不接受爬虫密钥作为替代认证；
- 不接受客户端传入actor ID，数据库actor固定取自已验证会话；
- 使用service role只调用已授权的事务RPC；
- RPC不存在时返回不可用错误，不回退到metadata直接覆盖；
- 代码已通过Deno类型检查，但尚未部署。

`revision-lifecycle`只提供`publish`和`rollback`，不直接更新revision表。`model-budget`只提供`reserve`和`finalize`，不调用任何模型。`account-governance`提供`suspend`、`reactivate`、`purgeEvents`和受双确认保护的`delete`；删除由数据库准备、Auth Admin删除和数据库终态确认三步组成。

## 九、CI门禁

新增：

```bash
npm run edge:typecheck
npm run edge:test
```

以下工作流已接入revision迁移测试、邀请制认证测试、工作流结构合同、Edge类型检查和共享测试：

- `Manual report quality`；
- `Deploy GitHub Pages`；
- `Apply manual policy analysis`。

任何Edge数据库字段漂移、JSON不可序列化、事务迁移失败、公共注册恢复或工作流步骤错位都会阻断。

## 十、仍待实施

阶段八尚未完成：

1. 在既有Supabase项目完成阶段七、阶段八迁移后重新生成完整Database类型，替换当前生产基线和Stage 8临时RPC扩展；
2. 在不新增费用的前提下，先完成既有生产项目只读Schema、原文和备份能力核验，再经明确授权执行加法影子迁移；
3. 在加法影子部署后实测事务RPC、RLS、PostgREST和三个候选Edge入口，但暂不切换现有读写；
4. 将人工写回改为“创建修订→投影→审核→事务发布”；
5. 将受控模型调用统一接入预算预留和结算RPC；
6. 将禁用规则引擎从`analyze/index.ts`移到独立实验函数或包；
7. 增加真实网络连接下的Edge授权、错误路径和并发集成测试；
8. 在既有Supabase项目中实际关闭公共注册，并建设管理员创建账号和凭据轮换；两阶段硬删除候选已完成，仍需托管Auth级联与失败恢复实测。

现有`analyze.applyManualAnalysis`仍继续写入`metadata.reportPayload`，直到阶段七、八迁移部署和新写入链完成双轨验收。

## 十一、结论

阶段八已经完成四类关键底层风险治理：Edge Function不再处于无类型状态，revision发布和Token调用已有事务化、幂等、可审计的数据库硬约束，邀请制、账户停用和两阶段硬删除已有数据库与Edge候选实现，工作流结构也有自动防错门。最终本地回归见`stage-8-final-regression-report-v1.0.md`。这些能力仍是未部署的生产候选，不能宣称线上已经切换；后续严格遵循`zero-cost-validation-and-deployment-strategy-v1.0.md`。

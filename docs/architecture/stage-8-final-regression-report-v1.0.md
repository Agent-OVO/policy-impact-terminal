# 阶段八最终本地回归报告 v1.0

日期：2026年7月11日。
状态：阶段六至阶段八仓库级成果完成本地封板；Supabase生产尚未部署。

## 一、回归边界

本次回归验证阶段七、阶段八仓库实现及现有前端兼容性，未执行：

- Supabase生产数据库迁移；
- Edge Function部署；
- GitHub Pages部署；
- 生产报告写回；
- 生产读写路径切换；
- 任何新增付费云资源。

用户已明确要求不接受任何额外费用，因此没有创建Supabase Preview Branch或其他计费暂存环境。后续遵循`zero-cost-validation-and-deployment-strategy-v1.0.md`。

## 二、最终自动质量结果

### 1. 依赖和报告

```text
npm audit：0个高危及以上漏洞
人工报告：20/20严格校验通过
完整报告：17
轻量报告：3
A/B/C：12/5/3
验证器回归：全部通过
```

治理指标保持：

```text
证据：171
证据对象覆盖率：85.4%
权威公司关系：115
具有独立公司证据：40
pending/watch_only：19
```

本轮没有修改`manual-reports/*.json`。

### 2. 官方原文和影子包

```text
官方复合原文：20/20 verified
官方附件：7/7成功提取
影子包：deploymentReady=true
政策动作：97
产业节点：103
产业边：76
公司关系：115
政策网络：58
证据引用：171
观察/催化/风险/边界信号：772
```

证据摘录审计继续保留：103条政策原文摘录中，41条逐字匹配、27条压缩匹配、11条仅语义相关、24条无法稳定定位；7份报告需要后续单份修订治理。

### 3. 数据库迁移

固定版本PGlite临时PostgreSQL顺序执行：

1. 阶段七revision和projection内核；
2. 阶段八事务发布和回滚；
3. Token预算强制执行；
4. 邀请制账户治理；
5. 两阶段硬删除；
6. 20份真实影子包批量装载；
7. 重复装载幂等性。

最终结果：

```text
迁移语法：通过
DDL、函数、触发器和RLS对象：通过
表级RLS角色访问：通过
发布、回滚、幂等和审计：通过
Token预留、结算和超限阻断：通过
邀请、暂停、恢复和事件清理：通过
硬删除准备、失败恢复、Auth删除证明、成功终态和重放：通过
20份批量装载和重复执行：通过
```

### 4. Edge Function

Deno类型检查覆盖：

- `ingest`；
- `analyze`；
- `publish`；
- `revision-lifecycle`；
- `model-budget`；
- `account-governance`。

结果：6/6零错误。

共享JSON边界测试：4/4通过，包括有限数字、循环引用、BigInt、函数和`undefined`字段处理。

### 5. 认证和工作流

```text
邀请制登录边界：通过
前端signUp调用：0
Supabase全局signup：关闭
Supabase邮箱signup：关闭
GitHub Actions工作流合同：3/3通过
GitHub Actions YAML真实解析：全部通过
```

工作流合同已经防止：

- 步骤或`run`误写入`pull_request.paths`；
- 迁移、认证、Edge或构建质量门缺失；
- 非法路径缩进行静默进入工作流。

### 6. 前端构建

```text
TypeScript/Vite构建：通过
JavaScript分块：4
最大JavaScript：217.03 KiB
JavaScript总量：576.01 KiB
最大CSS：130.86 KiB
source map：0
构建预算：通过
```

旧前端仅发生邀请制认证安全修改，没有进行视觉重构或报告业务页面改造。

## 三、本轮实际发现并修复的问题

### 1. 两阶段删除迁移语法错误

PL/pgSQL幂等判断中的内联`CASE`缺少显式括号，导致迁移无法解析。已改为括号表达式并通过真实数据库执行。

### 2. 参数与表列歧义

`finalize_account_deletion`参数`error_message`与表列同名，PostgreSQL拒绝执行。已改名为`deletion_error_message`。

### 3. 不可变审计与Auth外键级联冲突

Auth用户删除时，`ON DELETE SET NULL`需要修改审计表引用列，但不可变触发器拦截了该系统更新。已调整为：

- 仅允许`pg_trigger_depth() > 1`的外键级联把UUID引用从非空改为NULL；
- 目标和操作者UUID文本快照必须保持不变；
- 其他任何字段变化、普通更新和删除继续拒绝；
- `account_lifecycle_events`和`account_deletion_requests`均保存actor快照。

### 4. GitHub Actions结构污染

历史定向编辑曾将`node --check`命令写入`pull_request.paths`。文本合同测试首次未捕获。现已：

- 完整重建`manual-quality.yml`；
- 用PyYAML完成真实解析；
- 强化`test-workflow-contracts.mjs`，检查paths区块内所有深缩进行；
- 将`workflow:test`接入PR、Pages和人工写回工作流。

### 5. Windows历史构建产物污染

此前已通过受路径保护的`prebuild`清理解决。最终预算继续稳定通过。

## 四、仓库审计结果

```text
git diff --check：通过
YAML、JSON、TOML：全部可解析
报告正文差异：0
禁入路径被跟踪：0
敏感密钥实值命中：0
```

`deno.lock`是Deno远程依赖完整性锁文件，应进入正式提交。

根目录`NUL`为Windows命令误生成的47字节本地文件，已被`/NUL`忽略且未被Git跟踪。当前DevSpace文件工具未提供安全删除能力，因此本轮保留忽略状态，不影响构建、测试或提交。

以下路径继续禁入：

```text
scripts/generate_user_manual_pdfs.py
tmp/
成果截图/
artifacts/stage7/
NUL
```

## 五、零费用生产防护补充

在最终回归后新增并验证：

- `npm run production:readiness:audit`：只读查询既有项目、分支和备份管理面，并核对本地影子包、生产原文快照、差异报告和连接凭据；
- `npm run production:guard:test`：证明`setup:production`在无apply、无确认词或有阻断项时会在读取API密钥前失败；
- `npm run production:source-export`：默认不连接，只有目标项目、显式只读确认和临时管理员/爬虫凭据一致时导出20份生产`full_text`；
- `npm run production:source-guard:test`：离线验证生产原文导出边界；
- `npm run backup:production`：默认不连接，显式确认后只读导出`public/auth/supabase_migrations`，使用AES-256-GCM加密并删除临时明文；
- `npm run backup:guard:test`：验证错误主机、缺少确认和缺少数据库密码时拒绝；
- `npm run backup:crypto:test`：验证加密往返、篡改检测和错误密钥拒绝；
- `npm run workflow:generated-check`：确保`manual-quality.yml`与版本化生成定义完全一致。

2026年7月11日生产只读审计结果：项目`ACTIVE_HEALTHY`，但`pitr=false`、物理备份为0、生产原文快照缺失、差异核验未通过且当前无数据库连接凭据，因此`productionWriteReady=false`。

## 六、当前准确状态

可以宣称：

> 阶段六至阶段八的架构、不可变数据内核、事务发布、Token硬预算、邀请制账户治理、两阶段删除和候选Edge入口，已经完成仓库级实现及零费用本地高保真回归。

不能宣称：

- 已部署Supabase生产；
- 已通过真实Supabase Auth/PostgREST/Edge网关集成；
- 已关闭线上项目公共注册；
- 已切换报告写入或前端读取；
- 已完成生产备份恢复演练。

## 七、零费用条件下的下一阶段

下一步不再创建付费暂存资源。优先顺序为：

1. 本地RLS表级角色测试已经完成，后续保持为固定迁移门；
2. 使用既有生产项目进行只读Schema、原文和备份能力核验；
3. 形成生产旧`full_text`与官方复合原文差异报告；
4. 明确现有套餐内可用的恢复路径；
5. 只有再次取得明确生产授权后，才在现有生产项目进行加法影子迁移；
6. 加法迁移后不立即切换前端或人工写回，先做新旧双轨对照。

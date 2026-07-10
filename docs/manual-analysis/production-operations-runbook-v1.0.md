# 人工政策报告生产运行手册 v1.0

## 一、生产对象

> 过渡说明：本手册描述当前`metadata.reportPayload`生产路径。阶段七、八已经完成零费用仓库级封板，但新链路尚未部署Supabase生产或切换读写路径，因此本手册继续有效。用户不接受任何新增费用，不创建Preview Branch或付费暂存资源。目标架构、零费用验证策略、当前生产阻断和发布生命周期见`docs/architecture/`。迁移完成前不得同时建立可独立编辑的第二写入路径。

生产流程包括：

- 报告JSON编写与回炉；
- 严格质量校验；
- 回归测试与治理指标；
- Supabase人工写回；
- GitHub Pages发布；
- 线上运行与视觉抽查。

## 二、单份报告发布流程

### 1. 事实和证据准备

- 阅读政策正文和官方附件；
- 区分政策动作、产业节点、公司业务和项目兑现证据；
- 公司未被点名时，政策证据不得直接绑定公司；
- 保留原主体、条款、动作、节点和证据ID。

### 2. 本地质量门

```bash
npm run security:audit
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/<policy_id>.json
npm run manual:test
npm run manual:metrics
npm run stage7:test
npm run auth:test
npm run workflow:test
npm run workflow:generated-check
npm run production:guard:test
npm run backup:guard:test
npm run production:source-guard:test
npm run edge:typecheck
npm run edge:test
npm run build
npm run build:budget
```

任何命令失败均不得写回或发布。修改阶段七、八DDL、装载器、修订生命周期或Token预算时，还必须运行：

```bash
npm run stage7:migration-test
```

新建或实质修改政策原文证据时，应重新取得官方网页及附件并执行`npm run stage7:evidence-audit`；历史7份低匹配报告按`source-evidence-audit-v1.0.md`在单份增量修订中治理，不在普通迁移中批量改写。

### 3. 提交范围审查

```bash
git status --short
git diff --check
git diff --stat
```

只提交本轮报告、测试、治理注册表和必要文档。`tmp/`、成果截图和本地生成脚本默认禁入。

### 4. 人工写回

通过GitHub Actions `Apply manual policy analysis` 传入：

- `policy_id`；
- `manual-reports/<policy_id>.json`。

工作流必须依次通过：

1. 单份严格校验；
2. 全量回归测试；
3. 治理注册表和质量指标检查；
4. revision与投影确定性检查；
5. Supabase兼容路径写回。

日志必须出现：

```text
[manual:validate] ok
"published": true
```

### 5. Pages发布

Pages工作流在部署前执行：

1. 依赖安全审计；
2. 全量20份严格校验；
3. 回归测试；
4. 治理指标检查；
5. revision与投影确定性检查；
6. 前端生产构建；
7. 构建体积预算检查。

任一质量门失败时，静态站点不得部署。

### 6. 生产数据库与Edge变更边界

日常人工报告发布不执行阶段七、八生产迁移。生产就绪只读审计入口：

```bash
npm run production:readiness:audit
```

当前只有报告满足以下条件，生产配置脚本才可能继续：

```text
productionWriteReady=true
blockers=[]
项目ref与目标一致
零新增费用约束为false/禁止付费资源
报告生成时间不超过24小时
```

`scripts/configure-production.mjs`还要求`--apply-production`和精确项目确认词；否则在读取API密钥之前失败。

生产原文导出和备份也默认只验证、不连接：

```bash
npm run production:source-export
npm run backup:production
```

只有临时凭据、精确目标和显式只读确认齐全后才执行。备份使用AES-256-GCM加密，明文SQL只存在于系统临时目录并在结束时删除。当前PITR关闭、物理备份列表为空，因此任何生产数据库写入仍被阻断。

## 三、治理注册表

治理状态以以下文件为准：

```text
docs/manual-analysis/report-governance-registry-v1.0.json
```

新增报告时必须同步登记：

- `policyId`；
- A/B/C类别；
- `full`或`light`迁移状态；
- 简化标题。

未登记报告会被 `npm run manual:metrics` 拦截。

## 四、日常质量指标

运行：

```bash
npm run manual:metrics
npm run manual:metrics -- --json
```

持续关注：

- 报告总数和注册表一致性；
- 完整迁移报告数；
- 轻量豁免报告数；
- 证据对象覆盖率；
- 公司映射数量；
- 具有独立公司证据的映射数量；
- `pending/watch_only`数量。

独立公司证据覆盖率是补强指标，不应通过删除低置信主体或伪造证据提升。

## 五、视觉和运行抽查

### 无认证检查

- 生产登录页桌面端和移动端；
- 页面状态码和静态资源；
- 控制台错误；
- 登录表单、品牌信息和响应式布局。

### 本地演示检查

使用 `VITE_ENABLE_MOCK=true`：

- 本地演示登录；
- 报告列表；
- 报告模块切换；
- 产业链、公司和证据区域；
- 桌面和移动布局；
- 控制台无未处理异常。

### 认证后生产检查

使用已验证的一次性账号流程：

```bash
npm run qa:production:authenticated
node scripts/manage-production-qa-user.mjs audit
```

可通过`--output <path>`保存详细JSON：

```bash
npm run qa:production:authenticated -- --output <path>
```

自动检查：

- 20份报告是否全部可打开；
- 每份报告是否有7个章节入口；
- 17份完整报告是否展示投资方向观察和政策网络；
- 公司卡数量是否等于权威`companyMap`计数；
- 关系、证据和监管角色标签是否存在；
- 桌面端和390px移动端是否横向溢出；
- 控制台、页面异常和失败网络请求；
- 3份C类轻量报告是否保持兼容。

账号流程：

```text
创建带ephemeral-production-qa标记的临时账号
→ 运行QA
→ finally删除Auth用户
→ 验证profiles、user_events、analysis_jobs均无残留
```

`audit`只把本工具创建的`qa_`账号作为阻断项。普通账号和早期`codexqa*`候选记录不会被自动删除。

## 六、故障处置

### 严格校验失败

- 不降低规则；
- 修复真实引用、证据、分数或措辞冲突；
- 重新运行全量质量门。

### 写回失败

- 查看单份报告校验和Supabase函数日志；
- 不重复修改已发布报告以碰运气；
- 核对policyId、文件路径和密钥配置。

### Pages失败

- 先判断是质量门、构建还是部署失败；
- 质量门失败必须修复报告或注册表；
- 不通过跳过测试恢复部署。

### 线上回归

- 回滚到上一成功提交或修复后重新部署；
- 保留问题报告、复现步骤和受影响policyId；
- 若Supabase数据已写回，需使用上一版本报告重新写回，而不是只回滚静态页面。

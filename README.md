# 政策产业影响终端

政策产业影响终端是一个邀请制、内部使用的政策驱动投资研究辅助系统。当前系统已经完成可靠的单政策结构化分析、证据治理、产业链映射、公司关系映射、人工审核发布和生产展示基线，正在从“单政策报告系统”升级为“跨政策、跨产业、跨公司、持续变化追踪的投资观察终端”。

## 当前能力

- 20份人工政策报告全部通过严格校验；
- 17份完整五模块报告，3份C类轻量报告；
- 政策原文、产业证据和公司业务证据分层；
- `companyMap`作为现有报告公司关系权威映射；
- Supabase认证、只读生产访问和人工审核写回；
- 仓库候选已关闭公共注册，并对邀请态、暂停态账户实施数据库读取阻断；
- GitHub Actions质量门、Pages发布和生产认证态QA；
- 依赖高危漏洞为0，现有20份报告桌面与移动端生产QA通过。

阶段七已经完成不可变报告版本、原文版本、跨政策投影、公司证据卡、Token账本和集中配置的仓库实现。20份官方网页及附件复合原文全部验证，真实影子包达到`deploymentReady=true`，并在临时PostgreSQL中完成20份全量装载和幂等性测试。阶段八已完成Edge Function生产Schema类型基线、JSON写入边界、事务发布与回滚、Token预算硬门、邀请制登录边界、暂停/恢复与90天行为事件保留，以及可失败恢复的两阶段账号硬删除候选流程；对应`revision-lifecycle`、`model-budget`和`account-governance`入口只接受真实管理员JWT。上述阶段七、八能力均尚未部署Supabase，当前线上仍使用原`metadata.reportPayload`兼容路径。

## 架构入口

系统级架构决策见：

- `docs/architecture/README.md`
- `docs/architecture/stage-6-design-review-v1.0.md`
- `docs/architecture/stage-7-revision-projection-core-report-v1.0.md`
- `docs/architecture/stage-8-transactional-lifecycle-and-edge-types-v1.0.md`
- `docs/architecture/stage-8-final-regression-report-v1.0.md`
- `docs/architecture/zero-cost-validation-and-deployment-strategy-v1.0.md`
- `docs/architecture/zero-cost-production-readiness-audit-v1.0.md`
- `docs/architecture/stage-7-to-13-roadmap-v1.0.md`

人工政策分析方法、报告质量和生产运行材料见：

- `docs/manual-analysis/README.md`
- `docs/manual-analysis/production-operations-runbook-v1.0.md`
- `docs/manual-analysis/report-quality-status-v1.0.md`

## 当前架构边界

现有生产实现仍从`policies.metadata`读取完整报告JSON，并兼容历史字段。阶段六已经决定：

- 政策原文进入不可变原文版本；
- 完整报告进入不可变`report_revisions.payload`，并保留可读取的发布历史；
- 当前原文变化不会覆盖旧报告，而是通过`isSourceCurrent`标记待复核；
- 公司、产业、政策网络、证据和信号表作为按修订自动生成的可重建投影；
- 禁止报告JSON和关系表独立人工双写；
- 旧前端冻结维护，最后整体重构。

阶段六完成设计封板；阶段七、八已形成可执行迁移、20份官方原文版本、真实影子包、批量装载器、事务发布、Token预算和专用Edge候选入口，并通过临时PostgreSQL、表级RLS角色测试、Deno和工作流封板检查。用户明确不接受新增费用，因此不创建Supabase Preview Branch或其他付费暂存资源。当前尚未执行生产迁移，也未部署或切换新Edge写入链；`metadata`路径继续作为唯一线上兼容路径。

## 本地运行

```powershell
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:5174/
```

生产使用Supabase。复制`.env.example`为`.env.local`并填写：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_ANALYSIS_JOB_MODE=disabled
```

本地UI演示可显式设置：

```text
VITE_ENABLE_MOCK=true
```

生产构建不得启用Mock。

## 质量检查

```bash
npm run security:audit
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/*.json
npm run manual:test
npm run manual:metrics
npm run policy:triage-test
npm run policy:crawl-contract-test
npm run stage7:test
npm run stage7:migration-test
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

任何质量门失败均不得写回或发布。`npm run build`会先执行受路径保护的显式`dist`清理，避免历史构建文件污染预算。涉及有限采集、Edge Function、revision生命周期或Token预算的修改，还必须通过确定性分层、采集合同、Deno和临时PostgreSQL测试。阶段七可通过`npm run stage7:source-fetch -- --require-all`重建官方网页及附件复合原文，通过`npm run stage7:evidence-audit`审计证据摘录，并使用`npm run stage7:shadow -- --source-documents=artifacts/stage7/official-source-documents.json --require-deployment-ready`生成真实影子包。`npm run stage7:migration-test -- --shadow-package=artifacts/stage7/report-revision-shadow.json`会实际执行阶段七至阶段九迁移、有限人工队列、表级RLS、20份装载和幂等性检查。`tmp/`、`成果截图/`和本地生成脚本默认禁入提交。

## 政策来源

固定定时来源只保留：

1. 中国政府网最新政策；
2. 国家发展改革委政策文件库；
3. 工业和信息化部政策文件库；
4. 国家数据局政策发布。

其他官方来源只用于单份报告任务型补证，不自动进入定时爬虫。定时任务已调整为工作日北京时间09:30和17:30运行；每来源最多扫描60条，全局非L0候选最多24条，单次原文入库最多12条，高价值待分析池最多8条，本轮实际分析任务最多3条。

抓取使用零Token确定性分层：L0排除，L1只归档原文，L2/L3进入有限人工复核。默认命令只生成本地候选制品，不写Supabase：

```powershell
npm run crawl:sources -- --source-scan-limit=60 --candidate-limit=24 --ingest-limit=12 --analysis-limit=3 --pending-queue-limit=8
npm run crawl:sources -- --source=all --ingest
```

输出包含四来源健康、L0—L3数量、入库选择、8条待分析池和3条本轮分析任务。任一来源失败时本轮标记`degraded`；已选候选存在但正文提取为0时标记`failed`并阻断入库。抓取不会自动生成或发布报告。

## 首批六政策研究批次

阶段九已完成首批3份深度报告和3份标准报告，以及跨政策矩阵、三维筛选校准、产业/公司反查和人工队列处置。入口：

```text
research-batches/stage9-first-six/README.md
```

一键验收和查询：

```powershell
npm run stage9:first-six:test
npm run stage9:first-six:query -- industry 人工智能
npm run stage9:first-six:query -- company 万华化学 --json
npm run stage9:first-six:queue -- list immediate_analysis
```

四份新增报告只保存在研究批次目录，两份既有报告按引用复用；本批次不自动写入`manual-reports/`或生产数据库。

## 人工分析与发布

```powershell
npm run manual:policies -- list --limit=10
npm run manual:policies -- get --policyId=<policy-uuid>
npm run manual:policies -- apply --policyId=<policy-uuid> --file=manual-reports/<policy-id>.json
```

当前写回仍使用`analyze` Edge Function和`metadata.reportPayload`。该路径在报告修订体系完成迁移前继续作为生产兼容路径，已发布报告不得绕过严格校验。

## 部署

生产站点：

```text
https://agent-ovo.github.io/policy-impact-terminal/
```

GitHub Pages只托管静态前端。政策抓取和人工写回由独立工作流执行。生产配置、数据库初始化和Edge Function部署见`supabase/README.md`。

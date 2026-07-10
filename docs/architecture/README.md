# 政策产业影响终端架构决策入口

本目录保存系统级、长期有效的架构决策。`docs/manual-analysis/`继续保存人工政策分析方法、质量门、阶段完成记录和生产运行材料；两类文档职责不同，不相互替代。

## 当前状态

阶段六“产品边界、事实源、版本体系、有限来源和Token治理封板”已完成。阶段七已经完成可执行数据库迁移、20份官方网页及附件复合原文、确定性投影器、真实影子包、批量装载器、临时PostgreSQL迁移和幂等性验证。阶段八已完成Edge生产Schema类型基线、JSON边界、事务发布/回滚、Token预算硬门、邀请制账户治理、两阶段硬删除和三个管理员专用Edge候选入口。上述新增能力均尚未部署Supabase，生产读写链保持不变。

## 必读顺序

1. `stage-6-design-review-v1.0.md`
2. `ADR-001-product-positioning-and-user-boundary.md`
3. `ADR-002-report-source-of-truth.md`
4. `ADR-003-report-revision-review-publish-lifecycle.md`
5. `ADR-004-centralized-configuration-and-version-governance.md`
6. `ADR-005-legacy-frontend-freeze-and-rebuild.md`
7. `ADR-006-policy-source-whitelist-and-limited-crawl.md`
8. `ADR-007-model-boundary-and-token-budget.md`
9. `ADR-008-source-evidence-card-incremental-reuse.md`
10. `report-version-database-migration-draft-v1.0.md`
11. `existing-20-report-migration-acceptance-plan-v1.0.md`
12. `stage-7-revision-projection-core-report-v1.0.md`
13. `stage-7-supabase-deployment-runbook-v1.0.md`
14. `stage-8-transactional-lifecycle-and-edge-types-v1.0.md`
15. `stage-8-final-regression-report-v1.0.md`
16. `zero-cost-validation-and-deployment-strategy-v1.0.md`
17. `zero-cost-production-readiness-audit-v1.0.md`
18. `stage-7-to-13-roadmap-v1.0.md`
19. `frontend-rebuild-entry-criteria-v1.0.md`

## 决策摘要

- 产品定位：邀请制、内部使用、以个人为主并允许少量协作用户的政策驱动投资研究辅助系统。
- 事实源：采用分层不可变事实源。政策原文版本、报告修订、跨政策投影分别承担不同职责；规范化投影必须由报告修订自动生成，禁止人工双写。
- 报告版本：完整报告进入不可变`report_revisions`，已发布版本不得覆盖；发布、回滚和投影切换必须事务化。
- 来源边界：固定四个定时来源，不以扩源作为默认解法；任务型补证来源不得自动进入定时爬虫。
- 模型边界：抓取、筛选、去重、查询、聚合、浏览和普通提醒零Token；仅高价值分析、疑难判断和关键修订允许受控调用。
- 前端策略：旧前端冻结维护，系统内核、生产链和跨政策能力稳定后再整体重构。
- 成本边界：不创建Supabase Preview Branch、新付费项目或其他新增计费资源；后续按零费用策略进行本地高保真验证、既有生产只读核验和受控加法影子部署。

## 约束

阶段六ADR属于设计封板；阶段七、阶段八属于已经完成本地PostgreSQL、Deno、工作流和20份真实影子包验收、但尚未部署Supabase的生产候选。由于禁止新增付费暂存资源，后续不能把“真实暂存环境”作为前置假设；生产状态只能以既有Supabase项目的迁移记录、只读核验、备份恢复、加法影子部署、新旧对照、Edge Function部署与生产回归为准，不能因为本地测试已经通过就宣称线上完成。

# 人工政策报告质量状态 v1.0

统计日期：2026年7月10日。

## 一、报告治理状态

| 指标 | 当前值 |
|---|---:|
| 人工报告总数 | 20 |
| 治理注册表登记 | 20 |
| A类完整报告 | 12 |
| B类方向化报告 | 5 |
| C类轻量报告 | 3 |
| 完成五模块迁移 | 17 |
| 轻量豁免 | 3 |
| 严格校验失败 | 0 |
| 生产认证态可打开 | 20/20 |
| 桌面端、移动端章节完整 | 20/20 |

## 二、证据和公司映射

| 指标 | 当前值 |
|---|---:|
| 证据总数 | 171 |
| 已标注证据对象 | 146 |
| 全部报告证据对象覆盖率 | 85.4% |
| 17份完整报告证据对象覆盖率 | 100% |
| 公司关系映射 | 115 |
| 具有独立公司证据的映射 | 40 |
| 独立公司证据覆盖率 | 34.8% |
| `pending/watch_only`映射 | 19 |
| 完整报告公司计数与`companyMap`一致 | 17/17 |
| 生产公司卡数量与权威计数一致 | 20/20 |

C类轻量报告不强制补五模块和证据对象，因此全部报告口径下的证据对象覆盖率低于100%。

独立公司证据覆盖率用于后续补强，不作为删除公司或上调关系的依据。没有独立公司材料的映射必须保持间接、待验证或政策点名等符合事实的等级。

完整报告的`companies`保留主体事实和兼容记录，`companyMap`是投资观察、公司排序、关系标签、证据等级和统计数量的权威来源。没有`companyMap`的轻量报告继续回退`companies`。

### 官方原文与摘录审计

| 指标 | 当前值 |
|---|---:|
| 官方网页及附件复合原文 | 20/20 |
| 官方附件 | 7/7成功提取 |
| 标为政策原文的摘录 | 103 |
| 逐字匹配 | 41 |
| 可验证压缩摘录 | 27 |
| 仅语义相关 | 11 |
| 无法稳定定位 | 24 |
| 低于60%定位率的报告 | 7 |

官方原文事实源已经完整，但7份历史报告存在`excerpt`与`interpretation`边界不清的问题。该问题不通过迁移自动改写，按`source-evidence-audit-v1.0.md`在后续单份增量修订中治理。

## 三、自动质量门

当前自动执行：

```text
依赖安全审计
→ 全量严格校验
→ 回归测试
→ 治理注册表与指标检查
→ revision内容哈希与确定性投影检查
→ 邀请制登录边界检查
→ Edge Function Deno类型与JSON边界检查
→ TypeScript/Vite构建
→ 构建体积预算
```

执行入口：

```bash
npm run security:audit
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/*.json
npm run manual:test
npm run manual:metrics
npm run stage7:test
npm run auth:test
npm run edge:typecheck
npm run edge:test
npm run build
npm run build:budget
```

严格校验已经拦截：

- 公司或节点引用错误；
- 镜像身份字段冲突；
- 强政策网络缺少来源；
- 监管角色或合规观察信号缺失；
- 误导性投资指令；
- `summary.companyCount`、`analysisCoverage.companyCount`与`companyMap.length`不一致。

## 四、CI与发布

- PR：`Manual report quality`工作流执行全量质量门；涉及阶段七、八DDL、装载器、修订契约或Token预算时，还在临时PostgreSQL中实际执行迁移、发布、回滚、预算阻断和20份批量装载。
- GitHub Pages：部署前执行安全审计、全量质量门、revision投影、事务迁移、Edge类型检查和构建预算。
- 人工写回：单份严格校验后，再执行回归测试、治理指标、revision投影、事务迁移和Edge类型检查。
- 新增报告未登记治理注册表时，`manual:metrics`直接失败。
- Edge Function `analyze`按`companyMap`派生公司统计。

## 五、生产认证态QA

执行入口：

```bash
npm run qa:production:authenticated
node scripts/manage-production-qa-user.mjs audit
```

当前结果：

```text
认证状态：通过
报告：20/20
每份章节：7
完整报告投资观察：17/17
完整报告政策网络：17/17
桌面端失败：0
移动端失败：0
横向溢出：0
控制台错误：0
页面异常：0
失败请求：0
临时QA用户残留：0
```

一次性账号删除后，Auth用户、`profiles`、`user_events`和`analysis_jobs`均验证为零残留。工具不会自动删除普通用户或早期`codexqa*`候选记录。

详细证据见：

- `authenticated-production-qa-report-v1.0.md`；
- `visual-qa-report-v1.0.md`。

## 六、下一轮质量重点

1. 对`source-evidence-audit-v1.0.md`登记的7份报告，在下一次单份修订时将概括性`excerpt`移入`interpretation`或补成可定位原文；
2. 优先给高关注公司映射补充年报、公告、合同和项目证据；
3. 不以提高覆盖率为理由伪造公司证据或删除合理的待验证主体；
4. 对年度报告更新只更新业务事实，不自动上调政策关系；
5. 新政策发布或前端重大改动后运行认证态生产QA；
6. C类报告保持轻量，不为统一数字强制补产业链或公司；
7. 两条早期`codexqa*`候选账号仅作人工治理评估，不由自动工具删除。

# 人工政策分析文档入口

本目录保存政策产业影响终端的人工分析方法、质量规则、标准作业流程、报告模板和发布前检查清单。

## 1. 必读顺序

### 第一步：先读投资观察上位方法论

- `policy-industry-company-methodology-v1.0.md`

用途：规定政策如何转化为产业链、公司、政策网络和投资方向观察。

核心链条：

```text
政策动作
→ 政策影响产业
→ 产业链环节
→ 公司位置
→ 政策网络
→ 投资方向观察
→ 后续催化与反证
```

该文件是当前上位规则。系统目标不是写政策摘要，而是服务个人投资研究：看清政策影响什么产业链、产业链中有哪些上市公司、政策之间是否形成连续催化，以及这些信息给投资方向带来什么提示。

三类异质政策的验证结果和字段收敛结论见：

- `three-sample-convergence-audit-v1.0.md`

旧报告分级回炉顺序见：

- `report-migration-backlog-v1.0.md`

阶段化执行路线和完成记录见：

- `next-stage-roadmap-v2.0.md`
- `phase-1-2-completion-report-v1.0.md`
- `phase-3-4-completion-report-v1.0.md`
- `stage-5-technical-debt-report-v1.0.md`
- `report-migration-backlog-v1.0.md`

生产治理和质量状态见：

- `report-governance-registry-v1.0.json`
- `report-quality-status-v1.0.md`
- `production-operations-runbook-v1.0.md`
- `evidence-update-policy-v1.0.md`
- `visual-qa-report-v1.0.md`
- `authenticated-production-qa-report-v1.0.md`

### 第二步：再读政策拆分方法论

- `policy-decomposition-methodology-v1.0.1.md`

用途：规定一份政策应当如何拆解。`policy-decomposition-methodology-v1.0.md` 保留为历史基准，后续新增报告默认使用 v1.0.1。

它负责辅助完成：

```text
外壳类型与实质类型识别
→ 政策信号强度与落地确定性判断
→ 分析深度分层
→ 政策动作拆分
→ 分层证据等级
→ 公司映射边界
```

### 第三步：读标准作业流程

- `standard-analysis-workflow-v1.0.md`

用途：规定每次人工分析必须怎么做，避免跳步、硬凑公司或把政策分析写成摘要。

### 第四步：读质量标准

- `policy-analysis-quality-standard-v1.1.md`

用途：规定哪些表达和结构可以发布，哪些需要降级或拦截。

重点关注：

- 不能把产业链相关写成确定受益；
- 公司映射必须分层；
- 公司分数必须拆成政策相关度和证据确定性；
- 证据摘录和人工解释必须分开；
- 横向对比未启用时必须透明说明。

### 第五步：使用报告模板

- `report-template-v1.1.json`

用途：作为新报告和回炉报告的字段模板。模板现在同时承载：

```text
政策拆分字段
产业链关系字段
公司映射字段
政策网络字段
投资方向观察字段
```

当前前端仍使用 `chainNodes`、`chainEdges` 和 `companies` 展示产业链地图与公司页面。生成报告时应将它们视为新关系模块的兼容投影：节点 ID、公司 ID、产业位置、传导方向和证据边界必须一致，不能维护两套相互矛盾的事实。

### 第六步：使用生成提示词

- `report-authoring-prompt-v1.0.md`

用途：交给分析代理生成标准化政策报告 JSON。该提示词要求输出可通过严格校验的完整 JSON。

### 第七步：发布前逐项检查

- `pre-publication-checklist-v1.0.md`

用途：发布前人工复核。即使 `manual:validate` 通过，也应按该清单检查是否存在误导性表达、证据边界不清或公司映射过度确定。

## 2. 与系统脚本的关系

发布前校验脚本：

```text
scripts/validate-manual-report.mjs
```

该脚本已经自动化执行部分质量规则。

普通校验：

```bash
npm run manual:validate -- manual-reports/<policy-id>.json
```

严格校验：

```bash
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/<policy-id>.json
```

验证器回归测试：

```bash
npm run manual:test
```

回归测试覆盖旧报告、三份异质样板、精简派生字段报告和多类故意错误。GitHub Actions 发布流程已启用严格校验。不能通过严格校验的报告不得写回 Supabase。

## 3. 新报告生成前检查

每次生成新政策报告前，必须先回答：

1. 这条政策影响哪些产业链？
2. 产业链中哪些环节最直接？
3. 这些环节里有哪些上市公司或公司类型？
4. 公司与政策之间是强关系、间接关系还是观察关系？
5. 这条政策与哪些上位、配套、后续或地方政策相关？
6. 这条政策给投资方向观察带来什么提示？
7. 现在最主要的反证和不足是什么？
8. 后续需要等待什么催化信号？

没有完成这些判断，不应直接写公司清单。

## 4. 允许不做公司映射

部分政策不适合公司映射。此时应明确写：

```json
{
  "companies": [],
  "companyMap": [],
  "analysisCoverage": {
    "status": "no_company_mapping",
    "companyImpactConclusion": "本政策不适合映射具体公司。"
  }
}
```

不要为了前端展示硬凑公司。

## 5. 标准化作业默认路径

### 新增报告

```text
读取政策原文
→ 判断政策影响产业链
→ 拆产业链环节
→ 映射公司位置
→ 判断政策网络
→ 形成投资方向观察
→ 使用 report-authoring-prompt-v1.0.md 生成 JSON
→ 按 pre-publication-checklist-v1.0.md 人工复核
→ 严格校验
→ GitHub Actions apply
→ 前端抽查
```

### 回炉旧报告

```text
先补 policyIndustryMap
→ 补 industryChain
→ 补 companyMap
→ 补 policyNetwork
→ 补 investmentDirection
→ 检查新旧产业链/公司字段 ID 和关系是否一致
→ 再检查 policy-decomposition-methodology-v1.0.1 字段
→ 严格校验并重新发布
```

## 6. 当前下一步建议

1. 新增报告全部按 `policy-industry-company-methodology-v1.0.md` 生成，并优先使用可派生身份字段的精简写法；
2. 旧报告按 `report-migration-backlog-v1.0.md` 的 A/B/C 分类处理，不做机械批量迁移；
3. A 类完整回炉，B 类优先补产业方向和政策网络，C 类保持轻量；
4. 每次发布前同时运行严格校验和 `npm run manual:test`；
5. 外部搜索只服务产业链验证、公司业务暴露、政策网络、催化信号和反证搜索。

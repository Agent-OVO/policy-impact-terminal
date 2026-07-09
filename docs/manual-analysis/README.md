# 人工政策分析文档入口

本目录保存政策产业影响终端的人工分析方法、质量规则、标准作业流程、报告模板和发布前检查清单。

## 1. 必读顺序

### 第一步：先读方法论

- `policy-decomposition-methodology-v1.0.1.md`

用途：规定一份政策应当如何拆解。`policy-decomposition-methodology-v1.0.md` 保留为历史基准，后续新增报告默认使用 v1.0.1。

核心顺序：

```text
外壳类型与实质类型识别
→ 政策信号强度与落地确定性判断
→ 分析深度分层
→ 政策动作拆分
→ 产业传导路径
→ 分层证据等级
→ 公司映射边界
→ 后续验证清单
→ 前端可信展示
```

### 第二步：读标准作业流程

- `standard-analysis-workflow-v1.0.md`

用途：规定每次人工分析必须怎么做，避免跳步、硬凑公司或把政策分析写成摘要。

流程：

```text
01 资料读取
02 政策分型
03 分析深度决策
04 政策动作拆分
05 产业传导拆分
06 公司映射决策
07 报告生成与自检
08 严格校验与发布
```

### 第三步：读质量标准

- `policy-analysis-quality-standard-v1.1.md`

用途：规定哪些表达和结构可以发布，哪些需要降级或拦截。

重点关注：

- 不能把产业链相关写成确定受益；
- 公司映射必须分层；
- 公司分数必须拆成政策相关度和证据确定性；
- 证据摘录和人工解释必须分开；
- 横向对比未启用时必须透明说明。

### 第四步：使用报告模板

- `report-template-v1.1.json`

用途：作为新报告和回炉报告的字段模板。

### 第五步：使用生成提示词

- `report-authoring-prompt-v1.0.md`

用途：交给分析代理生成标准化政策报告 JSON。该提示词要求输出可通过严格校验的完整 JSON。

### 第六步：发布前逐项检查

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

GitHub Actions 发布流程已启用严格校验。不能通过严格校验的报告不得写回 Supabase。

## 3. 新报告生成前检查

每次生成新政策报告前，必须先回答：

1. 这份政策的外壳类型和实质类型分别是什么？
2. 它的政策信号强度和落地确定性分别是什么？
3. 它应进入 L0—L5 哪个分析深度？
4. 它有哪些真实政策动作？
5. 它的产业影响传导路径是什么？
6. 它是否真的适合做公司映射？
7. 公司是否被政策点名？
8. 是否存在订单、采购、补贴、名单或项目证据？
9. 后续需要等待什么文件验证？

没有完成这些判断，不应直接写公司清单。

## 4. 允许不做公司映射

部分政策不适合公司映射。此时应明确写：

```json
{
  "companies": [],
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
→ 判断是否值得分析
→ 选择 L0—L5 分析深度
→ 使用 report-authoring-prompt-v1.0.md 生成 JSON
→ 按 pre-publication-checklist-v1.0.md 人工复核
→ 严格校验
→ GitHub Actions apply
→ 前端抽查
```

### 回炉旧报告

```text
先补 methodologyVersion
→ 补 documentShellType / substantivePolicyType / primaryActionType
→ 补 policySignalStrength / implementationCertainty / analysisDepth
→ 补 actionType / actionEvidenceLevel
→ 补 industryNodeEvidenceLevel
→ 补 companyMappingEvidenceLevel
→ 补 evidenceObject
→ 严格校验并重新发布
```

## 6. 当前下一步建议

1. 新增报告全部按 v1.0.1 方法论和 v1.1 模板生成；
2. 把剩余旧报告逐步升级为 v1.0.1；
3. 将“政策类型、政策动作、分析深度、后续验证清单”逐步做成前端一级展示能力；
4. 后续可增加批量质量审计脚本，定期扫描全部报告是否符合新标准。

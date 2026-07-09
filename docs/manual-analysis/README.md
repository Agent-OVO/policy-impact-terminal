# 人工政策分析文档入口

本目录保存政策产业影响终端的人工分析方法、质量规则和报告模板。

## 1. 必读顺序

### 第一步：先读方法论

- `policy-decomposition-methodology-v1.0.md`

用途：规定一份政策应当如何拆解。

核心顺序：

```text
政策类型识别
→ 政策强度判断
→ 政策动作拆分
→ 产业传导路径
→ 证据等级
→ 公司映射边界
→ 后续验证清单
→ 前端可信展示
```

### 第二步：再读质量标准

- `policy-analysis-quality-standard-v1.1.md`

用途：规定哪些表达和结构可以发布，哪些需要降级或拦截。

重点关注：

- 不能把产业链相关写成确定受益；
- 公司映射必须分层；
- 公司分数必须拆成政策相关度和证据确定性；
- 证据摘录和人工解释必须分开；
- 横向对比未启用时必须透明说明。

### 第三步：最后使用报告模板

- `report-template-v1.1.json`

用途：作为新报告和回炉报告的字段模板。

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

1. 这份政策属于什么类型？
2. 它的政策强度是高、中还是低？
3. 它有哪些真实政策动作？
4. 它的产业影响传导路径是什么？
5. 它是否真的适合做公司映射？
6. 公司是否被政策点名？
7. 是否存在订单、采购、补贴、名单或项目证据？
8. 后续需要等待什么文件验证？

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

## 5. 当前下一步建议

已发布报告中，仍有部分报告只完成旧标准分析。后续优先：

1. 对剩余报告补齐 `mappingLevel`、`policyRelevance`、`evidenceCertainty`、`implementationDependency`；
2. 将新增报告全部按 v1.1 模板生成；
3. 逐步把方法论中的“政策类型”“政策动作类型”“后续验证清单”结构化到前端展示。

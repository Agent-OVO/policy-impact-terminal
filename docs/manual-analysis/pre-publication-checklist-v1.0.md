# 政策报告发布前检查清单 v1.0

## 一、使用方式

每份报告写回 Supabase 前，必须按本清单检查。

建议执行顺序：

```text
人工检查
→ JSON 解析检查
→ 严格质量校验
→ GitHub Actions apply
→ 写回结果复核
→ 前端展示抽查
```

## 二、基础信息检查

- [ ] policyId 与文件名一致；
- [ ] summary.id 与 policyId 一致；
- [ ] policy.title 准确；
- [ ] issuer 准确；
- [ ] publishDate 准确；
- [ ] sourceUrl 为官方来源；
- [ ] fullText 或证据来源足以支撑分析；
- [ ] 不存在乱码、错字、错误标题或错配政策。

## 三、方法论字段检查

- [ ] methodologyVersion = `policy-decomposition-methodology-v1.0.1`；
- [ ] documentShellType 已填写；
- [ ] substantivePolicyType 已填写；
- [ ] primaryActionType 已填写；
- [ ] policySignalStrength 已填写，且为 high / medium / low；
- [ ] implementationCertainty 已填写，且为 high / medium / low；
- [ ] analysisDepth 已填写，且为 L0—L5；
- [ ] analysisDepthReason 已说明为什么分析到该深度；
- [ ] followUpSignals 已列出后续验证项。

## 四、政策动作检查

每条 action：

- [ ] 有 actionType；
- [ ] 有 actionEvidenceLevel；
- [ ] 有 implementationDependency；
- [ ] body 只写政策动作，不写公司受益；
- [ ] action 之间不重复；
- [ ] 至少覆盖政策最核心的 2—5 个动作。

## 五、条款与证据检查

- [ ] clauses 不只是标题摘录，而是能支撑动作拆分；
- [ ] evidence.excerpt 尽量接近政策原文；
- [ ] 人工解释放在 interpretation，不冒充 excerpt；
- [ ] evidenceObject 已标明 policy_action / industry_node / company_mapping / background；
- [ ] evidence 与 clauses、chainNodes、companies 的引用关系有效；
- [ ] 没有把解释性语言当作政策原文。

## 六、产业传导检查

每个 chainNode：

- [ ] 有清晰产业节点名称；
- [ ] 有 industryNodeEvidenceLevel；
- [ ] 有 verificationSignals；
- [ ] 能说明政策动作如何传导到该节点；
- [ ] 没有从关键词直接跳到公司；
- [ ] 节点证据强不自动传导为公司强证据。

## 七、公司映射检查

如果 companies 不为空，每个公司必须检查：

- [ ] 有 companyMappingEvidenceLevel；
- [ ] 有 mappingLevel；
- [ ] officialMention 正确；
- [ ] hasOrderEvidence 正确；
- [ ] hasProcurementEvidence 正确；
- [ ] hasSubsidyEvidence 正确；
- [ ] policyRelevance 与 evidenceCertainty 已拆分；
- [ ] confidence 未超过证据等级上限；
- [ ] riskNote 写清未点名、无订单、无采购、无补贴等边界；
- [ ] implementationDependency 写清后续验证条件；
- [ ] 不存在“确定受益”“直接利好”“推荐买入”等投资化表达。

## 八、无公司映射检查

如果 companies 为空：

- [ ] analysisCoverage.status = no_company_mapping 或 summary_only；
- [ ] companyImpactConclusion 明确说明为什么不适合映射公司；
- [ ] 前端不会显示空白误导；
- [ ] 没有为了展示效果硬凑公司。

## 九、横向对比检查

- [ ] 如果没有真实横向比较，comparableCount = 0；
- [ ] insights 明确写“未启用横向对比，仅基于当前政策文本”；
- [ ] 没有无证据写“相比此前更强/更弱”；
- [ ] 如果启用横向对比，必须有 comparable policies 和证据来源。

## 十、监管政策检查

如果政策属于监管约束型：

- [ ] 区分 constraint_exposed 与 compliance_provider；
- [ ] 不把受约束主体简单写成 beneficiary；
- [ ] 说明合规成本、处罚风险、标准门槛或行业出清；
- [ ] 合规服务方必须有明确服务链条，不得泛化。

## 十一、命令校验

### JSON 解析

```bash
node -e "JSON.parse(require('fs').readFileSync('manual-reports/<policy-id>.json','utf8'))"
```

### 严格校验

```bash
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/<policy-id>.json
```

必须看到：

```text
[manual:validate] ok manual-reports/<policy-id>.json
```

## 十二、发布校验

触发发布：

```bash
gh workflow run apply-manual-analysis.yml -f policy_id=<policy-id> -f report_file=manual-reports/<policy-id>.json
```

发布日志必须出现：

```text
MANUAL_QUALITY_STRICT: true
[manual:validate] ok
published: true
```

## 十三、前端抽查

发布后至少抽查：

- [ ] 报告能打开；
- [ ] 侧边栏显示方法论标签；
- [ ] 公司卡片显示未点名/间接证据/待验证等边界；
- [ ] 公司详情页显示映射边界；
- [ ] 证据链能对应到条款和产业节点；
- [ ] 不出现投资建议或荐股表达。

## 十四、最终发布口径

发布前最后确认：

```text
这份报告说明了政策如何产生影响，
也说明了哪些影响还没有证据，
并且不会让用户把产业链相关误读为确定受益。
```

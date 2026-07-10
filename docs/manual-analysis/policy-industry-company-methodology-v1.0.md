# 政策—产业链—公司投资观察方法论 v1.0

## 一、方法论定位

本方法论是“政策产业影响终端”的新的上位分析规则。

它解决的不是“政策怎么写成报告”，而是：

```text
一条政策出来后，如何转化为产业链、公司、政策网络和投资方向观察？
```

本系统的核心目标不是政策归档，也不是企业级政策情报，而是服务个人投资研究：

- 识别政策影响的产业链；
- 拆分产业链环节和传导路径；
- 找出相关上市公司所处位置；
- 识别政策与政策之间的延续、配套和催化关系；
- 给出方向性投资观察、后续催化和反证条件。

## 二、总原则

### 1. 政策分析服务投资方向观察

每份报告最终都要回答：

```text
这条政策给我的投资研究带来什么方向提示？
```

不是所有政策都值得深拆；不是所有政策都适合映射公司；不是所有公司映射都能形成投资观察。

### 2. 关系比标签重要

系统不应只输出“政策类型”“投资相关性”等标签，而应输出关系：

```text
政策动作 → 产业链环节 → 公司位置 → 相关政策 → 后续催化
```

### 3. 公司不是清单，而是产业链位置

公司必须绑定到产业链节点，说明：

- 公司处在哪个环节；
- 该环节是否被政策直接推动；
- 公司业务暴露是否明确；
- 是否有订单、采购、补贴、名单或项目证据；
- 是否只是主题相关。

### 4. 方向观察不是交易建议

系统可以输出：

- 关注哪些产业方向；
- 关注哪些产业链环节；
- 哪些公司类型值得进入研究；
- 后续看什么催化；
- 哪些反证会削弱判断。

系统不得输出：

- 买入；
- 推荐；
- 目标价；
- 确定受益；
- 收益承诺；
- 明确交易动作。

## 三、标准分析链条

每份重点政策应按以下顺序分析：

```text
政策原文
→ 政策动作
→ 产业链映射
→ 产业链位置判断
→ 公司映射
→ 公司关系强弱排序
→ 政策网络
→ 投资方向观察
→ 后续催化与反证
```

其中，`policy-decomposition-methodology-v1.0.1.md` 负责辅助判断政策动作、证据等级和公司映射边界；本方法论负责规定投资观察的主线。

### 兼容与单一事实源原则

五个关系模块是现有报告的投资观察增强层，不是第二套互相独立的数据系统。在当前前端完成逐步迁移前：

- `industryChain.nodes` 与既有 `chainNodes` 必须使用相同节点 ID；
- `industryChain.edges` 与既有 `chainEdges` 必须表达同一组传导关系；
- `companyMap.companyId` 必须对应既有 `companies.id`；
- `companyMap.chainNodeId` 必须对应真实产业链节点；
- `companyMap.relationship` 与 `policyEvidence` 是投资映射的权威关系字段；
- 如果既有 `companies` 已填写 `mappingLevel`，不得与 `companyMap.relationship` 矛盾；
- 新旧字段不得出现产业位置、证据等级或公司关系相互矛盾的情况。

既有 `chainNodes`、`chainEdges`、`companies` 暂时继续承担产业链地图、完整主体事实和公司页面的运行兼容；五个新模块负责首屏投资观察、政策网络和关系解释。名单型政策中，`companies` 可以保留未上市企业、科研院所、分支机构等全部官方点名主体，`companyMap` 只选择适合进入上市公司投资观察或需要重点解释的主体，不要求两者数量相等。兼容期内，`companies.mappingLevel` 与 `companyMappingEvidenceLevel` 可以作为运行镜像字段继续保留，但凡主体进入 `companyMap`，两边关系和证据等级必须一致，不得被独立编辑成两套事实。后续如迁移，应先统一前端数据源，再删除兼容字段。

## 四、核心模块一：policyIndustryMap

`policyIndustryMap` 回答：

```text
政策影响哪些产业？影响方向是什么？政策动作如何作用到产业？
```

每条记录建议包含：

```json
{
  "id": "pi1",
  "industry": "数据标注",
  "policyAction": "标注攻坚行动",
  "impactType": "demand_creation | funding_support | standard_constraint | market_mechanism | regulatory_constraint | infrastructure_build | sentiment_signal",
  "impactDirection": "positive | constraint | mixed | pending",
  "evidenceLevel": "strong | indirect | pending",
  "policyCloseness": "direct | indirect | thematic",
  "reason": "政策为什么影响该产业",
  "relatedClauseIds": [],
  "relatedNodeIds": [],
  "watchSignals": []
}
```

### 判断标准

- 政策明确提出某项建设、行动、标准、名单或监管要求，可视为 direct；
- 只从宏观方向推导出的产业，最多为 indirect；
- 只因概念相关纳入的产业，应标为 thematic 或 pending。

## 五、核心模块二：industryChain

`industryChain` 回答：

```text
产业链如何展开？政策作用在哪些环节？上下游如何传导？
```

建议结构：

```json
{
  "id": "chain1",
  "chainName": "高质量数据集产业链",
  "policyRole": "政策在这条产业链中的作用",
  "nodes": [
    {
      "id": "data-labeling",
      "name": "数据标注",
      "position": "upstream | midstream | downstream | support",
      "policySensitivity": "high | medium | low",
      "evidenceLevel": "strong | indirect | pending",
      "description": "该环节如何受政策影响",
      "companyIds": [],
      "watchSignals": []
    }
  ],
  "edges": [
    {
      "from": "data-source",
      "to": "data-labeling",
      "relation": "data_flow | demand_flow | compliance_flow | funding_flow | application_flow",
      "description": "上下游关系说明"
    }
  ]
}
```

### 注意事项

产业链必须服务投资观察，不能为了画图而画图。若产业链无法拆出上市公司或可跟踪信号，应降低分析深度。

## 六、核心模块三：companyMap

`companyMap` 回答：

```text
哪些上市公司处在哪个产业链环节？与政策关系强弱如何？
```

建议结构：

```json
{
  "id": "cm1",
  "companyId": "co1",
  "company": "海天瑞声",
  "ticker": "688787.SH",
  "chainNode": "数据标注",
  "chainNodeId": "data-labeling",
  "relationship": "policy_named | direct_industry | indirect_industry | thematic_only | watch_only",
  "policyEvidence": "strong | indirect | pending",
  "businessExposure": "训练数据与数据标注服务",
  "investmentUse": "纳入数据标注方向观察，不等于确定受益",
  "watchSignals": [],
  "keyRisks": [],
  "doNotOverread": []
}
```

### 公司强弱判断

强关系：

- 被政策或附件点名；
- 是政策明确行动直接作用的产业链环节；
- 公司业务暴露明确，且有公告、年报、中标或项目证据。

中关系：

- 处在政策直接作用产业链环节；
- 但政策未点名公司，也无订单或采购证据。

弱关系：

- 只是主题相关；
- 公司业务暴露不清；
- 需要多层传导；
- 只适合作为观察线索。

## 七、核心模块四：policyNetwork

`policyNetwork` 回答：

```text
这条政策和其他政策是什么关系？政策链条是否形成连续催化？
```

建议结构：

```json
{
  "id": "pn1",
  "relatedPolicy": "人工智能+行动政策",
  "relationship": "upstream_guidance | downstream_implementation | supporting_rule | prior_policy | follow_up_catalyst | local_rollout | contrast_policy",
  "meaning": "该政策关系对投资观察有什么意义",
  "evidenceLevel": "strong | indirect | pending",
  "sourceDate": "YYYY-MM-DD",
  "sourceUrl": "https://官方政策来源",
  "watchSignals": []
}
```

### 政策关系类型

- upstream_guidance：上位政策；
- downstream_implementation：执行文件；
- supporting_rule：配套规则；
- prior_policy：历史政策；
- follow_up_catalyst：后续催化政策；
- local_rollout：地方落地；
- contrast_policy：对比政策。

强政策关系必须能够回到官方原文，并填写 `sourceDate` 和 `sourceUrl`。如果只知道可能存在某项配套政策、行业任务或地方方案，但尚未找到官方文件，应使用 `pending`，把它放入后续催化观察，不能写成已经成立的政策关系。

## 八、核心模块五：investmentDirection

`investmentDirection` 回答：

```text
这条政策给个人投资研究带来什么方向性提示？
```

建议结构：

```json
{
  "primaryDirection": "数据要素 + AI 数据基础设施",
  "directionStrength": "high | medium | low | pending",
  "timeHorizon": "short_term | medium_term | long_term | uncertain",
  "watchIndustries": [],
  "watchChainNodes": [],
  "watchCompanyTypes": [],
  "watchCompanies": [],
  "nearTermCatalysts": [],
  "keyRisks": [],
  "minimumEvidenceNeeded": [],
  "doNotOverread": [],
  "summary": "方向性投资观察，不写交易建议"
}
```

### 输出边界

可以写：

```text
该政策提示数据标注、数据治理和质量测评方向值得进入主题观察。
```

不能写：

```text
该政策利好某公司，建议买入。
```

## 九、外部搜索如何服务本方法论

外部搜索只服务五类问题：

1. 产业链验证：该产业链环节是否真实存在，行业如何分工；
2. 公司业务暴露：公司是否真的在该环节有业务；
3. 政策网络：是否存在上位、配套、后续或地方政策；
4. 催化信号：是否已有项目、名单、资金、试点、招投标；
5. 反证搜索：是否存在商业化弱、预算不足、估值透支、业务占比低等问题。

不为写背景综述而搜索。

## 十、与既有方法论关系

本方法论是新的上位规则。

- `policy-industry-company-methodology-v1.0.md`：回答政策如何转化为产业链、公司和投资方向；
- `policy-decomposition-methodology-v1.0.1.md`：回答政策动作、证据等级和映射边界如何拆；
- `policy-analysis-quality-standard-v1.1.md`：负责防止误导和投资化表达；
- `report-template-v1.1.json`：承载结构化字段；
- `report-authoring-prompt-v1.0.md`：生成标准报告；
- `pre-publication-checklist-v1.0.md`：发布前复核。

## 十一、最终验收标准

一份高质量投资导向政策报告必须让用户看清：

```text
政策影响什么产业链；
产业链有哪些关键环节；
哪些上市公司处于这些环节；
公司与政策之间是什么证据关系；
相关政策之间是否形成连续催化；
这给投资方向观察带来什么提示；
哪些证据不足，不能过度解读。
```

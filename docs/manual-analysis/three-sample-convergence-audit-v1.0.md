# 三样板横向收敛审计 v1.0

## 一、审计目的

本审计用于判断 `policy-industry-company-methodology-v1.0` 在三种异质政策上是否成立，并据此收敛字段职责、写作要求和运行兼容规则。

审计样板：

1. 无企业名单的行动方案：行业高质量数据集建设行动；
2. 官方点名案例名单：先进计算赋能新质生产力典型应用案例；
3. 监管约束通知：2026年度工业节能监察。

本审计不讨论交易动作、目标价或配置比例，只检查政策—产业—公司研究结构是否稳定、可验证、可复用。

## 二、三类样板验证结论

| 样板类型 | 最强证据 | 公司关系边界 | 必须保留的差异化能力 |
|---|---|---|---|
| 无名单行动方案 | 政策动作、产业链环节、公司年报业务证据 | 公司最多为直接或间接产业关系，不能写成政策点名 | 公司业务证据必须独立于政策正文 |
| 官方名单型政策 | 官方附件中的案例和申报主体 | `policy_named` 只说明被附件点名，不代表订单、补贴或收入 | 完整点名主体与上市公司投资映射必须分层 |
| 监管约束型政策 | 强制标准、监察范围、整改和执法安排 | 必须区分受监管主体与合规服务商 | `regulatoryRole`、整改风险和订单验证信号 |

结论：五个关系模块均具有独立用途，没有出现只服务单一样板、应当删除的模块。

## 三、字段实际使用结果

三份样板均稳定使用：

- `policyIndustryMap`：政策动作到产业的关系；
- `industryChain`：政策在产业链上的传导方式；
- `companyMap`：公司与政策、产业节点之间的研究关系；
- `policyNetwork`：前序、上位、配套、地方和后续政策；
- `investmentDirection`：方向、周期、催化、风险和最低补证要求。

三个样板的字段集合基本一致。监管样板仅额外使用可选字段 `regulatoryRole`，属于关系层的必要差异，而不是新增模块。

## 四、发现的重复维护问题

### 1. `industryChain.nodes` 与 `chainNodes`

三份样板中：

- 节点 ID 全部重复；
- 节点产业位置全部重复；
- 节点公司 ID 全部重复；
- 节点名称大部分重复，少量为展示别名；
- 节点描述不重复，因为 `chainNodes.description` 描述节点事实，`industryChain.nodes.description` 描述政策如何作用到该节点。

因此，节点身份和基础事实应以 `chainNodes` 为准；关系层只需维护政策敏感度和政策传导解释。

### 2. `companyMap` 与 `companies`

三份样板中，进入 `companyMap` 的主体：

- 公司名称全部可由 `companies.id` 唯一确定；
- 证券代码全部可由 `companies.id` 唯一确定；
- 节点名称可由 `chainNodeId` 唯一确定；
- 公司关系、政策证据、监管角色、研究用途、催化和风险无法从主体事实推导，必须保留在 `companyMap`。

因此，`companyMap.company`、`ticker`、`chainNode` 属于可派生显示字段，不应继续强制人工重复录入。

## 五、收敛后的单一事实源

```text
chainNodes
= 节点 ID、标准名称、产业位置、基础描述、完整主体引用、基础证据

chainEdges
= 产业地图拓扑、显示强度和置信度

industryChain
= 链条主题、政策作用、节点政策敏感度、政策传导解释、关系层观察信号

companies
= 主体 ID、名称、证券代码、上市状态、主体类型、完整点名事实

companyMap
= 政策关系、政策证据、监管角色、业务暴露、研究用途、催化、风险和不过度解读边界

policyIndustryMap
= 政策动作到产业的关系

policyNetwork
= 政策之间的关系和来源

investmentDirection
= 研究方向的最终综合判断
```

## 六、实施决定

### 决定一：身份字段自动派生

运行 mapper 支持：

- `industryChain.nodes` 根据 `id` 从 `chainNodes` 补全名称、位置、证据等级、公司引用和观察信号；
- `companyMap` 根据 `companyId` 和 `chainNodeId` 从 `companies`、`chainNodes` 补全公司名称、证券代码和节点名称。

现有完整 JSON 继续兼容，不要求立即删除镜像字段。

### 决定二：显式镜像必须一致

若报告仍显式填写重复身份字段，严格校验必须检查：

- 公司名称和证券代码不得与 `companies` 冲突；
- 节点产业位置和证据等级不得与 `chainNodes` 冲突；
- 节点公司引用不得与 `chainNodes.companyIds` 冲突；
- 旧 `companies.mappingLevel`、`companyMappingEvidenceLevel` 若存在，不得与 `companyMap` 冲突。

### 决定三：保留关系解释字段

以下字段不是重复字段，不能删除：

- `industryChain.nodes.policySensitivity`；
- `industryChain.nodes.description`；
- `companyMap.relationship`；
- `companyMap.policyEvidence`；
- `companyMap.regulatoryRole`；
- `companyMap.businessExposure`；
- `companyMap.investmentUse`；
- 催化、风险和不过度解读字段。

### 决定四：暂不删除旧结构

当前前端产业链页面和公司页面仍依赖 `chainNodes`、`chainEdges`、`companies`。本轮只减少新报告的重复录入，不删除兼容字段，也不开展大规模前端重构。

## 七、回归测试要求

项目必须持续验证：

1. 旧报告无新字段时继续通过；
2. 三份完整新样板继续通过；
3. 删除可派生身份字段的精简新报告继续通过；
4. 节点、公司引用不存在时失败；
5. 显式身份字段与事实源冲突时失败；
6. 强政策关系没有官方来源时失败；
7. 监管政策没有监管角色时失败；
8. 合规服务商没有项目或订单观察信号时失败；
9. 出现买入、目标价或确定性受益表达时失败。

执行命令：

```bash
npm run manual:test
```

## 八、最终判断

三份异质样板已经证明当前方法论具备通用性，不需要继续增加第四份样板来扩字段。下一阶段应转入旧报告分级迁移：高价值政策完整回炉，宏观规划只补产业和政策关系，程序性或无投资映射价值政策保留旧结构。

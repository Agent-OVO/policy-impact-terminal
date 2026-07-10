# 生产认证态全量QA报告 v1.0

验收日期：2026年7月10日。

## 一、验收目标

在不保留生产测试账号的前提下，对线上全部20份政策报告执行认证态桌面端和移动端全量检查，验证：

- 报告列表和报告详情可读取；
- 7个章节模块均可切换；
- 17份完整报告展示投资方向观察和政策网络；
- 3份C类轻量报告不出现空白或错误模块；
- 公司影响页面与权威`companyMap`一致；
- 桌面端和390px移动端无横向溢出；
- 控制台、页面异常和失败网络请求为0。

生产地址：

```text
https://agent-ovo.github.io/policy-impact-terminal/
```

## 二、一次性账号安全机制

新增：

```text
scripts/manage-production-qa-user.mjs
scripts/run-production-authenticated-qa.mjs
scripts/production-authenticated-qa.playwright.js
npm run qa:production:authenticated
```

流程为：

```text
创建带专属purpose标记的一次性用户
→ 创建普通user档案
→ 生成仅存于系统临时目录的浏览器会话状态
→ 执行生产认证态QA
→ finally中删除Auth用户
→ 复核profiles、user_events、analysis_jobs均为0残留
→ 删除本地临时会话文件
```

数据库外键已确认：

- `profiles.id`对Auth用户使用`on delete cascade`；
- `user_events.user_id`使用`on delete cascade`；
- `analysis_jobs.owner_id`使用`on delete cascade`；
- 其他历史创建者字段使用`on delete set null`。

工具只审计和清理由本工具创建、带`ephemeral-production-qa`标记或`qa_`前缀的账号，不会删除普通用户。审计中发现两条早期`codexqa*`候选记录，未纳入本工具管理范围，也未作任何修改。

## 三、QA发现与修复

### 公司影响页使用了错误的数据层

修复前：

- `companies`保存完整主体事实和兼容记录；
- `companyMap`保存权威投资观察映射；
- 投资方向观察模块使用`companyMap`；
- 独立“公司影响分析”模块却展示全部`companies`。

因此出现：

- 就业规划核心映射2家，公司页显示6家；
- 教育规划核心映射3家，公司页显示6家；
- 先进计算案例核心映射9家，公司页显示18家；
- 部分报告的列表“代表公司数”与实际权威映射不一致。

修复方式：

1. 存在`companyMap`时，公司页只展示其映射主体；
2. 公司顺序按`companyMap`读取，并按权威产业节点分组；
3. 关系类型、证据等级、监管角色、产业节点和风险说明由`companyMap`覆盖；
4. 主体名称、证券代码、产品和独立公司证据继续来自`companies`事实层；
5. 没有`companyMap`的旧轻量报告继续回退`companies`，保持兼容；
6. `summary.companyCount`和`analysisCoverage.companyCount`统一派生自`companyMap.length`；
7. 严格validator新增公司计数一致性拦截。

Edge Function `analyze`已同步更新，17份完整报告全部重新写回并返回`published: true`。

## 四、最终验收结果

执行：

```bash
npm run qa:production:authenticated
```

最终结果：

```text
authenticated=true
reportCount=20
fullInvestmentPanels=17
policyNetworkPanels=17
桌面端失败=0
桌面端横向溢出=0
桌面端运行错误=0
移动端失败=0
移动端横向溢出=0
移动端运行错误=0
断言失败=0
```

账号清理复核：

```text
authUser=true
profiles=true
user_events=true
analysis_jobs=true
managed ephemeral users remaining=0
```

代表性公司投影结果：

| 报告 | 权威计数 | 公司页卡片 | 标签区域 |
|---|---:|---:|---:|
| 就业优先规划 | 2 | 2 | 2 |
| 教育发展规划 | 3 | 3 | 3 |
| 先进计算典型案例 | 9 | 9 | 9 |
| 工业节能监察 | 12 | 12 | 12 |
| AI伦理审查先导计划 | 10 | 10 | 10 |

就业公司页仅显示科锐国际、北京人力；教育公司页仅显示视源股份、科大讯飞、佳发教育。培训类和其他兼容主体不再进入核心公司分析页面。

## 五、发布闭环

- 修复提交：`333fe44 Align company views with authoritative mappings`；
- GitHub Pages：Run `29085299429`，成功；
- 质量工作流：Run `29085333823`，成功；
- Edge Function：`analyze`远程部署成功；
- 完整报告重新写回：17/17成功；
- 最终生产认证态QA：20/20通过。

## 六、结论

生产认证态视觉与运行验收已经完成。当前20份报告在列表计数、投资方向观察、公司影响分析、政策网络、桌面端和移动端之间口径一致；一次性QA账号可以自动创建、使用、删除并验证零残留。阶段四原有的认证条件待补项正式关闭。

# 阶段九首批六政策研究批次

本目录完成阶段九第二部分的A—G工作包，目标是验证“筛选—事实源—报告—聚合—校准—反查—人工处置”完整闭环。

## 工作包状态

| 工作包 | 内容 | 状态 | 主要成果 |
|---|---|---|---|
| A | 六政策选样与原文附件核验 | 完成 | `batch-manifest.json`、`source-audit.json` |
| B | 三份深度报告 | 完成 | 输配电价、精细化工揭榜、新增复核AI＋人社 |
| C | 三份标准报告 | 完成 | 行业标准计划、既有美丽中国、农业机器人 |
| D | 跨政策综合分析 | 完成 | `cross-policy-matrix.json`、`cross-policy-observation.md` |
| E | 筛选排序校准 | 完成 | `triage-calibration.json`及三维评分代码 |
| F | 产业和公司反查 | 完成 | `scripts/query-stage9-first-six.mjs` |
| G | 人工队列处置 | 完成 | `queue-dispositions.json`及只读管理工具 |

## 六份报告

### 深度报告

1. `reports/1c9d4a56-5f1e-4c16-8b2a-202607101077.json`：输配电价。
2. `reports/95e4c9b2-6fd4-4fb5-b8cb-202606290303.json`：精细化工揭榜挂帅名单。
3. `../../manual-reports/4e45255c-dc48-4526-8ca3-3f313e68780a.json`：“人工智能＋人社”实施意见。

### 标准报告

1. `reports/6b23a2d4-8d2a-4f80-9f84-202607070805.json`：2026年第四批行业标准计划。
2. `../../manual-reports/3abd8068-084e-441f-b96b-7c849ca324f7.json`：美丽中国建设“十五五”规划。
3. `reports/8f74d5a1-12e0-4de2-8f6a-202606090269.json`：农业机器人典型场景遴选。

四份新增报告位于研究批次目录，不自动进入`manual-reports/`，不写生产数据库。正式发布前仍需确认生产policy UUID和最新公司业务证据。

## 使用命令

严格验证四份新增报告：

```bash
MANUAL_QUALITY_STRICT=true npm run manual:validate -- research-batches/stage9-first-six/reports/*.json
```

查看批次概况：

```bash
npm run stage9:first-six:query -- summary
```

产业反查：

```bash
npm run stage9:first-six:query -- industry 人工智能
npm run stage9:first-six:query -- industry 电网 --json
```

公司反查：

```bash
npm run stage9:first-six:query -- company 万华化学
npm run stage9:first-six:query -- company 科大讯飞 --json
```

查看人工处置：

```bash
npm run stage9:first-six:queue -- validate
npm run stage9:first-six:queue -- list immediate_analysis
npm run stage9:first-six:queue -- list retain_observation 机器人 --json
```

自动测试：

```bash
npm run policy:triage-test
npm run stage9:first-six:query-test
npm run stage9:first-six:queue-test
```

## 关键方法结论

- 政策工具强度、增量产业影响和公司可验证性必须分开评分。
- 典型案例名单多为事后认定，不能因主体明确而挤占未来任务的优先级。
- 揭榜挂帅、价格调整、征集遴选和采购准入具有更强的未来事件价值。
- 综合规划必须等待专项政策、预算和项目，不能按正文关键词数量高估。
- 公司映射允许为空。农业机器人样本在名单公布前保持零公司关系。
- 自动分数只负责排队，附件和公司证据由人工研究流程确认。

## 边界

本批次没有：

- 部署Supabase迁移或Edge Function；
- 写入生产数据库；
- 自动发布报告；
- 新增固定政策来源；
- 调用模型API；
- 修改六至八阶段Git暂存区；
- 输出交易建议、目标价或收益承诺。

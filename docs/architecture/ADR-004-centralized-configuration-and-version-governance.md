# ADR-004 系统集中配置与版本治理

状态：已接受
日期：2026年7月10日

## 背景

`2026-05-01`和`codex-manual-v1`目前散落在前端、脚本、SQL、Edge Function和工作流中。抓取范围、可见范围和历史比较范围被错误绑定。

## 决策

建立服务端集中配置和版本治理。非敏感运行参数进入版本化配置；密钥继续只存于安全环境变量或平台Secret。

至少拆分：

- `active_crawl_since`：定时抓取起始范围；
- `published_visibility_since`：普通用户可见范围；
- `comparison_corpus_since`：历史比较语料范围；
- `source_whitelist_version`；
- `report_schema_version`；
- `analysis_version`；
- `projection_version`；
- `token_budget_policy_version`；
- `frontend_contract_version`。

## 配置规则

- 配置变更必须有版本、变更人、原因、生效时间和回滚值；
- 前端不自行硬编码生产范围，只消费服务端返回的公开配置；
- CLI、工作流和Edge Function读取同一配置快照；
- 一次生产操作记录所使用的配置版本，确保结果可复现；
- 配置缺失或版本不兼容时应失败关闭，不能静默使用不同默认值；
- 本地开发允许显式覆盖，但必须在输出中标注覆盖来源。

## 实现边界

阶段七可先使用`system_config_versions`表和只读RPC，不建设复杂配置后台。生产变更由受控SQL或CLI完成。新前端重构后再评估图形化配置界面。

## 后果

范围和版本调整不再需要跨多层手工同步，历史结果可以追溯到具体配置快照。代价是各执行入口必须接入统一配置读取和缓存失效机制。

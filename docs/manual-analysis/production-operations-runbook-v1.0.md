# 人工政策报告生产运行手册 v1.0

## 一、生产对象

生产流程包括：

- 报告JSON编写与回炉；
- 严格质量校验；
- 回归测试与治理指标；
- Supabase人工写回；
- GitHub Pages发布；
- 线上运行与视觉抽查。

## 二、单份报告发布流程

### 1. 事实和证据准备

- 阅读政策正文和官方附件；
- 区分政策动作、产业节点、公司业务和项目兑现证据；
- 公司未被点名时，政策证据不得直接绑定公司；
- 保留原主体、条款、动作、节点和证据ID。

### 2. 本地质量门

```bash
npm run security:audit
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/<policy_id>.json
npm run manual:test
npm run manual:metrics
npm run build
npm run build:budget
```

任何命令失败均不得写回或发布。

### 3. 提交范围审查

```bash
git status --short
git diff --check
git diff --stat
```

只提交本轮报告、测试、治理注册表和必要文档。`tmp/`、成果截图和本地生成脚本默认禁入。

### 4. 人工写回

通过GitHub Actions `Apply manual policy analysis` 传入：

- `policy_id`；
- `manual-reports/<policy_id>.json`。

工作流必须依次通过：

1. 单份严格校验；
2. 全量回归测试；
3. 治理注册表和质量指标检查；
4. Supabase写回。

日志必须出现：

```text
[manual:validate] ok
"published": true
```

### 5. Pages发布

Pages工作流在部署前执行：

1. 依赖安全审计；
2. 全量20份严格校验；
3. 回归测试；
4. 治理指标检查；
5. 前端生产构建；
6. 构建体积预算检查。

任一质量门失败时，静态站点不得部署。

## 三、治理注册表

治理状态以以下文件为准：

```text
docs/manual-analysis/report-governance-registry-v1.0.json
```

新增报告时必须同步登记：

- `policyId`；
- A/B/C类别；
- `full`或`light`迁移状态；
- 简化标题。

未登记报告会被 `npm run manual:metrics` 拦截。

## 四、日常质量指标

运行：

```bash
npm run manual:metrics
npm run manual:metrics -- --json
```

持续关注：

- 报告总数和注册表一致性；
- 完整迁移报告数；
- 轻量豁免报告数；
- 证据对象覆盖率；
- 公司映射数量；
- 具有独立公司证据的映射数量；
- `pending/watch_only`数量。

独立公司证据覆盖率是补强指标，不应通过删除低置信主体或伪造证据提升。

## 五、视觉和运行抽查

### 无认证检查

- 生产登录页桌面端和移动端；
- 页面状态码和静态资源；
- 控制台错误；
- 登录表单、品牌信息和响应式布局。

### 本地演示检查

使用 `VITE_ENABLE_MOCK=true`：

- 本地演示登录；
- 报告列表；
- 报告模块切换；
- 产业链、公司和证据区域；
- 桌面和移动布局；
- 控制台无未处理异常。

### 认证后生产检查

需要专门测试账号或安全复用的测试Cookie，检查：

- 新写回报告是否可打开；
- 首屏公司排序；
- 关系和监管角色标签；
- 政策网络来源；
- 长文本换行和移动端；
- 旧报告无空白模块。

没有安全测试账号时，不得通过创建不可清理的临时生产账号规避限制，应在视觉报告中明确记录待补项。

## 六、故障处置

### 严格校验失败

- 不降低规则；
- 修复真实引用、证据、分数或措辞冲突；
- 重新运行全量质量门。

### 写回失败

- 查看单份报告校验和Supabase函数日志；
- 不重复修改已发布报告以碰运气；
- 核对policyId、文件路径和密钥配置。

### Pages失败

- 先判断是质量门、构建还是部署失败；
- 质量门失败必须修复报告或注册表；
- 不通过跳过测试恢复部署。

### 线上回归

- 回滚到上一成功提交或修复后重新部署；
- 保留问题报告、复现步骤和受影响policyId；
- 若Supabase数据已写回，需使用上一版本报告重新写回，而不是只回滚静态页面。

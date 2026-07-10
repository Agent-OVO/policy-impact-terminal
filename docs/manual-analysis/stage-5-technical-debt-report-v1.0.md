# 阶段五独立技术债治理完成报告 v1.0

## 一、治理范围

本阶段只处理工程运行时、依赖安全、前端构建和发布质量门，不修改任何政策报告内容。

## 二、GitHub Actions运行时升级

全部官方Action升级到面向Node.js 24的新主版本：

- `actions/checkout@v7`；
- `actions/setup-node@v6`；
- `actions/upload-artifact@v7`；
- `actions/configure-pages@v6`；
- `actions/upload-pages-artifact@v5`；
- `actions/deploy-pages@v5`。

覆盖工作流：

- 人工报告写回；
- 政策抓取；
- GitHub Pages部署；
- 人工报告读取；
- 报告质量CI；
- 已发布政策重新分析。

验收要求：质量工作流、Pages部署和至少一条人工写回流程均须在GitHub上实测成功，且不再出现旧Action被强制切换Node.js 24的提示。

## 三、依赖安全治理

治理前`npm audit`结果：

- 高危：2个包节点；
- 低危：1个包节点；
- 涉及Vite、Undici、Babel；
- 总计3个漏洞包节点。

修复版本：

- Vite：`6.4.2 → 6.4.3`；
- Undici：`7.25.0 → 7.28.0`；
- Babel核心及配套包：统一到`7.29.7`；
- 同步刷新Browserslist相关锁文件依赖。

未进行React、TypeScript、Lucide等业务框架大版本升级。

治理后：

```text
npm audit --audit-level=high
found 0 vulnerabilities
```

安全审计已接入PR质量CI和Pages发布流程，未来出现高危漏洞时自动阻断。

## 四、前端构建拆分

治理前：

- 单一JavaScript主包约590.21KB；
- gzip约168.02KB；
- Vite持续提示单块超过500KB。

治理后采用稳定供应商分块：

| 分块 | 原始大小 | gzip |
|---|---:|---:|
| 应用主包 | 221.53KB | 64.63KB |
| Supabase供应商包 | 207.09KB | 53.46KB |
| React供应商包 | 142.93KB | 45.78KB |
| 图标供应商包 | 17.58KB | 3.83KB |

结果：

- 最大JavaScript分块由约590KB降至221.53KB；
- 降幅约62.5%；
- 超500KB构建警告消失；
- 总传输量基本不变，主要收益是并行加载、长期缓存和解析峰值降低，不夸大为总下载量大幅减少。

浏览器资源对比：

| 指标 | 治理前线上版本 | 治理后候选版本 |
|---|---:|---:|
| JavaScript请求数 | 1 | 4 |
| JavaScript解码总量 | 590475字节 | 589136字节 |
| 最大JavaScript资源 | 590475字节 | 221532字节 |
| 控制台错误 | 0 | 0 |

线上基线通过远程网络加载，候选版本通过本地预览加载，两者毫秒耗时不具直接可比性，因此不使用加载时间宣称性能提升。

## 五、输出目录清理与构建预算

Vite显式设置`emptyOutDir: true`，避免历史哈希文件进入Pages制品。

新增：

```text
scripts/check-bundle-budget.mjs
npm run build:budget
```

当前预算：

- 单个JavaScript分块不超过300KiB；
- JavaScript总量不超过650KiB；
- 单个CSS不超过180KiB；
- 生产输出不得包含source map。

预算检查已接入PR质量CI和Pages发布流程。

## 六、全新安装验收

在不复用项目`node_modules`和`dist`的临时副本中执行：

```text
npm ci
npm run security:audit
MANUAL_QUALITY_STRICT=true npm run manual:validate -- manual-reports/*.json
npm run manual:test
npm run manual:metrics
npm run build
npm run build:budget
```

结果：全部通过。

全新构建输出仅包含：

- 1个CSS；
- 4个JavaScript分块；
- 1个静态SVG；
- 1个入口HTML。

## 七、仍待条件补齐事项

生产登录后的17份完整报告逐份QA仍需要专门、可清理测试账号或可撤销测试Cookie。

该项属于认证条件缺口，不属于本阶段工程失败。不得为完成指标创建无法回收的生产账号。

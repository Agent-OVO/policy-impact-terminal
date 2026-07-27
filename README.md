# 政策产业影响终端

这是把 UI 预览图转成真实系统的第一版前端工程。当前版本先使用本地 mock 数据跑通产品形态，并预留 Supabase 登录与后端数据接入。

## 已实现

- 登录/注册壳，支持本地演示登录
- 登录后的政策列表工作台，可查看已发布报表和后台处理状态
- 普通用户只读使用，不能创建新的政策分析任务
- GitHub Actions 每小时抓取 2026-05-01 以后政策正文和页面声明的全部附件；分析结果经人工审核后写回发布
- 正式分析取件会生成证据包，保存官方发布页、正文、附件原文件、SHA-256、提取状态和人工复核标记
- 官方页面会校验字节数、HTML结构和已知错误模板；HTTP 200但返回错误页，或发布外壳声明附件却发现0个附件时，禁止进入正式分析
- 生产运行摘要每日生成带 `asOf` 和工作流 run ID 的只读快照，静态文档不作为实时数量权威源
- 政策速读、政策条款、政策背景、对比分析、产业链影响、公司影响分析、证据总览
- 可点击产业链影响图，右侧节点详情联动
- 代表性公司影响卡片、影响矩阵、公司详情
- PC、平板、手机响应式布局
- Supabase client 配置入口
- Supabase 表结构、RLS 与 Edge Function 接入说明草案

## 运行

```powershell
npm install
npm run dev
```

然后访问：

```text
http://127.0.0.1:5173/
```

## Supabase 接入

复制 `.env.example` 为 `.env.local`，填入：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

当前 UI 会在没有 Supabase 配置时使用本地演示账号流程。后续可把 mock 数据替换为 Supabase 表：

- `policies`
- `policy_actions`
- `policy_clauses`
- `industry_nodes`
- `industry_edges`
- `companies`
- `evidence`

数据库草案在 `supabase/schema.sql`，接入说明在 `supabase/README.md`。当前前端已经通过 `src/lib/reportRepository.ts` 建立了列表、任务和后续报表加载的服务边界。

## 政策来源抓取

先运行 dry-run，输出候选政策与本地去重结果：

```powershell
npm run crawl:sources -- --limit=40
```

默认只保留 2026-05-01 以后发布的政策原文或政策发布页，排除政策解读、图解、答记者问、新闻发布会等二次解读内容。发改委来源会限定在 `/xxgk/zcfb/` 政策发布路径。抓取器会同时读取正文和页面声明的附件：PDF、OFD、DOC/DOCX、XLS/XLSX、PPT/PPTX、CSV、TXT、XML、HTML、JSON、ZIP及常见图片/扫描件。可解析格式会合并为研究证据，所有成功下载的附件均记录类型、大小、SHA-256和状态；旧DOC/XLS/PPT等不能可靠自动解析的格式仍保留原文件并标记人工复核。如确需保留解读内容，可额外加 `--include-interpretations`。

常用参数：

```powershell
npm run crawl:sources -- --source=gov_zhengce_latest,nda_policy_release --limit=20
npm run crawl:sources -- --since=2026-05-01 --out=artifacts/policy-candidates.json
```

如需把候选政策原文写入 Supabase Edge Function，在 `.env.local` 中配置管理员 access token 或爬虫密钥后运行：

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ACCESS_TOKEN=admin-user-jwt
# 或
SUPABASE_FUNCTION_JWT=your-supabase-anon-key-or-function-jwt
SUPABASE_CRAWLER_SECRET=strong-random-shared-secret
```

```powershell
npm run crawl:sources -- --ingest
```

注意：`SUPABASE_ACCESS_TOKEN` 必须是管理员用户 JWT，不能使用 service role key。抓取流程只入库政策原文，不写回 `reportPayload`；普通用户不能通过前端或 Edge Function 创建任务。

## 人工审核政策分析

定时抓取完成后，由授权分析流程读取政策原文并写回审核后的结构化报告。`scripts/manual-policy-analysis.mjs` 通过 `analyze` Edge Function 完成待分析列表、全文读取和人工分析结果写回：

```powershell
npm run manual:policies -- list --limit=10
npm run manual:policies -- get --policyId=<policy-uuid>
npm run manual:evidence -- --policy-json=artifacts/manual-policy.json --out-dir=artifacts/manual-evidence
npm run manual:policies -- apply --policyId=<policy-uuid> --file=artifacts/manual-report-payload.json
```

- `list` 默认只列出 `publish_date >= 2026-05-01` 且尚未完成当前人工审核分析版本的政策。
- `get` 返回政策元数据和 `policies.full_text`；GitHub正式取件工作流随后自动运行 `manual:evidence`，重新获取官方发布页及全部附件并形成证据包。
- 证据包包含 `source-page.html`、`source-page.txt`、`evidence.txt`、`manifest.json`、原始政策JSON和 `attachments/` 原文件目录。附件缺失或下载失败时不得进入正式产业和公司映射。
- `apply` 写回手动整理的 `reportPayload`，把政策标记为 `published`，前端随后只展示这些已发布分析。
- 正式取件发现附件下载失败、附件数量被安全上限截断或发布外壳没有取得附件正文时，会关闭本次开放任务并把政策退回 `awaiting_evidence`；旧DOC/XLS/PPT、扫描件等原件已下载但仍需人工阅读时，也先退回等待证据，完成人工核验后以 `attachment_review_completed=true` 显式放行。证据包始终上传供复核。
- 历史遗留的开放分析任务只能在管理员显式传入 `--closeOpenJob=true` 且给出原因时关闭；关闭结果记为失败任务并保留审计信息，不允许静默取消。
- 如果本地没有 Supabase 函数密钥，可把审核后的 JSON 放在 `manual-reports/*.json`，然后手动触发 `.github/workflows/apply-manual-analysis.yml` 写回。

## GitHub Pages 与定时抓取

GitHub Pages 只负责托管静态前端。政策抓取通过 GitHub Actions 定时任务执行，工作流在 `.github/workflows/crawl-policies.yml`：

- 全天每小时第17分钟运行一次，采集过程不自动选择分析。
- 每次运行 `scripts/crawl-policy-sources.mjs --manual-selection-only --ingest`，抓取 2026-05-01 以后政策正文和附件并写入 Supabase。
- `.github/workflows/production-operations-summary.yml` 每日生成一次只读生产快照；实时候选数量、重复组和附件待证数量以该快照的 `asOf`、查询窗口和run ID为准。
- 前端部署工作流在 `.github/workflows/deploy-pages.yml`。GitHub Pages 的发布源应设置为 GitHub Actions。
- 报告分析不由 GitHub Actions 定时执行；由授权分析流程运行 `npm run manual:policies -- list/get/apply` 完成读取、分析和写回。

GitHub 仓库需要配置 Actions Secrets：

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_FUNCTION_JWT=your-supabase-anon-key-or-function-jwt
SUPABASE_CRAWLER_SECRET=strong-random-shared-secret
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Supabase Edge Function 侧需要配置同一个爬虫密钥，以及用于归属定时抓取数据的管理员用户 ID：

```powershell
supabase secrets set CRAWLER_INGEST_SECRET=strong-random-shared-secret
supabase secrets set CRAWLER_OWNER_ID=admin-profile-user-uuid
supabase functions deploy ingest
supabase functions deploy analyze
supabase functions deploy publish
```

`CRAWLER_OWNER_ID` 必须对应 `profiles` 表中 `status = active` 且 `role = admin` 的用户。普通用户登录访问网站不会触发抓取或分析；登录只负责访问前端和读取已发布的手动分析结果。

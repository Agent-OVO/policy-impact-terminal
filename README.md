# 政策产业影响终端

这是把 UI 预览图转成真实系统的第一版前端工程。当前版本先使用本地 mock 数据跑通产品形态，并预留 Supabase 登录与后端数据接入。

## 已实现

- 登录/注册壳，支持本地演示登录
- 登录后的政策列表工作台，可查看已发布报表和后台处理状态
- 普通用户只读使用，不能创建新的政策分析任务
- GitHub Actions 定时抓取政策原文，并自动完成基础分析与发布
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

默认只保留政策原文或政策发布页，排除政策解读、图解、答记者问、新闻发布会等二次解读内容。发改委来源会限定在 `/xxgk/zcfb/` 政策发布路径；抓取结果会提取政策正文并在写入 Supabase 时保存到 `policies.full_text`。如确需保留解读内容，可额外加 `--include-interpretations`。

常用参数：

```powershell
npm run crawl:sources -- --source=gov_zhengce_latest,nda_policy_release --limit=20
npm run crawl:sources -- --since=2026-01-01 --out=artifacts/policy-candidates.json
```

如需写入 Supabase Edge Function 并自动生成基础报表，在 `.env.local` 中配置管理员 access token 或爬虫密钥后运行：

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ACCESS_TOKEN=admin-user-jwt
# 或
SUPABASE_FUNCTION_JWT=your-supabase-anon-key-or-function-jwt
SUPABASE_CRAWLER_SECRET=strong-random-shared-secret
```

```powershell
npm run crawl:sources -- --auto-publish
```

注意：`SUPABASE_ACCESS_TOKEN` 必须是管理员用户 JWT，不能使用 service role key。普通用户不能通过前端或 Edge Function 创建任务。

## GitHub Pages 与定时抓取

GitHub Pages 只负责托管静态前端。政策抓取通过 GitHub Actions 定时任务执行，工作流在 `.github/workflows/crawl-policies.yml`：

- 工作日按北京时间每小时运行一次。
- 周六、周日按北京时间每 12 小时运行一次，分别在 00:00 和 12:00。
- 每次运行 `scripts/crawl-policy-sources.mjs --auto-publish`，抓取政策原文、写入 Supabase、执行基础自动分析并发布报表。
- 前端部署工作流在 `.github/workflows/deploy-pages.yml`。GitHub Pages 的发布源应设置为 GitHub Actions。

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

`CRAWLER_OWNER_ID` 必须对应 `profiles` 表中 `status = active` 且 `role = admin` 的用户。普通用户登录访问网站不会自动触发抓取；登录只负责访问前端和读取已发布报表。

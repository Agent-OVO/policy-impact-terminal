# Supabase Backend Skeleton

This folder holds the database schema and Edge Function boundary for the Policy Impact Terminal. The production frontend reads Supabase only; local mock data is available only when `VITE_ENABLE_MOCK=true` is set explicitly.

## 1. Apply Schema

Run the versioned migrations:

```powershell
supabase db push
```

The initial schema is checked in as `supabase/migrations/20260510000000_initial_schema.sql`. Keep `supabase/schema.sql` as the editable declarative reference, then generate or update migrations before deploying a new database.
The official source seed is checked in as `supabase/migrations/20260510001000_seed_policy_sources.sql`, so a fresh database receives the crawler source registry during `supabase db push`.

After the schema is applied, seed the first official policy source pool:

```powershell
# Paste this file into Supabase SQL Editor, or convert it to a migration/seed step.
supabase/policy-sources.seed.sql
```

The initial source pool contains:

- 中国政府网 - 最新政策: `https://www.gov.cn/zhengce/zuixin/`
- 国家发展改革委 - 政策文件库: `https://www.ndrc.gov.cn/xxgk/wjk/`
- 工业和信息化部 - 政策文件库: `https://www.miit.gov.cn/search/zcwjk.html?websiteid=110000000000000&pg=&p=&tpl=14&category=183&q=`
- 国家数据局 - 政策发布: `https://www.nda.gov.cn/sjj/zwgk/zcfb/list/index_pc_1.html`

The core tables are:

- `policies`: top-level policy/report metadata.
- `policy_sources`: official source registry with crawl and dedupe priority.
- `analysis_jobs`: async job queue for ingest/analyze/publish.
- `policy_actions`, `policy_clauses`, `industry_nodes`, `industry_edges`, `companies`, `evidence`: future hydrated report data.

RLS is enabled. Normal browser clients use the anon key and authenticated user session, and are read-only for published policy reports. Policy/job writes are reserved for active admins and the scheduled crawler path. Edge Functions use the service role key server-side only after verifying an active admin JWT or the crawler secret.

### Report Payload Contract

`listPolicyReports()` reads list metrics from `policies.metadata`. The frontend accepts both camelCase and snake_case keys at the top level or inside `metadata.counts` / `metadata.report_counts`:

```json
{
  "industryCount": 14,
  "company_count": 7,
  "evidenceCount": 22,
  "primary_signal": "数据流通与交易平台"
}
```

`getPolicyReport(reportId)` loads a row by `policies.id` when `reportId` is a UUID, or by `policies.external_id` when it is a stable business slug. It then looks for a complete report JSON in `policies.metadata.reportPayload` first. It also accepts `report_payload`, `policyReport`, `policy_report`, `report`, `payload`, `analysisPayload`, `analysis_payload`, `outputPayload`, or `output_payload`, including one nested payload container. The payload may use camelCase or snake_case field names; the repository maps it back to the current App report shape.

Minimal shape:

```json
{
  "reportPayload": {
    "policy": {
      "title": "关于推动数据要素市场化配置 加快培育数据产业的意见",
      "issuer": "国家发展改革委等17部门",
      "publish_date": "2024-05-28",
      "source_name": "国家数据局官网",
      "confidence": 78
    },
    "actions": [],
    "clauses": [],
    "chain_nodes": [],
    "chain_edges": [],
    "companies": [],
    "evidence": []
  }
}
```

If no complete payload is present, the production frontend shows a clear error and does not fall back to local demo data. This prevents a real policy from being mixed with an unrelated sample report.

### Duplicate Policy Handling

The same policy can appear on multiple sources, especially between 中国政府网, ministry sites, and 国家数据局 reposts. Do not dedupe by URL alone.

`policies` therefore has these fields:

- `policy_no`: official document number when available.
- `canonical_source_url`: normalized URL without tracking/hash noise.
- `dedupe_key`: canonical key used for same-policy detection.
- `content_hash`: optional normalized full-text hash.
- `duplicate_of_policy_id`: optional pointer to the canonical policy.

`ingest` builds a dedupe key in this order:

1. `policyNo/policy_no` + issuer.
2. normalized title + issuer + publish date.
3. normalized source URL as a fallback.

If `dedupe_key` or `content_hash` already exists on a canonical policy, `ingest` returns that existing `policyId` with `duplicate: true` and creates a lightweight job linked to the existing policy instead of creating a second policy report.

## 2. Frontend Environment

Create `.env.local` from `.env.example` and set:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ANALYSIS_JOB_MODE=disabled
```

The production UI is read-only for normal users. Do not expose browser-side job creation for public users; scheduled GitHub Actions should run the crawler and call Edge Functions with the crawler secret.

For local UI-only demos without Supabase, add `VITE_ENABLE_MOCK=true` to `.env.local`. Do not set this in GitHub Pages or any production build.

Production setup can be driven by:

```powershell
npm run setup:production
```

The setup script now links the Supabase project and pushes migrations before resolving the crawler owner and deploying functions. Set `SUPABASE_DB_PASSWORD` in the shell if the Supabase CLI needs the remote database password. Use `--skip-db` only when the database has already been initialized.

Keep `SUPABASE_SERVICE_ROLE_KEY` out of `.env.local` and every Vite-prefixed variable. It belongs only in Supabase Edge Function secrets.

## 3. Edge Function Deployment

Deploy the MVP functions and set server-side secrets:

```powershell
supabase functions deploy ingest
supabase functions deploy analyze
supabase functions deploy publish

supabase secrets set SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set CRAWLER_INGEST_SECRET=strong-random-shared-secret
supabase secrets set CRAWLER_OWNER_ID=admin-profile-user-uuid
```

The functions are intended to run with Supabase JWT verification enabled. Manual calls require an active admin user's access token. Scheduled crawler calls use a JWT accepted by Supabase Functions plus `x-crawler-secret`. Inside the function, the service role key is used only for database writes after the function has verified admin/crawler authorization.

The scheduled GitHub crawler runs `node scripts/crawl-policy-sources.mjs --preflight` before crawling. That preflight validates the Edge Function crawler secret, `CRAWLER_OWNER_ID`, active admin profile, and seeded active `policy_sources` rows. Published-policy refreshes use `scripts/reanalyze-published-policies.mjs`, which calls the `analyze` Edge Function batch endpoint instead of querying `policies` with an anonymous REST session.

## 4. Job Flow

The intended minimal flow is:

1. `ingest`: create a draft `policies` row and a queued `analysis_jobs` row. The response includes `policyId`, `policyRef.id`, and `job.policy_id` for frontend routing. If the request includes `externalId` or `external_id`, ingest writes `policies.external_id` when that column exists; on older schemas it falls back to `policies.metadata.externalId` / `metadata.external_id` and still returns `policyExternalId`.
2. `analyze`: update the job to `analyzing`, generate a rules-based `metadata.reportPayload` from `policies.full_text`, and move the policy to `reviewing`.
3. `publish`: require the analyze stage to have completed, then mark the linked policy and job as `published`.

The current `analyze` function is a baseline rules analyzer. It makes the system usable end-to-end, but deeper industrial-chain and company-level analysis should later be upgraded with a dedicated model/worker.

See `supabase/functions/README.md` for request/response examples and deployment commands.

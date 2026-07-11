# Supabase Backend Skeleton

This folder holds the database schema and Edge Function boundary for the Policy Impact Terminal. The production frontend reads Supabase only; local mock data is available only when `VITE_ENABLE_MOCK=true` is set explicitly.

> Architecture transition: the current production contract still stores the full report in `policies.metadata.reportPayload`. Stage 7 has completed immutable source/revision/projection infrastructure and a deployment-ready 20-report shadow package. Stage 8 has added typed Edge boundaries, transactional publish/rollback, immutable command/event audit, model-token reservation/finalization, and two admin-only Edge candidates. None of the Stage 7/8 migrations or new functions has been deployed to Supabase production, and no live read/write path has switched. Until staging and production acceptance are complete, the remainder of this README continues to describe the live compatibility path.

## 1. Apply Schema

Run the versioned migrations:

```powershell
supabase db push
```

The authoritative deployable database history is the ordered set under `supabase/migrations/`. The initial schema is `20260510000000_initial_schema.sql`; Stage 7 adds `20260710010000_stage7_revision_projection_core.sql`; Stage 8 adds `20260710020000_stage8_transactional_revision_lifecycle.sql`, `20260710021000_stage8_model_budget_enforcement.sql`, `20260710022000_stage8_invite_account_governance.sql`, and `20260710023000_stage8_account_deletion_workflow.sql`; Stage 9 adds `20260711010000_stage9_limited_collection_queue.sql`. `supabase/schema.sql` is a historical consolidated snapshot and must not be deployed alone or manually maintained as a second schema source.

The official source seed is checked in as `supabase/migrations/20260510001000_seed_policy_sources.sql`, so a fresh database receives the crawler source registry during `supabase db push`.

Before any Stage 7 production push, run:

```powershell
npm run stage7:test
npm run stage7:source-fetch -- --require-all
npm run stage7:evidence-audit
npm run stage7:shadow -- --source-documents=artifacts/stage7/official-source-documents.json --require-deployment-ready
npm run stage7:migration-test
npm run stage7:migration-test -- --shadow-package=artifacts/stage7/report-revision-shadow.json
npm run auth:test
npm run workflow:test
npm run workflow:generated-check
npm run production:guard:test
npm run backup:guard:test
npm run backup:crypto:test
npm run production:source-guard:test
npm run edge:typecheck
npm run edge:test
npm run stage7:diff -- --before=<old.json> --after=<new.json>
```

Official source documents, source-evidence audit files, and the shadow package are ignored local artifacts. The verified source is the official page plus its directly mounted official attachments; the legacy production `full_text` is a migration comparison input and must not silently replace a more complete official composite source. The current 20-report package passes source, payload, projection, table-level RLS roles, PostgreSQL execution, bulk-load, rollback and idempotence tests. The user does not permit any additional paid resources, so no Preview Branch or paid staging project may be created. Before `supabase db push`, the existing production project must pass read-only source comparison, encrypted logical backup plus restore verification, production readiness audit, exact-target confirmation and explicit deployment approval.

Protected database-load validation:

```powershell
npm run production:readiness:audit
npm run production:source-export
npm run backup:production
npm run stage7:db-load -- --actor-id=<admin-uuid> --target=production
```

All commands above default to validation-only behavior. The source export and backup require separate read-only confirmations and transient credentials. The database loader and `setup:production` remain blocked until the 24-hour readiness report has `productionWriteReady=true` and no blockers. Exact-host checks, backup encryption, restore requirements, confirmation phrases and postflight checks are defined in `docs/architecture/stage-7-supabase-deployment-runbook-v1.0.md` and `docs/architecture/zero-cost-production-readiness-audit-v1.0.md`.

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
- `policy_actions`, `policy_clauses`, `industry_nodes`, `industry_edges`, `companies`, `evidence`: legacy normalized-table draft retained for the current production compatibility path.
- `policy_source_documents`, `policy_source_segments`: immutable original-text versions and deterministic source segments.
- `report_revisions`: immutable complete report payloads with content, source, schema, analysis, and projection hashes; published and superseded history remains readable through controlled RPCs.
- `report_policy_actions`, `report_industry_nodes`, `report_industry_edges`, `report_company_relations`, `report_policy_network_relations`, `report_evidence_refs`, `report_signals`: revision-scoped rebuildable projections, never independent report facts.
- `company_evidence_cards`: demand-driven reusable company fact evidence, not a full-market company database.
- `model_usage_ledger`, `model_budget_periods`, `system_config_versions`: auditable Token use, hard budget reservation/settlement, and versioned non-secret architecture configuration.
- `report_revision_commands`, `report_revision_events`: immutable idempotency and audit history for transactional publication and rollback.
- `account_lifecycle_events`, `account_deletion_requests`: immutable suspension/reactivation/retention audit and recoverable two-phase hard-deletion workflow; invited, suspended and deletion-prepared profiles are denied report reads.

RLS is enabled. Normal browser clients use the anon key and authenticated user session. Under the Stage 7 target contract, browsers receive read access only to published/superseded projection tables and client-visible config; full revision payloads and history metadata are returned by security-definer RPCs. Original source versions, projection runs, company evidence cards, Token ledger, and every Stage 7 write remain server-side. Edge Functions use the service role key only after verifying an active admin JWT or the crawler secret.

The current source document may be newer than the current published report. This is a valid stale-report state: revision reads return `isSourceCurrent=false` instead of blocking source ingestion or overwriting the old report. The Stage 8 repository contract provides controlled transactional publication, rollback and Token preflight, but production reanalysis orchestration is not yet switched.

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

The production UI is read-only for normal users. Do not expose browser-side job creation for public users; scheduled GitHub Actions should run the crawler with `--ingest` and call Edge Functions with the crawler secret. Analysis is triggered from a Codex conversation with `scripts/manual-policy-analysis.mjs`.

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

The scheduled GitHub crawler runs `node scripts/crawl-policy-sources.mjs --preflight` before crawling. That preflight validates the Edge Function crawler secret, `CRAWLER_OWNER_ID`, active admin profile, and seeded active `policy_sources` rows. The crawl job then runs `scripts/crawl-policy-sources.mjs --ingest` with `--since=2026-05-01` by default, storing original policy text in `policies.full_text` and leaving report analysis unpublished until the Codex manual workflow applies it.

## 4. Current Flow

The intended production flow is:

1. `ingest`: create a draft `policies` row for an original policy published on or after 2026-05-01 and persist deterministic L0—L3 triage metadata. L1 records are archived without an analysis task; at most eight L2/L3 records remain in the high-value review pool and at most three selected records create `analysis_jobs`. Duplicate crawls merge stronger triage metadata and reuse the latest existing job instead of generating repeated jobs. The response includes `policyId`, `policyRef.id`, and `job.policy_id` when a task is actually created. If the request includes `externalId` or `external_id`, ingest writes `policies.external_id` when that column exists; on older schemas it falls back to `policies.metadata.externalId` / `metadata.external_id` and still returns `policyExternalId`.
2. `manual list`: run `npm run manual:policies -- list --limit=10` to find policies that still need Codex manual analysis.
3. `manual get`: run `npm run manual:policies -- get --policyId=<policy-uuid>` to read metadata and `policies.full_text` into the Codex conversation.
4. `manual apply`: run `npm run manual:policies -- apply --policyId=<policy-uuid> --file=artifacts/manual-report-payload.json` to write the reviewed `reportPayload`, set `analysis_version = 'codex-manual-v1'`, mark the policy `published`, and update the linked job when one exists.

When local function secrets are unavailable, commit reviewed payloads under `manual-reports/*.json` and trigger `.github/workflows/apply-manual-analysis.yml` with the policy UUID and report file path. The workflow uses repository secrets and still calls the same `applyManualAnalysis` Edge Function.

Normal users only browse policies that have reached `status = 'published'` through the manual apply step. Database RLS enforces the same public boundary through `public.can_read_policy`: non-admin users can read only policies with `analysis_version = 'codex-manual-v1'` and `publish_date >= '2026-05-01'`.

See `supabase/functions/README.md` for request/response examples and deployment commands.

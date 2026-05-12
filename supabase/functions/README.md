# Supabase Edge Functions

This directory contains the deployable MVP function boundary for moving the mock prototype toward a real Supabase job flow. The current production path separates collection from analysis: scheduled crawls only ingest original policy text published on or after 2026-05-01, and Codex-driven manual analysis writes the final report payload back through `analyze`.

## Auth Contract

- All functions accept `POST` plus `OPTIONS` for CORS.
- Deploy with Supabase JWT verification enabled unless there is a deliberate server-to-server wrapper.
- Manual calls must include an active admin user's access token: `Authorization: Bearer <admin-user-access-token>`.
- Scheduled crawler calls include a JWT accepted by Supabase Edge Functions plus `x-crawler-secret`.
- The function runtime uses `SUPABASE_SERVICE_ROLE_KEY` only server-side, after checking the caller. Never expose the service role key to Vite, browser code, or manual client calls.
- `ingest`, `analyze`, and `publish` are privileged write operations. Normal authenticated users are read-only and only browse published analyses.
- The scheduled crawler calls `ingest` only. Codex manual analysis uses the `analyze` manual `list/get/apply` operations.

## Functions

### `ingest`

Input:

```json
{
  "sourceUrl": "https://www.gov.cn/example/policy.html",
  "title": "Policy title",
  "sourceName": "gov.cn",
  "sourceKey": "gov_zhengce_latest",
  "externalId": "optional-upstream-policy-id",
  "issuer": "政策发布机构",
  "publishDate": "2024-05-28",
  "policyNo": "国办发〔2024〕12号",
  "contentHash": "optional-normalized-full-text-hash",
  "fullText": "optional extracted policy full text",
  "inputPayload": {}
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Rejects policies without `publishDate >= 2026-05-01`.
- Rejects ingest requests that do not include extracted original policy `fullText` of at least 280 characters.
- Links the policy to `policy_sources` by `sourceKey/source_key` when provided, otherwise by matching the submitted URL host against active source registry rows.
- Creates a `policies` row with `status = 'draft'`.
- Returns frontend-usable policy identifiers as `policyId`, `policyRef.id`, and `job.policy_id`.
- If `externalId` or `external_id` is present, writes `policies.external_id` when the deployed schema supports that column. If the column is absent, ingest falls back to `policies.metadata.externalId` / `metadata.external_id` and still returns `policyExternalId`.
- Builds `dedupe_key` from `policyNo/policy_no`, otherwise normalized `title + issuer + publishDate`, otherwise normalized URL.
- Checks existing canonical policies by `dedupe_key` and `contentHash/content_hash`. When a duplicate is detected, returns `{ duplicate: true, policyId, policyRef, policy, job, next: [] }` and does not create a second policy row.
- Creates an `analysis_jobs` row with `status = 'queued'`, `progress = 8`, and the normalized request in `input_payload`.
- Returns `{ policyId, policyExternalId, policyRef, policy, job, next: ["analyze"] }`; the scheduled crawler stops here and leaves analysis for the manual Codex workflow.

### `analyze`

`analyze` is the authenticated control plane used by `scripts/manual-policy-analysis.mjs`. The current workflow is manual:

1. List policies waiting for Codex analysis.
2. Fetch one policy's metadata and `full_text`.
3. Apply a reviewed `reportPayload`, marking the policy published.

List input:

```json
{
  "listPendingManualAnalysis": true,
  "limit": 10,
  "sincePublishDate": "2026-05-01"
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Lists policies with `publish_date >= sincePublishDate` that have not yet been marked with `codex-manual-v1`.
- Returns `{ mode, sincePublishDate, count, policies }`.

Get input:

```json
{
  "getManualAnalysisPolicy": true,
  "policyId": "policy-uuid"
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Requires the policy to be in the active manual scope: `publish_date >= 2026-05-01` and status `draft`, `reviewing`, or `published`.
- Returns policy metadata plus `fullText` for Codex to analyze in the conversation.

Apply input:

```json
{
  "applyManualAnalysis": true,
  "policyId": "policy-uuid",
  "reportPayload": {
    "brief": { "judgement": "Codex-written policy conclusion..." },
    "actions": [],
    "clauses": [],
    "chainNodes": [],
    "companies": [],
    "evidence": [],
    "backgroundCards": []
  }
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Rejects empty or template-only payloads. A publishable manual report must include a real `brief.judgement`, policy actions, interpreted clauses, industry-chain impact nodes, evidence, factual background, and either representative companies or an explicit company-impact no-match explanation in `analysisCoverage`.
- Normalizes the submitted manual `reportPayload`.
- Writes `metadata.reportPayload`, `metadata.policyReport`, `metadata.analysis`, counts, summary, category, confidence, and `analysis_version = 'codex-manual-v1'`.
- Moves the policy to `status = 'published'` and marks the latest linked analysis job as `published` when present.
- Returns `{ policyId, analyzerVersion, published, jobUpdated, jobId, reportPayload }`.

The function stores the Codex-reviewed result; it does not derive production reports during scheduled crawling. Legacy rules-analysis request shapes are disabled in production unless the Edge Function has `ALLOW_RULES_ANALYSIS=true` set server-side and the request also explicitly opts in. Do not enable that for normal operation.

### `publish`

The current scheduled/manual architecture does not call `publish` after crawling. `applyManualAnalysis` publishes the policy when it writes the reviewed Codex report payload. The standalone `publish` function is locked down: it only accepts jobs whose linked policy already has `analysis_version = 'codex-manual-v1'` and `publish_date >= 2026-05-01`.

Input:

```json
{
  "jobId": "analysis-job-uuid"
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Requires the job to have a linked `policy_id`.
- Requires the analyze stage to have written `analysis_jobs.output_payload.analysisStub`.
- Moves the policy to `status = 'published'` and sets `published_at`.
- Moves the job to `status = 'published'`, `progress = 100`.
- Returns `{ policy, job }`.

## Deploy

```powershell
supabase functions deploy ingest
supabase functions deploy analyze
supabase functions deploy publish
```

Required secrets:

```powershell
supabase secrets set SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set CRAWLER_INGEST_SECRET=strong-random-shared-secret
supabase secrets set CRAWLER_OWNER_ID=admin-profile-user-uuid
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to Vite or browser code.

## Manual Calls

Use a real admin user access token or the configured crawler secret, not the service role key. The supported manual analysis client is `scripts/manual-policy-analysis.mjs`:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ACCESS_TOKEN=admin-user-jwt
# or
SUPABASE_FUNCTION_JWT=your-supabase-anon-key-or-function-jwt
SUPABASE_CRAWLER_SECRET=strong-random-shared-secret
```

```powershell
npm run manual:policies -- list --limit=10
npm run manual:policies -- get --policyId=<policy-uuid>
npm run manual:validate -- artifacts/manual-report-payload.json
npm run manual:policies -- apply --policyId=<policy-uuid> --file=artifacts/manual-report-payload.json
```

## Frontend

The production frontend is read-only for normal users. Scheduled GitHub Actions call `scripts/crawl-policy-sources.mjs --ingest`; Codex manual analysis publishes reports later through `scripts/manual-policy-analysis.mjs list/get/apply`.

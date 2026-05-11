# Supabase Edge Functions

This directory contains the deployable MVP function boundary for moving the mock prototype toward a real Supabase job flow. The functions do not call an LLM yet; `analyze` generates a rules-based baseline report payload from stored policy text so scheduled crawls can publish readable reports.

## Auth Contract

- All functions accept `POST` plus `OPTIONS` for CORS.
- Deploy with Supabase JWT verification enabled unless there is a deliberate server-to-server wrapper.
- Manual calls must include an active admin user's access token: `Authorization: Bearer <admin-user-access-token>`.
- Scheduled crawler calls include a JWT accepted by Supabase Edge Functions plus `x-crawler-secret`.
- The function runtime uses `SUPABASE_SERVICE_ROLE_KEY` only server-side, after checking the caller. Never expose the service role key to Vite, browser code, or manual client calls.
- `ingest`, `analyze`, and `publish` are admin/crawler-write operations. Normal authenticated users are read-only.

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
- Links the policy to `policy_sources` by `sourceKey/source_key` when provided, otherwise by matching the submitted URL host against active source registry rows.
- Creates a `policies` row with `status = 'draft'`.
- Returns frontend-usable policy identifiers as `policyId`, `policyRef.id`, and `job.policy_id`.
- If `externalId` or `external_id` is present, writes `policies.external_id` when the deployed schema supports that column. If the column is absent, ingest falls back to `policies.metadata.externalId` / `metadata.external_id` and still returns `policyExternalId`.
- Builds `dedupe_key` from `policyNo/policy_no`, otherwise normalized `title + issuer + publishDate`, otherwise normalized URL.
- Checks existing canonical policies by `dedupe_key` and `contentHash/content_hash`. When a duplicate is detected, returns `{ duplicate: true, policyId, policyRef, policy, job, next: [] }` and does not create a second policy row.
- Creates an `analysis_jobs` row with `status = 'queued'`, `progress = 8`, and the normalized request in `input_payload`.
- Returns `{ policyId, policyExternalId, policyRef, policy, job, next: ["analyze"] }`.

### `analyze`

Input:

```json
{
  "jobId": "analysis-job-uuid"
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Reads the linked `policies.full_text` and generates a rules-based `metadata.reportPayload`.
- Moves the job to `status = 'analyzing'`, `progress = 85`.
- Moves the linked policy to `status = 'reviewing'`.
- Rejects already published or failed jobs.
- Returns `{ job, analysis, next: ["publish"] }`.

Published-policy refresh input:

```json
{
  "reanalyzePublished": true,
  "limit": 30
}
```

Behavior:

- Authenticates an active admin caller or verifies the scheduled crawler secret.
- Uses the server-side service role client to list the latest `status = 'published'` policies.
- Rebuilds `metadata.reportPayload` for each policy from stored `policies.full_text`.
- Keeps policies published; it only updates analysis metadata, confidence, category, summary, and counts.
- Skips policies whose original full text is missing or too short.
- Returns `{ selected, reanalyzed, skipped, failed, results }`.

Current limitation: this is a baseline rules analyzer, not a full LLM/policy expert analyzer. It creates a usable report shell from policy text, but company-level and deep industry conclusions should be upgraded later.

### `publish`

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

Use a real admin user access token, not the service role key:

```powershell
$ProjectUrl = "https://your-project-ref.supabase.co"
$AnonKey = "your-anon-key"
$AccessToken = "admin-user-access-token-from-auth-session"
$Headers = @{
  Authorization = "Bearer $AccessToken"
  apikey = $AnonKey
}

$Ingest = Invoke-RestMethod `
  -Method Post `
  -Uri "$ProjectUrl/functions/v1/ingest" `
  -Headers $Headers `
  -ContentType "application/json" `
  -Body (@{
    sourceUrl = "https://www.gov.cn/example/policy.html"
    title = "Policy title"
    sourceName = "gov.cn"
    externalId = "gov-policy-2024-001"
  } | ConvertTo-Json)

$JobId = $Ingest.job.id

Invoke-RestMethod `
  -Method Post `
  -Uri "$ProjectUrl/functions/v1/analyze" `
  -Headers $Headers `
  -ContentType "application/json" `
  -Body (@{ jobId = $JobId } | ConvertTo-Json)

Invoke-RestMethod `
  -Method Post `
  -Uri "$ProjectUrl/functions/v1/publish" `
  -Headers $Headers `
  -ContentType "application/json" `
  -Body (@{ jobId = $JobId } | ConvertTo-Json)
```

## Frontend

The production frontend is read-only for normal users. Scheduled GitHub Actions should call `scripts/crawl-policy-sources.mjs --auto-publish` instead of allowing users to create analysis jobs from the browser.

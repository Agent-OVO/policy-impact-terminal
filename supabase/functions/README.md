# Supabase Edge Functions

This directory contains the Edge Function boundary for policy collection, the current manual report compatibility path, and the Stage 8 revision/token governance candidates. Production still separates collection from analysis: scheduled crawls ingest original policy text, and Codex-driven manual analysis currently writes the reviewed report payload through `analyze`. The new `revision-lifecycle` and `model-budget` functions are repository-complete but must not be deployed before the Stage 7/8 migrations pass Supabase staging acceptance.

## Auth Contract

- All functions accept `POST` plus `OPTIONS` for CORS.
- Deploy with Supabase JWT verification enabled unless there is a deliberate server-to-server wrapper.
- Manual calls must include an active admin user's access token: `Authorization: Bearer <admin-user-access-token>`.
- Scheduled crawler calls include a JWT accepted by Supabase Edge Functions plus `x-crawler-secret`.
- The function runtime uses `SUPABASE_SERVICE_ROLE_KEY` only server-side, after checking the caller. Never expose the service role key to Vite, browser code, or manual client calls.
- `ingest`, `analyze`, and `publish` are privileged write operations. Normal authenticated users are read-only and only browse published analyses.
- The scheduled crawler calls `ingest` only. Codex manual analysis uses the `analyze` manual `list/get/apply` operations.
- `revision-lifecycle` and `model-budget` require a real active admin JWT. They do not accept the crawler secret as an alternative identity and never accept a client-supplied actor ID.
- Both Stage 8 functions call service-role-only database RPCs after admin verification; browser clients cannot invoke those RPCs directly.

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
- Accepts deterministic `analysisDepth`, `reviewPriority`, queue eligibility, selection, reasons and signal fields from the fixed-source crawler and stores them in policy metadata.
- L0 records are removed before ingest; L1 records create only the draft policy original; L2/L3 may enter the eight-item review pool, while only the three records selected for the current run create `analysis_jobs`.
- Checks existing canonical policies by `dedupe_key` and `contentHash/content_hash`. A duplicate merges the stronger triage state without downgrading an existing priority, reuses the latest analysis job when present, and never creates a second policy row.
- A newly selected analysis task uses `status = 'queued'`, `progress = 8`, and the normalized request in `input_payload`; deferred or archive-only records return `job: null` and `next: []`.
- The scheduled crawler stops after original-text ingest and queue creation; it never generates or publishes a report automatically.

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

### `revision-lifecycle` — Stage 8 candidate, not deployed

Input examples:

```json
{
  "action": "publish",
  "policyId": "policy-uuid",
  "revisionId": "approved-revision-uuid",
  "idempotencyKey": "publish:policy:revision:request-001",
  "expectedCurrentRevisionId": "current-revision-uuid"
}
```

```json
{
  "action": "rollback",
  "policyId": "policy-uuid",
  "revisionId": "superseded-revision-uuid",
  "idempotencyKey": "rollback:policy:revision:request-001",
  "expectedCurrentRevisionId": "current-revision-uuid"
}
```

Behavior:

- Requires an active admin JWT; crawler-secret authentication is not allowed.
- Derives `actor_id` from the verified session and ignores no client actor field because none is accepted.
- Calls the service-role-only `publish_report_revision` or `rollback_report_revision` RPC.
- The RPC locks the policy row, checks optimistic current revision, validates projection state, writes immutable command/event audit records, and performs publication or rollback atomically.
- Idempotent replay returns the existing result; a reused key with different parameters is rejected.

### `model-budget` — Stage 8 candidate, not deployed

Reserve input:

```json
{
  "action": "reserve",
  "policyId": "optional-policy-uuid",
  "revisionId": "optional-revision-uuid",
  "operationType": "policy_analysis",
  "provider": "openai",
  "model": "model-name",
  "promptVersion": "prompt-v1",
  "requestHash": "64-character-sha256",
  "budgetClass": "L2",
  "triggerReason": "high-value policy analysis",
  "plannedInputTokens": 7000,
  "plannedOutputTokens": 2000,
  "metadata": {}
}
```

Finalize input:

```json
{
  "action": "finalize",
  "usageId": "usage-ledger-uuid",
  "inputTokens": 6500,
  "outputTokens": 1600,
  "cachedTokens": 500,
  "status": "succeeded",
  "metadata": {}
}
```

Behavior:

- Requires an active admin JWT and calls only service-role-only budget RPCs.
- Does not call a model. It only reserves or finalizes auditable budget usage.
- L0/L1 are blocked with zero tokens; L2/L3 enforce per-call hard limits and monthly reservation; exception calls require a reason.
- Finalization releases reservations, records actual/cache/effective tokens, and forces an actual hard-limit overrun to `failed`.

### `account-governance` — Stage 8 candidate, not deployed

Supported actions:

```json
{
  "action": "suspend",
  "targetUserId": "user-uuid",
  "reason": "access revoked by administrator"
}
```

```json
{
  "action": "reactivate",
  "targetUserId": "user-uuid",
  "reason": "access restored after review"
}
```

```json
{
  "action": "purgeEvents",
  "referenceTime": "2026-07-10T00:00:00Z"
}
```

```json
{
  "action": "delete",
  "targetUserId": "user-uuid",
  "requestKey": "delete:user-uuid:request-001",
  "reason": "approved account deletion",
  "confirmation": "DELETE:user-uuid"
}
```

Behavior:

- Requires an active admin JWT and derives the actor from the verified session.
- Calls only service-role-only account-governance RPCs.
- Suspended and invited profiles cannot read published reports even if an old session token still exists.
- Administrators cannot suspend themselves; audit events are immutable.
- User behavior events use the active retention configuration, initially 90 days.
- Hard deletion uses a two-phase workflow. Phase one creates an idempotent request, locks the profile in `deleted` status, blocks reads, and records immutable audit. The Edge function then deletes the Auth user. Phase two records success only after the Auth foreign key has been removed; an Auth failure restores the prior profile status and records `deletion_failed`.
- The request requires an exact `DELETE:<targetUserId>` confirmation, a unique request key, and a reason. Self-deletion and deletion of the last active administrator are rejected.
- If the Auth user was deleted but finalization was interrupted, repeating the same request safely detects the missing Auth user and completes the existing prepared request.

### `publish` — legacy compatibility

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

# Only after Stage 7/8 migrations and Supabase staging acceptance:
supabase functions deploy revision-lifecycle
supabase functions deploy model-budget
supabase functions deploy account-governance
```

Required secrets:

```powershell
supabase secrets set SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set CRAWLER_INGEST_SECRET=strong-random-shared-secret
supabase secrets set CRAWLER_OWNER_ID=admin-profile-user-uuid
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to Vite or browser code. Do not deploy the Stage 8 functions before their RPCs exist in the target database; otherwise they intentionally return an unavailable RPC error rather than falling back to non-transactional writes.

## Type and Boundary Checks

```powershell
npm run edge:typecheck
npm run edge:test
npm run stage7:migration-test
```

The database type baseline in `_shared/database.types.ts` reflects the production schema before Stage 7 deployment and covers the tables used by current functions. After staging migration, regenerate the complete Supabase type file and replace the provisional Stage 8 RPC type extension.

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

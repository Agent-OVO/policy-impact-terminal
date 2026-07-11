#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildShadowPackage } from "./lib/report-revision-core.mjs";
import { applyStage7ShadowPackage } from "./lib/stage7-shadow-database-loader.mjs";

const args = parseArgs(process.argv.slice(2));
const modulePath = path.resolve(args.pgliteModule);
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();

await db.exec(bootstrapSql());
const stage7Migration = await fs.readFile(path.resolve(args.migration), "utf8");
const stage8Migration = await fs.readFile(path.resolve(args.stage8Migration), "utf8");
const stage8BudgetMigration = await fs.readFile(path.resolve(args.stage8BudgetMigration), "utf8");
const stage8AccountMigration = await fs.readFile(path.resolve(args.stage8AccountMigration), "utf8");
const stage8DeletionMigration = await fs.readFile(path.resolve(args.stage8DeletionMigration), "utf8");
const stage9CollectionMigration = await fs.readFile(path.resolve(args.stage9CollectionMigration), "utf8");
await db.exec(stage7Migration);
await db.exec(stage8Migration);
await db.exec(stage8BudgetMigration);
await db.exec(stage8AccountMigration);
await db.exec(stage8DeletionMigration);
await db.exec(stage9CollectionMigration);

await assertCatalog(db);
await assertLifecycle(db);
await assertTransactionalCommands(db);
await assertModelBudgetEnforcement(db);
await assertInviteAccountGovernance(db);
await assertAccountDeletionWorkflow(db);
await assertLimitedCollectionQueue(db);
await assertTableLevelRls(db);
await assertBulkShadowMigration(db, args.shadowPackage);
await db.close();
console.log("[stage9:pglite] migrations, lifecycle commands, limited review queue, table-level RLS roles, 20-report bulk load, and idempotence assertions passed");

async function assertCatalog(database) {
  const expectedTables = [
    "policy_source_documents",
    "policy_source_segments",
    "report_revisions",
    "report_projection_runs",
    "report_policy_actions",
    "report_industry_nodes",
    "report_industry_edges",
    "report_company_relations",
    "report_policy_network_relations",
    "report_evidence_refs",
    "report_signals",
    "company_evidence_cards",
    "report_company_evidence_refs",
    "model_usage_ledger",
    "system_config_versions",
    "report_revision_commands",
    "report_revision_events",
    "model_budget_periods",
    "account_lifecycle_events",
    "account_deletion_requests"
  ];
  const tableRows = await database.query(
    "select tablename from pg_tables where schemaname = 'public' and tablename = any($1::text[]) order by tablename",
    [expectedTables]
  );
  assert.deepEqual(tableRows.rows.map((item) => item.tablename), [...expectedTables].sort());

  const policyColumns = await database.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name='policies'"
  );
  const columnSet = new Set(policyColumns.rows.map((item) => item.column_name));
  for (const name of ["current_source_document_id", "current_published_revision_id", "current_draft_revision_id"]) {
    assert.ok(columnSet.has(name), `policies.${name} must exist`);
  }

  const functions = await database.query(
    "select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public'"
  );
  const functionSet = new Set(functions.rows.map((item) => item.proname));
  for (const name of [
    "can_read_report_revision",
    "is_report_revision_source_current",
    "get_current_report_revision",
    "get_report_revision",
    "list_report_revisions",
    "get_active_system_config",
    "publish_report_revision",
    "rollback_report_revision",
    "reserve_model_usage",
    "finalize_model_usage",
    "is_active_user",
    "set_user_account_status",
    "purge_expired_user_events",
    "prepare_account_deletion",
    "finalize_account_deletion",
    "list_pending_policy_analysis",
  ]) {
    assert.ok(functionSet.has(name), `function ${name} must exist`);
  }
}

async function assertLifecycle(database) {
  const adminId = "00000000-0000-0000-0000-000000000001";
  const policyId = "00000000-0000-0000-0000-000000000101";
  const documentId1 = "00000000-0000-0000-0000-000000000201";
  const documentId2 = "00000000-0000-0000-0000-000000000202";
  const revisionId1 = "00000000-0000-0000-0000-000000000301";
  const revisionId2 = "00000000-0000-0000-0000-000000000302";
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const contentHash1 = "c".repeat(64);
  const contentHash2 = "d".repeat(64);
  const projectionHash1 = "e".repeat(64);
  const projectionHash2 = "f".repeat(64);

  await database.exec(`
    set request.jwt.claim.sub = '${adminId}';
    insert into auth.users(id) values ('${adminId}');
    insert into public.profiles(id, role, status) values ('${adminId}', 'admin', 'active');
    insert into public.policies(id, title, status, analysis_version, publish_date)
    values ('${policyId}', '测试政策', 'published', 'codex-manual-v1', date '2026-07-10');

    insert into public.policy_source_documents(
      id, policy_id, source_url, normalized_text, source_document_hash, parser_version, fetched_at
    ) values (
      '${documentId1}', '${policyId}', 'https://www.gov.cn/test', '第一版测试政策原文，长度用于迁移测试。', '${hashA}', 'test-parser', now()
    );

    insert into public.report_revisions(
      id, policy_id, status, payload, schema_version, analysis_version, projection_version,
      source_document_hash, content_hash, change_summary, change_reason, created_by
    ) values (
      '${revisionId1}', '${policyId}', 'draft', '{"id":"test-v1"}'::jsonb,
      'report-schema-v1.1', 'codex-manual-v1', 'policy-projection-v1',
      '${hashA}', '${contentHash1}', '初始版本', 'pglite_test', '${adminId}'
    );

    insert into public.report_projection_runs(
      policy_id, revision_id, projection_version, status, started_at, finished_at,
      row_counts, projection_hash
    ) values (
      '${policyId}', '${revisionId1}', 'policy-projection-v1', 'succeeded', now(), now(),
      '{"policyActions":1}'::jsonb, '${projectionHash1}'
    );
    insert into public.report_policy_actions(
      policy_id, revision_id, projection_version, action_key, title, signal, evidence_level
    ) values (
      '${policyId}', '${revisionId1}', 'policy-projection-v1', 'a1', '测试动作', 'positive', 'strong'
    );

    update public.report_revisions set status='in_review' where id='${revisionId1}';
    update public.report_revisions
      set status='approved', reviewed_by='${adminId}', reviewed_at=now()
      where id='${revisionId1}';
    update public.report_revisions
      set status='published', published_at=now(), projection_hash='${projectionHash1}'
      where id='${revisionId1}';
    update public.policies
      set current_source_document_id='${documentId1}', current_published_revision_id='${revisionId1}'
      where id='${policyId}';
  `);

  const current1 = await database.query("select public.get_current_report_revision($1::uuid) as value", [policyId]);
  assert.equal(current1.rows[0].value.revisionId, revisionId1);
  assert.equal(current1.rows[0].value.isSourceCurrent, true);

  await expectFailure(
    database,
    `update public.report_revisions set payload='{"id":"tampered"}'::jsonb where id='${revisionId1}'`,
    "immutable revision payload"
  );
  await expectFailure(
    database,
    `update public.report_policy_actions set title='篡改动作' where revision_id='${revisionId1}'`,
    "published projection immutability"
  );

  await database.exec(`
    insert into public.policy_source_documents(
      id, policy_id, parent_document_id, source_url, normalized_text, source_document_hash,
      parser_version, fetched_at
    ) values (
      '${documentId2}', '${policyId}', '${documentId1}', 'https://www.gov.cn/test-v2',
      '第二版测试政策原文，长度用于迁移测试。', '${hashB}', 'test-parser', now()
    );
    update public.policies set current_source_document_id='${documentId2}' where id='${policyId}';
  `);
  const stale = await database.query("select public.get_current_report_revision($1::uuid) as value", [policyId]);
  assert.equal(stale.rows[0].value.isSourceCurrent, false);

  await database.exec(`
    insert into public.report_revisions(
      id, policy_id, parent_revision_id, status, payload, schema_version, analysis_version,
      projection_version, source_document_hash, content_hash, change_summary, change_reason, created_by
    ) values (
      '${revisionId2}', '${policyId}', '${revisionId1}', 'draft', '{"id":"test-v2"}'::jsonb,
      'report-schema-v1.1', 'codex-manual-v1', 'policy-projection-v1',
      '${hashB}', '${contentHash2}', '第二版', 'source_changed', '${adminId}'
    );
    insert into public.report_projection_runs(
      policy_id, revision_id, projection_version, status, started_at, finished_at,
      row_counts, projection_hash
    ) values (
      '${policyId}', '${revisionId2}', 'policy-projection-v1', 'succeeded', now(), now(),
      '{"policyActions":1}'::jsonb, '${projectionHash2}'
    );
    insert into public.report_policy_actions(
      policy_id, revision_id, projection_version, action_key, title, signal, evidence_level
    ) values (
      '${policyId}', '${revisionId2}', 'policy-projection-v1', 'a1', '第二版动作', 'positive', 'strong'
    );
    update public.report_revisions set status='in_review' where id='${revisionId2}';
    update public.report_revisions
      set status='approved', reviewed_by='${adminId}', reviewed_at=now()
      where id='${revisionId2}';
    update public.report_revisions set status='superseded' where id='${revisionId1}';
    update public.report_revisions
      set status='published', published_at=now(), projection_hash='${projectionHash2}'
      where id='${revisionId2}';
    update public.policies set current_published_revision_id='${revisionId2}' where id='${policyId}';
  `);

  const current2 = await database.query("select public.get_current_report_revision($1::uuid) as value", [policyId]);
  assert.equal(current2.rows[0].value.revisionId, revisionId2);
  assert.equal(current2.rows[0].value.isSourceCurrent, true);
  const history = await database.query("select public.list_report_revisions($1::uuid) as value", [policyId]);
  assert.equal(history.rows[0].value.length, 2);

  await database.exec(`
    update public.report_revisions set status='superseded' where id='${revisionId2}';
    update public.report_revisions set status='published' where id='${revisionId1}';
    update public.policies set current_published_revision_id='${revisionId1}' where id='${policyId}';
  `);
  const rolledBack = await database.query("select public.get_current_report_revision($1::uuid) as value", [policyId]);
  assert.equal(rolledBack.rows[0].value.revisionId, revisionId1);
  assert.equal(rolledBack.rows[0].value.isSourceCurrent, false);

  await database.exec(`
    insert into public.model_usage_ledger(
      id, policy_id, revision_id, operation_type, model, input_tokens, output_tokens,
      cached_tokens, budget_class, trigger_reason, status
    ) values (
      '00000000-0000-0000-0000-000000000401', '${policyId}', '${revisionId1}',
      'evidence_review', 'test-model', 1000, 200, 100, 'L2', 'migration test', 'planned'
    );
    update public.model_usage_ledger
      set status='succeeded'
      where id='00000000-0000-0000-0000-000000000401';
  `);
  await expectFailure(
    database,
    "update public.model_usage_ledger set input_tokens=9999 where id='00000000-0000-0000-0000-000000000401'",
    "model ledger identity immutability"
  );
}

async function assertTransactionalCommands(database) {
  const adminId = "00000000-0000-0000-0000-000000000001";
  const policyId = "00000000-0000-0000-0000-000000000101";
  const revisionId1 = "00000000-0000-0000-0000-000000000301";
  const revisionId2 = "00000000-0000-0000-0000-000000000302";
  const revisionId3 = "00000000-0000-0000-0000-000000000303";
  const hashB = "b".repeat(64);
  const contentHash3 = "1".repeat(64);
  const projectionHash3 = "2".repeat(64);
  const rollbackKey = "stage8-rollback-command-0001";
  const publishKey = "stage8-publish-command-0001";

  const rollback = await database.query(
    `select public.rollback_report_revision($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid) as value`,
    [policyId, revisionId2, rollbackKey, adminId, revisionId1]
  );
  assert.equal(rollback.rows[0].value.command, "rollback");
  assert.equal(rollback.rows[0].value.previousRevisionId, revisionId1);
  assert.equal(rollback.rows[0].value.currentRevisionId, revisionId2);
  assert.equal(rollback.rows[0].value.changed, true);

  const rollbackReplay = await database.query(
    `select public.rollback_report_revision($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid) as value`,
    [policyId, revisionId2, rollbackKey, adminId, revisionId1]
  );
  assert.deepEqual(rollbackReplay.rows[0].value, rollback.rows[0].value);

  await database.exec(`
    insert into public.report_revisions(
      id, policy_id, parent_revision_id, status, payload, schema_version, analysis_version,
      projection_version, source_document_hash, content_hash, projection_hash,
      change_summary, change_reason, created_by, reviewed_by, reviewed_at
    ) values (
      '${revisionId3}', '${policyId}', '${revisionId2}', 'approved', '{"id":"test-v3"}'::jsonb,
      'report-schema-v1.1', 'codex-manual-v1', 'policy-projection-v1',
      '${hashB}', '${contentHash3}', '${projectionHash3}', '第三版', 'stage8_command_test',
      '${adminId}', '${adminId}', now()
    );
    insert into public.report_projection_runs(
      policy_id, revision_id, projection_version, status, started_at, finished_at,
      row_counts, projection_hash
    ) values (
      '${policyId}', '${revisionId3}', 'policy-projection-v1', 'succeeded', now(), now(),
      '{"policyActions":1}'::jsonb, '${projectionHash3}'
    );
    insert into public.report_policy_actions(
      policy_id, revision_id, projection_version, action_key, title, signal, evidence_level
    ) values (
      '${policyId}', '${revisionId3}', 'policy-projection-v1', 'a1', '第三版动作', 'positive', 'strong'
    );
  `);

  await expectFailure(
    database,
    `select public.publish_report_revision('${policyId}'::uuid, '${revisionId3}'::uuid, 'stage8-publish-wrong-current', '${adminId}'::uuid, '${revisionId1}'::uuid)`,
    "optimistic current revision check"
  );

  const publish = await database.query(
    `select public.publish_report_revision($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid) as value`,
    [policyId, revisionId3, publishKey, adminId, revisionId2]
  );
  assert.equal(publish.rows[0].value.command, "publish");
  assert.equal(publish.rows[0].value.previousRevisionId, revisionId2);
  assert.equal(publish.rows[0].value.currentRevisionId, revisionId3);
  assert.equal(publish.rows[0].value.changed, true);

  const publishReplay = await database.query(
    `select public.publish_report_revision($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid) as value`,
    [policyId, revisionId3, publishKey, adminId, revisionId2]
  );
  assert.deepEqual(publishReplay.rows[0].value, publish.rows[0].value);

  await expectFailure(
    database,
    `select public.rollback_report_revision('${policyId}'::uuid, '${revisionId1}'::uuid, '${publishKey}', '${adminId}'::uuid, '${revisionId3}'::uuid)`,
    "idempotency key reuse for different command"
  );

  const current = await database.query(
    `select current_published_revision_id::text as id from public.policies where id=$1::uuid`,
    [policyId]
  );
  assert.equal(current.rows[0].id, revisionId3);

  const auditCounts = await database.query(
    `select
       (select count(*)::int from public.report_revision_commands where policy_id=$1::uuid) as commands,
       (select count(*)::int from public.report_revision_events where policy_id=$1::uuid) as events`,
    [policyId]
  );
  assert.equal(auditCounts.rows[0].commands, 2);
  assert.equal(auditCounts.rows[0].events, 2);

  await expectFailure(
    database,
    `update public.report_revision_commands set result_payload='{}'::jsonb where command_key='${publishKey}'`,
    "revision command audit immutability"
  );
  await expectFailure(
    database,
    `delete from public.report_revision_events where policy_id='${policyId}'::uuid`,
    "revision event audit immutability"
  );
}

async function assertModelBudgetEnforcement(database) {
  const adminId = "00000000-0000-0000-0000-000000000001";
  const policyId = "00000000-0000-0000-0000-000000000101";
  const revisionId = "00000000-0000-0000-0000-000000000303";

  const zeroBudget = await reserve({
    hash: "3".repeat(64),
    budgetClass: "L0",
    plannedInput: 0,
    plannedOutput: 0,
    reason: "zero-token class test"
  });
  assert.equal(zeroBudget.allowed, false);
  assert.equal(zeroBudget.status, "blocked");
  assert.equal(zeroBudget.blockedReason, "zero_token_budget_class");

  const l2Reservation = await reserve({
    hash: "4".repeat(64),
    budgetClass: "L2",
    plannedInput: 6000,
    plannedOutput: 2000,
    reason: "L2 reservation test"
  });
  assert.equal(l2Reservation.allowed, true);
  assert.equal(l2Reservation.reservationTokens, 8000);

  const l2Replay = await reserve({
    hash: "4".repeat(64),
    budgetClass: "L2",
    plannedInput: 6000,
    plannedOutput: 2000,
    reason: "L2 reservation test"
  });
  assert.equal(l2Replay.usageId, l2Reservation.usageId);
  assert.equal(l2Replay.idempotentReplay, true);

  const finalized = await finalize({
    usageId: l2Reservation.usageId,
    input: 5000,
    output: 1500,
    cached: 500,
    status: "succeeded"
  });
  assert.equal(finalized.status, "succeeded");
  assert.equal(finalized.effectiveTokens, 6000);
  assert.equal(finalized.budgetViolation, false);

  const finalizedReplay = await finalize({
    usageId: l2Reservation.usageId,
    input: 5000,
    output: 1500,
    cached: 500,
    status: "succeeded"
  });
  assert.equal(finalizedReplay.idempotentReplay, true);

  await expectFailure(
    database,
    `select public.finalize_model_usage('${l2Reservation.usageId}'::uuid, 5001, 1500, 500, 'succeeded', '${adminId}'::uuid, '{}'::jsonb)`,
    "conflicting model usage finalization"
  );

  const perCallBlocked = await reserve({
    hash: "5".repeat(64),
    budgetClass: "L2",
    plannedInput: 11000,
    plannedOutput: 2000,
    reason: "per-call hard limit test"
  });
  assert.equal(perCallBlocked.allowed, false);
  assert.equal(perCallBlocked.blockedReason, "per_call_hard_limit_exceeded");

  const period = await database.query(
    `select period_start::text as period_start, reserved_effective_tokens, consumed_effective_tokens
     from public.model_budget_periods order by period_start desc limit 1`
  );
  assert.equal(period.rows[0].reserved_effective_tokens, 0);
  assert.equal(period.rows[0].consumed_effective_tokens, 6000);

  await database.query(
    `update public.model_budget_periods set effective_token_budget=6500 where period_start=$1::date`,
    [period.rows[0].period_start]
  );
  const monthlyBlocked = await reserve({
    hash: "6".repeat(64),
    budgetClass: "L2",
    plannedInput: 700,
    plannedOutput: 300,
    reason: "monthly hard limit test"
  });
  assert.equal(monthlyBlocked.allowed, false);
  assert.equal(monthlyBlocked.blockedReason, "monthly_hard_limit_exceeded");

  await database.query(
    `update public.model_budget_periods set effective_token_budget=300000 where period_start=$1::date`,
    [period.rows[0].period_start]
  );

  const exceptionReservation = await reserve({
    hash: "7".repeat(64),
    budgetClass: "exception",
    plannedInput: 30000,
    plannedOutput: 10000,
    reason: "approved emergency model operation",
    exceptionReason: "stage8 migration test exception"
  });
  assert.equal(exceptionReservation.allowed, true);
  assert.equal(exceptionReservation.reservationTokens, 0);
  const exceptionFinal = await finalize({
    usageId: exceptionReservation.usageId,
    input: 30000,
    output: 10000,
    cached: 0,
    status: "succeeded"
  });
  assert.equal(exceptionFinal.status, "succeeded");
  assert.equal(exceptionFinal.effectiveTokens, 40000);

  const hardLimitReservation = await reserve({
    hash: "8".repeat(64),
    budgetClass: "L2",
    plannedInput: 10000,
    plannedOutput: 2000,
    reason: "actual overrun audit test"
  });
  assert.equal(hardLimitReservation.allowed, true);
  const hardLimitFinal = await finalize({
    usageId: hardLimitReservation.usageId,
    input: 11000,
    output: 2000,
    cached: 0,
    status: "succeeded"
  });
  assert.equal(hardLimitFinal.status, "failed");
  assert.equal(hardLimitFinal.budgetViolation, true);

  const finalPeriod = await database.query(
    `select reserved_effective_tokens, consumed_effective_tokens, blocked_request_count
     from public.model_budget_periods order by period_start desc limit 1`
  );
  assert.equal(finalPeriod.rows[0].reserved_effective_tokens, 0);
  assert.equal(finalPeriod.rows[0].consumed_effective_tokens, 59000);
  assert.equal(finalPeriod.rows[0].blocked_request_count, 3);

  async function reserve(input) {
    const result = await database.query(
      `select public.reserve_model_usage(
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9,
         $10::integer, $11::integer, $12::uuid, $13, $14::jsonb
       ) as value`,
      [
        policyId,
        revisionId,
        "policy_analysis",
        "openai",
        "test-model",
        "stage8-test-v1",
        input.hash,
        input.budgetClass,
        input.reason,
        input.plannedInput,
        input.plannedOutput,
        adminId,
        input.exceptionReason ?? null,
        "{}"
      ]
    );
    return result.rows[0].value;
  }

  async function finalize(input) {
    const result = await database.query(
      `select public.finalize_model_usage(
         $1::uuid, $2::integer, $3::integer, $4::integer, $5, $6::uuid, $7::jsonb
       ) as value`,
      [input.usageId, input.input, input.output, input.cached, input.status, adminId, "{}"]
    );
    return result.rows[0].value;
  }
}

async function assertInviteAccountGovernance(database) {
  const adminId = "00000000-0000-0000-0000-000000000001";
  const userId = "00000000-0000-0000-0000-000000000501";
  const invitedId = "00000000-0000-0000-0000-000000000502";
  const policyId = "00000000-0000-0000-0000-000000000101";

  await database.exec(`
    insert into auth.users(id) values ('${userId}'), ('${invitedId}');
    insert into public.profiles(id, role, status)
    values
      ('${userId}', 'user', 'active'),
      ('${invitedId}', 'user', 'invited');
  `);

  await database.exec(`set request.jwt.claim.sub='${userId}'`);
  const identity = await database.query(
    `select auth.uid()::text as uid, public.is_active_user() as active,
            (select status from public.profiles where id=auth.uid()) as profile_status,
            (select status from public.policies where id=$1::uuid) as policy_status,
            (select analysis_version from public.policies where id=$1::uuid) as analysis_version,
            (select publish_date::text from public.policies where id=$1::uuid) as publish_date`,
    [policyId]
  );
  assert.equal(identity.rows[0].uid, userId);
  assert.equal(identity.rows[0].active, true);
  assert.equal(identity.rows[0].profile_status, "active");
  assert.equal(identity.rows[0].policy_status, "published");
  assert.equal(identity.rows[0].analysis_version, "codex-manual-v1");
  assert.equal(identity.rows[0].publish_date, "2026-07-10");
  const activeRead = await database.query(
    `select
       public.can_read_policy($1::uuid) as allowed,
       exists(
         select 1 from public.policies p
         where p.id=$1::uuid
           and public.is_active_user()
           and p.status='published'
           and p.analysis_version='codex-manual-v1'
           and p.publish_date >= date '2026-05-01'
       ) as direct_allowed,
       pg_get_functiondef('public.can_read_policy(uuid)'::regprocedure) as function_def`,
    [policyId]
  );
  assert.equal(activeRead.rows[0].direct_allowed, true);
  if (activeRead.rows[0].allowed !== true) {
    throw new Error(`can_read_policy mismatch: ${activeRead.rows[0].function_def}`);
  }

  const suspended = await database.query(
    `select public.set_user_account_status($1::uuid, 'suspended', $2::uuid, 'stage8 suspension test') as value`,
    [userId, adminId]
  );
  assert.equal(suspended.rows[0].value.changed, true);
  assert.equal(suspended.rows[0].value.currentStatus, "suspended");

  const suspendedRead = await database.query(
    `select public.can_read_policy($1::uuid) as allowed`,
    [policyId]
  );
  assert.equal(suspendedRead.rows[0].allowed, false);

  const reactivated = await database.query(
    `select public.set_user_account_status($1::uuid, 'active', $2::uuid, 'stage8 reactivation test') as value`,
    [userId, adminId]
  );
  assert.equal(reactivated.rows[0].value.currentStatus, "active");
  const activeAgain = await database.query(
    `select public.can_read_policy($1::uuid) as allowed`,
    [policyId]
  );
  assert.equal(activeAgain.rows[0].allowed, true);

  await database.exec(`set request.jwt.claim.sub='${invitedId}'`);
  const invitedRead = await database.query(
    `select public.can_read_policy($1::uuid) as allowed`,
    [policyId]
  );
  assert.equal(invitedRead.rows[0].allowed, false);

  await database.query(
    `select public.set_user_account_status($1::uuid, 'active', $2::uuid, 'activate invited account')`,
    [invitedId, adminId]
  );
  const invitedActivatedRead = await database.query(
    `select public.can_read_policy($1::uuid) as allowed`,
    [policyId]
  );
  assert.equal(invitedActivatedRead.rows[0].allowed, true);

  await database.exec(`set request.jwt.claim.sub='${adminId}'`);
  await expectFailure(
    database,
    `select public.set_user_account_status('${adminId}'::uuid, 'suspended', '${adminId}'::uuid, 'self lockout test')`,
    "administrator self-suspension"
  );

  await database.exec(`
    insert into public.user_events(
      id, user_id, session_id, event_type, occurred_at
    ) values
      ('00000000-0000-0000-0000-000000000601', '${userId}', 'old', 'app_open', timestamptz '2026-01-01 00:00:00+00'),
      ('00000000-0000-0000-0000-000000000602', '${userId}', 'recent', 'app_open', timestamptz '2026-07-01 00:00:00+00');
  `);
  const purge = await database.query(
    `select public.purge_expired_user_events($1::uuid, timestamptz '2026-07-10 00:00:00+00') as value`,
    [adminId]
  );
  assert.equal(purge.rows[0].value.retentionDays, 90);
  assert.equal(purge.rows[0].value.deletedCount, 1);
  const eventCount = await database.query(`select count(*)::int as count from public.user_events`);
  assert.equal(eventCount.rows[0].count, 1);

  const lifecycle = await database.query(
    `select action, count(*)::int as count
     from public.account_lifecycle_events
     group by action order by action`
  );
  const lifecycleCounts = Object.fromEntries(lifecycle.rows.map((item) => [item.action, item.count]));
  const lifecycleDetails = await database.query(
    `select target_user_id_snapshot, action, previous_status, new_status, reason
     from public.account_lifecycle_events order by created_at, id`
  );
  assert.equal(lifecycleCounts.suspended, 1);
  if (lifecycleCounts.reactivated !== 2) {
    throw new Error(`unexpected account lifecycle rows: ${JSON.stringify(lifecycleDetails.rows)}`);
  }
  assert.equal(lifecycleCounts.events_purged, 1);

  await expectFailure(
    database,
    `delete from public.account_lifecycle_events where action='events_purged'`,
    "account lifecycle audit immutability"
  );

  const accessConfig = await database.query(
    `select config_value from public.system_config_versions
     where config_key='product.access_boundary' and status='active'`
  );
  assert.equal(accessConfig.rows.length, 1);
  assert.equal(accessConfig.rows[0].config_value.registrationMode, "invite_only");
  assert.equal(accessConfig.rows[0].config_value.publicSignupEnabled, false);
}

async function assertAccountDeletionWorkflow(database) {
  const adminId = "00000000-0000-0000-0000-000000000001";
  const recoverUserId = "00000000-0000-0000-0000-000000000503";
  const deleteUserId = "00000000-0000-0000-0000-000000000504";

  await database.exec(`
    insert into auth.users(id) values ('${recoverUserId}'), ('${deleteUserId}');
    insert into public.profiles(id, role, status)
    values
      ('${recoverUserId}', 'user', 'active'),
      ('${deleteUserId}', 'user', 'active');
  `);

  const preparedFailure = await database.query(
    `select public.prepare_account_deletion($1::uuid, $2, $3::uuid, $4) as value`,
    [recoverUserId, "delete-request-recover-0001", adminId, "test deletion failure recovery"]
  );
  assert.equal(preparedFailure.rows[0].value.status, "prepared");
  assert.equal(preparedFailure.rows[0].value.previousStatus, "active");
  const blockedProfile = await database.query(
    `select status from public.profiles where id=$1::uuid`,
    [recoverUserId]
  );
  assert.equal(blockedProfile.rows[0].status, "deleted");

  const preparedState = await database.query(
    `select target_user_id::text as target_user_id, target_user_id_snapshot, previous_profile_status, status
     from public.account_deletion_requests where id=$1::uuid`,
    [preparedFailure.rows[0].value.requestId]
  );
  assert.equal(preparedState.rows[0].target_user_id, recoverUserId);
  assert.equal(preparedState.rows[0].target_user_id_snapshot, recoverUserId);
  assert.equal(preparedState.rows[0].previous_profile_status, "active");
  assert.equal(preparedState.rows[0].status, "prepared");

  const preparedReplay = await database.query(
    `select public.prepare_account_deletion($1::uuid, $2, $3::uuid, $4) as value`,
    [recoverUserId, "delete-request-recover-0001", adminId, "test deletion failure recovery"]
  );
  assert.equal(preparedReplay.rows[0].value.idempotentReplay, true);
  assert.equal(preparedReplay.rows[0].value.requestId, preparedFailure.rows[0].value.requestId);

  const failed = await database.query(
    `select public.finalize_account_deletion($1::uuid, false, $2::uuid, $3) as value`,
    [preparedFailure.rows[0].value.requestId, adminId, "simulated Auth delete failure"]
  );
  assert.equal(failed.rows[0].value.status, "failed");
  assert.equal(failed.rows[0].value.profileRestored, true);
  const restoredProfile = await database.query(
    `select status from public.profiles where id=$1::uuid`,
    [recoverUserId]
  );
  assert.equal(restoredProfile.rows[0].status, "active");

  const failedReplay = await database.query(
    `select public.finalize_account_deletion($1::uuid, false, $2::uuid, $3) as value`,
    [preparedFailure.rows[0].value.requestId, adminId, "simulated Auth delete failure"]
  );
  assert.equal(failedReplay.rows[0].value.idempotentReplay, true);
  await expectFailure(
    database,
    `select public.finalize_account_deletion('${preparedFailure.rows[0].value.requestId}'::uuid, true, '${adminId}'::uuid, null)`,
    "conflicting deletion finalization"
  );

  const preparedSuccess = await database.query(
    `select public.prepare_account_deletion($1::uuid, $2, $3::uuid, $4) as value`,
    [deleteUserId, "delete-request-success-0001", adminId, "test successful hard deletion"]
  );
  assert.equal(preparedSuccess.rows[0].value.status, "prepared");
  await expectFailure(
    database,
    `select public.finalize_account_deletion('${preparedSuccess.rows[0].value.requestId}'::uuid, true, '${adminId}'::uuid, null)`,
    "successful deletion finalization while Auth user still exists"
  );
  await database.query(`delete from auth.users where id=$1::uuid`, [deleteUserId]);
  const profileGone = await database.query(
    `select count(*)::int as count from public.profiles where id=$1::uuid`,
    [deleteUserId]
  );
  assert.equal(profileGone.rows[0].count, 0);

  const completed = await database.query(
    `select public.finalize_account_deletion($1::uuid, true, $2::uuid, null) as value`,
    [preparedSuccess.rows[0].value.requestId, adminId]
  );
  assert.equal(completed.rows[0].value.status, "completed");
  assert.equal(completed.rows[0].value.authUserDeleted, true);
  assert.equal(completed.rows[0].value.profileRestored, false);

  const completedReplay = await database.query(
    `select public.finalize_account_deletion($1::uuid, true, $2::uuid, null) as value`,
    [preparedSuccess.rows[0].value.requestId, adminId]
  );
  assert.equal(completedReplay.rows[0].value.idempotentReplay, true);

  await expectFailure(
    database,
    `select public.prepare_account_deletion('${adminId}'::uuid, 'delete-request-self-0001', '${adminId}'::uuid, 'self deletion test')`,
    "administrator self deletion"
  );
  await expectFailure(
    database,
    `update public.account_deletion_requests set reason='tampered' where id='${preparedSuccess.rows[0].value.requestId}'::uuid`,
    "account deletion request identity immutability"
  );
  await expectFailure(
    database,
    `delete from public.account_lifecycle_events where action='deleted'`,
    "account deletion audit immutability"
  );

  const requestStates = await database.query(
    `select status, count(*)::int as count
     from public.account_deletion_requests
     group by status order by status`
  );
  const requestCounts = Object.fromEntries(requestStates.rows.map((item) => [item.status, item.count]));
  assert.equal(requestCounts.failed, 1);
  assert.equal(requestCounts.completed, 1);
}

async function assertLimitedCollectionQueue(database) {
  await database.exec(`
    insert into public.policies(
      id, external_id, title, status, issuer, source_name, source_url,
      publish_date, analysis_version, metadata, duplicate_of_policy_id
    ) values
      ('00000000-0000-0000-0000-000000000701', 'queue-l3', '高优先级价格政策', 'draft', '测试部门', '测试来源', 'https://example.com/queue-l3', date '2026-07-11', 'v0',
       '{"analysisDepth":"L3","reviewPriority":95,"requiresManualAnalysis":true,"triageReasons":["价格机制"]}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000702', 'queue-l2', '方向型产业政策', 'draft', '测试部门', '测试来源', 'https://example.com/queue-l2', date '2026-07-10', 'v0',
       '{"analysis_depth":"L2","review_priority":70,"requires_manual_analysis":true,"triage_reasons":["产业行动"]}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000703', 'queue-l1', '低相关正式政策', 'draft', '测试部门', '测试来源', 'https://example.com/queue-l1', date '2026-07-09', 'v0',
       '{"analysisDepth":"L1","reviewPriority":20,"requiresManualAnalysis":false}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000704', 'queue-l0', '工作动态', 'draft', '测试部门', '测试来源', 'https://example.com/queue-l0', date '2026-07-09', 'v0',
       '{"analysisDepth":"L0","reviewPriority":0,"requiresManualAnalysis":false}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000705', 'queue-legacy', '历史未分层政策', 'draft', '测试部门', '测试来源', 'https://example.com/queue-legacy', date '2026-07-08', 'v0',
       '{}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000706', 'queue-published', '已完成人工报告', 'published', '测试部门', '测试来源', 'https://example.com/queue-published', date '2026-07-08', 'codex-manual-v1',
       '{"analysisDepth":"L3","reviewPriority":99,"requiresManualAnalysis":true}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000707', 'queue-archived', '已归档政策', 'archived', '测试部门', '测试来源', 'https://example.com/queue-archived', date '2026-07-08', 'v0',
       '{"analysisDepth":"L3","reviewPriority":99,"requiresManualAnalysis":true}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000708', 'queue-old', '范围外旧政策', 'draft', '测试部门', '测试来源', 'https://example.com/queue-old', date '2026-04-30', 'v0',
       '{"analysisDepth":"L3","reviewPriority":99,"requiresManualAnalysis":true}'::jsonb, null),
      ('00000000-0000-0000-0000-000000000709', 'queue-duplicate', '重复政策', 'draft', '测试部门', '测试来源', 'https://example.com/queue-duplicate', date '2026-07-11', 'v0',
       '{"analysisDepth":"L3","reviewPriority":100,"requiresManualAnalysis":true}'::jsonb,
       '00000000-0000-0000-0000-000000000701');
  `);

  await database.exec("set role authenticated");
  const result = await database.query("select public.list_pending_policy_analysis(20) as value");
  await database.exec("reset role");

  const value = result.rows[0].value;
  assert.equal(value.total, 3);
  assert.equal(value.queueLimit, 8);
  assert.deepEqual(value.rows.map((item) => item.id), ["queue-l3", "queue-l2", "queue-legacy"]);
  assert.deepEqual(value.rows.map((item) => item.reviewPriority), [95, 70, 0]);
  assert.deepEqual(value.rows.map((item) => item.analysisDepth), ["L3", "L2", "legacy"]);
  assert.deepEqual(value.rows[0].triageReasons, ["价格机制"]);

  const limited = await database.query("select public.list_pending_policy_analysis(1) as value");
  assert.equal(limited.rows[0].value.queueLimit, 1);
  assert.equal(limited.rows[0].value.rows.length, 1);
  assert.equal(limited.rows[0].value.rows[0].id, "queue-l3");
}

async function assertTableLevelRls(database) {
  const policyId = "00000000-0000-0000-0000-000000000101";
  const currentRevisionId = "00000000-0000-0000-0000-000000000303";
  const activeUserId = "00000000-0000-0000-0000-000000000701";
  const invitedUserId = "00000000-0000-0000-0000-000000000702";
  const suspendedUserId = "00000000-0000-0000-0000-000000000703";
  const adminId = "00000000-0000-0000-0000-000000000001";

  await database.exec(`
    insert into auth.users(id) values
      ('${activeUserId}'),
      ('${invitedUserId}'),
      ('${suspendedUserId}');
    insert into public.profiles(id, role, status) values
      ('${activeUserId}', 'user', 'active'),
      ('${invitedUserId}', 'user', 'invited'),
      ('${suspendedUserId}', 'user', 'suspended');
  `);

  const activeProjectionCount = await queryAsRole(
    database,
    "authenticated",
    activeUserId,
    `select count(*)::int as count
     from public.report_policy_actions
     where policy_id='${policyId}'::uuid`
  );
  assert.equal(activeProjectionCount.rows[0].count, 3, "active authenticated users must read published history projections");

  const currentReport = await queryAsRole(
    database,
    "authenticated",
    activeUserId,
    `select public.get_current_report_revision('${policyId}'::uuid) as value`
  );
  assert.equal(currentReport.rows[0].value.revisionId, currentRevisionId);

  await expectRoleFailure(
    database,
    "authenticated",
    activeUserId,
    `select count(*) from public.report_revisions`,
    "authenticated users must not directly select full revision payload rows"
  );
  await expectRoleFailure(
    database,
    "authenticated",
    activeUserId,
    `insert into public.report_policy_actions(
       policy_id, revision_id, projection_version, action_key, title, signal, evidence_level
     ) values (
       '${policyId}'::uuid, '${currentRevisionId}'::uuid, 'policy-projection-v1',
       'rls-write-test', '非法浏览器写入', 'pending', 'pending'
     )`,
    "authenticated users must not write projection rows"
  );

  const invitedProjectionCount = await queryAsRole(
    database,
    "authenticated",
    invitedUserId,
    `select count(*)::int as count
     from public.report_policy_actions
     where policy_id='${policyId}'::uuid`
  );
  assert.equal(invitedProjectionCount.rows[0].count, 0, "invited users must be filtered by RLS even with a valid session claim");
  await expectRoleFailure(
    database,
    "authenticated",
    invitedUserId,
    `select public.get_current_report_revision('${policyId}'::uuid)`,
    "invited users must not read current report RPC payloads"
  );

  const suspendedProjectionCount = await queryAsRole(
    database,
    "authenticated",
    suspendedUserId,
    `select count(*)::int as count
     from public.report_policy_actions
     where policy_id='${policyId}'::uuid`
  );
  assert.equal(suspendedProjectionCount.rows[0].count, 0, "suspended users must be filtered by RLS with an old JWT claim");

  const adminProjectionCount = await queryAsRole(
    database,
    "authenticated",
    adminId,
    `select count(*)::int as count
     from public.report_policy_actions
     where policy_id='${policyId}'::uuid`
  );
  assert.equal(adminProjectionCount.rows[0].count, 3, "active administrators must read published history projections");

  await expectRoleFailure(
    database,
    "anon",
    null,
    `select count(*) from public.report_policy_actions`,
    "anonymous role must not read internal report projections"
  );
}

async function queryAsRole(database, role, userId, sql) {
  await database.exec("reset role");
  if (userId) {
    await database.exec(`set request.jwt.claim.sub='${userId}'`);
  } else {
    await database.exec("reset request.jwt.claim.sub");
  }
  await database.exec(`set role ${role}`);
  try {
    return await database.query(sql);
  } finally {
    await database.exec("reset role");
    await database.exec("reset request.jwt.claim.sub");
  }
}

async function expectRoleFailure(database, role, userId, sql, label) {
  let failed = false;
  try {
    await queryAsRole(database, role, userId, sql);
  } catch {
    failed = true;
    await database.exec("reset role");
    await database.exec("reset request.jwt.claim.sub");
  }
  assert.equal(failed, true, label);
}

async function assertBulkShadowMigration(database, shadowPackagePath) {
  const actorId = "00000000-0000-0000-0000-000000000001";
  const reportsDir = path.resolve("manual-reports");
  const files = (await fs.readdir(reportsDir)).filter((item) => item.endsWith(".json")).sort();
  const reports = await Promise.all(
    files.map(async (file) => JSON.parse(await fs.readFile(path.join(reportsDir, file), "utf8")))
  );
  const shadow = shadowPackagePath
    ? JSON.parse(await fs.readFile(path.resolve(shadowPackagePath), "utf8"))
    : buildShadowPackage(reports, {
        sourceDocuments: reports.map((report, index) => ({
          policyId: report.policyId ?? report.id,
          sourceUrl: report.policy?.sourceUrl ?? null,
          fullText: Array.from({ length: 12 }, (_, paragraphIndex) =>
            `第${paragraphIndex + 1}段 合成迁移测试原文，政策${index + 1}，用于验证20份报告批量装载、哈希、段落、投影和幂等性。`
          ).join("\n\n"),
          parserVersion: "pglite-bulk-test-v1",
          metadata: {
            verificationStatus: "official_source_verified",
            testOnly: true
          }
        })),
        generatedAt: "2026-07-10T00:00:00.000Z"
      });
  assert.equal(shadow.deploymentReady, true);

  const first = await applyStage7ShadowPackage(database, shadow, {
    actorId,
    seedMissingPolicies: true
  });
  assert.equal(first.policies, shadow.counts.reports);
  assert.equal(first.sourceDocuments, shadow.counts.sourceDocuments);
  assert.equal(first.revisions, shadow.counts.reports);
  assert.equal(first.policyActions, shadow.counts.policyActions);
  assert.equal(first.industryNodes, shadow.counts.industryNodes);
  assert.equal(first.industryEdges, shadow.counts.industryEdges);
  assert.equal(first.companyRelations, shadow.counts.companyRelations);
  assert.equal(first.policyNetworkRelations, shadow.counts.policyNetworkRelations);
  assert.equal(first.evidenceRefs, shadow.counts.evidenceRefs);
  assert.equal(first.signals, shadow.counts.signals);

  const tableExpectations = {
    policy_source_documents: shadow.counts.sourceDocuments + 2,
    report_revisions: shadow.counts.reports + 3,
    report_projection_runs: shadow.counts.reports + 3,
    report_policy_actions: shadow.counts.policyActions + 3,
    report_industry_nodes: shadow.counts.industryNodes,
    report_industry_edges: shadow.counts.industryEdges,
    report_company_relations: shadow.counts.companyRelations,
    report_policy_network_relations: shadow.counts.policyNetworkRelations,
    report_evidence_refs: shadow.counts.evidenceRefs,
    report_signals: shadow.counts.signals
  };
  for (const [table, expected] of Object.entries(tableExpectations)) {
    const count = await database.query(`select count(*)::int as count from public.${table}`);
    assert.equal(count.rows[0].count, expected, `${table} count must match shadow package`);
  }

  const pointers = await database.query(
    `select count(*)::int as count
     from public.policies
     where id = any($1::uuid[])
       and current_source_document_id is not null
       and current_published_revision_id is not null
       and current_draft_revision_id is null`,
    [reports.map((report) => report.policyId ?? report.id)]
  );
  assert.equal(pointers.rows[0].count, reports.length);

  const hashes = await database.query(
    `select count(*)::int as count
     from public.report_revisions r
     join public.policies p on p.current_published_revision_id = r.id
     join public.policy_source_documents d on d.id = p.current_source_document_id
     where p.id = any($1::uuid[])
       and r.source_document_hash = d.source_document_hash
       and r.projection_hash is not null`,
    [reports.map((report) => report.policyId ?? report.id)]
  );
  assert.equal(hashes.rows[0].count, reports.length);

  await applyStage7ShadowPackage(database, shadow, {
    actorId,
    seedMissingPolicies: true
  });
  for (const [table, expected] of Object.entries(tableExpectations)) {
    const count = await database.query(`select count(*)::int as count from public.${table}`);
    assert.equal(count.rows[0].count, expected, `${table} must remain idempotent`);
  }
}

async function expectFailure(database, sql, label) {
  let failed = false;
  try {
    await database.exec(sql);
  } catch {
    failed = true;
  }
  assert.equal(failed, true, `${label} must be rejected`);
}

function bootstrapSql() {
  return `
    create schema if not exists auth;
    create or replace function public.gen_random_uuid()
    returns uuid language sql volatile as $$
      select (
        substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-4' ||
        substr(md5(random()::text || clock_timestamp()::text), 1, 3) || '-a' ||
        substr(md5(random()::text || clock_timestamp()::text), 1, 3) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 1, 12)
      )::uuid
    $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create table auth.users(id uuid primary key);
    create or replace function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create or replace function public.set_updated_at()
    returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end;
    $$;

    create table public.profiles(
      id uuid primary key references auth.users(id) on delete cascade,
      role text not null default 'user',
      status text not null default 'active'
    );
    create or replace function public.is_admin()
    returns boolean language sql stable security definer set search_path=public as $$
      select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='active')
    $$;

    create table public.policies(
      id uuid primary key default gen_random_uuid(),
      external_id text,
      title text not null,
      status text not null default 'draft',
      visibility text not null default 'authenticated',
      issuer text,
      publish_date date,
      effective_date date,
      category text,
      policy_level text,
      jurisdiction text,
      source_url text,
      source_name text,
      content_hash text,
      summary text,
      full_text text,
      confidence numeric(5,2),
      tags text[] not null default '{}'::text[],
      analysis_version text not null default 'v0',
      metadata jsonb not null default '{}'::jsonb,
      duplicate_of_policy_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.user_events(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      session_id text not null,
      event_type text not null,
      policy_ref text,
      module_id text,
      target_type text,
      target_id text,
      duration_ms integer,
      route_path text,
      viewport jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
    create or replace function public.can_read_policy(target_policy_id uuid)
    returns boolean language sql stable security definer set search_path=public as $$
      select exists(
        select 1 from public.policies p
        where p.id=target_policy_id and (
          public.is_admin() or (p.status='published' and p.analysis_version='codex-manual-v1')
        )
      )
    $$;
  `;
}

function parseArgs(argv) {
  const parsed = {
    pgliteModule: "",
    migration: "supabase/migrations/20260710010000_stage7_revision_projection_core.sql",
    stage8Migration: "supabase/migrations/20260710020000_stage8_transactional_revision_lifecycle.sql",
    stage8BudgetMigration: "supabase/migrations/20260710021000_stage8_model_budget_enforcement.sql",
    stage8AccountMigration: "supabase/migrations/20260710022000_stage8_invite_account_governance.sql",
    stage8DeletionMigration: "supabase/migrations/20260710023000_stage8_account_deletion_workflow.sql",
    stage9CollectionMigration: "supabase/migrations/20260711010000_stage9_limited_collection_queue.sql",
    shadowPackage: ""
  };
  for (const arg of argv) {
    if (arg.startsWith("--pglite-module=")) parsed.pgliteModule = arg.slice("--pglite-module=".length);
    else if (arg.startsWith("--migration=")) parsed.migration = arg.slice("--migration=".length);
    else if (arg.startsWith("--stage8-migration=")) parsed.stage8Migration = arg.slice("--stage8-migration=".length);
    else if (arg.startsWith("--stage8-budget-migration=")) parsed.stage8BudgetMigration = arg.slice("--stage8-budget-migration=".length);
    else if (arg.startsWith("--stage8-account-migration=")) parsed.stage8AccountMigration = arg.slice("--stage8-account-migration=".length);
    else if (arg.startsWith("--stage8-deletion-migration=")) parsed.stage8DeletionMigration = arg.slice("--stage8-deletion-migration=".length);
    else if (arg.startsWith("--stage9-collection-migration=")) parsed.stage9CollectionMigration = arg.slice("--stage9-collection-migration=".length);
    else if (arg.startsWith("--shadow-package=")) parsed.shadowPackage = arg.slice("--shadow-package=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.pgliteModule) throw new Error("--pglite-module=<absolute path> is required");
  return parsed;
}

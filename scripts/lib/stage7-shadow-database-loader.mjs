import crypto from "node:crypto";

export async function seedStage7Policies(database, shadowPackage) {
  if (!database || typeof database.query !== "function") {
    throw new Error("A database client with query() is required.");
  }
  if (!shadowPackage?.deploymentReady || !Array.isArray(shadowPackage.revisions)) {
    throw new Error("A deployment-ready Stage 7 shadow package is required.");
  }
  const sourceByPolicy = new Map(shadowPackage.sourceDocuments.map((item) => [item.policyId, item]));
  const rows = shadowPackage.revisions.map((revision) => {
    const report = revision.payload ?? {};
    const policy = report.policy ?? {};
    const summary = report.summary ?? {};
    const brief = report.brief ?? {};
    const source = sourceByPolicy.get(revision.policyId);
    if (!source) throw new Error(`Missing source document for staging policy ${revision.policyId}.`);
    return [
      revision.policyId,
      report.id ?? revision.policyId,
      policy.title ?? summary.title ?? revision.policyId,
      policy.issuer ?? summary.issuer ?? null,
      policy.publishDate ?? summary.publishDate ?? null,
      policy.effectiveDate ?? null,
      policy.category ?? summary.category ?? null,
      policy.level ?? null,
      policy.jurisdiction ?? null,
      policy.sourceUrl ?? source.sourceUrl ?? null,
      policy.source ?? summary.source ?? null,
      source.sourceDocumentHash,
      brief.judgement ?? summary.primarySignal ?? null,
      source.normalizedText,
      policy.confidence ?? summary.confidence ?? null,
      Array.isArray(policy.tags) ? policy.tags : [],
      revision.analysisVersion,
      json({ stagingSeed: true, sourceDocumentHash: source.sourceDocumentHash })
    ];
  });
  await insertMany(database, {
    table: "public.policies",
    columns: [
      "id", "external_id", "title", "issuer", "publish_date", "effective_date",
      "category", "policy_level", "jurisdiction", "source_url", "source_name",
      "content_hash", "summary", "full_text", "confidence", "tags",
      "analysis_version", "metadata"
    ],
    casts: [
      "uuid", "text", "text", "text", "date", "date", "text", "text", "text",
      "text", "text", "text", "text", "text", "numeric", "text[]", "text", "jsonb"
    ],
    rows,
    conflict: "on conflict (id) do nothing"
  });
  return { attempted: rows.length };
}

export async function applyStage7ShadowPackage(database, shadowPackage, options = {}) {
  validateInputs(database, shadowPackage, options);
  const actorId = options.actorId;
  const policyIds = shadowPackage.revisions.map((item) => item.policyId);

  const sourceDocumentIds = new Map();
  const revisionIds = new Map();
  const result = {
    policies: shadowPackage.revisions.length,
    sourceDocuments: 0,
    sourceSegments: 0,
    revisions: 0,
    projectionRuns: 0,
    policyActions: 0,
    industryNodes: 0,
    industryEdges: 0,
    companyRelations: 0,
    policyNetworkRelations: 0,
    evidenceRefs: 0,
    signals: 0
  };

  await database.exec("begin");
  try {
    if (options.seedMissingPolicies === true) {
      await seedStage7Policies(database, shadowPackage);
    }
    await assertPoliciesExist(database, policyIds);

    for (const sourceDocument of shadowPackage.sourceDocuments) {
      const sourceDocumentId = deterministicUuid(
        `stage7:source-document:${sourceDocument.policyId}:${sourceDocument.sourceDocumentHash}`
      );
      sourceDocumentIds.set(sourceDocument.policyId, sourceDocumentId);
      await database.query(
        `insert into public.policy_source_documents (
          id, policy_id, parent_document_id, source_url, normalized_text,
          source_document_hash, parser_version, fetched_at, official_published_at,
          metadata
        ) values (
          $1::uuid, $2::uuid, null, $3, $4, $5, $6,
          $7::timestamptz, $8::timestamptz, $9::jsonb
        )
        on conflict (policy_id, source_document_hash) do nothing`,
        [
          sourceDocumentId,
          sourceDocument.policyId,
          sourceDocument.sourceUrl,
          sourceDocument.normalizedText,
          sourceDocument.sourceDocumentHash,
          sourceDocument.parserVersion,
          sourceDocument.fetchedAt,
          sourceDocument.officialPublishedAt,
          json(sourceDocument.metadata)
        ]
      );
      result.sourceDocuments += 1;

      const segmentRows = sourceDocument.segments.map((segment) => ({
        id: deterministicUuid(`stage7:source-segment:${sourceDocumentId}:${segment.segmentKey}`),
        policyId: sourceDocument.policyId,
        sourceDocumentId,
        ...segment
      }));
      await insertMany(database, {
        table: "public.policy_source_segments",
        columns: [
          "id", "policy_id", "source_document_id", "segment_key", "sort_order",
          "heading_level", "heading_path", "page_number", "source_locator",
          "segment_text", "segment_hash"
        ],
        casts: ["uuid", "uuid", "uuid", "text", "integer", "integer", "text[]", "integer", "jsonb", "text", "text"],
        rows: segmentRows.map((item) => [
          item.id,
          item.policyId,
          item.sourceDocumentId,
          item.segmentKey,
          item.sortOrder,
          item.headingLevel,
          item.headingPath,
          item.pageNumber,
          json(item.sourceLocator),
          item.text,
          item.segmentHash
        ]),
        conflict: "on conflict (source_document_id, segment_key) do nothing"
      });
      result.sourceSegments += segmentRows.length;
    }

    for (const shadowRevision of shadowPackage.revisions) {
      const sourceDocumentId = sourceDocumentIds.get(shadowRevision.policyId);
      if (!sourceDocumentId) {
        throw new Error(`Missing source document ID for ${shadowRevision.policyId}.`);
      }
      const revisionId = deterministicUuid(
        `stage7:report-revision:${shadowRevision.policyId}:${shadowRevision.contentHash}`
      );
      revisionIds.set(shadowRevision.policyId, revisionId);

      const existing = await database.query(
        `select id, status, content_hash, projection_hash
         from public.report_revisions
         where policy_id = $1::uuid and content_hash = $2`,
        [shadowRevision.policyId, shadowRevision.contentHash]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.id !== revisionId || row.projection_hash !== shadowRevision.projectionHash) {
          throw new Error(`Existing revision for ${shadowRevision.policyId} conflicts with deterministic migration identity.`);
        }
        await database.query(
          `update public.policies
           set current_source_document_id = $2::uuid,
               current_published_revision_id = $3::uuid,
               current_draft_revision_id = null
           where id = $1::uuid`,
          [shadowRevision.policyId, sourceDocumentId, revisionId]
        );
        continue;
      }

      await database.query(
        `insert into public.report_revisions (
          id, policy_id, parent_revision_id, status, payload, schema_version,
          analysis_version, projection_version, source_document_hash, content_hash,
          change_summary, change_reason, created_by
        ) values (
          $1::uuid, $2::uuid, null, 'draft', $3::jsonb, $4, $5, $6,
          $7, $8, $9, $10, $11::uuid
        )`,
        [
          revisionId,
          shadowRevision.policyId,
          json(shadowRevision.payload),
          shadowRevision.schemaVersion,
          shadowRevision.analysisVersion,
          shadowRevision.projectionVersion,
          shadowRevision.sourceDocumentHash,
          shadowRevision.contentHash,
          shadowRevision.changeSummary,
          shadowRevision.changeReason,
          actorId
        ]
      );
      result.revisions += 1;

      const runId = deterministicUuid(
        `stage7:projection-run:${revisionId}:${shadowRevision.projectionVersion}:1`
      );
      await database.query(
        `insert into public.report_projection_runs (
          id, policy_id, revision_id, projection_version, attempt_no,
          status, started_at
        ) values ($1::uuid, $2::uuid, $3::uuid, $4, 1, 'running', now())`,
        [runId, shadowRevision.policyId, revisionId, shadowRevision.projectionVersion]
      );
      result.projectionRuns += 1;

      const projection = shadowRevision.projection;
      await insertPolicyActions(database, revisionId, projection);
      await insertIndustryNodes(database, revisionId, projection);
      await insertIndustryEdges(database, revisionId, projection);
      await insertCompanyRelations(database, revisionId, projection);
      await insertPolicyNetwork(database, revisionId, projection);
      await insertEvidence(database, revisionId, projection);
      await insertSignals(database, revisionId, projection);

      result.policyActions += projection.policyActions.length;
      result.industryNodes += projection.industryNodes.length;
      result.industryEdges += projection.industryEdges.length;
      result.companyRelations += projection.companyRelations.length;
      result.policyNetworkRelations += projection.policyNetworkRelations.length;
      result.evidenceRefs += projection.evidenceRefs.length;
      result.signals += projection.signals.length;

      await database.query(
        `update public.report_projection_runs
         set status = 'succeeded',
             projection_hash = $2,
             row_counts = $3::jsonb,
             finished_at = now()
         where id = $1::uuid`,
        [runId, shadowRevision.projectionHash, json(projection.counts)]
      );
      await database.query(
        `update public.report_revisions set status = 'in_review' where id = $1::uuid`,
        [revisionId]
      );
      await database.query(
        `update public.report_revisions
         set status = 'approved', reviewed_by = $2::uuid, reviewed_at = now()
         where id = $1::uuid`,
        [revisionId, actorId]
      );
      await database.query(
        `update public.report_revisions
         set status = 'published', published_at = now(), projection_hash = $2
         where id = $1::uuid`,
        [revisionId, shadowRevision.projectionHash]
      );
      await database.query(
        `update public.policies
         set current_source_document_id = $2::uuid,
             current_published_revision_id = $3::uuid,
             current_draft_revision_id = null
         where id = $1::uuid`,
        [shadowRevision.policyId, sourceDocumentId, revisionId]
      );
    }

    await database.exec("commit");
  } catch (error) {
    await database.exec("rollback").catch(() => undefined);
    throw error;
  }

  return {
    ...result,
    sourceDocumentIds: Object.fromEntries(sourceDocumentIds),
    revisionIds: Object.fromEntries(revisionIds)
  };
}

export function deterministicUuid(value) {
  const bytes = crypto.createHash("sha256").update(String(value), "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function insertPolicyActions(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_policy_actions",
    columns: [
      "policy_id", "revision_id", "projection_version", "action_key", "title",
      "body", "signal", "action_type", "evidence_level", "implementation_dependency",
      "confidence", "clause_keys", "sort_order", "payload_fragment"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "text", "text", "text", "numeric", "text[]", "integer", "jsonb"],
    rows: projection.policyActions.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.actionKey, item.title,
      item.body, item.signal, item.actionType, item.evidenceLevel, item.implementationDependency,
      item.confidence, item.clauseKeys, item.sortOrder, json(item.payloadFragment)
    ])
  });
}

async function insertIndustryNodes(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_industry_nodes",
    columns: [
      "policy_id", "revision_id", "projection_version", "node_key", "title",
      "subtitle", "section", "relation", "evidence_level", "confidence", "description",
      "clause_keys", "company_keys", "verification_signals", "sort_order", "payload_fragment"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "text", "text", "numeric", "text", "text[]", "text[]", "text[]", "integer", "jsonb"],
    rows: projection.industryNodes.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.nodeKey, item.title,
      item.subtitle, item.section, item.relation, item.evidenceLevel, item.confidence,
      item.description, item.clauseKeys, item.companyKeys, item.verificationSignals,
      item.sortOrder, json(item.payloadFragment)
    ])
  });
}

async function insertIndustryEdges(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_industry_edges",
    columns: [
      "policy_id", "revision_id", "projection_version", "edge_key", "from_node_key",
      "to_node_key", "edge_type", "confidence", "description", "sort_order", "payload_fragment"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "numeric", "text", "integer", "jsonb"],
    rows: projection.industryEdges.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.edgeKey,
      item.fromNodeKey, item.toNodeKey, item.edgeType, item.confidence,
      item.description, item.sortOrder, json(item.payloadFragment)
    ])
  });
}

async function insertCompanyRelations(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_company_relations",
    columns: [
      "policy_id", "revision_id", "projection_version", "relation_key", "company_key",
      "source_company_id", "company_name", "ticker", "chain_node_key", "relationship",
      "policy_evidence", "regulatory_role", "business_exposure", "investment_use",
      "watch_signals", "key_risks", "do_not_overread", "sort_order", "payload_fragment"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "text", "text", "text", "text", "text", "text", "text", "text[]", "text[]", "text[]", "integer", "jsonb"],
    rows: projection.companyRelations.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.relationKey,
      item.companyKey, item.sourceCompanyId, item.companyName, item.ticker,
      item.chainNodeKey, item.relationship, item.policyEvidence, item.regulatoryRole,
      item.businessExposure, item.investmentUse, item.watchSignals, item.keyRisks,
      item.doNotOverread, item.sortOrder, json(item.payloadFragment)
    ])
  });
}

async function insertPolicyNetwork(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_policy_network_relations",
    columns: [
      "policy_id", "revision_id", "projection_version", "relation_key",
      "related_policy_key", "related_policy_title", "relationship", "meaning",
      "evidence_level", "source_date", "source_url", "watch_signals", "sort_order",
      "payload_fragment"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "text", "text", "date", "text", "text[]", "integer", "jsonb"],
    rows: projection.policyNetworkRelations.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.relationKey,
      item.relatedPolicyKey, item.relatedPolicyTitle, item.relationship, item.meaning,
      item.evidenceLevel, item.sourceDate, item.sourceUrl, item.watchSignals,
      item.sortOrder, json(item.payloadFragment)
    ])
  });
}

async function insertEvidence(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_evidence_refs",
    columns: [
      "policy_id", "revision_id", "projection_version", "evidence_key", "title",
      "source_name", "evidence_type", "evidence_object", "published_at", "source_url",
      "excerpt", "interpretation", "source_location", "confidence", "linked_clause_keys",
      "linked_node_keys", "linked_company_keys", "sort_order", "payload_fragment"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "text", "date", "text", "text", "text", "text", "numeric", "text[]", "text[]", "text[]", "integer", "jsonb"],
    rows: projection.evidenceRefs.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.evidenceKey,
      item.title, item.sourceName, item.evidenceType, item.evidenceObject,
      item.publishedAt, item.sourceUrl, item.excerpt, item.interpretation,
      item.sourceLocation, item.confidence, item.linkedClauseKeys, item.linkedNodeKeys,
      item.linkedCompanyKeys, item.sortOrder, json(item.payloadFragment)
    ])
  });
}

async function insertSignals(database, revisionId, projection) {
  await insertMany(database, {
    table: "public.report_signals",
    columns: [
      "policy_id", "revision_id", "projection_version", "signal_key", "signal_type",
      "subject_type", "subject_key", "signal_value", "direction", "strength",
      "time_horizon", "summary", "sort_order"
    ],
    casts: ["uuid", "uuid", "text", "text", "text", "text", "text", "text", "text", "text", "text", "text", "integer"],
    rows: projection.signals.map((item) => [
      item.policyId, revisionId, projection.projectionVersion, item.signalKey,
      item.signalType, item.subjectType, item.subjectKey, item.signalValue,
      item.direction, item.strength, item.timeHorizon, item.summary, item.sortOrder
    ])
  });
}

async function insertMany(database, input) {
  if (input.rows.length === 0) return;
  const params = [];
  const values = input.rows.map((row) => {
    const placeholders = row.map((value, index) => {
      params.push(value);
      const cast = input.casts[index];
      return `$${params.length}${cast ? `::${cast}` : ""}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await database.query(
    `insert into ${input.table} (${input.columns.join(", ")}) values ${values.join(", ")} ${input.conflict ?? ""}`,
    params
  );
}

async function assertPoliciesExist(database, policyIds) {
  const result = await database.query(
    `select id::text as id from public.policies where id = any($1::uuid[])`,
    [policyIds]
  );
  const existing = new Set(result.rows.map((item) => item.id));
  const missing = policyIds.filter((item) => !existing.has(item));
  if (missing.length > 0) {
    throw new Error(`Shadow migration requires existing policies: ${missing.join(", ")}`);
  }
}

function validateInputs(database, shadowPackage, options) {
  if (!database || typeof database.query !== "function" || typeof database.exec !== "function") {
    throw new Error("A database client with query() and exec() is required.");
  }
  if (!shadowPackage || !Array.isArray(shadowPackage.revisions) || !Array.isArray(shadowPackage.sourceDocuments)) {
    throw new Error("A valid Stage 7 shadow package is required.");
  }
  if (shadowPackage.deploymentReady !== true) {
    throw new Error("Stage 7 shadow package must have deploymentReady=true.");
  }
  if (!isUuid(options.actorId)) {
    throw new Error("A valid migration actor UUID is required.");
  }
  if (shadowPackage.revisions.length !== shadowPackage.sourceDocuments.length) {
    throw new Error("Every report revision must have one verified source document.");
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function json(value) {
  return JSON.stringify(value ?? null);
}

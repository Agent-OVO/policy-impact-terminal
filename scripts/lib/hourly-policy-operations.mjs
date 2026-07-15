const EXPECTED_SOURCE_KEYS = [
  "gov_zhengce_latest",
  "ndrc_policy_documents",
  "miit_policy_library",
  "nda_policy_release"
];

export const HOURLY_POLICY_OPERATIONS_VERSION = "hourly-policy-operations-v1";

export function auditHourlyCollectionRuns(rawRuns, options = {}) {
  const expectedRuns = positiveInteger(options.expectedRuns, 24);
  const expectedFrequencyMinutes = positiveInteger(options.expectedFrequencyMinutes, 60);
  const maxGapMinutes = positiveInteger(options.maxGapMinutes, 120);
  const requireClean = options.requireClean === true;
  const runs = rawRuns
    .map((run, index) => normalizeRun(run, index))
    .sort((left, right) => left.crawledAtMs - right.crawledAtMs);

  const hardErrors = [];
  const warnings = [];
  const sourceStats = Object.fromEntries(EXPECTED_SOURCE_KEYS.map((key) => [key, {
    sourceKey: key,
    okRuns: 0,
    failedRuns: 0,
    degradedRuns: 0,
    maxConsecutiveFailures: 0,
    currentFailureStreak: 0,
    latestStatus: "unknown"
  }]));

  if (runs.length < expectedRuns) {
    warnings.push({ code: "run_count_below_target", expectedRuns, actualRuns: runs.length });
  }
  if (runs.length === 0) {
    hardErrors.push({ code: "no_hourly_collection_artifacts" });
  }

  const seenTimes = new Set();
  let maxObservedGapMinutes = 0;
  let totalNewCandidatesObserved = 0;
  let totalRepeatedCandidateObservations = 0;
  const candidateFirstSeen = new Map();
  const runSummaries = [];

  for (const [index, run] of runs.entries()) {
    if (!Number.isFinite(run.crawledAtMs)) {
      hardErrors.push({ code: "invalid_crawled_at", artifact: run.artifactName });
      continue;
    }
    if (seenTimes.has(run.crawledAt)) {
      hardErrors.push({ code: "duplicate_run_timestamp", crawledAt: run.crawledAt, artifact: run.artifactName });
    }
    seenTimes.add(run.crawledAt);

    if (index > 0) {
      const gapMinutes = (run.crawledAtMs - runs[index - 1].crawledAtMs) / 60000;
      maxObservedGapMinutes = Math.max(maxObservedGapMinutes, gapMinutes);
      if (gapMinutes > maxGapMinutes) {
        warnings.push({
          code: "hourly_schedule_gap",
          previous: runs[index - 1].crawledAt,
          current: run.crawledAt,
          gapMinutes: round(gapMinutes),
          maxGapMinutes
        });
      }
      if (gapMinutes < Math.max(1, expectedFrequencyMinutes * 0.25)) {
        warnings.push({
          code: "runs_too_close",
          previous: runs[index - 1].crawledAt,
          current: run.crawledAt,
          gapMinutes: round(gapMinutes)
        });
      }
    }

    if (run.operatingMode !== "hourly_collection_manual_analysis") {
      hardErrors.push({ code: "wrong_operating_mode", artifact: run.artifactName, value: run.operatingMode });
    }
    if (run.automaticAnalysisSelection !== false) {
      hardErrors.push({ code: "automatic_analysis_selection_enabled", artifact: run.artifactName });
    }
    if (run.analysisSelected !== 0 || run.analysisQueueLength !== 0) {
      hardErrors.push({
        code: "automatic_analysis_selection_detected",
        artifact: run.artifactName,
        analysisSelected: run.analysisSelected,
        analysisQueueLength: run.analysisQueueLength
      });
    }
    if (run.runStatus === "failed") {
      hardErrors.push({ code: "collection_run_failed", artifact: run.artifactName });
    } else if (run.runStatus === "degraded") {
      warnings.push({ code: "collection_run_degraded", artifact: run.artifactName });
    }
    if (!sameStringSet(run.sourceKeys, EXPECTED_SOURCE_KEYS)) {
      hardErrors.push({ code: "source_whitelist_mismatch", artifact: run.artifactName, sourceKeys: run.sourceKeys });
    }
    if (run.candidates > 0 && run.withFullText === 0) {
      hardErrors.push({ code: "candidates_without_usable_full_text", artifact: run.artifactName, candidates: run.candidates });
    }
    if (run.ingestSelected !== run.withFullText) {
      hardErrors.push({
        code: "ingest_selection_starvation",
        artifact: run.artifactName,
        withFullText: run.withFullText,
        ingestSelected: run.ingestSelected
      });
    }
    if (run.queueOverflow > 0) {
      warnings.push({ code: "manual_inbox_pressure", artifact: run.artifactName, queueOverflow: run.queueOverflow });
    }

    const runIdentitySet = new Set();
    let newCandidates = 0;
    let repeatedCandidates = 0;
    for (const candidate of run.candidatesList) {
      const identity = candidateIdentity(candidate);
      if (!identity) continue;
      if (runIdentitySet.has(identity)) {
        hardErrors.push({ code: "duplicate_candidate_within_run", artifact: run.artifactName, identity });
        continue;
      }
      runIdentitySet.add(identity);
      if (candidateFirstSeen.has(identity)) {
        repeatedCandidates += 1;
        totalRepeatedCandidateObservations += 1;
      } else {
        candidateFirstSeen.set(identity, run.crawledAt);
        newCandidates += 1;
        totalNewCandidatesObserved += 1;
      }
    }

    const healthByKey = new Map(run.sourceHealth.map((item) => [item.sourceKey, item]));
    for (const sourceKey of EXPECTED_SOURCE_KEYS) {
      const stats = sourceStats[sourceKey];
      const health = healthByKey.get(sourceKey);
      const status = health?.status ?? "missing";
      stats.latestStatus = status;
      if (status === "ok") {
        stats.okRuns += 1;
        stats.currentFailureStreak = 0;
      } else {
        stats.failedRuns += 1;
        if (run.runStatus === "degraded") stats.degradedRuns += 1;
        stats.currentFailureStreak += 1;
        stats.maxConsecutiveFailures = Math.max(stats.maxConsecutiveFailures, stats.currentFailureStreak);
        if (status === "missing") {
          hardErrors.push({ code: "missing_source_health", artifact: run.artifactName, sourceKey });
        }
      }
    }

    runSummaries.push({
      artifactName: run.artifactName,
      crawledAt: run.crawledAt,
      runStatus: run.runStatus,
      candidates: run.candidates,
      withFullText: run.withFullText,
      ingestSelected: run.ingestSelected,
      newCandidates,
      repeatedCandidates,
      manualEligible: run.manualEligible,
      recommendedAnalysis: run.recommendedAnalysis,
      analysisSelected: run.analysisSelected,
      queueOverflow: run.queueOverflow
    });
  }

  for (const stats of Object.values(sourceStats)) {
    if (stats.maxConsecutiveFailures >= 2) {
      warnings.push({
        code: "source_consecutive_failures",
        sourceKey: stats.sourceKey,
        maxConsecutiveFailures: stats.maxConsecutiveFailures
      });
    }
    delete stats.currentFailureStreak;
  }

  const cleanWarnings = warnings.filter((item) => [
    "collection_run_degraded",
    "hourly_schedule_gap",
    "source_consecutive_failures",
    "manual_inbox_pressure",
    "run_count_below_target"
  ].includes(item.code));
  const valid = hardErrors.length === 0 && (!requireClean || cleanWarnings.length === 0);

  return {
    auditVersion: HOURLY_POLICY_OPERATIONS_VERSION,
    generatedAt: new Date().toISOString(),
    valid,
    requireClean,
    target: {
      expectedRuns,
      expectedFrequencyMinutes,
      maxGapMinutes
    },
    summary: {
      runCount: runs.length,
      firstRunAt: runs[0]?.crawledAt ?? null,
      lastRunAt: runs.at(-1)?.crawledAt ?? null,
      maxObservedGapMinutes: round(maxObservedGapMinutes),
      distinctCandidatesObserved: candidateFirstSeen.size,
      newCandidateObservations: totalNewCandidatesObserved,
      repeatedCandidateObservations: totalRepeatedCandidateObservations,
      automaticAnalysisSelections: runs.reduce((sum, item) => sum + item.analysisSelected, 0),
      hardErrorCount: hardErrors.length,
      warningCount: warnings.length
    },
    sourceHealth: Object.values(sourceStats),
    runSummaries,
    hardErrors,
    warnings
  };
}

export function candidateIdentity(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  return string(candidate.dedupeKey)
    || string(candidate.contentHash)
    || string(candidate.canonicalSourceUrl)
    || string(candidate.sourceUrl)
    || [string(candidate.issuer), string(candidate.publishDate), string(candidate.title)].filter(Boolean).join("|")
    || null;
}

function normalizeRun(raw, index) {
  const run = raw && typeof raw === "object" ? raw : {};
  const counts = run.counts && typeof run.counts === "object" ? run.counts : {};
  return {
    artifactName: string(run.__artifactName) || `run-${index + 1}`,
    crawledAt: string(run.crawledAt),
    crawledAtMs: Date.parse(string(run.crawledAt)),
    operatingMode: string(run.operatingMode),
    automaticAnalysisSelection: run.automaticAnalysisSelection,
    runStatus: string(run.runStatus) || "unknown",
    sourceKeys: array(run.sourceKeys).map(string).filter(Boolean),
    sourceHealth: array(run.sourceHealth).map((item) => ({
      sourceKey: string(item?.sourceKey),
      status: string(item?.status) || "unknown"
    })),
    candidates: number(counts.candidates),
    withFullText: number(counts.withFullText),
    ingestSelected: number(counts.ingestSelected),
    manualEligible: number(counts.manualEligible),
    recommendedAnalysis: number(counts.recommendedAnalysis),
    analysisSelected: number(counts.analysisSelected),
    queueOverflow: number(counts.queueOverflow),
    analysisQueueLength: array(run.analysisQueue).length,
    candidatesList: array(run.candidates)
  };
}

function sameStringSet(left, right) {
  return left.length === right.length && [...new Set(left)].sort().join("|") === [...new Set(right)].sort().join("|");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

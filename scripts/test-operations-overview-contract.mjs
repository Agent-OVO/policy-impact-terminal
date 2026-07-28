#!/usr/bin/env node

import fs from "node:fs/promises";

const [edgeFunction, repository, productionConfig] = await Promise.all([
  fs.readFile(new URL("../supabase/functions/operations-overview/index.ts", import.meta.url), "utf8"),
  fs.readFile(new URL("../src/lib/reportRepository.ts", import.meta.url), "utf8"),
  fs.readFile(new URL("./configure-production.mjs", import.meta.url), "utf8")
]);

assert(edgeFunction.includes("requireAuthenticatedUser(req, supabase)"), "operations overview must require an authenticated user");
assert(!edgeFunction.includes("requireActiveAdminUser"), "read-only overview must not require admin-only access");
assert(!edgeFunction.includes("full_text"), "operations overview must not read or return policy full text");
assert(edgeFunction.includes('disposition === "quick_archived"'), "quick-archived policies must be excluded");
assert(edgeFunction.includes('disposition === "dismissed"'), "dismissed policies must be excluded");
assert(edgeFunction.includes("awaiting_evidence"), "evidence blocker counts must use the canonical disposition");
assert(edgeFunction.includes("staleOpenAnalysisJobCount"), "open and stale analysis jobs must be included in the aggregate");
assert(edgeFunction.includes('formatVersion: "policy-operations-overview-v1"'), "response must be versioned");
assert(edgeFunction.includes("toSafeQueueRow"), "queue output must pass through a list-safe mapper");
assert(!/toSafeQueueRow[\s\S]*manualReviewReason/.test(edgeFunction), "safe queue output must not disclose review reasons");

assert(/client\.functions\.invoke\([\s\S]*?"operations-overview"/.test(repository), "frontend repository must prefer the canonical operations function");
assert(repository.includes('normalizePendingPolicyAnalysis(data, "legacy_rpc")'), "legacy RPC must remain a compatibility fallback");
assert(repository.includes('source?: "operations_function" | "legacy_rpc"'), "frontend must expose which read path supplied the state");
assert(repository.includes("evidenceBlockers"), "frontend contract must carry evidence blocker counts");

assert(productionConfig.includes('"operations-overview"'), "production deployment allow-list must include operations-overview");
assert(productionConfig.includes("--function="), "production deployment must support a single-function target");
assert(productionConfig.includes("PRODUCTION_FUNCTION_DEPLOY_CONFIRMATION"), "function deployment confirmation gate must remain enforced");

console.log("[operations-overview-test] authenticated read-only aggregation, canonical queue filtering, compatibility fallback, and targeted deployment gate passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

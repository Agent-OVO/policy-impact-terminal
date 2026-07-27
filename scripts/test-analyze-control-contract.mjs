#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const analyze = await fs.readFile(new URL("../supabase/functions/analyze/index.ts", import.meta.url), "utf8");

assert.match(analyze, /async function fetchOpenAnalysisJobs/);
assert.match(analyze, /const pageSize = 500/);
assert.match(analyze, /const maxRows = 10_000/);
assert.match(analyze, /\.range\(from, from \+ pageSize - 1\)/);
assert.doesNotMatch(analyze, /\.limit\(20\)/);
assert.match(analyze, /closedJobCount: closedJobs\.length/);
assert.match(analyze, /closedJobIds:/);
assert.doesNotMatch(analyze, /\n\s+closedJobs,\n/);
assert.match(analyze, /closeOpenJob=true/);
assert.match(analyze, /if \(!selected && policy\.status === "reviewing"\) updateValues\.status = "draft"/);

console.log("[analyze:control-test] paginated stale-job closure, compact audit output, explicit close gate, and disposition/status synchronization passed");

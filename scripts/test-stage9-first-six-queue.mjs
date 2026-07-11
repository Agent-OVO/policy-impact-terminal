#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  filterQueueDisposition,
  loadQueueDisposition,
  validateQueueDisposition
} from "./manage-stage9-first-six-queue.mjs";

const data = await loadQueueDisposition();
const result = validateQueueDisposition(data);
assert.equal(result.itemCount, 8);
assert.equal(result.counts.immediate_analysis, 3);
assert.equal(result.counts.retain_observation, 3);
assert.equal(result.counts.downgrade_archive, 1);
assert.equal(result.counts.defer_pending_evidence, 1);
assert.equal(result.activeCount, 7);

const immediate = filterQueueDisposition(data, "immediate_analysis");
assert.equal(immediate.length, 3);
assert.ok(immediate.some((item) => item.title.includes("输配电价")));
assert.ok(immediate.some((item) => item.title.includes("精细化工")));

const downgraded = filterQueueDisposition(data, "downgrade_archive");
assert.equal(downgraded.length, 1);
assert.ok(downgraded[0].title.includes("物联网"));

const robot = filterQueueDisposition(data, "all", "机器人");
assert.equal(robot.length, 1);
assert.equal(robot[0].disposition, "retain_observation");

const invalid = structuredClone(data);
invalid.items[0].manualReason = "太短";
assert.throws(() => validateQueueDisposition(invalid), /manualReason is too short/);

console.log(`[stage9:first-six-queue-test] items=${result.itemCount} active=${result.activeCount}`);

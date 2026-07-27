#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseCliArgs } from "./lib/cli-args.mjs";

const parsed = parseCliArgs([
  "wait",
  "--policyId=00000000-0000-4000-8000-000000000001",
  "--reason=附件已下载；请以attachment_review_completed=true重新取件",
  "--closeOpenJob=true",
  "--flag"
]);

assert.deepEqual(parsed._, ["wait"]);
assert.equal(parsed.policyId, "00000000-0000-4000-8000-000000000001");
assert.equal(parsed.reason, "附件已下载；请以attachment_review_completed=true重新取件");
assert.equal(parsed.closeOpenJob, "true");
assert.equal(parsed.flag, "true");

const noPositionals = parseCliArgs([
  "ignored",
  "--confirmation=rules-v0.2=approved"
], { keepPositionals: false });
assert.equal(noPositionals.confirmation, "rules-v0.2=approved");
assert.equal(Object.hasOwn(noPositionals, "_"), false);

console.log("[cli:args-test] long options preserve every character after the first equals sign and positional handling remains explicit");

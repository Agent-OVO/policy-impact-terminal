#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { renderManualQualityWorkflow } from "./lib/manual-quality-workflow.mjs";

const target = ".github/workflows/manual-quality.yml";
const actual = (await fs.readFile(target, "utf8")).replace(/\r\n/g, "\n");
const expected = renderManualQualityWorkflow();
assert.equal(
  actual,
  expected,
  `${target} differs from scripts/lib/manual-quality-workflow.mjs; regenerate it from the versioned definition.`
);
console.log("[workflow:generated-check] manual-quality workflow matches generated definition");

#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildFirstSixResearchIndex,
  loadFirstSixBatch,
  queryFirstSixIndex
} from "./query-stage9-first-six.mjs";

const batch = await loadFirstSixBatch();
const index = buildFirstSixResearchIndex(batch);
const summary = queryFirstSixIndex(index, "summary");
assert.equal(summary.policyCount, 6);
assert.ok(summary.industryRelationCount >= 20);
assert.ok(summary.companyRelationCount >= 15);

const grid = queryFirstSixIndex(index, "industry", "电网");
assert.ok(grid.some((item) => item.policyTitle.includes("输配电价")));

const ai = queryFirstSixIndex(index, "industry", "人工智能");
assert.ok(ai.some((item) => item.policyTitle.includes("人工智能＋人社")));
assert.ok(ai.some((item) => item.policyTitle.includes("行业标准")));

const wanhua = queryFirstSixIndex(index, "company", "万华化学");
assert.ok(wanhua.some((item) => item.policyTitle.includes("精细化工")));
assert.ok(wanhua.some((item) => item.policyTitle.includes("行业标准")));
assert.ok(wanhua.every((item) => item.policyEvidence));

const agriculture = queryFirstSixIndex(index, "policy", "农业机器人");
assert.equal(agriculture.length, 1);
const agricultureCompanies = index.companyIndex.filter((item) => item.policyTitle.includes("农业领域机器人"));
assert.equal(agricultureCompanies.length, 0);

const allCompanyRows = queryFirstSixIndex(index, "company", "");
assert.equal(allCompanyRows.length, index.companyIndex.length);

console.log(`[stage9:first-six-query-test] policies=${summary.policyCount} industries=${summary.industryRelationCount} companies=${summary.companyRelationCount}`);

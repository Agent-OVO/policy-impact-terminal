#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  assertUsablePolicyPageHtml,
  validatePolicyPageHtml
} from "./lib/policy-page-validation.mjs";

const miitError = Buffer.from("信息模板页面配置实体不能为空", "utf8");
const miitResult = validatePolicyPageHtml(miitError);
assert.equal(miitResult.valid, false);
assert.match(miitResult.reason, /only \d+ bytes|known error/i);
assert.throws(() => assertUsablePolicyPageHtml(miitError), /Unusable official policy page/);

const accessDenied = Buffer.from(`<!doctype html><html><body>${"Access Denied ".repeat(30)}</body></html>`, "utf8");
const deniedResult = validatePolicyPageHtml(accessDenied);
assert.equal(deniedResult.valid, false);
assert.match(deniedResult.reason, /known error/i);

const plainText = Buffer.from("政策正文".repeat(100), "utf8");
const plainResult = validatePolicyPageHtml(plainText);
assert.equal(plainResult.valid, false);
assert.match(plainResult.reason, /HTML structure/i);

const validHtml = Buffer.from(`<!doctype html><html><head><title>政策发布页</title></head><body><article>${"本通知明确实施范围、工作要求、附件清单和监督机制。".repeat(30)}</article></body></html>`, "utf8");
const validResult = validatePolicyPageHtml(validHtml);
assert.equal(validResult.valid, true);
assert.equal(assertUsablePolicyPageHtml(validHtml).valid, true);

console.log("[policy:page-validation-test] short pseudo-200 pages, access blocks, non-HTML payloads, and valid official pages are correctly distinguished");

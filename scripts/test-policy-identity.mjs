#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildDedupeKey,
  dedupeCandidates,
  extractCoreDocumentTitle,
  findDuplicateGroups,
  normalizePolicyNumber,
  normalizePolicyUrl
} from "./lib/policy-identity.mjs";

assert.equal(
  normalizePolicyUrl("https://example.gov.cn/policy?a=1&utm_source=test#section"),
  "https://example.gov.cn/policy?a=1"
);
assert.equal(normalizePolicyNumber("国家发展改革委令2026年第42号"), "令2026年第42号");
assert.equal(extractCoreDocumentTitle("国家发展改革委关于印发《非化石能源电力消费核算指南（试行）》的通知"), "非化石能源电力消费核算指南试行");
assert.notEqual(
  buildDedupeKey({ title: "关于印发《管理办法》的通知", publishDate: "2026-07-01", sourceUrl: "https://a.example/policy" }),
  buildDedupeKey({ title: "关于印发《管理办法》的通知", publishDate: "2026-07-01", sourceUrl: "https://b.example/policy" }),
  "short generic document titles must not create cross-source semantic identity"
);

const sameUrl = [
  {
    id: "short",
    title: "两部门关于公布网络安全保险试点名单的通知",
    sourceUrl: "https://example.gov.cn/policy.html",
    canonicalSourceUrl: "https://example.gov.cn/policy.html",
    publishDate: "2026-07-17",
    sourcePriority: 90,
    dedupeKey: "title-date:a",
    contentHash: "short-hash",
    fullText: "短正文".repeat(200),
    raw: { attachmentEvidenceIncomplete: true }
  },
  {
    id: "complete",
    title: "两部门关于公布网络安全保险试点名单的通知",
    sourceUrl: "https://example.gov.cn/policy.html#top",
    canonicalSourceUrl: "https://example.gov.cn/policy.html",
    publishDate: "2026-07-17",
    sourcePriority: 90,
    dedupeKey: "title-date:b",
    contentHash: "complete-hash",
    fullText: "完整正文和附件".repeat(800),
    raw: { attachmentEvidenceIncomplete: false }
  }
];
const exactResult = dedupeCandidates(sameUrl);
assert.equal(exactResult.candidates.length, 1);
assert.equal(exactResult.candidates[0].id, "complete");
assert.equal(exactResult.duplicates.length, 1);
assert.equal(exactResult.duplicates[0].reason, "exact-url");

const mirrors = [
  {
    id: "ndrc",
    title: "关于印发《非化石能源电力消费核算指南（试行）》的通知(发改能源〔2026〕622号)",
    sourceUrl: "https://ndrc.example/doc",
    canonicalSourceUrl: "https://ndrc.example/doc",
    publishDate: "2026-06-01",
    policyNo: "发改能源〔2026〕622号",
    sourcePriority: 90,
    dedupeKey: buildDedupeKey({
      title: "关于印发《非化石能源电力消费核算指南（试行）》的通知(发改能源〔2026〕622号)",
      publishDate: "2026-06-01",
      policyNo: "发改能源〔2026〕622号"
    }),
    fullText: "发改委正文".repeat(500),
    raw: { attachmentEvidenceIncomplete: false }
  },
  {
    id: "nda",
    title: "国家发展改革委、国家能源局等部门关于印发《非化石能源电力消费核算指南（试行）》的通知",
    sourceUrl: "https://nda.example/mirror",
    canonicalSourceUrl: "https://nda.example/mirror",
    publishDate: "2026-06-01",
    sourcePriority: 88,
    dedupeKey: buildDedupeKey({
      title: "国家发展改革委、国家能源局等部门关于印发《非化石能源电力消费核算指南（试行）》的通知",
      publishDate: "2026-06-01",
      policyNo: null
    }),
    fullText: "镜像正文".repeat(300),
    raw: { attachmentEvidenceIncomplete: false }
  }
];
const mirrorResult = dedupeCandidates(mirrors);
assert.equal(mirrorResult.candidates.length, 1);
assert.equal(mirrorResult.candidates[0].id, "ndrc");
assert.equal(mirrorResult.duplicates.length, 1);
assert.ok(["policy-no", "document-title-date"].includes(mirrorResult.duplicates[0].reason));

const groups = findDuplicateGroups([...sameUrl, ...mirrors]);
assert.equal(groups.length, 2);
assert.ok(groups.some((group) => group.reasons.includes("exact-url")));
assert.ok(groups.some((group) => group.reasons.includes("document-title-date")));

console.log("[policy:identity-test] exact URL, policy number, core document title, cross-source mirror, and canonical preference gates passed");

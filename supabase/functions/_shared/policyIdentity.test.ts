import {
  buildDedupeKey,
  extractCoreDocumentTitle,
  normalizePolicyNumber,
  normalizePolicyUrl,
  samePolicyIdentity
} from "./policyIdentity.ts";

Deno.test("policy identity normalizes official URLs and policy numbers", () => {
  assertEquals(
    normalizePolicyUrl("https://example.gov.cn/policy?utm_source=test&a=1#top"),
    "https://example.gov.cn/policy?a=1"
  );
  assertEquals(normalizePolicyNumber("国家发展改革委令2026年第42号"), "令2026年第42号");
});

Deno.test("policy identity matches exact URLs even when content differs", () => {
  assertEquals(samePolicyIdentity(
    {
      title: "短正文候选",
      publishDate: "2026-07-17",
      canonicalSourceUrl: "https://example.gov.cn/policy.html"
    },
    {
      title: "完整正文候选",
      publishDate: "2026-07-17",
      canonicalSourceUrl: "https://example.gov.cn/policy.html#content"
    }
  ), true);
});

Deno.test("policy identity does not merge short generic document titles", () => {
  const first = buildDedupeKey({
    title: "关于印发《管理办法》的通知",
    publishDate: "2026-07-01",
    sourceUrl: "https://a.example/policy"
  });
  const second = buildDedupeKey({
    title: "关于印发《管理办法》的通知",
    publishDate: "2026-07-01",
    sourceUrl: "https://b.example/policy"
  });
  if (first === second) throw new Error(`Generic title collision: ${first}`);
});

Deno.test("policy identity matches cross-source mirrors by core document title", () => {
  const first = "关于印发《非化石能源电力消费核算指南（试行）》的通知";
  const second = "国家发展改革委等部门关于印发《非化石能源电力消费核算指南（试行）》的通知";
  assertEquals(extractCoreDocumentTitle(first), extractCoreDocumentTitle(second));
  assertEquals(samePolicyIdentity(
    { title: first, publishDate: "2026-06-01", sourceUrl: "https://ndrc.example/doc" },
    { title: second, publishDate: "2026-06-01", sourceUrl: "https://nda.example/doc" }
  ), true);
  assertEquals(buildDedupeKey({ title: first, publishDate: "2026-06-01" }), buildDedupeKey({ title: second, publishDate: "2026-06-01" }));
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

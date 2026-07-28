#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = path.join(root, "supabase/functions/operations-overview/index.ts");

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  write: false,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  external: ["https://*"],
  logLevel: "silent"
});

if (!result.outputFiles?.length) {
  throw new Error("operations-overview Edge Function did not produce a bundle");
}

const bundledText = result.outputFiles[0].text;
if (!bundledText.includes("policy-operations-overview-v1")) {
  throw new Error("operations-overview bundle is missing the versioned response contract");
}
if (bundledText.includes("full_text")) {
  throw new Error("operations-overview bundle must not include policy full text access");
}

console.log(`[operations-overview-bundle-test] bundled ${result.outputFiles[0].contents.byteLength} bytes with local TypeScript and module resolution intact`);

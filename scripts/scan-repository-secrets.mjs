#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rules = [
  { id: "private_key_pem", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "github_pat", regex: /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/ },
  { id: "openai_key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { id: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "postgres_password_url", regex: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{8,}@/i },
  { id: "literal_service_role", regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^$<{\s][^"']{20,}["']/ },
  { id: "literal_crawler_secret", regex: /(?:SUPABASE_CRAWLER_SECRET|CRAWLER_INGEST_SECRET)\s*[:=]\s*["'][^$<{\s][^"']{20,}["']/ }
];
const ignoredPaths = [
  /^package-lock\.json$/,
  /^docs\/operations\/PRODUCTION_CHANGE_CONTROL\.md$/
];
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const findings = [];
for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (ignoredPaths.some((pattern) => pattern.test(normalized))) continue;
  const absolute = path.resolve(file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of rules) {
      if (rule.regex.test(line) && !isPlaceholder(line)) {
        findings.push({ file: normalized, line: index + 1, rule: rule.id });
      }
    }
  }
}
console.log(JSON.stringify({ ok: findings.length === 0, scannedFiles: files.length, findingCount: findings.length, findings }, null, 2));
if (findings.length > 0) process.exitCode = 1;

function isPlaceholder(line) {
  return /<[^>]+>|\$\{|process\.env|secrets\.|\[redacted\]|example\.com|user:pass|YOUR_|CHANGE_ME/i.test(line);
}

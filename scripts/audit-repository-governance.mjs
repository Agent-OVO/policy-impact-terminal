#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const actionsPermissions = ghJson([`repos/${args.repo}/actions/permissions`]);
const workflowPermissions = ghJson([`repos/${args.repo}/actions/permissions/workflow`]);
const rulesets = ghJson([`repos/${args.repo}/rulesets`], []);
const environments = ghJson([`repos/${args.repo}/environments`], { total_count: 0, environments: [] });
const branchProtection = ghJson([`repos/${args.repo}/branches/${args.branch}/protection`], null);
const report = {
  formatVersion: "repository-governance-audit-v1",
  generatedAt: new Date().toISOString(),
  repository: args.repo,
  branch: args.branch,
  readOnlyAudit: true,
  actions: {
    enabled: actionsPermissions?.enabled === true,
    allowedActions: actionsPermissions?.allowed_actions ?? null,
    shaPinningRequired: actionsPermissions?.sha_pinning_required === true,
    defaultWorkflowPermissions: workflowPermissions?.default_workflow_permissions ?? null,
    workflowsCanApprovePullRequests: workflowPermissions?.can_approve_pull_request_reviews === true
  },
  branchProtection: {
    protected: Boolean(branchProtection),
    requiredStatusChecks: branchProtection?.required_status_checks ?? null,
    requiredPullRequestReviews: branchProtection?.required_pull_request_reviews ?? null,
    enforceAdmins: branchProtection?.enforce_admins?.enabled === true
  },
  rulesets: Array.isArray(rulesets)
    ? rulesets.map((item) => ({ id: item.id, name: item.name, target: item.target, enforcement: item.enforcement }))
    : [],
  environments: (environments?.environments ?? []).map((item) => ({
    name: item.name,
    protectionRules: (item.protection_rules ?? []).map((rule) => rule.type),
    deploymentBranchPolicy: item.deployment_branch_policy ?? null
  }))
};
report.findings = [
  ...(!report.branchProtection.protected && report.rulesets.length === 0 ? ["main_branch_has_no_protection_or_ruleset"] : []),
  ...(report.actions.allowedActions === "all" ? ["all_github_actions_are_allowed"] : []),
  ...(!report.actions.shaPinningRequired ? ["repository_does_not_require_action_sha_pinning"] : []),
  ...(report.actions.defaultWorkflowPermissions !== "read" ? ["default_workflow_token_is_not_read_only"] : [])
];
report.ok = report.findings.length === 0;
await writeJson(args.out, report);
console.log(`[security:governance] branchProtected=${report.branchProtection.protected} rulesets=${report.rulesets.length} allowedActions=${report.actions.allowedActions} shaPinningRequired=${report.actions.shaPinningRequired}`);
console.log(`[security:governance] findings=${report.findings.join(",") || "none"}`);
console.log(`[security:governance] wrote ${path.resolve(args.out)}`);
if (args.requireClean && !report.ok) process.exitCode = 2;

function ghJson(apiArgs, fallback = undefined) {
  try {
    const output = execFileSync("gh", ["api", ...apiArgs], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000
    });
    return JSON.parse(output);
  } catch (error) {
    if (fallback !== undefined) return fallback;
    const stderr = String(error?.stderr ?? "");
    if (/Branch not protected|HTTP 404/.test(stderr)) return null;
    throw new Error(sanitize(stderr || error?.message || "GitHub API failed"));
  }
}
function parseArgs(argv) {
  const parsed = {
    repo: process.env.GITHUB_REPOSITORY || "Agent-OVO/policy-impact-terminal",
    branch: "main",
    out: "artifacts/repository-governance-audit.json",
    requireClean: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--repo=")) parsed.repo = arg.slice(7);
    else if (arg.startsWith("--branch=")) parsed.branch = arg.slice(9);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice(6);
    else if (arg === "--require-clean") parsed.requireClean = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/audit-repository-governance.mjs [--require-clean]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
function sanitize(value) { return String(value ?? "").replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 2_000); }
async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

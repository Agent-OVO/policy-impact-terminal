#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "qxzspsofhmfjceuaulhu";
const PROJECT_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const GITHUB_REPO = process.env.GITHUB_REPO || "Agent-OVO/policy-impact-terminal";
const providedCrawlerSecret = Boolean(process.env.SUPABASE_CRAWLER_SECRET);
const CRAWLER_SECRET =
  process.env.SUPABASE_CRAWLER_SECRET || crypto.randomBytes(32).toString("base64url");

const args = new Set(process.argv.slice(2));
const dispatchWorkflows = args.has("--dispatch");
const applyFunctions = args.has("--apply-functions");
const applyGithubSecrets = args.has("--apply-github-secrets");
const applySupabaseSecrets = args.has("--apply-supabase-secrets");
const applyDatabaseMigrations = args.has("--apply-db-migrations");
const deployableFunctions = ["ingest", "analyze", "publish", "operations-overview"];
const requestedFunctions = [...args]
  .filter((arg) => arg.startsWith("--function="))
  .map((arg) => arg.slice("--function=".length).trim())
  .filter(Boolean);
const backupManifestPath = path.resolve("artifacts/production-backups/latest-manifest.json");

function run(command, commandArgs, { input, quiet = false } = {}) {
  const label = [command, ...commandArgs].join(" ");
  if (!quiet) console.log(`> ${label}`);
  const options = {
    encoding: "utf8",
    stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  };
  if (input !== undefined) options.input = input;
  try {
    return execFileSync(command, commandArgs, options);
  } catch (error) {
    if (quiet) {
      const sanitized = new Error(error?.stderr?.toString?.() || "Command failed.");
      sanitized.status = error?.status;
      throw sanitized;
    }
    throw error;
  }
}

function runVisible(command, commandArgs) {
  const label = [command, ...maskCommandArgs(commandArgs)].join(" ");
  console.log(`> ${label}`);
  execFileSync(command, commandArgs, { stdio: "inherit" });
}

function maskCommandArgs(commandArgs) {
  const sensitive = new Set(
    [
      process.env.SUPABASE_DB_PASSWORD,
      process.env.SUPABASE_CRAWLER_SECRET,
      process.env.SUPABASE_ACCESS_TOKEN
    ].filter(Boolean),
  );

  return commandArgs.map((arg) => sensitive.has(arg) ? "***" : arg);
}

function quoteCmdArg(arg) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) return arg;
  return `"${String(arg).replace(/(["^&|<>%])/g, "^$1")}"`;
}

function runNpx(commandArgs, options) {
  if (process.platform !== "win32") return run("npx", commandArgs, options);
  return run("cmd.exe", ["/d", "/s", "/c", ["npx", ...commandArgs].map(quoteCmdArg).join(" ")], options);
}

function runVisibleNpx(commandArgs) {
  if (process.platform !== "win32") {
    runVisible("npx", commandArgs);
    return;
  }
  runVisible("cmd.exe", ["/d", "/s", "/c", ["npx", ...commandArgs].map(quoteCmdArg).join(" ")]);
}

function supabase(commandArgs, options) {
  return runNpx(["supabase", ...commandArgs], options);
}

function supabaseVisible(commandArgs) {
  runVisibleNpx(["supabase", ...commandArgs]);
}

function collectKeyRows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(collectKeyRows);
  if (typeof value !== "object") return [];

  const hasKey = ["key", "api_key", "apiKey", "value"].some((field) => typeof value[field] === "string");
  if (hasKey) return [value];

  return Object.values(value).flatMap(collectKeyRows);
}

function readKey(row) {
  return row.key || row.api_key || row.apiKey || row.value || "";
}

function readName(row) {
  return [row.name, row.type, row.key_name, row.keyName, row.prefix]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getApiKeys() {
  const raw = supabase(["projects", "api-keys", "--project-ref", PROJECT_REF, "--output", "json"], {
    quiet: true,
  });
  const rows = collectKeyRows(JSON.parse(raw));

  const anon = rows.find((row) => /\banon\b|publishable/.test(readName(row)));
  const service = rows.find((row) => /service[_ -]?role|secret/.test(readName(row)));

  if (!anon || !readKey(anon)) {
    throw new Error("Could not find the Supabase anon/publishable key from project api-keys output.");
  }
  if (!service || !readKey(service)) {
    throw new Error("Could not find the Supabase service role/secret key from project api-keys output.");
  }

  return {
    anonKey: readKey(anon),
    serviceRoleKey: readKey(service),
  };
}

async function resolveCrawlerOwner(serviceRoleKey) {
  if (process.env.CRAWLER_OWNER_ID) return process.env.CRAWLER_OWNER_ID;

  const ownerEmail =
    process.env.CRAWLER_OWNER_EMAIL || `crawler-owner+${PROJECT_REF}@policy-impact-terminal.local`;

  const admin = createClient(PROJECT_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let page = 1;
  let foundUser = null;
  while (!foundUser) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    foundUser = data.users.find((user) => user.email?.toLowerCase() === ownerEmail.toLowerCase());
    if (foundUser || data.users.length < 100) break;
    page += 1;
  }

  if (!foundUser) {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: crypto.randomBytes(24).toString("base64url"),
      email_confirm: true,
      user_metadata: {
        name: "Policy crawler owner",
        systemRole: "scheduled-crawler"
      }
    });

    if (createUserError || !createdUser.user) {
      throw createUserError || new Error(`Unable to create crawler owner ${ownerEmail}.`);
    }

    foundUser = createdUser.user;
  }

  const { error } = await admin.from("profiles").upsert(
    {
      id: foundUser.id,
      display_name: foundUser.email,
      role: "admin",
      status: "active",
      subscription_tier: "enterprise",
      subscription_status: "active",
    },
    { onConflict: "id" },
  );

  if (error) throw error;
  return foundUser.id;
}

function setGithubSecret(name, value) {
  run("gh", ["secret", "set", name, "--repo", GITHUB_REPO, "--body", value], { quiet: true });
  console.log(`[ok] GitHub secret ${name}`);
}

function setSupabaseSecrets(secrets) {
  const args = Object.entries(secrets).map(
    ([key, value]) => `${key}=${String(value).replace(/\r?\n/g, "")}`,
  );
  supabase(["secrets", "set", ...args, "--project-ref", PROJECT_REF], { quiet: true });
  console.log("[ok] Supabase Edge Function secrets");
}

function deployFunctions() {
  const functionNames = requestedFunctions.length > 0 ? [...new Set(requestedFunctions)] : deployableFunctions;
  const invalidFunctions = functionNames.filter((name) => !deployableFunctions.includes(name));
  if (invalidFunctions.length > 0) {
    throw new Error(`Unsupported function deployment target(s): ${invalidFunctions.join(", ")}.`);
  }
  for (const functionName of functionNames) {
    runVisibleNpx([
      "supabase",
      "functions",
      "deploy",
      functionName,
      "--project-ref",
      PROJECT_REF,
      "--use-api",
    ]);
  }
}

function buildDbArgs(baseArgs) {
  return process.env.SUPABASE_DB_PASSWORD
    ? [...baseArgs, "--password", process.env.SUPABASE_DB_PASSWORD]
    : baseArgs;
}

function pushDatabaseMigrations() {
  console.log("[db] Linking Supabase project and pushing migrations");
  supabaseVisible(buildDbArgs(["link", "--project-ref", PROJECT_REF]));
  supabaseVisible(buildDbArgs(["db", "push", "--include-all", "--yes"]));
}

function triggerWorkflows() {
  runVisible("gh", ["workflow", "run", "Deploy GitHub Pages", "--repo", GITHUB_REPO]);
  runVisible("gh", [
    "workflow",
    "run",
    "Crawl policy sources hourly",
    "--repo",
    GITHUB_REPO,
    "-f",
    "source=all"
  ]);
}

function requireConfirmation(name, expected) {
  if (process.env[name] !== expected) {
    throw new Error(`Set ${name}=${expected} only after independent review and explicit approval.`);
  }
}

function requireVerifiedBackupManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(backupManifestPath, "utf8"));
  } catch {
    throw new Error(`Verified backup manifest is required before database migration: ${backupManifestPath}`);
  }
  const valid = manifest?.formatVersion === "zero-cost-logical-backup-v1" &&
    manifest?.projectRef === PROJECT_REF &&
    manifest?.readOnlyExport === true &&
    manifest?.cryptographicSelfCheckPassed === true &&
    manifest?.restoreVerified === true;
  if (!valid) {
    throw new Error("Database migration is blocked until the encrypted logical backup has passed a dedicated local restore verification.");
  }
}

function printHelp() {
  console.log(`Production configuration is validation-only by default.\n\nWrite flags:\n  --apply-functions [--function=<name>]\n  --apply-github-secrets\n  --apply-supabase-secrets\n  --apply-db-migrations\n  --dispatch\n\nDeployable functions:\n  ${deployableFunctions.join(", ")}\n\nRequired confirmations:\n  PRODUCTION_FUNCTION_DEPLOY_CONFIRMATION=DEPLOY_FUNCTIONS:${PROJECT_REF}\n  PRODUCTION_SECRET_ROTATION_CONFIRMATION=ROTATE_SECRETS:${PROJECT_REF}\n  PRODUCTION_DB_MIGRATION_CONFIRMATION=APPLY_MIGRATIONS:${PROJECT_REF}\n  PRODUCTION_WORKFLOW_DISPATCH_CONFIRMATION=DISPATCH_WORKFLOWS:${PROJECT_REF}\n\nDatabase migrations additionally require a restore-verified encrypted backup manifest at:\n  ${backupManifestPath}`);
}

async function main() {
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  console.log(`Production configuration target: ${GITHUB_REPO}`);
  console.log(`Supabase project: ${PROJECT_REF}`);
  console.log(`[plan] functions=${applyFunctions} functionTargets=${requestedFunctions.join(",") || "all"} githubSecrets=${applyGithubSecrets} supabaseSecrets=${applySupabaseSecrets} databaseMigrations=${applyDatabaseMigrations} dispatch=${dispatchWorkflows}`);

  const anyWrite = applyFunctions || applyGithubSecrets || applySupabaseSecrets || applyDatabaseMigrations || dispatchWorkflows;
  if (!anyWrite) {
    console.log("[validation-only] No production write flag was supplied. No keys were loaded and no remote resource was modified.");
    printHelp();
    return;
  }

  if (applyDatabaseMigrations) {
    requireConfirmation("PRODUCTION_DB_MIGRATION_CONFIRMATION", `APPLY_MIGRATIONS:${PROJECT_REF}`);
    requireVerifiedBackupManifest();
    pushDatabaseMigrations();
  }

  if (applyFunctions) {
    requireConfirmation("PRODUCTION_FUNCTION_DEPLOY_CONFIRMATION", `DEPLOY_FUNCTIONS:${PROJECT_REF}`);
    deployFunctions();
  }

  if (applyGithubSecrets || applySupabaseSecrets) {
    requireConfirmation("PRODUCTION_SECRET_ROTATION_CONFIRMATION", `ROTATE_SECRETS:${PROJECT_REF}`);
    const { anonKey, serviceRoleKey } = getApiKeys();
    console.log("[ok] Supabase API keys loaded for explicit secret rotation");
    let crawlerOwnerId = process.env.CRAWLER_OWNER_ID || "";

    if (applySupabaseSecrets) {
      crawlerOwnerId = await resolveCrawlerOwner(serviceRoleKey);
      console.log("[ok] Crawler owner resolved");
      setSupabaseSecrets({
        SUPABASE_URL: PROJECT_URL,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        CRAWLER_INGEST_SECRET: CRAWLER_SECRET,
        CRAWLER_OWNER_ID: crawlerOwnerId
      });
    }

    if (applyGithubSecrets) {
      setGithubSecret("VITE_SUPABASE_URL", PROJECT_URL);
      setGithubSecret("VITE_SUPABASE_ANON_KEY", anonKey);
      setGithubSecret("SUPABASE_URL", PROJECT_URL);
      setGithubSecret("SUPABASE_FUNCTION_JWT", anonKey);
      if (applySupabaseSecrets || providedCrawlerSecret) {
        setGithubSecret("SUPABASE_CRAWLER_SECRET", CRAWLER_SECRET);
      } else {
        console.log("[skip] SUPABASE_CRAWLER_SECRET was not rotated because no matching Supabase secret write was requested.");
      }
    }
  }

  if (dispatchWorkflows) {
    requireConfirmation("PRODUCTION_WORKFLOW_DISPATCH_CONFIRMATION", `DISPATCH_WORKFLOWS:${PROJECT_REF}`);
    triggerWorkflows();
  }

  console.log("[done] Explicit production changes finished.");
}

main().catch((error) => {
  const detail = error?.stderr?.toString?.() || error?.message || String(error);
  console.error(`[error] ${detail.trim()}`);
  console.error(
    "Hint: run `npx supabase login --token <SUPABASE_ACCESS_TOKEN> --name policy-impact-terminal` before this setup script.",
  );
  process.exitCode = 1;
});

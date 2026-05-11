#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "qxzspsofhmfjceuaulhu";
const PROJECT_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const GITHUB_REPO = process.env.GITHUB_REPO || "Agent-OVO/policy-impact-terminal";
const providedCrawlerSecret = Boolean(process.env.SUPABASE_CRAWLER_SECRET);
const CRAWLER_SECRET =
  process.env.SUPABASE_CRAWLER_SECRET || crypto.randomBytes(32).toString("base64url");

const args = new Set(process.argv.slice(2));
const dispatchWorkflows = args.has("--dispatch");
const skipFunctions = args.has("--skip-functions");
const skipGithubSecrets = args.has("--skip-github-secrets");
const skipSupabaseSecrets = args.has("--skip-supabase-secrets");
const skipDatabase = args.has("--skip-db");

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
  for (const functionName of ["ingest", "analyze", "publish"]) {
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
    "Crawl policy sources",
    "--repo",
    GITHUB_REPO,
    "-f",
    "source=all",
    "-f",
    "limit=20",
  ]);
}

async function main() {
  console.log(`Configuring production for ${GITHUB_REPO}`);
  console.log(`Supabase project: ${PROJECT_REF}`);

  const { anonKey, serviceRoleKey } = getApiKeys();
  console.log("[ok] Supabase API keys loaded");

  if (!skipDatabase) {
    pushDatabaseMigrations();
  }

  let crawlerOwnerId = process.env.CRAWLER_OWNER_ID || "";
  if (!skipSupabaseSecrets) {
    crawlerOwnerId = await resolveCrawlerOwner(serviceRoleKey);
    console.log("[ok] Crawler owner resolved");
  }

  if (!skipGithubSecrets) {
    setGithubSecret("VITE_SUPABASE_URL", PROJECT_URL);
    setGithubSecret("VITE_SUPABASE_ANON_KEY", anonKey);
    setGithubSecret("SUPABASE_URL", PROJECT_URL);
    setGithubSecret("SUPABASE_FUNCTION_JWT", anonKey);
    if (!skipSupabaseSecrets || providedCrawlerSecret) {
      setGithubSecret("SUPABASE_CRAWLER_SECRET", CRAWLER_SECRET);
    } else {
      console.log("[skip] GitHub secret SUPABASE_CRAWLER_SECRET until Supabase function secrets are configured");
    }
  }

  if (!skipSupabaseSecrets) {
    setSupabaseSecrets({
      SUPABASE_URL: PROJECT_URL,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      CRAWLER_INGEST_SECRET: CRAWLER_SECRET,
      CRAWLER_OWNER_ID: crawlerOwnerId,
    });
  }

  if (!skipFunctions) deployFunctions();
  if (dispatchWorkflows) triggerWorkflows();

  console.log("[done] Production configuration finished.");
}

main().catch((error) => {
  const detail = error?.stderr?.toString?.() || error?.message || String(error);
  console.error(`[error] ${detail.trim()}`);
  console.error(
    "Hint: run `npx supabase login --token <SUPABASE_ACCESS_TOKEN> --name policy-impact-terminal` before this setup script.",
  );
  process.exitCode = 1;
});

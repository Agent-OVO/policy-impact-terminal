#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const AUTH_DOMAIN = "users.policy-impact-terminal.invalid";
const DEFAULT_ORIGIN = "https://agent-ovo.github.io";
const DEFAULT_PROJECT_REF = "qxzspsofhmfjceuaulhu";

function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[++index] : true;
    options[key] = value;
  }
  return { command, options };
}

function run(command, args) {
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    return execFileSync(command, args, options);
  } catch (error) {
    throw new Error(error?.stderr?.toString?.().trim() || `${command} failed.`);
  }
}

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${String(value).replace(/(["^&|<>%])/g, "^$1")}"`;
}

function runNpx(args) {
  if (process.platform !== "win32") return run("npx", args);
  return run("cmd.exe", ["/d", "/s", "/c", ["npx", ...args].map(quoteCmdArg).join(" ")]);
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

function getProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const localRef = path.resolve("supabase", ".temp", "project-ref");
  if (fs.existsSync(localRef)) return fs.readFileSync(localRef, "utf8").trim();
  return DEFAULT_PROJECT_REF;
}

function getApiKeys(projectRef) {
  if (process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
  }

  const raw = runNpx(["supabase", "projects", "api-keys", "--project-ref", projectRef, "--output", "json"]);
  const rows = collectKeyRows(JSON.parse(raw));
  const anon = rows.find((row) => /\banon\b|publishable/.test(readName(row)));
  const service = rows.find((row) => /service[_ -]?role|secret/.test(readName(row)));
  if (!anon || !readKey(anon)) throw new Error("Supabase anon/publishable key was not found.");
  if (!service || !readKey(service)) throw new Error("Supabase service role/secret key was not found.");
  return { anonKey: readKey(anon), serviceRoleKey: readKey(service) };
}

function getClients(projectRef) {
  const projectUrl = process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`;
  const { anonKey, serviceRoleKey } = getApiKeys(projectRef);
  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const browserAuth = createClient(projectUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return { projectUrl, admin, browserAuth };
}

function secureWrite(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows ACLs are managed by the current user; chmod may be advisory only.
  }
}

function normalizeOrigin(value) {
  const parsed = new URL(value || DEFAULT_ORIGIN);
  return parsed.origin;
}

async function createQaUser(options) {
  const projectRef = getProjectRef();
  const origin = normalizeOrigin(options.origin);
  const { admin, browserAuth } = getClients(projectRef);
  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`.slice(-14);
  const username = `qa_${suffix}`.slice(0, 32).toLowerCase();
  const email = `${username}@${AUTH_DOMAIN}`;
  const password = crypto.randomBytes(24).toString("base64url");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-production-qa-"));
  const contextPath = path.join(tempDir, "context.json");
  const storageStatePath = path.join(tempDir, "storage-state.json");

  let createdUserId = "";
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: username,
        username,
        purpose: "ephemeral-production-qa"
      }
    });
    if (createError || !created.user) throw createError || new Error("QA user creation returned no user.");
    createdUserId = created.user.id;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: createdUserId,
        display_name: username,
        role: "user",
        status: "active",
        subscription_tier: "free",
        subscription_status: "active",
        metadata: { purpose: "ephemeral-production-qa" }
      },
      { onConflict: "id" }
    );
    if (profileError) throw profileError;

    const { data: signedIn, error: signInError } = await browserAuth.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw signInError || new Error("QA user sign-in returned no session.");

    const storageKey = `sb-${projectRef}-auth-token`;
    const storageState = {
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [{ name: storageKey, value: JSON.stringify(signedIn.session) }]
        }
      ]
    };
    const context = {
      version: 1,
      projectRef,
      origin,
      userId: createdUserId,
      username,
      email,
      storageStatePath,
      createdAt: new Date().toISOString()
    };
    secureWrite(storageStatePath, storageState);
    secureWrite(contextPath, context);

    console.log(JSON.stringify({
      ok: true,
      contextPath,
      storageStatePath,
      userId: createdUserId,
      username,
      origin
    }));
  } catch (error) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function verifyDeleted(admin, userId) {
  const checks = {};
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  checks.authUser = !userData?.user && Boolean(userError);

  for (const [name, column] of [
    ["profiles", "id"],
    ["user_events", "user_id"],
    ["analysis_jobs", "owner_id"]
  ]) {
    const { count, error } = await admin.from(name).select("*", { count: "exact", head: true }).eq(column, userId);
    if (error) throw error;
    checks[name] = count === 0;
  }

  return checks;
}

async function cleanupQaUser(options) {
  if (!options.context || options.context === true) throw new Error("cleanup requires --context <path>.");
  const contextPath = path.resolve(String(options.context));
  const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  const { admin } = getClients(context.projectRef || getProjectRef());

  const { error } = await admin.auth.admin.deleteUser(context.userId);
  if (error && !/not found/i.test(error.message || "")) throw error;
  const checks = await verifyDeleted(admin, context.userId);
  const ok = Object.values(checks).every(Boolean);

  fs.rmSync(path.dirname(contextPath), { recursive: true, force: true });
  console.log(JSON.stringify({ ok, userId: context.userId, checks }));
  if (!ok) process.exitCode = 1;
}

async function auditQaUsers() {
  const { admin } = getClients(getProjectRef());
  const managedEphemeralUsers = [];
  const legacyTestCandidates = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users ?? []) {
      const localPart = user.email?.split("@")[0]?.toLowerCase() ?? "";
      const row = { id: user.id, email: user.email, createdAt: user.created_at };
      if (
        user.user_metadata?.purpose === "ephemeral-production-qa" ||
        (user.email?.endsWith(`@${AUTH_DOMAIN}`) && localPart.startsWith("qa_"))
      ) {
        managedEphemeralUsers.push(row);
      } else if (user.email?.endsWith(`@${AUTH_DOMAIN}`) && localPart.startsWith("codexqa")) {
        legacyTestCandidates.push(row);
      }
    }
    if ((data.users ?? []).length < 1000) break;
    page += 1;
  }

  const result = {
    ok: managedEphemeralUsers.length === 0,
    count: managedEphemeralUsers.length,
    users: managedEphemeralUsers,
    legacyTestCandidates
  };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

async function auditLegacyQaUsers() {
  const { admin } = getClients(getProjectRef());
  const candidates = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    candidates.push(...(data.users ?? []).filter((user) => {
      const localPart = user.email?.split("@")[0]?.toLowerCase() ?? "";
      return user.email?.endsWith(`@${AUTH_DOMAIN}`) && localPart.startsWith("codexqa");
    }));
    if ((data.users ?? []).length < 1000) break;
    page += 1;
  }

  const users = [];
  for (const user of candidates) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,display_name,role,status,subscription_tier,subscription_status,metadata")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const { count: userEventCount, error: eventError } = await admin
      .from("user_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (eventError) throw eventError;
    const { data: jobs, error: jobsError } = await admin
      .from("analysis_jobs")
      .select("id,status,created_at,finished_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (jobsError) throw jobsError;
    const jobStatuses = {};
    for (const job of jobs ?? []) jobStatuses[job.status] = (jobStatuses[job.status] ?? 0) + 1;
    const purposefulProfile = profile?.metadata?.purpose && profile.metadata.purpose !== "ephemeral-production-qa";
    const deletionEligible = (userEventCount ?? 0) === 0 && (jobs?.length ?? 0) === 0 && !purposefulProfile;
    users.push({
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      profile: profile ?? null,
      userEventCount: userEventCount ?? 0,
      analysisJobCount: jobs?.length ?? 0,
      analysisJobStatuses: jobStatuses,
      deletionEligible,
      recommendation: deletionEligible
        ? "eligible_for_explicit_user_approved_deletion"
        : "retain_until_dependencies_are_reviewed"
    });
  }

  console.log(JSON.stringify({
    ok: true,
    count: users.length,
    deletionEligibleCount: users.filter((item) => item.deletionEligible).length,
    users
  }));
}

async function verifyQaUser(options) {
  if (!options.context || options.context === true) throw new Error("verify requires --context <path>.");
  const context = JSON.parse(fs.readFileSync(path.resolve(String(options.context)), "utf8"));
  const { admin } = getClients(context.projectRef || getProjectRef());
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(context.userId);
  const { count: profileCount, error: profileError } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("id", context.userId);
  if (profileError) throw profileError;
  console.log(JSON.stringify({
    ok: !userError && Boolean(userData?.user) && profileCount === 1,
    userId: context.userId,
    username: context.username,
    profileCount
  }));
}

const { command, options } = parseArgs(process.argv.slice(2));

try {
  if (command === "create") await createQaUser(options);
  else if (command === "cleanup") await cleanupQaUser(options);
  else if (command === "verify") await verifyQaUser(options);
  else if (command === "audit") await auditQaUsers();
  else if (command === "audit-legacy") await auditLegacyQaUsers();
  else {
    console.error("Usage: node scripts/manage-production-qa-user.mjs <create|verify|cleanup|audit|audit-legacy> [--origin URL] [--context PATH]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`[production-qa-user] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

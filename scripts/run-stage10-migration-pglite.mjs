#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const migration = "supabase/migrations/20260711020000_stage10_cross_policy_observation_kernel.sql";
const forwarded = process.argv.slice(2);

const { stdout, stderr } = await execFileAsync(process.execPath, [
  path.resolve("scripts/run-stage7-migration-pglite.mjs"),
  "--stage10-migration=" + migration,
  ...forwarded
], {
  cwd: process.cwd(),
  timeout: 240_000,
  maxBuffer: 24 * 1024 * 1024,
  windowsHide: true
});

if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

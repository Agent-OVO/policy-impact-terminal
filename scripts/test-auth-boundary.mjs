#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const app = await fs.readFile("src/App.tsx", "utf8");
const config = await fs.readFile("supabase/config.toml", "utf8");

assert.doesNotMatch(app, /supabase\.auth\.signUp\s*\(/, "public signUp must not exist in the frozen frontend");
assert.doesNotMatch(app, /创建账号|注册无需邮箱确认|普通用户注册后即可/, "public registration copy must not exist");
assert.match(app, /仅限已获授权的内部账号登录；新账号由管理员创建。/);

const globalSignup = config.match(/# Allow\/disallow new user signups to your project\.\s*\nenable_signup\s*=\s*(true|false)/);
const emailSignup = config.match(/\[auth\.email\][\s\S]*?# Allow\/disallow new user signups via email to your project\.\s*\nenable_signup\s*=\s*(true|false)/);
assert.equal(globalSignup?.[1], "false", "global Supabase signup must be disabled");
assert.equal(emailSignup?.[1], "false", "email signup must be disabled");
assert.match(config, /enable_anonymous_sign_ins\s*=\s*false/);

console.log("[auth:test] invite-only login boundary passed");

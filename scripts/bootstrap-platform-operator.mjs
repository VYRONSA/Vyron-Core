#!/usr/bin/env node
/**
 * Promote an existing account to Platform Operator.
 *
 * Why this exists: every Platform Console gate (middleware.ts,
 * app/api/platform/_shared.ts, public.vyron_is_platform_operator()) reads the operator
 * claim from auth.users.raw_app_meta_data. That column can only be written with the
 * service role, so on a fresh project nobody can reach /platform. This script performs
 * that one write through the Supabase Auth Admin API, so nobody has to hand-edit
 * auth.users in the dashboard.
 *
 * It writes BOTH claim shapes the codebase accepts — app_metadata.role (string) and
 * app_metadata.roles (array) — and preserves every other key already in app_metadata
 * (provider, providers, ...).
 *
 * Safety: by default it refuses to run once ANY account already holds an operator
 * claim, so it behaves as a genuine first-run bootstrap. Promote later operators from
 * the Platform Console, or pass --allow-additional to override deliberately.
 *
 * Usage:
 *   node scripts/bootstrap-platform-operator.mjs <email>                  # uses .env.local
 *   node scripts/bootstrap-platform-operator.mjs <email> --env .env.production
 *   node scripts/bootstrap-platform-operator.mjs <email> --check          # report only
 *   node scripts/bootstrap-platform-operator.mjs <email> --demote         # remove the claim
 *
 * Production: either point --env at the production env file, or export
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the shell (real env vars
 * win over the file, so CI needs no file at all).
 *
 * The service-role key is read locally and sent only to your own Supabase project.
 * Never commit it, and never expose it to the browser.
 */

import fs from "node:fs";
import path from "node:path";

const OPERATOR_ROLE = "platform_operator";
/** Mirrors PLATFORM_OPERATOR_ROLE_CLAIMS in lib/server/platform-operator.ts. */
const OPERATOR_CLAIMS = new Set([
  "super_admin",
  "platform_admin",
  "platform_operator",
  "supervisor tools",
]);

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

function parseArgs(argv) {
  const args = { email: "", envFile: ".env.local", check: false, demote: false, allowAdditional: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") args.envFile = argv[++i] || args.envFile;
    else if (arg === "--check") args.check = true;
    else if (arg === "--demote") args.demote = true;
    else if (arg === "--allow-additional") args.allowAdditional = true;
    else if (!arg.startsWith("-") && !args.email) args.email = arg;
  }
  return args;
}

/** Minimal dotenv reader: real environment variables take precedence over the file. */
function loadEnv(envFile) {
  const resolved = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(resolved)) return {};

  const out = {};
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    out[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function toRoleList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string") {
    const role = value.trim().toLowerCase();
    return role ? [role] : [];
  }
  return [];
}

function operatorClaims(user) {
  const meta = user?.app_metadata || {};
  return [...toRoleList(meta.role), ...toRoleList(meta.roles)];
}

function isOperator(user) {
  return operatorClaims(user).some((claim) => OPERATOR_CLAIMS.has(claim));
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function adminFetch(url, key, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : body?.msg || body?.message || JSON.stringify(body);
    throw new Error(`${response.status} ${response.statusText} — ${detail}`);
  }
  return body;
}

/** Pages through auth.users: the Admin API cannot filter on app_metadata server-side. */
async function listAllUsers(url, key) {
  const users = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await adminFetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`, key);
    const batch = body?.users || [];
    users.push(...batch);
    if (batch.length < PAGE_SIZE) return users;
  }
  throw new Error("More auth users than this script will page through; promote from the Platform Console instead.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    fail("Usage: node scripts/bootstrap-platform-operator.mjs <email> [--env <file>] [--check] [--demote]");
  }

  const email = args.email.trim().toLowerCase();
  const fileEnv = loadEnv(args.envFile);
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url) fail(`NEXT_PUBLIC_SUPABASE_URL is not set (looked in the environment and ${args.envFile}).`);
  if (!key) fail(`SUPABASE_SERVICE_ROLE_KEY is not set (looked in the environment and ${args.envFile}).`);

  console.log(`\n  Project : ${url}`);
  console.log(`  Target  : ${email}`);
  console.log(`  Source  : ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "environment" : args.envFile}\n`);

  const users = await listAllUsers(url, key);
  const target = users.find((user) => (user.email || "").trim().toLowerCase() === email);
  const existingOperators = users.filter(isOperator);

  console.log(`  Accounts scanned   : ${users.length}`);
  console.log(`  Existing operators : ${existingOperators.length ? existingOperators.map((u) => u.email).join(", ") : "none"}`);

  if (!target) {
    fail(`No account exists for ${email}. Sign up in the app first, then re-run this script.`);
  }
  console.log(`  Current app_metadata: ${JSON.stringify(target.app_metadata || {})}`);
  console.log(`  Is operator        : ${isOperator(target)}\n`);

  if (args.check) {
    console.log("  --check: no changes made.\n");
    return;
  }

  if (args.demote) {
    const meta = { ...(target.app_metadata || {}) };
    const remaining = toRoleList(meta.roles).filter((role) => !OPERATOR_CLAIMS.has(role));
    if (toRoleList(meta.role).some((role) => OPERATOR_CLAIMS.has(role))) delete meta.role;
    if (remaining.length) meta.roles = remaining;
    else delete meta.roles;

    await adminFetch(`${url}/auth/v1/admin/users/${target.id}`, key, {
      method: "PUT",
      body: JSON.stringify({ app_metadata: meta }),
    });
    console.log(`  Removed the operator claim from ${email}.`);
    console.log("  They must sign out and back in for the change to take effect.\n");
    return;
  }

  if (isOperator(target)) {
    console.log(`  ${email} is already a Platform Operator. Nothing to do.`);
    console.log("  If /platform still redirects, sign out and sign back in to refresh the session.\n");
    return;
  }

  const otherOperators = existingOperators.filter((user) => user.id !== target.id);
  if (otherOperators.length > 0 && !args.allowAdditional) {
    fail(
      `A Platform Operator already exists (${otherOperators.map((u) => u.email).join(", ")}).\n` +
        "  Bootstrap is meant for the zero-operator case — promote further operators from /platform,\n" +
        "  or re-run with --allow-additional if you are sure."
    );
  }

  // Merge rather than replace: app_metadata also carries provider/providers, and
  // dropping those would corrupt the account's identity records.
  const existingMeta = target.app_metadata || {};
  const roles = new Set(toRoleList(existingMeta.roles));
  roles.add(OPERATOR_ROLE);
  const appMetadata = { ...existingMeta, role: OPERATOR_ROLE, roles: Array.from(roles) };

  const updated = await adminFetch(`${url}/auth/v1/admin/users/${target.id}`, key, {
    method: "PUT",
    body: JSON.stringify({ app_metadata: appMetadata }),
  });

  if (!isOperator(updated)) {
    fail(`The update was accepted but ${email} still has no operator claim: ${JSON.stringify(updated?.app_metadata)}`);
  }

  console.log(`  ${email} is now a Platform Operator.`);
  console.log(`  New app_metadata: ${JSON.stringify(updated.app_metadata)}\n`);
  console.log("  Next: sign out and sign back in (the claim is baked into the JWT at sign-in),");
  console.log("  then open /platform.\n");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

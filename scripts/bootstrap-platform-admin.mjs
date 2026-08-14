#!/usr/bin/env node
/**
 * Platform Administrator provisioning — offline recovery tool.
 *
 * Mirrors lib/platform/platform-admin-provisioning.ts (which is the reference
 * implementation used by the boot reconciler and the recovery endpoint). This standalone
 * copy exists because it must work when the app will not start at all — a wrong env var,
 * a bad deploy, or a database that was restored without an administrator.
 *
 * It is idempotent and self-healing:
 *   1. creates the auth user if it does not exist (email pre-confirmed)
 *   2. grants the platform_operator claim if missing
 *   3. re-links company_users rows whose user_id is stale after an account was recreated
 *
 * Safety: refuses when another Platform Operator already exists, unless --force. While
 * an operator exists, promote further operators from the Platform Console.
 *
 * Usage:
 *   npm run bootstrap:admin                       # uses PLATFORM_BOOTSTRAP_ADMIN_EMAIL/_PASSWORD
 *   npm run bootstrap:admin -- --check            # report only, no writes
 *   npm run bootstrap:admin -- you@example.com --password "..."
 *   npm run bootstrap:admin -- --env .env.production
 *   npm run bootstrap:admin -- --force            # repair even while an operator exists
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Real environment
 * variables win over the env file, so CI/production need no file at all.
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
  const args = { email: "", password: "", envFile: ".env.local", check: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") args.envFile = argv[++i] || args.envFile;
    else if (arg === "--password") args.password = argv[++i] || "";
    else if (arg === "--check") args.check = true;
    else if (arg === "--force") args.force = true;
    else if (!arg.startsWith("-") && !args.email) args.email = arg;
  }
  return args;
}

function loadEnv(envFile) {
  const resolved = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(resolved)) return {};
  const out = {};
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function toRoleList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") {
    const r = value.trim().toLowerCase();
    return r ? [r] : [];
  }
  return [];
}

const isOperator = (user) => {
  const meta = user?.app_metadata || {};
  return [...toRoleList(meta.role), ...toRoleList(meta.roles)].some((r) => OPERATOR_CLAIMS.has(r));
};

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function api(url, key, init = {}) {
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

async function listAllUsers(url, key) {
  const users = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await api(`${url}/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`, key);
    const batch = body?.users || [];
    users.push(...batch);
    if (batch.length < PAGE_SIZE) return users;
  }
  throw new Error("Too many auth users to page through; promote from the Platform Console instead.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = loadEnv(args.envFile);
  const pick = (name) => (process.env[name] || fileEnv[name] || "").trim().replace(/^["']|["']$/g, "");

  const url = pick("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const key = pick("SUPABASE_SERVICE_ROLE_KEY");
  const email = (args.email || pick("PLATFORM_BOOTSTRAP_ADMIN_EMAIL")).trim().toLowerCase();
  const password = args.password || pick("PLATFORM_BOOTSTRAP_ADMIN_PASSWORD");

  if (!url) fail(`NEXT_PUBLIC_SUPABASE_URL is not set (looked in the environment and ${args.envFile}).`);
  if (!key) fail(`SUPABASE_SERVICE_ROLE_KEY is not set (looked in the environment and ${args.envFile}).`);
  if (!email) {
    fail(
      "No administrator email. Pass one as an argument or set PLATFORM_BOOTSTRAP_ADMIN_EMAIL."
    );
  }

  console.log(`\n  Project : ${url}`);
  console.log(`  Admin   : ${email}`);
  console.log(`  Source  : ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "environment" : args.envFile}\n`);

  const users = await listAllUsers(url, key);
  const operators = users.filter(isOperator);
  const target = users.find((u) => (u.email || "").trim().toLowerCase() === email) || null;

  console.log(`  Accounts           : ${users.length}`);
  console.log(`  Existing operators : ${operators.length ? operators.map((u) => u.email).join(", ") : "none"}`);
  console.log(`  Target account     : ${target ? `exists (operator=${isOperator(target)})` : "does not exist"}\n`);

  if (args.check) {
    console.log("  --check: no changes made.\n");
    return;
  }

  const others = operators.filter((u) => (u.email || "").trim().toLowerCase() !== email);
  if (others.length > 0 && !args.force) {
    fail(
      `A Platform Operator already exists (${others.map((u) => u.email).join(", ")}).\n` +
        "  Promote further operators from /platform, or re-run with --force to repair anyway."
    );
  }

  const actions = [];
  let userId = target?.id || null;

  if (!target) {
    if (!password) {
      fail(
        `No account exists for ${email} and no password was supplied.\n` +
          "  Pass --password \"...\" or set PLATFORM_BOOTSTRAP_ADMIN_PASSWORD."
      );
    }
    const created = await api(`${url}/auth/v1/admin/users`, key, {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: OPERATOR_ROLE, roles: [OPERATOR_ROLE] },
      }),
    });
    userId = created.id;
    actions.push("created auth user", "granted operator claim");
  } else if (!isOperator(target)) {
    const meta = { ...(target.app_metadata || {}) };
    const roles = new Set(toRoleList(meta.roles));
    roles.add(OPERATOR_ROLE);
    await api(`${url}/auth/v1/admin/users/${target.id}`, key, {
      method: "PUT",
      body: JSON.stringify({ app_metadata: { ...meta, role: OPERATOR_ROLE, roles: [...roles] } }),
    });
    actions.push("granted operator claim");
  }

  if (target && password && args.force) {
    await api(`${url}/auth/v1/admin/users/${target.id}`, key, {
      method: "PUT",
      body: JSON.stringify({ password, email_confirm: true }),
    });
    actions.push("reset password");
  }

  // Re-link memberships whose user_id went stale when the account was recreated.
  if (userId) {
    const linked = await fetch(
      `${url}/rest/v1/company_users?user_email=eq.${encodeURIComponent(email)}&or=(user_id.is.null,user_id.neq.${userId})`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ user_id: userId }),
      }
    );
    if (linked.ok) {
      const rows = await linked.json().catch(() => []);
      if (Array.isArray(rows) && rows.length) actions.push(`linked ${rows.length} company membership(s)`);
    }
  }

  const verify = await listAllUsers(url, key);
  const now = verify.find((u) => (u.email || "").trim().toLowerCase() === email);
  if (!now || !isOperator(now)) {
    fail(`Provisioning did not take effect for ${email}: ${JSON.stringify(now?.app_metadata)}`);
  }

  console.log(
    actions.length === 0
      ? `  ${email} was already fully provisioned. Nothing to do.\n`
      : `  ${email} provisioned: ${actions.join(", ")}.\n`
  );
  console.log(`  app_metadata: ${JSON.stringify(now.app_metadata)}`);
  console.log("\n  Sign in, then open /platform.\n");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

#!/usr/bin/env node
/**
 * VYRON CORE — Road & Recovery disposable validation environment (Phase 7).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 *
 * Phases 0-6 were each validated against a database that was assembled by hand. Those
 * databases could not be rebuilt, so once their fixtures were consumed the runtime suites
 * could no longer run — the regression net existed, but only once. This script makes the
 * environment reproducible: one command, from an empty cluster to a fully provisioned
 * two-tenant Road & Recovery operation with the complete Phase 0-6 suite passing.
 *
 * ---------------------------------------------------------------------------
 * IT USES THE REAL MIGRATIONS
 * ---------------------------------------------------------------------------
 *
 * Every file under sql/0NN is applied verbatim, in order. Nothing is rewritten to make it
 * apply, because the whole value of the exercise is that the SQL under test is the SQL
 * that ships. Only two things are added, both under sql/test-harness/ and both clearly
 * marked as test-only:
 *
 *   000-supabase-compat.sql   the Supabase primitives a bare cluster lacks
 *                             (auth schema, the three roles, storage stubs)
 *
 * That is now the ONLY thing added. The six baseline tables the harness used to scaffold
 * are owned by sql/010 as of Phase 8, so the schema under test is entirely the
 * repository's own.
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 *
 * This script refuses to run against anything that is not a local disposable cluster. It
 * will not accept a remote host, a Supabase hostname, or a database whose name does not
 * carry the harness prefix. Production is unreachable from here by construction.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *
 *   node scripts/rr-test-env.mjs up        build the environment (drops and recreates)
 *   node scripts/rr-test-env.mjs reseed    re-apply fixtures only, keeping the schema
 *   node scripts/rr-test-env.mjs verify    security gate: grants, views, boundary
 *   node scripts/rr-test-env.mjs status    report what is provisioned
 *   node scripts/rr-test-env.mjs down      drop the database
 *   node scripts/rr-test-env.mjs env       print the exports the test runner needs
 *
 * Environment:
 *   RR_TEST_PSQL     path to psql (required)
 *   RR_TEST_PGHOST   default 127.0.0.1
 *   RR_TEST_PGPORT   default 55432
 *   RR_TEST_PGUSER   default postgres
 *   RR_TEST_DB       default rr_harness
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SQL_DIR = path.join(REPO_ROOT, "sql");
const HARNESS_DIR = path.join(SQL_DIR, "test-harness");

const PSQL = process.env.RR_TEST_PSQL;
const HOST = process.env.RR_TEST_PGHOST || "127.0.0.1";
const PORT = process.env.RR_TEST_PGPORT || "55432";
const USER = process.env.RR_TEST_PGUSER || "postgres";
const DB = process.env.RR_TEST_DB || "rr_harness";

// ---------------------------------------------------------------------------
// Migration order
// ---------------------------------------------------------------------------

/**
 * Migrations excluded from the harness, each for a stated reason.
 *
 * An exclusion is a decision, not an omission, so every one of them is named here rather
 * than being quietly skipped by a glob.
 */
const EXCLUDED = {
  "000-run-all-companies.sql":
    "Bootstrap aggregate of 001 and 002. Running both would apply the same DDL twice.",
  "005-verify-companies-api.sql":
    "A verification script, not a migration. It asserts against a live project.",
  "007-clear-demo-company-data.sql":
    "DELETEs demo rows. Destructive, and the harness has no demo rows to clear.",
  "035-v2-demo-environment.sql":
    "Seeds demo data. A deterministic environment must contain only rows the fixtures declare.",
  "PASTE_THIS_IN_SUPABASE.sql":
    "A copy-paste bundle for the Supabase console, not part of the ordered series.",
};

/**
 * Migrations that must run OUT of numeric order, with the reason.
 *
 * sql/038 adds operational columns to public.hr_warnings, but hr_warnings is created by
 * sql/051. Strict numeric order therefore fails on a clean database. This is a genuine
 * ordering defect in the repository, recorded here rather than papered over: applying 038
 * after 051 is what a clean install actually requires.
 */
/**
 * Migrations that must run OUT of numeric order.
 *
 * EMPTY, and that is the point. sql/038 used to be deferred behind sql/051 because it
 * altered a table sql/051 creates. That was a defect in the repository, and Phase 8 fixed
 * it there — sql/038 now creates the baseline table if it is absent — rather than leaving
 * the harness to paper over it. A harness that reorders migrations is not rehearsing the
 * deployment anybody will actually perform.
 */
const DEFERRED = {};

function migrationOrder() {
  const all = readdirSync(SQL_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const ordered = [];
  const deferred = [];
  for (const name of all) {
    if (EXCLUDED[name]) continue;
    if (DEFERRED[name]) {
      deferred.push(name);
      continue;
    }
    ordered.push(name);
  }
  return { ordered, deferred };
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

function assertDisposable() {
  if (!PSQL) {
    fail(
      "RR_TEST_PSQL is not set.\n" +
        "Point it at a LOCAL psql binary, e.g.\n" +
        '  export RR_TEST_PSQL="C:/Program Files/PostgreSQL/18/bin/psql.exe"'
    );
  }
  if (!existsSync(PSQL)) fail(`RR_TEST_PSQL does not exist: ${PSQL}`);

  // The harness builds and DROPS databases. Every one of these checks exists so that a
  // mistyped environment variable cannot point that at something real.
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);
  if (!localHosts.has(HOST)) {
    fail(
      `Refusing to run against host "${HOST}".\n` +
        "This script creates and drops databases and will only talk to a local disposable cluster."
    );
  }
  if (/supabase|amazonaws|azure|gcp|\.co\.za|\.com|\.io|\.net/i.test(HOST)) {
    fail(`Refusing to run against what looks like a remote host: ${HOST}`);
  }
  if (PORT === "5432") {
    fail(
      "Refusing to use port 5432, the default a real local PostgreSQL install listens on.\n" +
        "The disposable cluster runs on its own port (55432 by default) so it cannot be confused with anything else."
    );
  }
  if (!/^(rr_|probe)/.test(DB)) {
    fail(
      `Refusing to manage database "${DB}".\n` +
        'The harness only manages databases whose name starts with "rr_" or "probe".'
    );
  }
  for (const key of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (process.env[key]) {
      fail(
        `${key} is set in this shell.\n` +
          "Refusing to run so there is no chance of a production credential being used. Unset it and retry."
      );
    }
  }
}

function fail(message) {
  console.error(`\n[rr-test-env] ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// psql
// ---------------------------------------------------------------------------

function psql(args, { database = DB, allowFailure = false, quiet = true } = {}) {
  const base = ["-h", HOST, "-p", PORT, "-U", USER, "-d", database, "-v", "ON_ERROR_STOP=1"];
  if (quiet) base.push("-q");
  try {
    return execFileSync(PSQL, [...base, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PGPASSWORD: process.env.RR_TEST_PGPASSWORD || "" },
    });
  } catch (error) {
    if (allowFailure) return String(error.stdout || "") + String(error.stderr || "");
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(detail);
  }
}

/**
 * Runs a statement written to a UTF-8 file rather than passed with -c.
 *
 * psql -c on Windows re-encodes the argument through the console codepage, which mangles
 * any non-ASCII character. Writing the statement to a file and using -f avoids it, which
 * matters because the fixtures contain real South African place names.
 */
function psqlStatement(statement, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rr-env-"));
  const file = path.join(dir, "statement.sql");
  try {
    writeFileSync(file, statement, "utf8");
    return psql(["-f", file], options);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function queryTuples(sql, database = DB) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rr-env-"));
  const file = path.join(dir, "q.sql");
  try {
    writeFileSync(file, sql, "utf8");
    const out = execFileSync(
      PSQL,
      ["-h", HOST, "-p", PORT, "-U", USER, "-d", database, "-tAF|", "-v", "ON_ERROR_STOP=1", "-f", file],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // Same credential the psql() helper above passes. Without it a cluster that
        // requires a password leaves psql waiting on a prompt it can never receive
        // (stdin is "ignore"), so `up` and `status` hang after the migrations rather
        // than reporting. The two helpers must agree about how they authenticate.
        env: { ...process.env, PGPASSWORD: process.env.RR_TEST_PGPASSWORD || "" },
      }
    );
    return out
      .split("\n")
      .map((line) => line.replace(/\r$/, "").trim())
      .filter(Boolean)
      .map((line) => line.split("|"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function step(label) {
  process.stdout.write(`  ${label.padEnd(58, ".")} `);
}

function ok(detail = "ok") {
  process.stdout.write(`${detail}\n`);
}

function commandDown() {
  assertDisposable();
  console.log(`\n[rr-test-env] Dropping ${DB}`);
  psqlStatement(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE);`, { database: "postgres" });
  console.log("  dropped\n");
}

function commandUp() {
  assertDisposable();
  const started = Date.now();
  console.log(`\n[rr-test-env] Building ${DB} on ${HOST}:${PORT}\n`);

  step("drop existing database");
  psqlStatement(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE);`, { database: "postgres" });
  ok();

  step("create empty database");
  psqlStatement(`CREATE DATABASE ${DB};`, { database: "postgres" });
  ok();

  step("supabase compatibility layer");
  psql(["-f", path.join(HARNESS_DIR, "000-supabase-compat.sql")]);
  ok();

  const { ordered, deferred } = migrationOrder();
  const sequence = [...ordered, ...deferred];
  let applied = 0;
  const failures = [];

  for (const name of sequence) {
    step(`migration ${name.slice(0, 44)}`);
    try {
      psql(["-f", path.join(SQL_DIR, name)]);
      applied += 1;
      ok();
    } catch (error) {
      failures.push({ name, error: String(error.message).split("\n")[0] });
      ok("FAILED");
    }
  }

  if (failures.length > 0) {
    console.error("\n[rr-test-env] MIGRATIONS FAILED — the environment is not usable:\n");
    for (const failure of failures) console.error(`  ${failure.name}\n    ${failure.error}`);
    console.error(
      "\nFix the migration or record the reason in EXCLUDED/DEFERRED in this script.\n" +
        "Do NOT work around it in a test.\n"
    );
    process.exit(1);
  }

  step("fixtures");
  psql(["-f", path.join(HARNESS_DIR, "900-fixtures.sql")]);
  ok();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  ${applied} migrations applied in ${seconds}s\n`);
  reportStatus();
  console.log("Run the suite with:\n");
  console.log(commandEnv(true));
}

function commandReseed() {
  assertDisposable();
  console.log(`\n[rr-test-env] Re-applying fixtures to ${DB}`);
  step("fixtures");
  psql(["-f", path.join(HARNESS_DIR, "900-fixtures.sql")]);
  ok();
  reportStatus();
}

function reportStatus() {
  const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
  const BRAVO = "bbbbbbbb-0000-4000-8000-000000000002";

  const counts = queryTuples(`
    SELECT
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'rr!_%' ESCAPE '!'),
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'rr!_%' ESCAPE '!'),
      (SELECT count(*) FROM public.companies),
      (SELECT count(*) FROM public.employees),
      (SELECT count(*) FROM public.rr_service_types),
      (SELECT count(*) FROM public.rr_workflow_definitions WHERE active)
  `)[0];

  console.log("  Schema");
  console.log(`    tables ................ ${counts[0]}`);
  console.log(`    road & recovery tables  ${counts[1]}`);
  console.log(`    road & recovery views . ${counts[2]}`);
  console.log("  Fixtures");
  console.log(`    tenants ............... ${counts[3]}`);
  console.log(`    employees ............. ${counts[4]}`);
  console.log(`    service types ......... ${counts[5]}`);
  console.log(`    active workflows ...... ${counts[6]}`);

  for (const [label, company] of [["Alpha", ALPHA], ["Bravo", BRAVO]]) {
    const rows = queryTuples(`SELECT component, ok, detail FROM public.rr_provisioning_status('${company}')`);
    const failed = rows.filter((row) => row[1] !== "t");
    console.log(`  Provisioning — ${label}`);
    if (failed.length === 0) {
      console.log(`    all ${rows.length} components provisioned`);
    } else {
      for (const row of failed) console.log(`    FAILED ${row[0]}: ${row[2]}`);
    }
  }
  console.log("");
}


/**
 * The security gate: grant regression, view security and the protected-table fingerprint.
 *
 * Run with NOTHING ELSE TOUCHING THE DATABASE. sql/049 takes an AccessExclusiveLock on
 * every company-scoped table, so re-applying it while a test suite is mid-transaction
 * deadlocks both. That is why this lives here and not in a test file: it is an
 * environment check, and it needs the environment to itself.
 */
function commandVerify() {
  assertDisposable();
  console.log("");
  console.log(`[rr-test-env] Security gate on ${DB}`);
  console.log("");

  const grantSql = `
    SELECT table_name || '=' || COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '')
      FROM information_schema.role_table_grants
     WHERE grantee = 'authenticated' AND table_schema = 'public'
     GROUP BY table_name
     ORDER BY table_name`;

  step("capture grant matrix");
  const before = queryTuples(grantSql).map((row) => row[0]);
  ok(`${before.length} tables`);

  step("re-apply sql/049 to the complete schema");
  psql(["-f", path.join(SQL_DIR, "049-release-candidate-security-hardening.sql")]);
  ok();

  step("re-capture grant matrix");
  const after = queryTuples(grantSql).map((row) => row[0]);
  ok(`${after.length} tables`);

  const beforeSet = new Map(before.map((entry) => entry.split("=")));
  const afterSet = new Map(after.map((entry) => entry.split("=")));
  const changes = [];
  for (const [table, grants] of afterSet) {
    const was = beforeSet.get(table);
    if (was === undefined) changes.push(`  ADDED   ${table} = ${grants}`);
    else if (was !== grants) changes.push(`  CHANGED ${table}: ${was} -> ${grants}`);
  }
  for (const [table] of beforeSet) {
    if (!afterSet.has(table)) changes.push(`  REMOVED ${table}`);
  }

  step("grant regression");
  if (changes.length > 0) {
    ok("FAILED");
    console.error("");
    console.error("[rr-test-env] sql/049 CHANGED THE GRANT MATRIX:");
    console.error("");
    for (const change of changes) console.error(change);
    console.error("");
    console.error("A table narrowed by its own migration was re-widened by the generic");
    console.error("hardening loop. Register it in the correct branch of sql/049 so that");
    console.error("grants, RLS and triggers all express the same intent.");
    console.error("");
    process.exit(1);
  }
  ok("no change");

  // The protected-table fingerprint, in two parts because the tables are protected in two
  // different ways and conflating them would either miss a real widening or flag a grant
  // that is there on purpose.
  //
  //   APPEND-ONLY and the custody PROJECTION: no UPDATE, no DELETE, no TRUNCATE. A
  //   recorded event is never edited and never removed.
  //
  //   IMMUTABLE SNAPSHOTS (rr_evidence_requirements, rr_job_rate_snapshot): no UPDATE and
  //   no TRUNCATE, but DELETE is granted ON PURPOSE — it is the rollback path when job
  //   creation or a charge calculation fails part way. What must never happen is an
  //   EDIT: a policy or rate-card change must not retroactively alter a job that already
  //   exists.
  step("protected-table fingerprint");
  const widened = queryTuples(`
    SELECT g.table_name, g.privilege_type
      FROM information_schema.role_table_grants g
     WHERE g.grantee = 'authenticated'
       AND g.table_schema = 'public'
       AND (
         (g.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
          AND g.table_name IN (
            'rr_service_state_events','rr_dispatch_candidates','rr_standby_summary',
            'rr_compliance_evaluations','rr_requirement_waivers','rr_module_provisioning',
            'rr_custody_events','rr_storage_accrual','rr_charge_calculations',
            'rr_charge_lines','rr_custody_holdings'
          ))
         OR
         (g.privilege_type IN ('UPDATE', 'TRUNCATE')
          AND g.table_name IN ('rr_evidence_requirements','rr_job_rate_snapshot'))
         OR
         (g.privilege_type IN ('DELETE', 'TRUNCATE')
          AND g.table_name IN (
            'rr_authorisations','rr_release_authorisations','rr_storage_bookings',
            'rr_billable_facts','rr_billing_disputes','rr_intelligence_thresholds'
          ))
       )
     ORDER BY 1, 2`);
  if (widened.length > 0) {
    ok("FAILED");
    console.error("");
    console.error("[rr-test-env] A PROTECTED TABLE CARRIES A DESTRUCTIVE GRANT:");
    console.error("");
    for (const row of widened) console.error(`  ${row[0]}: ${row[1]}`);
    process.exit(1);
  }
  ok("append-only and immutable tables are clean");

  step("no TRUNCATE anywhere on rr_*");
  const truncate = queryTuples(`
    SELECT table_name FROM information_schema.role_table_grants
     WHERE grantee = 'authenticated' AND table_schema = 'public'
       AND table_name LIKE 'rr!_%' ESCAPE '!' AND privilege_type = 'TRUNCATE'`);
  if (truncate.length > 0) {
    ok("FAILED");
    console.error(`  TRUNCATE granted on: ${truncate.map((row) => row[0]).join(", ")}`);
    process.exit(1);
  }
  ok();

  step("anon holds nothing on rr_*");
  const anonGrants = queryTuples(`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
     WHERE grantee = 'anon' AND table_schema = 'public' AND table_name LIKE 'rr!_%' ESCAPE '!'`);
  if (anonGrants.length > 0) {
    ok("FAILED");
    for (const row of anonGrants) console.error(`  anon: ${row[0]} ${row[1]}`);
    process.exit(1);
  }
  ok();

  step("every rr_ view is security_invoker");
  const views = queryTuples(`
    SELECT c.relname, COALESCE(array_to_string(c.reloptions, ','), 'NONE')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'rr!_%' ESCAPE '!'
     ORDER BY 1`);
  const leaky = views.filter((row) => !String(row[1]).includes("security_invoker=true"));
  if (leaky.length > 0) {
    ok("FAILED");
    console.error("");
    console.error("[rr-test-env] A VIEW RUNS AS ITS OWNER AND WILL LEAK ACROSS TENANTS:");
    console.error("");
    for (const row of leaky) console.error(`  ${row[0]}: ${row[1]}`);
    process.exit(1);
  }
  ok(`${views.length} views`);

  step("no finance relation exists");
  const finance = queryTuples(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND (table_name LIKE '%invoice%' OR table_name LIKE '%credit_note%'
         OR table_name LIKE '%ledger%' OR table_name LIKE '%debtor%'
         OR table_name LIKE '%payment%' OR table_name LIKE '%xero%')`);
  if (finance.length > 0) {
    ok("FAILED");
    console.error(`  finance relations found: ${finance.map((row) => row[0]).join(", ")}`);
    process.exit(1);
  }
  ok("VYRON CORE / VYRON FINANCE boundary intact");

  console.log("");
  console.log("  SECURITY GATE PASSED");
  console.log("");
}

function commandStatus() {
  assertDisposable();
  console.log(`\n[rr-test-env] ${DB} on ${HOST}:${PORT}\n`);
  reportStatus();
}

function commandEnv(indent = false) {
  const prefix = indent ? "  " : "";
  return [
    `${prefix}export RR_TEST_PSQL="${PSQL}"`,
    `${prefix}export RR_TEST_PGHOST=${HOST}`,
    `${prefix}export RR_TEST_PGPORT=${PORT}`,
    `${prefix}export RR_TEST_PGUSER=${USER}`,
    `${prefix}export RR_TEST_DB=${DB}`,
    // The suite reaches psql through tests/support/pg-query-transport.ts, which inherits
    // the shell environment verbatim. A cluster that requires a password therefore needs
    // PGPASSWORD exported here too, or every query blocks on a prompt it cannot answer.
    ...(process.env.RR_TEST_PGPASSWORD
      ? [`${prefix}export PGPASSWORD=${process.env.RR_TEST_PGPASSWORD}`]
      : []),
    `${prefix}npm test`,
    "",
  ].join("\n");
}

function commandOrder() {
  const { ordered, deferred } = migrationOrder();
  console.log("\n[rr-test-env] Migration order\n");
  // Only ONE prerequisite remains. sql/010 took ownership of the baseline tables in
  // Phase 8 and 010-baseline-tables.sql was deleted with it; listing it here outlived the
  // file and sent a reader looking for something that is not there.
  console.log("  Harness prerequisites (test-only, sql/test-harness/):");
  console.log("    000-supabase-compat.sql\n");
  console.log(`  Repository migrations, numeric order (${ordered.length}):`);
  for (const name of ordered) console.log(`    ${name}`);
  console.log(`\n  Deferred out of numeric order (${deferred.length}):`);
  for (const name of deferred) console.log(`    ${name}\n      ${DEFERRED[name]}`);
  console.log(`\n  Excluded (${Object.keys(EXCLUDED).length}):`);
  for (const [name, reason] of Object.entries(EXCLUDED)) console.log(`    ${name}\n      ${reason}`);
  console.log("\n  Fixtures:");
  console.log("    900-fixtures.sql\n");
}

const COMMANDS = {
  up: commandUp,
  down: commandDown,
  reseed: commandReseed,
  status: commandStatus,
  verify: commandVerify,
  order: commandOrder,
  env: () => process.stdout.write(commandEnv()),
};

const command = process.argv[2] || "up";
if (!COMMANDS[command]) {
  console.error(`\nUnknown command: ${command}`);
  console.error(`Available: ${Object.keys(COMMANDS).join(", ")}\n`);
  process.exit(1);
}

try {
  COMMANDS[command]();
} catch (error) {
  fail(String(error.message || error));
}

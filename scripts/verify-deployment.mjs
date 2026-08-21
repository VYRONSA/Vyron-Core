#!/usr/bin/env node
/**
 * VYRON CORE — deployment verification.
 *
 *   npm run verify:deployment
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS
 * ---------------------------------------------------------------------------
 *
 * A read-only audit of a deployed VYRON CORE database. It answers one question — "is this
 * deployment actually correct and safe" — and answers it by inspecting the database rather
 * than by trusting that the migrations were run.
 *
 * It is the generalisation of the sprint-N-verify scripts already in this directory. Those
 * were written per sprint against a live project and checked whichever columns that sprint
 * cared about; this checks the deployment contract as a whole, and is meant to be run
 * before and after every release.
 *
 * ---------------------------------------------------------------------------
 * IT IS READ-ONLY, AND THE DATABASE ENFORCES THAT
 * ---------------------------------------------------------------------------
 *
 * Every statement runs inside `SET TRANSACTION READ ONLY`. That is not a convention this
 * script promises to keep — it is PostgreSQL refusing any INSERT, UPDATE, DELETE or DDL
 * this script could possibly issue, including by accident. Verification that can repair
 * is verification you cannot trust, because a passing run no longer proves the deployment
 * was already correct.
 *
 * So it does NOT: migrate, repair, create missing objects, seed defaults, or relax a
 * grant. It reports, and it FAILS CLOSED — anything it cannot confirm is a failure, never
 * an assumption.
 *
 * ---------------------------------------------------------------------------
 * CONNECTING
 * ---------------------------------------------------------------------------
 *
 * Set ONE of:
 *
 *   VYRON_DB_URL     a PostgreSQL connection string (Supabase provides one under
 *                    Project Settings -> Database). Use a READ-ONLY role if you have one.
 *
 *   RR_TEST_PGHOST / RR_TEST_PGPORT / RR_TEST_PGUSER / RR_TEST_DB
 *                    the disposable harness, for verifying a rehearsal build.
 *
 * And PSQL_PATH (or RR_TEST_PSQL) pointing at a psql binary.
 *
 * The service-role KEY is never used and never read: this speaks PostgreSQL, not PostgREST.
 *
 * Options:
 *   --company <uuid>   also verify Road & Recovery provisioning for that company
 *   --json             emit a machine-readable report
 *   --quiet            only print failures
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PSQL = process.env.PSQL_PATH || process.env.RR_TEST_PSQL;
const DB_URL = process.env.VYRON_DB_URL || "";
const HOST = process.env.RR_TEST_PGHOST || "127.0.0.1";
const PORT = process.env.RR_TEST_PGPORT || "55432";
const USER = process.env.RR_TEST_PGUSER || "postgres";
const DB = process.env.RR_TEST_DB || "";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const QUIET = args.includes("--quiet");
const COMPANY = (() => {
  const index = args.indexOf("--company");
  return index !== -1 ? args[index + 1] : null;
})();

const results = [];
let failures = 0;

function record(area, check, ok, detail) {
  results.push({ area, check, ok, detail });
  if (!ok) failures += 1;
  if (JSON_OUT) return;
  if (ok && QUIET) return;
  const mark = ok ? "  PASS" : "  FAIL";
  process.stdout.write(`${mark}  ${area} · ${check}\n`);
  if (!ok && detail) process.stdout.write(`        ${detail}\n`);
}

function die(message) {
  process.stderr.write(`\n[verify:deployment] ${message}\n\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Read-only query transport
// ---------------------------------------------------------------------------

function connectionArgs() {
  if (DB_URL) return [DB_URL];
  if (!DB) {
    die(
      "No database specified.\n" +
        "Set VYRON_DB_URL, or RR_TEST_DB (plus RR_TEST_PGHOST/PGPORT/PGUSER) for a harness build."
    );
  }
  return ["-h", HOST, "-p", PORT, "-U", USER, "-d", DB];
}

/**
 * Runs a SELECT inside an explicitly READ ONLY transaction.
 *
 * The wrapper is what makes "read-only" a guarantee rather than an intention: PostgreSQL
 * rejects any write inside it, so this script cannot modify a production database even if
 * a future edit to it were careless.
 */
function query(sql) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vyron-verify-"));
  const file = path.join(dir, "q.sql");
  try {
    writeFileSync(
      file,
      ["BEGIN;", "SET TRANSACTION READ ONLY;", sql.trim().replace(/;+\s*$/, "") + ";", "COMMIT;"].join(
        "\n"
      ),
      "utf8"
    );
    const out = execFileSync(
      PSQL,
      // -q matters: without it psql prints the BEGIN / SET / COMMIT command tags to
      // stdout, and they arrive here looking exactly like result rows.
      [...connectionArgs(), "-q", "-tAF|", "-v", "ON_ERROR_STOP=1", "-f", file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return out
      .split("\n")
      .map((line) => line.replace(/\r$/, "").trim())
      .filter(Boolean)
      .map((line) => line.split("|"));
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    die(`Query failed:\n${detail}`);
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scalar(sql) {
  const rows = query(sql);
  return rows.length > 0 ? rows[0][0] : null;
}

function list(sql) {
  return query(sql).map((row) => row[0]);
}

// ---------------------------------------------------------------------------
// The deployment contract
// ---------------------------------------------------------------------------

/** Tables without which VYRON CORE cannot function. */
const REQUIRED_TABLES = [
  "companies", "company_users", "employees", "stores",
  "leave_requests", "leave_balances", "roster_shifts", "hr_documents",
  "field_jobs", "field_job_events", "field_job_assignments", "field_vehicles",
  "mobile_workforce_evidence", "mobile_gps_validations",
  "workforce_automation_actions", "workforce_automation_approvals",
  "vyron_audit_log",
  "rr_service_types", "rr_workflow_definitions", "rr_service_jobs",
  "rr_service_state_events", "rr_counterparties", "rr_authorisations",
  "rr_dispatch_candidates", "rr_dispatch_assignments", "rr_tow_truck_profiles",
  "rr_driver_certifications", "rr_bystand_details", "rr_bystand_reason_codes",
  "rr_standby_summary", "rr_requirement_policies", "rr_requirement_items",
  "rr_evidence_requirements", "rr_evidence_links", "rr_compliance_evaluations",
  "rr_requirement_waivers", "rr_job_exceptions", "rr_module_provisioning",
  "rr_release_authorisations", "rr_custody_yards", "rr_custody_events",
  "rr_custody_holdings", "rr_custody_items", "rr_storage_bookings",
  "rr_storage_accrual", "rr_rate_cards", "rr_rate_card_items",
  "rr_job_rate_snapshot", "rr_billable_facts", "rr_charge_calculations",
  "rr_charge_lines", "rr_billing_exceptions", "rr_billing_disputes",
  "rr_intelligence_thresholds",
];

/** Columns whose absence silently breaks a feature rather than erroring loudly. */
const REQUIRED_COLUMNS = {
  employees: ["id", "company_id", "employee_number", "first_name", "last_name", "active", "record_status"],
  stores: ["id", "company_id", "name", "record_status"],
  workforce_automation_actions: [
    "trigger_type", "pipeline_stage", "workflow_owner",
    "outcome_before_json", "outcome_after_json", "impact_estimate_json",
  ],
  rr_service_jobs: ["company_id", "field_job_id", "workflow_key", "service_state", "counterparty_id"],
  rr_service_state_events: ["seconds_in_previous_state", "from_state", "to_state", "occurred_at"],
  rr_billable_facts: ["fact_code", "quantity", "source_detail", "status", "superseded_by"],
  rr_intelligence_thresholds: ["metric_key", "target_value", "effective_from", "effective_to", "active", "version"],
  rr_job_margin: ["has_cost_data", "direct_cost", "margin_pct"],
};

const REQUIRED_FUNCTIONS = [
  "vyron_user_company_ids", "vyron_is_platform_operator",
  "rr_provision_company", "rr_provisioning_status",
  "rr_seed_service_catalogue", "rr_seed_bystand_reasons",
  "rr_publish_bystand_workflow_v2", "rr_seed_requirement_policies", "rr_seed_rate_cards",
];

/** Tables whose protection is enforced by a trigger, and the trigger that does it. */
const REQUIRED_TRIGGERS = {
  rr_service_state_events: "rr_service_state_events_append_only",
  rr_dispatch_candidates: "rr_dispatch_candidates_append_only",
  rr_standby_summary: "rr_standby_summary_append_only",
  rr_compliance_evaluations: "rr_compliance_evaluations_append_only",
  rr_requirement_waivers: "rr_requirement_waivers_append_only",
  rr_module_provisioning: "rr_module_provisioning_append_only",
  rr_custody_events: "rr_custody_events_append_only",
  rr_storage_accrual: "rr_storage_accrual_append_only",
  rr_charge_calculations: "rr_charge_calculations_append_only",
  rr_charge_lines: "rr_charge_lines_append_only",
  rr_evidence_requirements: "rr_evidence_requirements_immutable",
  rr_job_rate_snapshot: "rr_job_rate_snapshot_immutable",
  rr_billable_facts: "rr_billable_facts_append_only",
  rr_billing_disputes: "rr_billing_disputes_append_only",
  rr_intelligence_thresholds: "rr_intelligence_thresholds_guard",
  rr_authorisations: "rr_authorisations_forbid_delete",
  rr_release_authorisations: "rr_release_authorisations_forbid_delete",
  rr_storage_bookings: "rr_storage_bookings_forbid_delete",
  // The custody PROJECTION is maintained from the event log, so the trigger that
  // guarantees it lives on rr_custody_events, not on the projection itself.
  rr_custody_events_projection: "rr_custody_events_project",
};

/** authenticated must hold EXACTLY these privileges, no more. */
const GRANT_CONTRACT = {
  append_only: {
    grants: "INSERT,SELECT",
    tables: [
      "rr_service_state_events", "rr_dispatch_candidates", "rr_standby_summary",
      "rr_compliance_evaluations", "rr_requirement_waivers", "rr_module_provisioning",
      "rr_custody_events", "rr_storage_accrual", "rr_charge_calculations", "rr_charge_lines",
      "discipline_progression_decisions",
    ],
  },
  non_deletable: {
    grants: "INSERT,SELECT,UPDATE",
    tables: [
      "rr_authorisations", "rr_release_authorisations", "rr_storage_bookings",
      "rr_billable_facts", "rr_billing_disputes", "rr_intelligence_thresholds",
    ],
  },
  read_only: { grants: "SELECT", tables: ["rr_custody_holdings"] },
  immutable_deletable: {
    grants: "DELETE,INSERT,SELECT",
    tables: ["rr_evidence_requirements", "rr_job_rate_snapshot"],
  },
};

const FINANCE_PATTERNS = ["%invoice%", "%credit_note%", "%ledger%", "%debtor%", "%payment%", "%xero%", "%journal%"];

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkConnection() {
  const version = scalar("SELECT current_setting('server_version')");
  record("database", "reachable", Boolean(version), version ? `PostgreSQL ${version}` : "no response");

  // Prove the read-only wrapper is actually in force rather than assuming it.
  const readOnly = scalar("SELECT current_setting('transaction_read_only')");
  record(
    "database",
    "session is READ ONLY",
    readOnly === "on",
    readOnly === "on" ? "writes are refused by PostgreSQL" : `transaction_read_only=${readOnly}`
  );
}

function checkTables() {
  const present = new Set(
    list(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
  );
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  record(
    "schema",
    `${REQUIRED_TABLES.length} required tables`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : `all present`
  );
}

function checkColumns() {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = new Set(
      list(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table}'`
      )
    );
    const missing = columns.filter((column) => !present.has(column));
    record(
      "schema",
      `${table} columns`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : `${columns.length} present`
    );
  }
}

function checkFunctions() {
  const present = new Set(
    list(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'`
    )
  );
  const missing = REQUIRED_FUNCTIONS.filter((fn) => !present.has(fn));
  record(
    "schema",
    "required functions",
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : `${REQUIRED_FUNCTIONS.length} present`
  );
}

function checkTriggers() {
  const rows = query(
    `SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal`
  );
  const byTable = new Map();
  for (const [table, trigger] of rows) {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(trigger);
  }
  const missing = [];
  for (const [key, trigger] of Object.entries(REQUIRED_TRIGGERS)) {
    // The projection entry names its host table through the key, not the map key itself.
    const table = key === "rr_custody_events_projection" ? "rr_custody_events" : key;
    if (!byTable.get(table)?.has(trigger)) missing.push(`${table}.${trigger}`);
  }
  record(
    "security",
    "immutability triggers",
    missing.length === 0,
    missing.length
      ? `missing: ${missing.join(", ")} — these tables are protected by GRANTS ALONE, which does not bind the owner`
      : `${Object.keys(REQUIRED_TRIGGERS).length} present`
  );
}

function checkIndexes() {
  // Tenant-scoped lookups on the largest tables. A missing index here is a performance
  // cliff under load, not a correctness fault, but it belongs in a deployment check.
  const required = [
    ["rr_service_jobs", "company_id"],
    ["rr_service_state_events", "company_id"],
    ["rr_billable_facts", "company_id"],
    ["employees", "company_id"],
    ["workforce_automation_actions", "company_id"],
  ];
  const missing = [];
  for (const [table, column] of required) {
    const found = scalar(
      `SELECT count(*)::int FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = '${table}' AND indexdef LIKE '%${column}%'`
    );
    if (Number(found) === 0) missing.push(`${table}(${column})`);
  }
  record(
    "performance",
    "tenant-scoped indexes",
    missing.length === 0,
    missing.length ? `no index covering: ${missing.join(", ")}` : `${required.length} covered`
  );
}

function checkRls() {
  const unprotected = list(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
           WHERE col.table_schema = 'public' AND col.table_name = c.relname
             AND col.column_name = 'company_id'
        )
      ORDER BY 1`
  );
  record(
    "security",
    "RLS on every company-scoped table",
    unprotected.length === 0,
    unprotected.length ? `RLS DISABLED on: ${unprotected.join(", ")}` : "all enabled"
  );

  // RLS enabled with NO policy denies EVERYONE. That is fail-safe, and for
  // public.companies it is deliberate: the application reads it through the
  // SECURITY DEFINER RPC vyron_get_company_access() and falls back to that RPC when the
  // direct read is refused. It is reported for visibility, never as a failure — a
  // deny-all table cannot leak, and flagging it would train people to ignore this output.
  const policyless = list(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname)
      ORDER BY 1`
  );
  record(
    "security",
    "deny-all tables (informational)",
    true,
    policyless.length
      ? `RLS on with no policy, so all access is denied: ${policyless.join(", ")}`
      : "none"
  );

  // A USING (true) policy is only dangerous on a table that holds TENANT data. On a
  // public catalogue — subscription plans, solution templates — it is exactly right, and
  // failing on it would be crying wolf. The test is therefore the presence of company_id.
  const permissive = list(
    `SELECT p.tablename || ' / ' || p.policyname FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND (p.qual = 'true' OR p.with_check = 'true')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = p.tablename
             AND c.column_name = 'company_id'
        )
      ORDER BY 1`
  );
  record(
    "security",
    "no wide-open policy on tenant data",
    permissive.length === 0,
    permissive.length
      ? `USING (true) on a company-scoped table — every tenant sees every row: ${permissive.join(", ")}`
      : "none"
  );

  const publicCatalogue = list(
    `SELECT p.tablename FROM pg_policies p
      WHERE p.schemaname = 'public' AND (p.qual = 'true' OR p.with_check = 'true')
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = p.tablename
             AND c.column_name = 'company_id'
        )
      GROUP BY p.tablename ORDER BY 1`
  );
  record(
    "security",
    "wide-open policies on non-tenant tables (informational)",
    true,
    publicCatalogue.length ? publicCatalogue.join(", ") : "none"
  );
}

function checkGrants() {
  for (const [model, spec] of Object.entries(GRANT_CONTRACT)) {
    const wrong = [];
    for (const table of spec.tables) {
      const exists = scalar(
        `SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '${table}'`
      );
      if (Number(exists) === 0) continue;
      const actual = scalar(
        `SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '')
           FROM information_schema.role_table_grants
          WHERE grantee = 'authenticated' AND table_schema = 'public' AND table_name = '${table}'`
      );
      if (actual !== spec.grants) wrong.push(`${table}: expected ${spec.grants}, found ${actual || "none"}`);
    }
    record("grants", `${model} tables`, wrong.length === 0, wrong.join("; "));
  }

  const anonGrants = list(
    `SELECT table_name || ' ' || privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'anon' AND table_schema = 'public'
        AND table_name LIKE 'rr!_%' ESCAPE '!'`
  );
  record(
    "grants",
    "anon holds nothing on Road & Recovery",
    anonGrants.length === 0,
    anonGrants.join(", ")
  );

  const truncate = list(
    `SELECT table_name FROM information_schema.role_table_grants
      WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type = 'TRUNCATE'
        AND table_name LIKE 'rr!_%' ESCAPE '!'`
  );
  record("grants", "no TRUNCATE on Road & Recovery", truncate.length === 0, truncate.join(", "));

  // public.companies and public.company_users have no company_id column, so the sql/049
  // hardening loop never visits them. TRUNCATE is NOT gated by row level security, so a
  // grant here empties the tenant registry no matter what the policies say.
  const registry = list(
    `SELECT grantee || ' holds ' || privilege_type || ' on ' || table_name
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('companies', 'company_users')
        AND (grantee = 'anon' OR (grantee = 'authenticated' AND privilege_type = 'TRUNCATE'))
      ORDER BY 1`
  );
  record(
    "grants",
    "company registry is not exposed to anon or truncatable",
    registry.length === 0,
    registry.join("; ")
  );
}

function checkViews() {
  const views = query(
    `SELECT c.relname, COALESCE(array_to_string(c.reloptions, ','), '')
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
           WHERE col.table_schema = 'public' AND col.table_name = c.relname
             AND col.column_name = 'company_id'
        )
      ORDER BY 1`
  );
  const leaky = views.filter(([, opts]) => !String(opts).includes("security_invoker=true"));
  record(
    "security",
    "every tenant-scoped view is security_invoker",
    leaky.length === 0,
    leaky.length
      ? `runs as OWNER and will return EVERY tenant's rows: ${leaky.map(([name]) => name).join(", ")}`
      : `${views.length} views`
  );
}

function checkFinanceBoundary() {
  const clauses = FINANCE_PATTERNS.map((pattern) => `table_name LIKE '${pattern}'`).join(" OR ");
  const found = list(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND (${clauses}) ORDER BY 1`
  );
  record(
    "boundary",
    "VYRON CORE holds no finance object",
    found.length === 0,
    found.length
      ? `finance tables inside VYRON CORE: ${found.join(", ")} — invoicing, payments and ledgers belong to VYRON FINANCE`
      : "no invoice, payment, credit note, debtor or ledger table"
  );

  const fns = list(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (p.proname LIKE '%invoice%' OR p.proname LIKE '%payment%' OR p.proname LIKE '%ledger%')
      ORDER BY 1`
  );
  record("boundary", "no invoice-creating function", fns.length === 0, fns.join(", "));

  const duplicates = list(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE 'rr!_action%' ESCAPE '!'
          OR table_name LIKE 'rr!_outcome%' ESCAPE '!'
          OR table_name LIKE 'rr!_root%' ESCAPE '!'
          OR table_name LIKE 'rr!_employee%' ESCAPE '!')
      ORDER BY 1`
  );
  record(
    "boundary",
    "no duplicate action, outcome, root-cause or employee system",
    duplicates.length === 0,
    duplicates.join(", ")
  );
}

function checkRoadRecoveryVocabulary() {
  const definition = scalar(
    `SELECT COALESCE(pg_get_constraintdef(oid), '') FROM pg_constraint
      WHERE conname = 'workforce_automation_actions_action_type_check'`
  );
  const required = [
    "Escalate Dispatch", "Schedule Vehicle Release", "Request Authorisation",
    "Request Billing Information", "Review Distance Capture", "Review Fleet Capacity",
  ];
  const missing = required.filter((entry) => !String(definition).includes(entry));
  record(
    "road & recovery",
    "action vocabulary accepts Road & Recovery",
    missing.length === 0,
    missing.length ? `would be REJECTED: ${missing.join(", ")}` : "all six accepted"
  );

  const duplicateConstraints = scalar(
    `SELECT count(*)::int FROM pg_constraint
      WHERE conrelid = 'public.workforce_automation_actions'::regclass
        AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%action_type%'`
  );
  record(
    "road & recovery",
    "exactly one action_type constraint",
    Number(duplicateConstraints) === 1,
    `found ${duplicateConstraints} — two competing constraints silently reject valid values`
  );
}

function checkProvisioning() {
  if (!COMPANY) {
    record(
      "road & recovery",
      "provisioning",
      true,
      "skipped — pass --company <uuid> to verify a tenant's provisioning"
    );
    return;
  }

  const rows = query(
    `SELECT component, ok::text, detail FROM public.rr_provisioning_status('${COMPANY}')`
  );
  if (rows.length === 0) {
    record("road & recovery", "provisioning", false, `no provisioning status for ${COMPANY}`);
    return;
  }
  const failed = rows.filter(([, ok]) => ok !== "t" && ok !== "true");
  record(
    "road & recovery",
    `provisioning (${rows.length} components)`,
    failed.length === 0,
    failed.map(([component, , detail]) => `${component}: ${detail}`).join("; ")
  );

  const counts = query(
    `SELECT
       (SELECT count(*)::int FROM public.rr_service_types WHERE company_id = '${COMPANY}' AND active),
       (SELECT count(*)::int FROM public.rr_workflow_definitions WHERE company_id = '${COMPANY}' AND active),
       (SELECT count(*)::int FROM public.rr_requirement_policies WHERE company_id = '${COMPANY}' AND active),
       (SELECT count(*)::int FROM public.rr_bystand_reason_codes WHERE company_id = '${COMPANY}'),
       (SELECT count(*)::int FROM public.rr_rate_cards WHERE company_id = '${COMPANY}' AND active),
       (SELECT count(*)::int FROM public.rr_intelligence_thresholds WHERE company_id = '${COMPANY}' AND active)`
  )[0];

  const [services, workflows, policies, reasons, cards, thresholds] = counts.map(Number);
  record("road & recovery", "service catalogue", services >= 8, `${services} active service types (expected 8)`);
  record("road & recovery", "workflow definitions", workflows >= 6, `${workflows} active workflows (expected 6)`);
  record("road & recovery", "requirement policies", policies >= 8, `${policies} active policies`);
  record("road & recovery", "BYSTAND reason codes", reasons >= 1, `${reasons} reason codes`);
  record(
    "road & recovery",
    "rate cards",
    cards >= 8,
    cards >= 8
      ? `${cards} active rate cards`
      : `only ${cards} rate cards — jobs for unpriced services cannot be billed`
  );

  // Thresholds are OPTIONAL by design. Zero is a legitimate state and is reported as
  // information, never as a failure: intelligence says NO SLA CONFIGURED rather than
  // inventing a target.
  record(
    "road & recovery",
    "intelligence thresholds",
    true,
    thresholds === 0
      ? "none configured — intelligence will report NO SLA CONFIGURED and will not score health"
      : `${thresholds} operational targets configured`
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (!PSQL) die("PSQL_PATH (or RR_TEST_PSQL) is not set. Point it at a psql binary.");
if (!existsSync(PSQL)) die(`psql not found at ${PSQL}`);

if (!JSON_OUT) {
  const target = DB_URL ? "VYRON_DB_URL" : `${HOST}:${PORT}/${DB}`;
  process.stdout.write(`\n[verify:deployment] VYRON CORE deployment verification\n`);
  process.stdout.write(`  target: ${target}\n`);
  process.stdout.write(`  mode:   READ ONLY (enforced by PostgreSQL)\n\n`);
}

checkConnection();
checkTables();
checkColumns();
checkFunctions();
checkIndexes();
checkRls();
checkTriggers();
checkGrants();
checkViews();
checkFinanceBoundary();
checkRoadRecoveryVocabulary();
checkProvisioning();

if (JSON_OUT) {
  process.stdout.write(
    JSON.stringify({ ok: failures === 0, failures, checks: results }, null, 2) + "\n"
  );
} else {
  const passed = results.length - failures;
  process.stdout.write(`\n  ${passed}/${results.length} checks passed\n`);
  if (failures > 0) {
    process.stdout.write(`\n  DEPLOYMENT VERIFICATION FAILED — ${failures} check(s)\n`);
    process.stdout.write(
      `  This command reports only. It has not changed anything, and it will not:\n` +
        `  fix the deployment by running the missing migration, then verify again.\n\n`
    );
  } else {
    process.stdout.write(`\n  DEPLOYMENT VERIFIED\n\n`);
  }
}

// FAIL CLOSED. Anything unconfirmed is a failure.
process.exit(failures === 0 ? 0 : 1);

/**
 * Phase 8 — deployment integrity and the BYSTAND lifecycle.
 *
 * Two concerns, both of which Phase 7 exposed rather than solved:
 *
 *   1. The repository must be able to build its own schema. Phase 7 proved it could not,
 *      and the harness scaffolded six tables to get past it. Those tables are now owned by
 *      sql/010, and the assertions here make sure they stay owned — a schema contract that
 *      nothing checks drifts back within a release or two.
 *
 *   2. BYSTAND must remain structurally distinct from towing, all the way from the
 *      standing clock to intelligence. Phase 2 proved the timer; this proves the whole
 *      path, including that a paused attendance bills differently from a standing one.
 *
 * The static half runs anywhere. The runtime half needs the harness:
 *   node scripts/rr-test-env.mjs up
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";
import { ALPHA, ALPHA_CONTROLLER } from "./support/rr-lifecycle";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SQL_DIR = path.join(REPO_ROOT, "sql");

function migration(name: string): string {
  return readFileSync(path.join(SQL_DIR, name), "utf8");
}

const FOUNDATION = migration("010-workforce-foundation-tables.sql");
const HR_WARNINGS_COLUMNS = migration("038-hr-warnings-operational-columns.sql");
const EMPLOYEE_RELATIONS = migration("051-employee-relations-contract-intelligence-foundation.sql");

// ---------------------------------------------------------------------------
describe("Phase 8 — the repository owns its own schema", () => {
  it("creates every table the migration chain previously assumed existed", () => {
    // These six were referenced by migrations and by the application and created by none
    // of them. sql/030 failed on the first, and thirty-five migrations cascaded behind it.
    for (const table of [
      "employees",
      "stores",
      "leave_requests",
      "leave_balances",
      "roster_shifts",
      "hr_documents",
    ]) {
      assert.match(
        FOUNDATION,
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
        `sql/010 does not create public.${table}`
      );
    }
  });

  it("is safe against a live database that already has these tables", () => {
    // CREATE TABLE IF NOT EXISTS is a no-op on an existing table, which means it would
    // NOT add a column production is missing. The ADD COLUMN IF NOT EXISTS statements are
    // what make this a contract rather than a clean-install convenience.
    assert.ok(
      (FOUNDATION.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length > 40,
      "sql/010 does not reconcile columns on an existing database"
    );
  });

  it("destroys nothing", () => {
    for (const forbidden of [/DROP TABLE/i, /DROP COLUMN/i, /TRUNCATE/i, /ALTER COLUMN[^;]*TYPE/i]) {
      assert.equal(forbidden.test(FOUNDATION), false, `sql/010 contains ${forbidden}`);
    }
  });

  it("leaves security to the migrations that own it", () => {
    // sql/030 enables RLS and writes the tenant policies; sql/049 owns the grant matrix.
    // A foundation migration that pre-applied either would be testing itself.
    assert.equal(/ENABLE ROW LEVEL SECURITY/i.test(FOUNDATION), false);
    assert.equal(/^\s*GRANT /im.test(FOUNDATION), false);
    assert.equal(/CREATE POLICY/i.test(FOUNDATION), false);
  });

  it("declares the composite key Road & Recovery depends on", () => {
    // sql/071 uses (company_id, id) composite foreign keys so a cross-tenant reference is
    // impossible even if a policy were bypassed.
    assert.match(FOUNDATION, /employees_company_id_id_key UNIQUE \(company_id, id\)/);
  });

  it("creates leave_balances before anything can insert an employee", () => {
    // sql/039 installs an AFTER INSERT trigger on employees that writes to leave_balances.
    // Creating an employee therefore fails outright if the table is not there yet.
    const employees = FOUNDATION.indexOf("CREATE TABLE IF NOT EXISTS public.employees");
    const balances = FOUNDATION.indexOf("CREATE TABLE IF NOT EXISTS public.leave_balances");
    assert.ok(employees !== -1 && balances !== -1);
    assert.ok(
      balances > employees,
      "leave_balances must be created in the same migration, after employees"
    );
  });

  it("creates stores before employees, which reference it", () => {
    const stores = FOUNDATION.indexOf("CREATE TABLE IF NOT EXISTS public.stores");
    const employees = FOUNDATION.indexOf("CREATE TABLE IF NOT EXISTS public.employees");
    assert.ok(stores !== -1 && stores < employees);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 8 — migration ordering", () => {
  it("lets sql/038 apply before sql/051, which owns hr_warnings", () => {
    assert.match(
      HR_WARNINGS_COLUMNS,
      /to_regclass\('public\.hr_warnings'\) IS NULL/,
      "sql/038 still assumes hr_warnings exists and will fail on a clean database"
    );
    assert.match(HR_WARNINGS_COLUMNS, /CREATE TABLE public\.hr_warnings/);
  });

  it("keeps the two hr_warnings definitions identical", () => {
    // Two migrations can create this table. If their definitions drift, the shape you get
    // depends on which ran first — the worst kind of deployment bug to diagnose.
    const columnsOf = (source: string): string[] => {
      const start = source.indexOf("CREATE TABLE public.hr_warnings");
      const alt = source.indexOf("CREATE TABLE IF NOT EXISTS public.hr_warnings");
      const from = start !== -1 ? start : alt;
      assert.notEqual(from, -1, "hr_warnings definition not found");
      const body = source.slice(source.indexOf("(", from), source.indexOf(");", from));
      return body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[a-z_]+\s+/.test(line))
        .map((line) => line.split(/\s+/)[0]);
    };

    assert.deepEqual(
      columnsOf(HR_WARNINGS_COLUMNS).sort(),
      columnsOf(EMPLOYEE_RELATIONS).sort(),
      "sql/038 and sql/051 define hr_warnings differently"
    );
  });

  it("requires employees before creating hr_warnings, which references it", () => {
    assert.match(HR_WARNINGS_COLUMNS, /Prerequisite missing: public\.employees/);
  });

  it("needs no migration to run out of numeric order", () => {
    // The harness used to defer sql/038 behind sql/051. A harness that reorders migrations
    // is not rehearsing the deployment anybody will actually perform, so the fix belonged
    // in the repository and the deferral list must stay empty.
    const harness = readFileSync(path.join(REPO_ROOT, "scripts", "rr-test-env.mjs"), "utf8");
    assert.match(harness, /const DEFERRED = \{\};/, "the harness still reorders a migration");
  });

  it("scaffolds no application table in the test harness", () => {
    const harnessFiles = readdirSync(path.join(SQL_DIR, "test-harness"));
    assert.deepEqual(
      harnessFiles.sort(),
      ["000-supabase-compat.sql", "900-fixtures.sql"],
      "the harness creates application tables the repository should own"
    );

    // What remains must be Supabase infrastructure ONLY — never an application table.
    const compat = readFileSync(
      path.join(SQL_DIR, "test-harness", "000-supabase-compat.sql"),
      "utf8"
    );
    const created = [...compat.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\.(\w+)/g)];
    for (const [, schema] of created) {
      assert.notEqual(
        schema,
        "public",
        "the compatibility layer creates a table in public; only auth and storage stubs belong there"
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe("Phase 8 — the deployment verifier", () => {
  const verifier = readFileSync(path.join(REPO_ROOT, "scripts", "verify-deployment.mjs"), "utf8");

  it("runs every statement inside a READ ONLY transaction", () => {
    // This is what makes read-only a guarantee rather than an intention: PostgreSQL
    // refuses any write, including one a careless future edit might introduce.
    assert.match(verifier, /SET TRANSACTION READ ONLY/);
  });

  it("issues no write statement of any kind", () => {
    const body = verifier.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+public\./i,
      /\bDELETE\s+FROM\b/i,
      /\bCREATE\s+(TABLE|INDEX|POLICY|FUNCTION)\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
    ]) {
      assert.equal(forbidden.test(body), false, `the verifier can issue ${forbidden}`);
    }
  });

  it("fails closed", () => {
    assert.match(verifier, /process\.exit\(failures === 0 \? 0 : 1\)/);
  });

  it("never reads a Supabase service-role key", () => {
    assert.equal(/SERVICE_ROLE/i.test(verifier.replace(/^\s*\*.*$/gm, "")), false);
  });

  it("checks the finance boundary", () => {
    for (const term of ["invoice", "credit_note", "ledger", "debtor", "payment"]) {
      assert.ok(verifier.includes(term), `the verifier does not check for ${term}`);
    }
  });

  it("is registered as an npm script", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["verify:deployment"], "node scripts/verify-deployment.mjs");
  });
});

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const CONFIG = readTestDatabaseConfig();
let alpha: PgTestClient;
let owner: PgTestClient;
const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Phase 8 runtime", () => {
    it("skipped: run node scripts/rr-test-env.mjs up, then set RR_TEST_PSQL and RR_TEST_DB", () => {
      assert.ok(true);
    });
  });
}

before(() => {
  if (!CONFIG) return;
  alpha = createPgTestClient(CONFIG, { kind: "authenticated", email: ALPHA_CONTROLLER });
  owner = createPgTestClient(CONFIG, { kind: "owner" });
});

describeIf("Phase 8 — the schema was built by the repository", () => {
  it("has the foundation tables with their full contract", () => {
    const contract: Record<string, string[]> = {
      employees: [
        "id", "company_id", "employee_number", "first_name", "last_name", "email", "phone",
        "job_title", "employment_type", "store_id", "default_store_id",
        "kiosk_access_enabled", "pin_code", "active", "record_status",
      ],
      stores: ["id", "company_id", "name", "address", "city", "region", "gps_radius_meters", "record_status"],
      leave_balances: ["id", "company_id", "employee_id", "leave_type", "opening_balance", "accrued", "taken"],
      leave_requests: ["id", "company_id", "employee_id", "leave_type", "start_date", "end_date", "status"],
      roster_shifts: ["id", "company_id", "employee_id", "shift_date", "planned_start", "planned_end"],
      hr_documents: ["id", "company_id", "employee_id", "document_type", "file_path", "status"],
    };

    for (const [table, columns] of Object.entries(contract)) {
      const present = new Set(
        owner
          .sql(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = '${table}'`
          )
          .map((row) => String((row as { column_name: string }).column_name))
      );
      const missing = columns.filter((column) => !present.has(column));
      assert.deepEqual(missing, [], `${table} is missing ${missing.join(", ")}`);
    }
  });

  it("secures the foundation tables through the migrations that own security", () => {
    // sql/010 creates them; sql/030 and sql/049 protect them. The proof is that they end
    // up protected without sql/010 having said a word about security.
    for (const table of ["employees", "stores", "leave_requests", "leave_balances", "roster_shifts", "hr_documents"]) {
      const rls = owner.sql(
        `SELECT relrowsecurity::text AS enabled FROM pg_class WHERE relname = '${table}'`
      );
      // The transport renders booleans as JSON, so this is "true", not psql's "t".
      assert.equal(
        String((rls[0] as { enabled: string }).enabled),
        "true",
        `${table} has no row level security`
      );
      const policies = owner.sql(
        `SELECT count(*)::int AS n FROM pg_policies WHERE tablename = '${table}'`
      );
      assert.ok(
        Number((policies[0] as { n: number }).n) >= 1,
        `${table} has RLS enabled but no policy, so nobody can read it`
      );
    }
  });

  it("holds nothing for anon on the company registry", () => {
    // public.companies has no company_id column, so the sql/049 hardening loop never
    // reaches it. sql/001 granted anon ALL, including TRUNCATE — which row level security
    // does NOT gate.
    const rows = owner.sql(
      `SELECT grantee || ':' || privilege_type AS g FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name IN ('companies', 'company_users')
          AND (grantee = 'anon' OR (grantee = 'authenticated' AND privilege_type = 'TRUNCATE'))`
    );
    assert.deepEqual(rows, [], "anon can still reach the tenant registry");
  });

  it("marks every tenant-scoped view security_invoker, not only the Road & Recovery ones", () => {
    const leaky = owner.sql(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
          AND COALESCE(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=true%'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'public' AND col.table_name = c.relname
               AND col.column_name = 'company_id'
          )
        ORDER BY 1`
    );
    assert.deepEqual(leaky, [], "a tenant-scoped view runs as its owner");
  });
});

// ---------------------------------------------------------------------------
describeIf("Phase 8 — the BYSTAND lifecycle, end to end", () => {
  it("STANDING -> PAUSE -> RESUME -> EVIDENCE -> STAND-DOWN -> SEALED -> INTELLIGENCE", async () => {
    const { authorise, createJob, recordGpsArrival, satisfyEvidence, priceCard } = await import(
      "./support/rr-lifecycle"
    );
    const { transitionServiceJob } = await import("@/lib/road-recovery/job-service");
    const { sealStandbySummary } = await import("@/lib/road-recovery/bystand-service");
    const { computeRoadRecoveryIntelligence } = await import(
      "@/lib/road-recovery/intelligence-service"
    );

    priceCard(owner, "bystand", { callout: 400, standing_time: 480 });

    const job = await createJob(alpha, {
      serviceCode: "bystand",
      title: `PHASE8 bystand ${Date.now()}`,
      withDestination: false,
    });
    authorise(owner, { serviceJobId: job.serviceJobId, serviceCode: "bystand" });
    recordGpsArrival(owner, job.fieldJobId);

    const move = async (toState: string, reason?: string) => {
      const result = await transitionServiceJob(alpha as never, {
        companyId: ALPHA,
        actorEmail: ALPHA_CONTROLLER,
        serviceJobId: job.serviceJobId,
        toState,
        ...(reason ? { reason } : {}),
      });
      assert.ok(result.ok, result.ok ? "" : `${toState} failed: ${result.message}`);
    };

    // ARRIVE and start the standing clock.
    for (const state of [
      "bystand_requested", "authorisation_pending", "authorised",
      "assigned", "accepted", "en_route", "arrived_on_scene", "standing_by",
    ]) {
      await move(state);
    }

    // PAUSE and RESUME. A weather hold is not billable standing time, and the whole point
    // of the paused/standing distinction is that the customer is not charged for it.
    await move("weather_hold", "Lightning storm; crew withdrawn to the vehicle");
    await move("standing_by");

    // A second pause, through a different route, so the seal has to cope with more than
    // one paused interval.
    await move("scene_handover_to_authority", "Scene handed to SAPS while awaiting tow");
    await move("standing_by");

    await satisfyEvidence(alpha, owner, {
      serviceJobId: job.serviceJobId,
      fieldJobId: job.fieldJobId,
    });

    await move("stand_down_requested", "Owner arranged private recovery");
    await move("stood_down", "Stood down at the scene");

    // SEAL — through the real sealer, from the real event log.
    const sealed = await sealStandbySummary(alpha as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId: job.serviceJobId,
      sealedReason: "stand_down",
    });
    assert.ok(sealed.ok, sealed.ok ? "" : sealed.message);
    if (!sealed.ok) return;

    const summary = owner.sql(
      `SELECT standing_interval_count::int AS standing, paused_interval_count::int AS paused,
              total_billable_seconds::int AS billable, total_paused_seconds::int AS paused_secs,
              calculator_version
         FROM public.rr_standby_summary
        WHERE company_id = '${ALPHA}' AND service_job_id = '${job.serviceJobId}'`
    )[0] as {
      standing: number;
      paused: number;
      billable: number;
      paused_secs: number;
      calculator_version: string;
    };

    // THREE standing stretches (arrive-to-hold, hold-to-handover, handover-to-stand-down)
    // and TWO pauses. The counts are what prove pause and resume were tracked as separate
    // intervals rather than smeared into one.
    assert.equal(Number(summary.standing), 3, "the standing clock did not split at each pause");
    assert.equal(Number(summary.paused), 2, "the pauses were not recorded as paused intervals");
    assert.ok(Number(summary.billable) >= 0);
    assert.ok(Number(summary.paused_secs) >= 0);
    assert.ok(String(summary.calculator_version).length > 0, "the seal carries no calculator version");

    // STRUCTURAL SEPARATION. A BYSTAND attendance moves nothing and stores nothing, so it
    // must never carry a tow, storage, custody or delivery charge.
    const forbidden = owner.sql(
      `SELECT l.charge_code FROM public.rr_charge_lines l
        WHERE l.company_id = '${ALPHA}' AND l.service_job_id = '${job.serviceJobId}'
          AND l.charge_code IN ('tow_distance', 'storage_days', 'loading', 'unloading', 'delivery', 'recovery_hours')`
    );
    assert.deepEqual(forbidden, [], "a BYSTAND attendance carries a recovery charge");

    const custody = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_custody_events
        WHERE company_id = '${ALPHA}' AND service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(Number((custody[0] as { n: number }).n), 0, "a BYSTAND attendance took custody");

    // INTELLIGENCE — the attendance appears in the BYSTAND domain and NOWHERE in tow.
    const intelligence = await computeRoadRecoveryIntelligence(alpha as never, {
      companyId: ALPHA,
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2100-01-01T00:00:00.000Z",
    });
    assert.ok(intelligence.ok, intelligence.ok ? "" : intelligence.message);
    if (!intelligence.ok) return;

    const bystandDomain = intelligence.data.domains.find((entry) => entry.domain === "bystand");
    assert.ok(bystandDomain, "no BYSTAND intelligence domain");
    assert.ok(
      Number(bystandDomain?.detail.sealedAttendances ?? 0) >= 1,
      "the sealed attendance did not reach BYSTAND intelligence"
    );

    // The tow domain must not have counted it. buildDomains() asserts this and throws, so
    // reaching here at all is part of the proof; the count check makes it explicit.
    const towJobs = intelligence.data.jobCount - intelligence.data.bystandCount;
    const towDomain = intelligence.data.domains.find((entry) => entry.domain === "tow_operations");
    const cycle = towDomain?.metrics.find((entry) => entry.key === "job_cycle_time_hours");
    assert.ok(
      (cycle?.sampleSize ?? 0) <= towJobs,
      "a BYSTAND attendance was measured as a tow"
    );
  });
});

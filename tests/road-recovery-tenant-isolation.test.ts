/**
 * Road & Recovery tenant isolation and schema safety (Phase 0).
 *
 * There is no database in this test environment, so these tests assert against the
 * migration SOURCE. That is deliberate and it is the check that actually matters here:
 * every tenant-isolation defect this repository has hit was a property of the migration
 * text (a missing policy, a `USING (true)` left behind, a `company_id` that was text
 * instead of uuid so sql/049's policy generator raised "operator does not exist:
 * text = uuid" — see docs/SCHEMA_NORMALIZATION_PLAN.md).
 *
 * So this suite proves, for every table sql/070 creates:
 *
 *   - company_id is `uuid NOT NULL REFERENCES public.companies (id)`
 *   - row level security is enabled
 *   - a <table>_tenant_isolation policy is created using the sql/030 helpers
 *   - anon is revoked
 *   - no permissive `USING (true)` policy is introduced
 *
 * and, separately, that the migration does not touch field_jobs or its status CHECK.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  companyAvailableModules,
  effectiveUserModules,
  resolveModuleGrant,
  summarizeModuleAccess,
} from "@/lib/tenant/module-access";
import { MODULE_CATALOG, moduleLabel } from "@/lib/platform/module-catalog";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION_PATH = path.join(REPO_ROOT, "sql", "070-road-recovery-foundation.sql");
const MIGRATION = readFileSync(MIGRATION_PATH, "utf8");

/**
 * The migration with `--` comments stripped.
 *
 * Absence assertions ("must not grant anon", "must not mention tow_subtype") have to run
 * against executable SQL only. The header of sql/070 documents at length that there is no
 * tow_subtype and that anon never reaches this vertical, and matching that prose would
 * make the tests fail on their own documentation.
 *
 * Lines carrying a dollar-quoted workflow definition are preserved verbatim, since `--`
 * inside a JSON literal is data, not a comment.
 */
const MIGRATION_SQL = MIGRATION.split("\n")
  .map((line) => (line.includes("$rr_wf$") ? line : line.replace(/--.*$/, "")))
  .join("\n");

/** The four tables Phase 0 creates. */
const RR_TABLES = [
  "rr_service_types",
  "rr_workflow_definitions",
  "rr_service_jobs",
  "rr_service_state_events",
] as const;

/** Extracts the body of a CREATE TABLE statement, to the matching close paren. */
function createTableBody(table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS public.${table} (`;
  const start = MIGRATION.indexOf(marker);
  assert.ok(start >= 0, `sql/070 does not create public.${table}`);

  let depth = 0;
  let index = start + marker.length - 1;
  for (; index < MIGRATION.length; index += 1) {
    const char = MIGRATION[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return MIGRATION.slice(start + marker.length, index);
}

describe("Road & Recovery migration — tenant boundary", () => {
  it("creates exactly the four Phase 0 tables and no others", () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(created.sort(), [...RR_TABLES].sort());
  });

  for (const table of RR_TABLES) {
    it(`${table}: company_id is uuid NOT NULL referencing companies`, () => {
      const body = createTableBody(table);
      const match = body.match(/company_id\s+([^,\n]+)/);
      assert.ok(match, `${table} has no company_id column`);
      const declaration = match[1];

      assert.match(declaration, /^uuid\b/, `${table}.company_id must be uuid, got: ${declaration}`);
      assert.match(declaration, /NOT NULL/, `${table}.company_id must be NOT NULL`);
      assert.match(
        declaration,
        /REFERENCES public\.companies \(id\)/,
        `${table}.company_id must reference public.companies (id)`
      );
    });

    it(`${table}: row level security is enabled`, () => {
      assert.ok(
        MIGRATION.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} does not enable row level security`
      );
    });

    it(`${table}: anon is revoked`, () => {
      assert.ok(
        MIGRATION.includes(`REVOKE ALL ON public.${table} FROM anon`),
        `${table} does not revoke anon`
      );
    });

    it(`${table}: anon is never granted anything`, () => {
      const grantToAnon = new RegExp(`^\\s*GRANT[^;]*ON public\\.${table}[^;]*anon`, "im");
      assert.ok(!grantToAnon.test(MIGRATION_SQL), `${table} grants a privilege to anon`);
    });
  }

  it("creates a tenant_isolation policy for every table via the sql/030 helpers", () => {
    // The policies are generated in one loop over the table list, so assert the loop
    // covers all four names and uses both helper functions.
    for (const table of RR_TABLES) {
      assert.ok(
        new RegExp(`'${table}'`).test(MIGRATION),
        `${table} is not included in the policy generation loop`
      );
    }
    assert.match(MIGRATION, /%I_tenant_isolation ON public\.%I/);
    assert.match(MIGRATION, /public\.vyron_is_platform_operator\(\)/);
    assert.match(MIGRATION, /public\.vyron_user_company_ids\(\)/);
    assert.match(MIGRATION, /FOR ALL TO authenticated USING/);
    assert.match(MIGRATION, /WITH CHECK/);
  });

  it("introduces no permissive USING (true) policy", () => {
    // sql/014 originally shipped `USING (true) WITH CHECK (true)` on the field_* tables
    // and sql/049 had to strip them. This vertical must never reintroduce the pattern.
    assert.ok(
      !/USING\s*\(\s*true\s*\)/i.test(MIGRATION_SQL),
      "sql/070 contains a permissive USING (true) policy"
    );
    assert.ok(
      !/DEV allow all/i.test(MIGRATION_SQL),
      "sql/070 contains a DEV allow-all policy"
    );
  });

  it("fails closed when the sql/030 tenant helpers are missing", () => {
    // RLS is enabled before the policy block, so a project without sql/030 ends up with
    // RLS on and no policy, which denies everything rather than exposing rows.
    const rlsAt = MIGRATION.indexOf("ENABLE ROW LEVEL SECURITY");
    const policyAt = MIGRATION.indexOf("_tenant_isolation ON public.%I");
    assert.ok(rlsAt >= 0 && policyAt >= 0);
    assert.ok(rlsAt < policyAt, "RLS must be enabled before policies are created");
    assert.match(MIGRATION, /Tenant helper functions missing/);
  });

  it("scopes the seeding function to the service role only", () => {
    assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.rr_seed_service_catalogue\(uuid\) FROM PUBLIC/);
    assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.rr_seed_service_catalogue\(uuid\) FROM anon/);
    assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.rr_seed_service_catalogue\(uuid\) TO service_role/);
    // Not SECURITY DEFINER: it must run under the caller's rights so RLS still applies.
    const functionBody = MIGRATION.slice(
      MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.rr_seed_service_catalogue"),
      MIGRATION.indexOf("$seed$;")
    );
    assert.ok(
      !/SECURITY DEFINER/i.test(functionBody),
      "rr_seed_service_catalogue must not be SECURITY DEFINER"
    );
  });

  it("pins a job to a service type in its own company", () => {
    // Cross-tenant defence beyond RLS: the composite FK makes it impossible for a job in
    // company A to reference a service type belonging to company B.
    const body = createTableBody("rr_service_jobs");
    assert.match(body, /FOREIGN KEY \(company_id, service_type_id, workflow_key\)/);
    assert.match(body, /REFERENCES public\.rr_service_types \(company_id, id, workflow_key\)/);
    assert.match(body, /FOREIGN KEY \(company_id, workflow_key, workflow_version\)/);
    assert.match(
      body,
      /REFERENCES public\.rr_workflow_definitions \(company_id, workflow_key, version\)/
    );
  });
});

describe("Road & Recovery migration — existing schema is untouched", () => {
  it("does not ALTER public.field_jobs", () => {
    assert.ok(
      !/ALTER TABLE public\.field_jobs/i.test(MIGRATION_SQL),
      "sql/070 must not alter public.field_jobs"
    );
  });

  it("does not widen or touch the field_jobs status CHECK constraint", () => {
    assert.ok(
      !/field_jobs_status_check/i.test(MIGRATION_SQL),
      "sql/070 must not touch field_jobs_status_check"
    );
    assert.ok(
      !/DROP CONSTRAINT/i.test(MIGRATION_SQL),
      "sql/070 must not drop any constraint"
    );
  });

  it("alters no existing table at all", () => {
    const altered = [...MIGRATION_SQL.matchAll(/ALTER TABLE public\.(\w+)/g)].map((match) => match[1]);
    // The only ALTER TABLE statements are the ENABLE ROW LEVEL SECURITY calls on the new
    // tables. Nothing pre-existing is modified.
    for (const table of altered) {
      assert.ok(
        (RR_TABLES as readonly string[]).includes(table),
        `sql/070 alters pre-existing table public.${table}`
      );
    }
  });

  it("drops no table, column, function or trigger belonging to another module", () => {
    const drops = [...MIGRATION_SQL.matchAll(/DROP\s+(TABLE|COLUMN|FUNCTION)\s+(?:IF EXISTS\s+)?(\S+)/gi)];
    assert.deepEqual(drops, [], "sql/070 must not drop tables, columns or functions");
  });

  it("only creates the 1:1 extension, never a parallel job table", () => {
    const body = createTableBody("rr_service_jobs");
    assert.match(
      body,
      /field_job_id uuid NOT NULL REFERENCES public\.field_jobs \(id\)/,
      "rr_service_jobs must extend field_jobs"
    );
    assert.match(
      body,
      /UNIQUE \(field_job_id\)/,
      "the field_jobs link must be UNIQUE — that is what makes the relationship 1:1"
    );
  });

  it("records only physical statuses field_jobs can itself hold", () => {
    const body = createTableBody("rr_service_state_events");
    for (const status of [
      "Pending",
      "Dispatched",
      "Travelling",
      "On Site",
      "Completed",
      "Cancelled",
    ]) {
      assert.ok(body.includes(`'${status}'`), `the physical status CHECK omits ${status}`);
    }
    // Anything outside those six would be unrepresentable in field_jobs.status.
    assert.ok(!/'Impounded'|'Storage'|'Standing By'/.test(body));
  });
});

describe("Road & Recovery migration — BYSTAND is structurally not a tow", () => {
  it("defines no tow_subtype column, constraint or value anywhere", () => {
    // Executable SQL only: the header documents the absence of a tow subtype at length,
    // and that prose must not be mistaken for an implementation of one.
    assert.ok(
      !/tow_subtype/i.test(MIGRATION_SQL),
      "sql/070 references a tow subtype; BYSTAND must be a peer service type"
    );
  });

  it("binds the bystand workflow exclusively to the bystand service", () => {
    const body = createTableBody("rr_service_types");
    assert.match(body, /rr_service_types_bystand_workflow_exclusive/);
    // The if-and-only-if form: neither direction can be violated.
    assert.match(body, /\(service_code = 'bystand'\) = \(workflow_key = 'bystand'\)/);
  });

  it("makes a bystand service with tow characteristics unrepresentable", () => {
    const body = createTableBody("rr_service_types");
    const shape = body.slice(body.indexOf("rr_service_types_bystand_shape"));
    assert.match(shape, /requires_destination = false/);
    assert.match(shape, /requires_custody = false/);
    assert.match(shape, /requires_storage = false/);
    assert.match(shape, /billing_basis = 'per_hour_standing'/);
    assert.match(shape, /bills_standing_time = true/);
    assert.match(shape, /can_spawn_recovery_job = true/);
    assert.match(shape, /kpi_set_key = 'bystand'/);
  });

  it("makes a bystand JOB with a destination unrepresentable", () => {
    const body = createTableBody("rr_service_jobs");
    const check = body.slice(body.indexOf("rr_service_jobs_bystand_no_destination"));
    assert.match(check, /workflow_key <> 'bystand'/);
    for (const column of [
      "destination_type",
      "destination_label",
      "destination_address",
      "destination_latitude",
      "destination_longitude",
    ]) {
      assert.match(
        check,
        new RegExp(`${column} IS NULL`),
        `the bystand destination guard does not cover ${column}`
      );
    }
  });

  it("supports spawning a separate linked recovery job", () => {
    const body = createTableBody("rr_service_jobs");
    assert.match(
      body,
      /spawned_from_service_job_id uuid REFERENCES public\.rr_service_jobs \(id\)/,
      "a spawned job must point back at its originating job"
    );
    assert.match(body, /rr_service_jobs_spawn_not_self/);
  });
});

describe("Road & Recovery migration — append-only state history", () => {
  it("grants only SELECT and INSERT on the event log", () => {
    assert.ok(
      MIGRATION.includes("GRANT SELECT, INSERT ON public.rr_service_state_events TO authenticated")
    );
    const broadGrant = /GRANT[^;]*UPDATE[^;]*ON public\.rr_service_state_events/i;
    assert.ok(!broadGrant.test(MIGRATION_SQL), "the event log must not grant UPDATE");
    const deleteGrant = /GRANT[^;]*DELETE[^;]*ON public\.rr_service_state_events/i;
    assert.ok(!deleteGrant.test(MIGRATION_SQL), "the event log must not grant DELETE");
  });

  it("blocks UPDATE and DELETE with a trigger, which also binds the service role", () => {
    assert.match(MIGRATION, /CREATE TRIGGER rr_service_state_events_append_only/);
    assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON public\.rr_service_state_events/);
    assert.match(MIGRATION, /is append-only/);
  });
});

describe("Road & Recovery migration — idempotency", () => {
  it("guards every table, index, function, trigger and policy creation", () => {
    const creates = [...MIGRATION.matchAll(/^\s*CREATE (TABLE|INDEX|UNIQUE INDEX)([^\n]*)/gim)];
    assert.ok(creates.length > 0);
    for (const [, kind, rest] of creates) {
      assert.match(
        rest,
        /IF NOT EXISTS/,
        `an unguarded CREATE ${kind} would fail on a re-run: ${rest.trim()}`
      );
    }
  });

  it("replaces rather than recreates functions", () => {
    const functions = [...MIGRATION.matchAll(/CREATE (OR REPLACE )?FUNCTION/g)];
    assert.ok(functions.length > 0);
    for (const [, orReplace] of functions) {
      assert.ok(orReplace, "every function must be CREATE OR REPLACE to stay re-runnable");
    }
  });

  it("drops each trigger and policy before creating it", () => {
    assert.match(
      MIGRATION,
      /DROP TRIGGER IF EXISTS rr_service_state_events_append_only/
    );
    assert.match(MIGRATION, /DROP POLICY IF EXISTS %I_tenant_isolation/);
  });

  it("never inserts a seed row that already exists", () => {
    // Both seed INSERTs are guarded by WHERE NOT EXISTS, so a re-run preserves a
    // tenant's own renames and deactivations rather than overwriting them.
    const inserts = [...MIGRATION.matchAll(/INSERT INTO public\.rr_\w+/g)];
    assert.equal(inserts.length, 2, "expected exactly two seed INSERT statements");
    const notExists = [...MIGRATION.matchAll(/WHERE NOT EXISTS/g)];
    assert.ok(
      notExists.length >= 2,
      "each seed INSERT must be guarded by WHERE NOT EXISTS"
    );
    // Nothing may be overwritten on conflict either.
    assert.ok(!/ON CONFLICT[^;]*DO UPDATE/i.test(MIGRATION.slice(MIGRATION.indexOf("rr_seed_service_catalogue"))));
  });

  it("wraps everything in a single transaction and reloads the API schema", () => {
    assert.match(MIGRATION, /^BEGIN;$/m);
    assert.match(MIGRATION, /^COMMIT;$/m);
    assert.match(MIGRATION, /NOTIFY pgrst, 'reload schema'/);
  });

  it("raises a clear error when its prerequisites are missing", () => {
    assert.match(MIGRATION, /Prerequisite missing: public\.companies/);
    assert.match(MIGRATION, /Prerequisite missing: public\.field_jobs/);
  });

  it("has balanced dollar-quoted blocks", () => {
    const tags = [...MIGRATION.matchAll(/\$([a-z_]+)\$/g)].map((match) => match[1]);
    const counts = new Map<string, number>();
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const [tag, count] of counts) {
      assert.equal(count % 2, 0, `dollar-quoted tag $${tag}$ is unbalanced (${count} occurrences)`);
    }
  });
});

describe("Road & Recovery module registration", () => {
  it("registers road_recovery in the shared platform catalogue", () => {
    const entry = MODULE_CATALOG.find((item) => item.code === "road_recovery");
    assert.ok(entry, "road_recovery is not registered in lib/platform/module-catalog.ts");
    assert.equal(entry?.label, "Road & Recovery");
    assert.equal(moduleLabel("road_recovery"), "Road & Recovery");
  });

  it("registers the module in the database registry too", () => {
    assert.match(MIGRATION, /INSERT INTO public\.platform_modules/);
    assert.match(MIGRATION, /'road_recovery', 'Road & Recovery'/);
    assert.match(MIGRATION, /ON CONFLICT \(module_code\) DO NOTHING/);
  });

  it("adds the module to the existing towing_recovery solution template", () => {
    assert.match(MIGRATION, /WHERE code = 'towing_recovery'/);
    assert.match(MIGRATION, /@> '\["road_recovery"\]'::jsonb/);
  });

  it("enables the module for nobody by default", () => {
    // Registration is not entitlement. Nothing in the migration writes
    // companies.enabled_modules.
    assert.ok(
      !/UPDATE public\.companies/i.test(MIGRATION_SQL),
      "sql/070 must not grant the module to any company"
    );
  });

  it("seeds the catalogue only for companies that hold the module", () => {
    assert.match(MIGRATION, /@> '\["road_recovery"\]'::jsonb/);
    assert.match(MIGRATION, /FROM public\.companies c/);
  });

  it("is withheld from a company whose subscription excludes it", () => {
    const professional = ["employees", "leave", "clocking"];
    const grant = resolveModuleGrant(["leave", "road_recovery"], professional);
    assert.deepEqual(grant.modules, ["leave"]);
    assert.deepEqual(grant.rejected, ["road_recovery"]);
  });

  it("is grantable to a user once the company holds it", () => {
    const enterprise = ["employees", "leave", "road_recovery"];
    const grant = resolveModuleGrant(["road_recovery"], enterprise);
    assert.deepEqual(grant.modules, ["road_recovery"]);
    assert.deepEqual(grant.rejected, []);
  });

  it("narrows automatically if the company loses the module", () => {
    const stored = ["employees", "road_recovery"];
    assert.deepEqual(effectiveUserModules(stored, ["employees", "leave"]), ["employees"]);
  });

  it("appears in a company's available modules and summary", () => {
    assert.deepEqual(companyAvailableModules(["road_recovery", "leave"]), [
      "leave",
      "road_recovery",
    ]);
    assert.equal(
      summarizeModuleAccess(["road_recovery"], ["leave", "road_recovery"]),
      "Road & Recovery"
    );
  });

  it("does not disturb the ordering of the pre-existing catalogue", () => {
    // road_recovery is appended, so every code that shipped before it keeps its rank.
    const codes = MODULE_CATALOG.map((entry) => entry.code);
    assert.equal(codes[codes.length - 1], "road_recovery");
    assert.equal(codes.indexOf("dashboard"), 0);
    assert.ok(codes.indexOf("leave") < codes.indexOf("clocking"));
    assert.equal(new Set(codes).size, codes.length, "duplicate module code");
  });
});

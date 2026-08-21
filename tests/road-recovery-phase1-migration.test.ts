/**
 * Phase 1 migration security and schema safety (sql/071).
 *
 * Static assertions over the migration source, in the same spirit as the Phase 0 suite:
 * every tenant-isolation defect this repository has hit was a property of the migration
 * text. Runtime behaviour is separately proven against real PostgreSQL.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION = readFileSync(
  path.join(REPO_ROOT, "sql", "071-road-recovery-dispatch.sql"),
  "utf8"
);
const HARDENING = readFileSync(
  path.join(REPO_ROOT, "sql", "049-release-candidate-security-hardening.sql"),
  "utf8"
);

/** Executable SQL only — the header documents intent at length. */
const MIGRATION_SQL = MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const PHASE1_TABLES = [
  "rr_counterparties",
  "rr_counterparty_contacts",
  "rr_authorisations",
  "rr_tow_truck_profiles",
  "rr_driver_certifications",
  "rr_dispatch_candidates",
  "rr_dispatch_assignments",
] as const;

function createTableBody(table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS public.${table} (`;
  const start = MIGRATION.indexOf(marker);
  assert.ok(start >= 0, `sql/071 does not create public.${table}`);
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

describe("Phase 1 migration — tenant boundary", () => {
  it("creates exactly the seven Phase 1 tables", () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(created.sort(), [...PHASE1_TABLES].sort());
  });

  for (const table of PHASE1_TABLES) {
    it(`${table}: company_id is uuid NOT NULL referencing companies`, () => {
      const body = createTableBody(table);
      const match = body.match(/company_id\s+([^,\n]+)/);
      assert.ok(match, `${table} has no company_id`);
      assert.match(match[1], /^uuid\b/);
      assert.match(match[1], /NOT NULL/);
      assert.match(match[1], /REFERENCES public\.companies \(id\)/);
    });

    it(`${table}: RLS is enabled and anon is revoked`, () => {
      assert.ok(MIGRATION.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`));
      assert.ok(MIGRATION.includes(`REVOKE ALL ON public.${table} FROM anon`));
    });

    it(`${table}: is covered by the tenant isolation policy loop`, () => {
      assert.ok(new RegExp(`'${table}'`).test(MIGRATION));
    });
  }

  it("uses the sql/030 helpers and no permissive policy", () => {
    assert.match(MIGRATION, /public\.vyron_is_platform_operator\(\)/);
    assert.match(MIGRATION, /public\.vyron_user_company_ids\(\)/);
    assert.ok(!/USING\s*\(\s*true\s*\)/i.test(MIGRATION_SQL));
    assert.ok(!/DEV allow all/i.test(MIGRATION_SQL));
  });

  it("never grants anything to anon", () => {
    for (const table of PHASE1_TABLES) {
      const grantToAnon = new RegExp(`^\\s*GRANT[^;]*ON public\\.${table}[^;]*anon`, "im");
      assert.ok(!grantToAnon.test(MIGRATION_SQL), `${table} grants to anon`);
    }
  });

  it("pins every cross-tenant relationship with a composite foreign key", () => {
    // Each child row must be tied to a parent IN THE SAME COMPANY, not merely to a parent.
    const expectations: [string, RegExp][] = [
      ["rr_counterparty_contacts", /FOREIGN KEY \(company_id, counterparty_id\)/],
      ["rr_authorisations", /FOREIGN KEY \(company_id, service_job_id\)/],
      ["rr_authorisations", /FOREIGN KEY \(company_id, counterparty_id\)/],
      ["rr_tow_truck_profiles", /FOREIGN KEY \(company_id, field_vehicle_id\)/],
      ["rr_driver_certifications", /FOREIGN KEY \(company_id, employee_id\)/],
      ["rr_dispatch_candidates", /FOREIGN KEY \(company_id, service_job_id\)/],
      ["rr_dispatch_assignments", /FOREIGN KEY \(company_id, service_job_id\)/],
      ["rr_dispatch_assignments", /FOREIGN KEY \(company_id, employee_id\)/],
    ];
    for (const [table, pattern] of expectations) {
      assert.match(createTableBody(table), pattern, `${table} is missing a composite FK`);
    }
  });
});

describe("Phase 1 migration — legal records are not cascaded away", () => {
  it("restricts deletion of an authorised service job", () => {
    const body = createTableBody("rr_authorisations");
    assert.match(body, /service_job_id uuid NOT NULL REFERENCES public\.rr_service_jobs \(id\) ON DELETE RESTRICT/);
    assert.match(body, /FOREIGN KEY \(company_id, service_job_id\)[\s\S]*?ON DELETE RESTRICT/);
  });

  it("restricts deletion of a counterparty that has authorisations", () => {
    assert.match(
      createTableBody("rr_authorisations"),
      /FOREIGN KEY \(company_id, counterparty_id\)[\s\S]*?ON DELETE RESTRICT/
    );
  });

  it("supports voiding rather than deleting", () => {
    const body = createTableBody("rr_authorisations");
    assert.match(body, /void_reason text/);
    assert.match(body, /voided_at timestamptz/);
    assert.match(body, /rr_authorisations_void_recorded/);
    assert.match(body, /status IN \('active', 'expired', 'void', 'superseded'\)/);
  });

  it("does not grant DELETE on authorisations", () => {
    assert.match(MIGRATION, /GRANT SELECT, INSERT, UPDATE ON public\.rr_authorisations TO authenticated/);
    assert.match(MIGRATION, /REVOKE DELETE, TRUNCATE ON public\.rr_authorisations FROM authenticated/);
  });

  it("restricts deletion of an employee who holds dispatch assignments", () => {
    assert.match(
      createTableBody("rr_dispatch_assignments"),
      /FOREIGN KEY \(company_id, employee_id\)[\s\S]*?ON DELETE RESTRICT/
    );
  });
});

describe("Phase 1 migration — dispatch explainability", () => {
  it("retains every mandated explainability field", () => {
    const body = createTableBody("rr_dispatch_candidates");
    for (const column of [
      "eligible",
      "eligibility_failures",
      "distance_km",
      "capability_result",
      "certification_result",
      "availability_status",
      "conflicting_assignment_id",
      "score_components",
      "final_score",
      "recommended",
      "recommendation_reason",
      "engine_version",
    ]) {
      assert.ok(body.includes(column), `rr_dispatch_candidates is missing ${column}`);
    }
  });

  it("forces an ineligible candidate to say why", () => {
    assert.match(
      createTableBody("rr_dispatch_candidates"),
      /rr_dispatch_candidates_failures_consistent/
    );
  });

  it("refuses to recommend an ineligible candidate", () => {
    assert.match(
      createTableBody("rr_dispatch_candidates"),
      /NOT recommended OR eligible/
    );
  });

  it("is append-only in both grants and trigger", () => {
    assert.match(MIGRATION, /GRANT SELECT, INSERT ON public\.rr_dispatch_candidates TO authenticated/);
    assert.match(
      MIGRATION,
      /REVOKE UPDATE, DELETE, TRUNCATE ON public\.rr_dispatch_candidates FROM authenticated/
    );
    assert.match(MIGRATION, /CREATE TRIGGER rr_dispatch_candidates_append_only/);
    assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON public\.rr_dispatch_candidates/);
  });

  it("is protected from the sql/049 generic grant", () => {
    // Without this, re-running 049 would silently re-widen the append-only table, which
    // is exactly the defect Phase 0 runtime validation caught.
    //
    // Asserted as membership rather than as an exact branch literal: later phases add
    // their own tables to these lists, and a test that pins the literal fails on a
    // correct change while proving nothing extra.
    const appendOnlyBranch = HARDENING.slice(
      HARDENING.indexOf("IF tbl IN ("),
      HARDENING.indexOf("ELSIF tbl IN (")
    );
    assert.match(appendOnlyBranch, /'rr_service_state_events'/);
    assert.match(appendOnlyBranch, /'rr_dispatch_candidates'/);

    const nonDeletableBranch = HARDENING.slice(
      HARDENING.indexOf("ELSIF tbl IN ('rr_authorisations'")
    );
    assert.ok(
      nonDeletableBranch.length > 0,
      "rr_authorisations no longer has a non-deletable grant branch"
    );
    assert.match(nonDeletableBranch, /GRANT SELECT, INSERT, UPDATE ON public\.%I TO authenticated/);
    assert.match(nonDeletableBranch, /REVOKE DELETE, TRUNCATE ON public\.%I FROM authenticated/);
  });
});

describe("Phase 1 migration — reuse, not duplication", () => {
  it("creates no second employee, vehicle or job table", () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    for (const forbidden of [
      "rr_employees",
      "rr_drivers",
      "rr_vehicles",
      "rr_jobs",
      "rr_documents",
      "rr_assignments",
    ]) {
      assert.ok(!created.includes(forbidden), `sql/071 duplicates an existing entity: ${forbidden}`);
    }
  });

  it("references the existing employees table for certifications", () => {
    assert.match(
      createTableBody("rr_driver_certifications"),
      /REFERENCES public\.employees \(company_id, id\)/
    );
  });

  it("extends field_vehicles 1:1 rather than replacing it", () => {
    const body = createTableBody("rr_tow_truck_profiles");
    assert.match(body, /UNIQUE \(field_vehicle_id\)/);
    assert.match(body, /REFERENCES public\.field_vehicles \(company_id, id\)/);
  });

  it("links the confirmed crew row to the EXISTING field_job_assignments", () => {
    assert.match(
      createTableBody("rr_dispatch_assignments"),
      /field_job_assignment_id uuid REFERENCES public\.field_job_assignments \(id\)/
    );
  });

  it("does not modify field_jobs or its status CHECK", () => {
    assert.ok(!/ALTER TABLE public\.field_jobs/i.test(MIGRATION_SQL));
    assert.ok(!/field_jobs_status_check/i.test(MIGRATION_SQL));
  });

  it("does not modify field_job_events", () => {
    // 'Start Travel' and 'Arrive Site' already exist; Phase 1 needs no new event type.
    assert.ok(!/ALTER TABLE public\.field_job_events/i.test(MIGRATION_SQL));
    assert.ok(!/field_job_events_type_check/i.test(MIGRATION_SQL));
  });

  it("only adds uniqueness constraints to existing tables, never alters columns", () => {
    const alters = [...MIGRATION_SQL.matchAll(/ALTER TABLE public\.(\w+)\s+([\s\S]{0,60})/g)];
    for (const [, table, tail] of alters) {
      if ((PHASE1_TABLES as readonly string[]).includes(table)) continue;
      if (table === "rr_service_jobs") {
        assert.ok(
          /ADD COLUMN IF NOT EXISTS|ADD CONSTRAINT/.test(tail),
          `unexpected ALTER on rr_service_jobs: ${tail}`
        );
        continue;
      }
      assert.match(
        tail,
        /ADD CONSTRAINT \w+ UNIQUE/,
        `sql/071 alters ${table} in an unexpected way: ${tail}`
      );
    }
  });

  it("drops nothing", () => {
    const drops = [...MIGRATION_SQL.matchAll(/DROP\s+(TABLE|COLUMN|CONSTRAINT)\s/gi)];
    assert.deepEqual(drops, []);
  });
});

describe("Phase 1 migration — assignment integrity", () => {
  it("allows only one live offer or acceptance per job", () => {
    assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_dispatch_assignments_one_live/);
    assert.match(MIGRATION, /WHERE assignment_status IN \('offered', 'accepted'\)/);
  });

  it("requires a reason and timestamp on a decline", () => {
    assert.match(createTableBody("rr_dispatch_assignments"), /rr_dispatch_assignments_decline_recorded/);
  });

  it("only lets an accepted assignment carry a confirmed crew row", () => {
    assert.match(createTableBody("rr_dispatch_assignments"), /rr_dispatch_assignments_crew_row_check/);
  });
});

describe("Phase 1 migration — idempotency", () => {
  it("guards every create", () => {
    const creates = [...MIGRATION.matchAll(/^\s*CREATE (TABLE|INDEX|UNIQUE INDEX)([^\n]*)/gim)];
    assert.ok(creates.length > 0);
    for (const [, kind, rest] of creates) {
      assert.match(rest, /IF NOT EXISTS/, `unguarded CREATE ${kind}: ${rest.trim()}`);
    }
  });

  it("guards added constraints and columns", () => {
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS counterparty_id uuid/);
    assert.match(MIGRATION, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = '\w+'\)/);
  });

  it("replaces functions and re-creates the trigger safely", () => {
    assert.match(MIGRATION, /CREATE OR REPLACE FUNCTION public\.rr_dispatch_candidates_forbid_mutation/);
    assert.match(MIGRATION, /DROP TRIGGER IF EXISTS rr_dispatch_candidates_append_only/);
    assert.match(MIGRATION, /DROP POLICY IF EXISTS %I_tenant_isolation/);
  });

  it("is transactional and reloads the API schema", () => {
    assert.match(MIGRATION, /^BEGIN;$/m);
    assert.match(MIGRATION, /^COMMIT;$/m);
    assert.match(MIGRATION, /NOTIFY pgrst, 'reload schema'/);
  });

  it("declares its prerequisites", () => {
    assert.match(MIGRATION, /Prerequisite missing: public\.rr_service_jobs/);
    assert.match(MIGRATION, /Prerequisite missing: public\.field_vehicles/);
  });

  it("has balanced dollar-quoted blocks", () => {
    const tags = [...MIGRATION.matchAll(/\$([a-z_]+)\$/g)].map((match) => match[1]);
    const counts = new Map<string, number>();
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const [tag, count] of counts) {
      assert.equal(count % 2, 0, `unbalanced $${tag}$`);
    }
  });
});

describe("Phase 1 routing registration", () => {
  it("registers /road-recovery as a known protected route", async () => {
    const { PROTECTED_ROUTE_PREFIXES, canAccessRouteForRole } = await import(
      "@/lib/server/auth-routing"
    );
    assert.ok((PROTECTED_ROUTE_PREFIXES as readonly string[]).includes("/road-recovery"));
    assert.equal(canAccessRouteForRole("owner", "/road-recovery/dispatch"), true);
    assert.equal(canAccessRouteForRole("manager", "/road-recovery/dispatch"), true);
  });

  it("gives drivers their own job list but not the dispatch board", async () => {
    const { canAccessRouteForRole } = await import("@/lib/server/auth-routing");
    assert.equal(canAccessRouteForRole("employee", "/road-recovery/driver"), true);
    assert.equal(canAccessRouteForRole("employee", "/road-recovery/dispatch"), false);
    assert.equal(canAccessRouteForRole("employee", "/road-recovery/live"), false);
  });
});

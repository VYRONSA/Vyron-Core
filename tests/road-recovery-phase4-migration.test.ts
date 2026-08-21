/**
 * Phase 4 migration security and schema safety (sql/074, 075, 076, 077).
 *
 * Same discipline as Phases 0-3: every tenant-isolation defect this repository has
 * actually hit was a property of the migration TEXT, so the text is asserted directly.
 * Runtime behaviour is proven separately against real PostgreSQL.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function migration(name: string): string {
  return readFileSync(path.join(REPO_ROOT, "sql", name), "utf8");
}

/** Executable SQL only. The headers document intent at length and must not be matched. */
function executable(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const PROVISIONING = migration("074-road-recovery-provisioning.sql");
const AUTHORITY = migration("075-road-recovery-release-authority.sql");
const CUSTODY = migration("076-road-recovery-custody.sql");
const STORAGE = migration("077-road-recovery-storage.sql");
const HARDENING = migration("049-release-candidate-security-hardening.sql");

const ALL = [PROVISIONING, AUTHORITY, CUSTODY, STORAGE];
const ALL_SQL = ALL.map(executable).join("\n");

const PHASE4_TABLES = [
  "rr_module_provisioning",
  "rr_release_authorisations",
  "rr_custody_yards",
  "rr_custody_events",
  "rr_custody_holdings",
  "rr_custody_items",
  "rr_storage_bookings",
  "rr_storage_accrual",
] as const;

/** Tables earlier phases and the user declared off-limits. */
const PROTECTED_TABLES = [
  "field_jobs",
  "field_job_events",
  "field_job_assignments",
  "rr_service_jobs",
  "rr_service_state_events",
  "rr_standby_summary",
  "rr_dispatch_candidates",
  "rr_authorisations",
  "rr_evidence_requirements",
  "rr_compliance_evaluations",
  "rr_requirement_waivers",
  "mobile_workforce_evidence",
] as const;

function createTableBody(table: string): string {
  const source = ALL.find((entry) =>
    entry.includes(`CREATE TABLE IF NOT EXISTS public.${table} (`)
  );
  assert.ok(source, `no Phase 4 migration creates public.${table}`);
  const marker = `CREATE TABLE IF NOT EXISTS public.${table} (`;
  const start = source.indexOf(marker);
  let depth = 0;
  let index = start + marker.length - 1;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start + marker.length, index);
}

// ---------------------------------------------------------------------------
// Tenant boundary
// ---------------------------------------------------------------------------

describe("Phase 4 migrations — tenant boundary", () => {
  it("creates exactly the eight Phase 4 tables", () => {
    const created = ALL.flatMap((source) =>
      [...source.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((match) => match[1])
    );
    assert.deepEqual([...created].sort(), [...PHASE4_TABLES].sort());
  });

  it("gives every table a NOT NULL company_id referencing companies", () => {
    for (const table of PHASE4_TABLES) {
      assert.match(
        createTableBody(table),
        /company_id uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/,
        `${table} does not carry a mandatory company_id`
      );
    }
  });

  it("enables row level security on every table", () => {
    for (const table of PHASE4_TABLES) {
      assert.ok(
        ALL_SQL.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} does not enable RLS`
      );
    }
  });

  it("writes every policy against the sql/030 helpers, never USING (true)", () => {
    assert.equal(/USING\s*\(\s*true\s*\)/i.test(ALL_SQL), false);
    assert.equal(/WITH CHECK\s*\(\s*true\s*\)/i.test(ALL_SQL), false);

    for (const table of PHASE4_TABLES) {
      const named = new RegExp(`CREATE POLICY ${table}_tenant_isolation`).test(ALL_SQL);
      const looped = /CREATE POLICY %I_tenant_isolation/.test(ALL_SQL);
      assert.ok(named || looped, `${table} has no tenant isolation policy`);
    }

    const helperUses = [...ALL_SQL.matchAll(/vyron_user_company_ids\(\)/g)].length;
    assert.ok(helperUses >= 4, "policies are not written against the sql/030 helpers");
    assert.match(ALL_SQL, /vyron_is_platform_operator\(\)/);
  });

  it("revokes everything from anon on every table", () => {
    for (const table of PHASE4_TABLES) {
      assert.ok(
        ALL_SQL.includes(`REVOKE ALL ON public.${table} FROM anon`),
        `${table} does not revoke anon`
      );
    }
  });

  it("grants nothing to anon anywhere", () => {
    assert.equal(/GRANT[^;]*TO anon/i.test(ALL_SQL), false);
  });

  it("defends cross-tenant references with composite foreign keys", () => {
    for (const table of PHASE4_TABLES) {
      const body = createTableBody(table);
      const foreignKeys = [...body.matchAll(/FOREIGN KEY \(([^)]*)\)/g)].map((match) =>
        match[1].replace(/\s+/g, " ").trim()
      );
      for (const columns of foreignKeys) {
        assert.ok(
          columns.startsWith("company_id,"),
          `${table} has a foreign key on (${columns}) that does not lead with company_id`
        );
      }
    }
  });

  it("gives every table a (company_id, id) unique key", () => {
    for (const table of PHASE4_TABLES) {
      assert.match(
        createTableBody(table),
        /UNIQUE \(company_id, id\)/,
        `${table} cannot be the target of a composite foreign key`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Legal records
// ---------------------------------------------------------------------------

describe("Phase 4 migrations — legal records are protected", () => {
  it("uses ON DELETE RESTRICT against the service job for every legal record", () => {
    for (const table of [
      "rr_release_authorisations",
      "rr_custody_events",
      "rr_custody_holdings",
      "rr_custody_items",
      "rr_storage_bookings",
      "rr_storage_accrual",
    ]) {
      const body = createTableBody(table);
      const jobFk = body.match(
        /FOREIGN KEY \(company_id, service_job_id\)[\s\S]*?ON DELETE (\w+)/
      );
      assert.ok(jobFk, `${table} has no composite foreign key to the service job`);
      assert.equal(
        jobFk[1],
        "RESTRICT",
        `${table} lets a job be deleted out from under a legal record`
      );
    }
  });

  it("enforces append-only at BOTH layers on the custody chain and the sealed accrual", () => {
    for (const table of ["rr_custody_events", "rr_storage_accrual", "rr_module_provisioning"]) {
      assert.ok(
        ALL_SQL.includes(`GRANT SELECT, INSERT ON public.${table} TO authenticated`),
        `${table} does not take least-privilege grants`
      );
      assert.ok(
        ALL_SQL.includes(`REVOKE UPDATE, DELETE, TRUNCATE ON public.${table} FROM authenticated`),
        `${table} does not revoke mutation`
      );
      assert.match(
        ALL_SQL,
        new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}`),
        `${table} has no append-only trigger, so service_role could still rewrite history`
      );
    }
  });

  it("keeps the custody holdings projection read-only for a tenant", () => {
    assert.ok(ALL_SQL.includes("GRANT SELECT ON public.rr_custody_holdings TO authenticated"));
    assert.ok(
      ALL_SQL.includes(
        "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rr_custody_holdings FROM authenticated"
      )
    );
  });

  it("never grants DELETE on an authority — it is voided, not destroyed", () => {
    assert.ok(
      ALL_SQL.includes("GRANT SELECT, INSERT, UPDATE ON public.rr_release_authorisations TO authenticated")
    );
    assert.ok(
      ALL_SQL.includes("REVOKE DELETE, TRUNCATE ON public.rr_release_authorisations FROM authenticated")
    );
  });

  it("requires a release to name the collector and a disposal to carry a served notice", () => {
    const body = createTableBody("rr_release_authorisations");
    assert.match(body, /authority_type <> 'release'[\s\S]*?collector_name IS NOT NULL/);
    assert.match(body, /authority_type <> 'disposal'[\s\S]*?disposal_notice_reference IS NOT NULL/);
  });

  it("keeps release and disposal authority separate on a single row", () => {
    const body = createTableBody("rr_release_authorisations");
    assert.match(body, /rr_release_authorisations_no_cross_authority/);
    assert.match(body, /authority_type IN \('release', 'disposal'\)/);
  });

  it("requires verification to be a pair of facts or neither", () => {
    const body = createTableBody("rr_release_authorisations");
    assert.match(body, /verified_at IS NULL AND verified_by IS NULL/);
  });

  it("requires a custody release to name who received the vehicle", () => {
    const body = createTableBody("rr_custody_events");
    assert.match(body, /event_type <> 'released'[\s\S]*?receiving_party_name IS NOT NULL/);
  });

  it("never charges more storage days than elapsed", () => {
    assert.match(executable(STORAGE), /chargeable_days <= elapsed_days/);
  });
});

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

describe("Phase 4 — provisioning is additive, ordered and fail-closed", () => {
  const sql = executable(PROVISIONING);

  it("runs all FOUR baseline components, in dependency order", () => {
    const order = [
      "rr_seed_service_catalogue",
      "rr_seed_bystand_reasons",
      "rr_publish_bystand_workflow_v2",
      "rr_seed_requirement_policies",
    ];
    const body = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.rr_provision_company"),
      sql.indexOf("COMMENT ON FUNCTION public.rr_provision_company")
    );
    let cursor = -1;
    for (const fn of order) {
      const at = body.indexOf(`PERFORM public.${fn}(`);
      assert.ok(at >= 0, `rr_provision_company does not call ${fn}`);
      assert.ok(at > cursor, `${fn} runs out of dependency order`);
      cursor = at;
    }
  });

  it("checks module entitlement inside the function, not only in the caller", () => {
    assert.match(sql, /road_recovery[\s\S]*?does not hold the road_recovery module/);
  });

  it("verifies every component the user named", () => {
    for (const component of [
      "service_catalogue",
      "workflow_definitions",
      "workflow_active_version",
      "bystand_workflow_v2",
      "bystand_reason_codes",
      "requirement_policies",
      "requirement_policy_versions",
      "no_duplicates",
      "tenant_consistency",
    ]) {
      assert.ok(sql.includes(`'${component}'`), `the verifier does not report ${component}`);
    }
  });

  it("restricts both functions to service_role", () => {
    for (const fn of ["rr_provision_company", "rr_provisioning_status"]) {
      assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn}(uuid) FROM authenticated`));
      assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(uuid) TO service_role`));
    }
  });

  it("deletes nothing, anywhere", () => {
    assert.equal(/DELETE FROM/i.test(sql), false);
    assert.equal(/TRUNCATE TABLE/i.test(sql), false);
    assert.equal(/DROP TABLE/i.test(sql), false);
  });

  it("never re-activates or renames what a customer changed", () => {
    // The only UPDATE in the provisioning path belongs to the seeds themselves; this file
    // issues none of its own against tenant reference data.
    const updates = [...sql.matchAll(/UPDATE public\.(\w+)/g)].map((match) => match[1]);
    for (const table of updates) {
      assert.ok(
        table === "rr_module_provisioning" || PHASE4_TABLES.includes(table as never),
        `sql/074 updates tenant data in public.${table}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Protected tables
// ---------------------------------------------------------------------------

describe("Phase 4 migrations — earlier phases are left alone", () => {
  it("alters no existing table", () => {
    const altered = new Set(
      [...ALL_SQL.matchAll(/ALTER TABLE (?:IF EXISTS )?public\.(\w+)/g)].map((match) => match[1])
    );
    for (const table of altered) {
      assert.ok(
        (PHASE4_TABLES as readonly string[]).includes(table),
        `Phase 4 alters public.${table}, which is outside its scope`
      );
    }
  });

  it("writes to no protected table", () => {
    for (const table of PROTECTED_TABLES) {
      assert.equal(
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) public\\.${table}\\b`).test(ALL_SQL),
        false,
        `Phase 4 writes to protected table public.${table}`
      );
    }
  });

  it("drops nothing but its own policies and triggers", () => {
    const drops = [...ALL_SQL.matchAll(/DROP (\w+)/g)].map((match) => match[1].toUpperCase());
    for (const kind of drops) {
      assert.ok(["POLICY", "TRIGGER"].includes(kind), `Phase 4 issues DROP ${kind}`);
    }
  });

  it("never touches the field_jobs status CHECK", () => {
    assert.equal(/field_jobs_status_check/.test(ALL_SQL), false);
  });

  it("does not modify mobile_workforce_evidence, only references it", () => {
    assert.equal(/ALTER TABLE (?:IF EXISTS )?public\.mobile_workforce_evidence/.test(ALL_SQL), false);
    assert.match(ALL_SQL, /REFERENCES public\.mobile_workforce_evidence \(id\)/);
  });
});

// ---------------------------------------------------------------------------
// sql/049 agreement
// ---------------------------------------------------------------------------

describe("Phase 4 — sql/049 agrees with the new tables", () => {
  it("lists the append-only Phase 4 tables in the least-privilege branch", () => {
    const branch = HARDENING.slice(
      HARDENING.indexOf("IF tbl IN ("),
      HARDENING.indexOf("ELSIF tbl IN (")
    );
    for (const table of ["rr_custody_events", "rr_storage_accrual", "rr_module_provisioning"]) {
      assert.ok(branch.includes(table), `${table} is missing from the append-only branch`);
    }
  });

  it("lists the non-deletable Phase 4 tables in their own branch", () => {
    assert.match(HARDENING, /ELSIF tbl IN \('rr_authorisations'[^)]*'rr_release_authorisations'/);
    assert.match(HARDENING, /'rr_storage_bookings'/);
  });

  it("gives the custody holdings projection a read-only branch", () => {
    assert.match(HARDENING, /ELSIF tbl IN \('rr_custody_holdings'\) THEN/);
    const branch = HARDENING.slice(HARDENING.indexOf("ELSIF tbl IN ('rr_custody_holdings')"));
    assert.match(branch, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.%I FROM authenticated/);
    assert.match(branch, /GRANT SELECT ON public\.%I TO authenticated/);
  });

  it("still applies RLS, tenant isolation and anon revocation to those tables", () => {
    for (const table of PHASE4_TABLES) {
      assert.equal(
        new RegExp(`table_name NOT IN \\([^)]*${table}`).test(HARDENING),
        false,
        `${table} was excluded from the sql/049 loop`
      );
    }
  });
});

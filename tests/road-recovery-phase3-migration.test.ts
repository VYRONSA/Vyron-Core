/**
 * Phase 3 migration security, schema safety and seed parity (sql/073).
 *
 * Same discipline as the Phase 0 and Phase 1 suites: every tenant-isolation defect this
 * repository has actually hit was a property of the migration TEXT, so the migration text
 * is asserted directly. Runtime behaviour is proven separately against real PostgreSQL.
 *
 * It also proves two things Phase 3 specifically depends on:
 *   - the seeded defaults in sql/073 still match lib/road-recovery/requirement-catalogue.ts
 *   - sql/073 does not touch any table an earlier phase declared off-limits
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { policySeedRows } from "@/lib/road-recovery/requirement-catalogue";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION = readFileSync(
  path.join(REPO_ROOT, "sql", "073-road-recovery-requirements.sql"),
  "utf8"
);
const HARDENING = readFileSync(
  path.join(REPO_ROOT, "sql", "049-release-candidate-security-hardening.sql"),
  "utf8"
);

/** Executable SQL only. The header documents intent at length and must not be matched. */
const MIGRATION_SQL = MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const PHASE3_TABLES = [
  "rr_requirement_policies",
  "rr_requirement_items",
  "rr_evidence_requirements",
  "rr_evidence_links",
  "rr_requirement_waivers",
  "rr_compliance_evaluations",
  "rr_job_exceptions",
] as const;

/** Tables earlier phases and the user declared off-limits. */
const PROTECTED_TABLES = [
  "field_jobs",
  "field_job_events",
  "field_job_assignments",
  "rr_service_state_events",
  "rr_standby_summary",
  "rr_dispatch_candidates",
  "rr_authorisations",
  "employee_documents",
  "hearing_evidence",
  "mobile_workforce_evidence",
] as const;

function createTableBody(table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS public.${table} (`;
  const start = MIGRATION.indexOf(marker);
  assert.ok(start >= 0, `sql/073 does not create public.${table}`);
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

// ---------------------------------------------------------------------------
// Tenant boundary
// ---------------------------------------------------------------------------

describe("Phase 3 migration — tenant boundary", () => {
  it("creates exactly the seven Phase 3 tables", () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual([...created].sort(), [...PHASE3_TABLES].sort());
  });

  it("gives every table a NOT NULL company_id referencing companies", () => {
    for (const table of PHASE3_TABLES) {
      const body = createTableBody(table);
      assert.match(
        body,
        /company_id uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/,
        `${table} does not carry a mandatory company_id`
      );
    }
  });

  it("enables row level security on every table", () => {
    for (const table of PHASE3_TABLES) {
      assert.ok(
        MIGRATION_SQL.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} does not enable RLS`
      );
    }
  });

  it("writes every policy against the sql/030 tenant helpers, never USING (true)", () => {
    assert.equal(/USING\s*\(\s*true\s*\)/i.test(MIGRATION_SQL), false);
    assert.equal(/WITH CHECK\s*\(\s*true\s*\)/i.test(MIGRATION_SQL), false);

    // The policy is created by a generated loop, exactly as sql/049 does it, so the
    // assertion is that the loop covers every table and that the policy body is written
    // against the sql/030 helpers.
    assert.match(
      MIGRATION_SQL,
      /CREATE POLICY %I_tenant_isolation ON public\.%I FOR ALL TO authenticated USING \([\s\S]*?vyron_is_platform_operator\(\)[\s\S]*?vyron_user_company_ids\(\)[\s\S]*?WITH CHECK \([\s\S]*?vyron_user_company_ids\(\)/
    );

    const loop = MIGRATION_SQL.slice(
      MIGRATION_SQL.indexOf("SELECT unnest(ARRAY["),
      MIGRATION_SQL.indexOf("CREATE POLICY %I_tenant_isolation")
    );
    for (const table of PHASE3_TABLES) {
      assert.ok(loop.includes(`'${table}'`), `${table} is not covered by the policy loop`);
    }
  });

  it("revokes everything from anon on every table", () => {
    for (const table of PHASE3_TABLES) {
      assert.ok(
        MIGRATION_SQL.includes(`REVOKE ALL ON public.${table} FROM anon`),
        `${table} does not revoke anon`
      );
    }
  });

  it("grants nothing to anon anywhere", () => {
    assert.equal(/GRANT[^;]*TO anon/i.test(MIGRATION_SQL), false);
  });

  it("defends cross-tenant references with composite foreign keys, not bare id keys", () => {
    // A bare `REFERENCES rr_service_jobs (id)` would let one tenant's row point at
    // another tenant's job if RLS were ever bypassed. Every cross-table reference is
    // (company_id, x_id) -> (company_id, id).
    for (const table of PHASE3_TABLES) {
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

  it("gives every table a (company_id, id) unique key so it can be referenced compositely", () => {
    for (const table of PHASE3_TABLES) {
      const body = createTableBody(table);
      assert.match(
        body,
        /UNIQUE \(company_id, id\)/,
        `${table} cannot be the target of a composite foreign key`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("Phase 3 migration — immutability where it matters", () => {
  it("refuses UPDATE on the per-job requirement snapshot", () => {
    assert.ok(
      MIGRATION_SQL.includes("REVOKE UPDATE ON public.rr_evidence_requirements FROM authenticated")
    );
    assert.match(
      MIGRATION_SQL,
      /CREATE TRIGGER rr_evidence_requirements_immutable[\s\S]*?BEFORE UPDATE ON public\.rr_evidence_requirements/
    );
  });

  it("enforces append-only on waivers and compliance evaluations at BOTH layers", () => {
    for (const table of ["rr_requirement_waivers", "rr_compliance_evaluations"]) {
      assert.ok(
        MIGRATION_SQL.includes(`GRANT SELECT, INSERT ON public.${table} TO authenticated`),
        `${table} does not take least-privilege grants`
      );
      assert.ok(
        MIGRATION_SQL.includes(
          `REVOKE UPDATE, DELETE, TRUNCATE ON public.${table} FROM authenticated`
        ),
        `${table} does not revoke mutation`
      );
      assert.match(
        MIGRATION_SQL,
        new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}`),
        `${table} has no append-only trigger, so service_role could still rewrite history`
      );
    }
  });

  it("keeps a sealed verdict internally consistent", () => {
    // evidence_complete must always mean "nothing is blocking". A row asserting otherwise
    // would misreport why a job was allowed to bill.
    assert.match(
      MIGRATION_SQL,
      /evidence_complete\s*=\s*\(cardinality\(blocking_codes\)\s*=\s*0\)/
    );
  });
});

// ---------------------------------------------------------------------------
// Protected tables
// ---------------------------------------------------------------------------

describe("Phase 3 migration — leaves protected tables alone", () => {
  it("alters no table other than rr_service_jobs", () => {
    const altered = new Set(
      [...MIGRATION_SQL.matchAll(/ALTER TABLE (?:IF EXISTS )?public\.(\w+)/g)].map(
        (match) => match[1]
      )
    );
    for (const table of altered) {
      assert.ok(
        table === "rr_service_jobs" || (PHASE3_TABLES as readonly string[]).includes(table),
        `sql/073 alters public.${table}, which is outside Phase 3's scope`
      );
    }
  });

  it("does not modify mobile_workforce_evidence, which Phase 2 finished with", () => {
    assert.equal(/ALTER TABLE (?:IF EXISTS )?public\.mobile_workforce_evidence/.test(MIGRATION_SQL), false);
    assert.equal(/DROP .*mobile_workforce_evidence/i.test(MIGRATION_SQL), false);
  });

  it("drops nothing and truncates nothing", () => {
    assert.equal(/DROP TABLE/i.test(MIGRATION_SQL), false);
    assert.equal(/TRUNCATE TABLE/i.test(MIGRATION_SQL), false);
    // DROP POLICY / DROP TRIGGER IF EXISTS are re-runnability, not destruction.
    const drops = [...MIGRATION_SQL.matchAll(/DROP (\w+)/g)].map((match) => match[1].toUpperCase());
    for (const kind of drops) {
      assert.ok(["POLICY", "TRIGGER"].includes(kind), `sql/073 issues DROP ${kind}`);
    }
  });

  it("writes to no protected table", () => {
    for (const table of PROTECTED_TABLES) {
      if (table === "rr_authorisations") continue; // read by the engine, never written here
      assert.equal(
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) public\\.${table}\\b`).test(MIGRATION_SQL),
        false,
        `sql/073 writes to protected table public.${table}`
      );
    }
  });

  it("only ADDs columns to rr_service_jobs — never drops or retypes one", () => {
    const statements = [...MIGRATION_SQL.matchAll(/ALTER TABLE public\.rr_service_jobs([\s\S]*?);/g)];
    assert.ok(statements.length > 0);
    for (const [statement] of statements) {
      assert.ok(
        /ADD COLUMN IF NOT EXISTS|ADD CONSTRAINT/.test(statement),
        `non-additive change to rr_service_jobs: ${statement.trim().slice(0, 120)}`
      );
      assert.equal(/DROP COLUMN|ALTER COLUMN|SET DATA TYPE/.test(statement), false);
    }
  });

  it("never widens the field_jobs status CHECK", () => {
    assert.equal(/field_jobs_status_check/.test(MIGRATION_SQL), false);
  });
});

// ---------------------------------------------------------------------------
// sql/049 agreement
// ---------------------------------------------------------------------------

describe("Phase 3 — sql/049 agrees with sql/073", () => {
  it("lists the append-only Phase 3 tables in the least-privilege branch", () => {
    const branch = HARDENING.slice(
      HARDENING.indexOf("IF tbl IN ("),
      HARDENING.indexOf("ELSIF tbl IN ('rr_authorisations')")
    );
    assert.match(branch, /rr_compliance_evaluations/);
    assert.match(branch, /rr_requirement_waivers/);
    assert.match(branch, /GRANT SELECT, INSERT ON public\.%I TO authenticated/);
  });

  it("gives the requirement snapshot its own SELECT/INSERT/DELETE branch", () => {
    // Asserted as MEMBERSHIP, not as an exact branch literal: later phases add their own
    // immutable-but-deletable snapshots to this same branch, and pinning the literal
    // fails on a correct change while proving nothing extra.
    const branch = HARDENING.slice(HARDENING.indexOf("ELSIF tbl IN ('rr_evidence_requirements'"));
    assert.ok(branch.length > 0, "rr_evidence_requirements lost its own grant branch");
    assert.match(branch, /'rr_evidence_requirements'/);
    assert.match(branch, /REVOKE UPDATE, TRUNCATE ON public\.%I FROM authenticated/);
    assert.match(branch, /GRANT SELECT, INSERT, DELETE ON public\.%I TO authenticated/);
  });

  it("still applies RLS, tenant isolation and anon revocation to those tables", () => {
    // They stay in the loop deliberately: only the GRANT is special-cased.
    assert.equal(/table_name NOT IN \([^)]*rr_compliance_evaluations/.test(HARDENING), false);
    assert.equal(/table_name NOT IN \([^)]*rr_evidence_requirements/.test(HARDENING), false);
  });

  it("re-running sql/049 cannot re-widen a Phase 3 append-only table", () => {
    // The REVOKE is unconditional inside the branch, so it repairs a previously widened
    // project rather than only avoiding a new one.
    const branchStart = HARDENING.indexOf("IF tbl IN (");
    const branch = HARDENING.slice(branchStart, HARDENING.indexOf("ELSE"));
    assert.match(branch, /REVOKE UPDATE, DELETE, TRUNCATE/);
  });
});

// ---------------------------------------------------------------------------
// Seed parity
// ---------------------------------------------------------------------------

function generatedBlock(label: string): string {
  const start = `-- >>> GENERATED: ${label} (see header) >>>`;
  const end = `-- <<< GENERATED: ${label} <<<`;
  const a = MIGRATION.indexOf(start);
  const b = MIGRATION.indexOf(end);
  assert.ok(a >= 0, `sql/073 is missing the "${label}" block start marker`);
  assert.ok(b > a, `sql/073 is missing the "${label}" block end marker`);
  return MIGRATION.slice(a + start.length, b);
}

/** Parses the seeded VALUES rows: ('key', 'service', 1, $rr_req$[...]$rr_req$::jsonb) */
function parsePolicySeeds(): Map<
  string,
  { serviceCode: string | null; version: number; requirements: Record<string, unknown>[] }
> {
  const block = generatedBlock("REQUIREMENT POLICIES");
  const pattern =
    /\('([a-z0-9_]+)',\s*(?:'([a-z_]+)'|NULL),\s*(\d+),\s*\$rr_req\$([\s\S]*?)\$rr_req\$::jsonb\)/g;
  const found = new Map<
    string,
    { serviceCode: string | null; version: number; requirements: Record<string, unknown>[] }
  >();
  for (const match of block.matchAll(pattern)) {
    found.set(match[1], {
      serviceCode: match[2] ?? null,
      version: Number(match[3]),
      requirements: JSON.parse(match[4]),
    });
  }
  return found;
}

describe("Phase 3 — seed parity between sql/073 and the catalogue", () => {
  const parsed = parsePolicySeeds();
  const expected = policySeedRows();

  it("seeds exactly the policies the catalogue declares", () => {
    assert.deepEqual([...parsed.keys()].sort(), expected.map((row) => row.policy_key).sort());
  });

  it("matches every policy, requirement by requirement", () => {
    for (const row of expected) {
      const found = parsed.get(row.policy_key);
      assert.ok(found, `sql/073 does not seed ${row.policy_key}`);
      assert.equal(found.serviceCode, row.service_code, `${row.policy_key} service_code differs`);
      assert.equal(found.version, row.version, `${row.policy_key} version differs`);
      assert.deepEqual(
        found.requirements,
        row.requirements,
        `${row.policy_key} requirements differ between sql/073 and requirement-catalogue.ts`
      );
    }
  });

  it("leaves no unreplaced placeholder in the generated block", () => {
    const block = generatedBlock("REQUIREMENT POLICIES");
    assert.equal(/__[A-Z_]+__|TODO|PLACEHOLDER/.test(block), false);
  });

  it("seeds tenant DEFAULTS: no seeded policy is bound to a counterparty", () => {
    const seedFunction = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.rr_seed_requirement_policies"));
    assert.match(
      seedFunction,
      /\(company_id, policy_key, counterparty_id, service_code, version, active, label, created_by\)[\s\S]*?p_company_id, seed\.policy_key, NULL,/
    );
  });

  it("is idempotent — re-running the seed skips policies that already exist", () => {
    const seedFunction = MIGRATION.slice(
      MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.rr_seed_requirement_policies")
    );
    assert.match(seedFunction, /IF EXISTS \([\s\S]*?rr_requirement_policies[\s\S]*?CONTINUE;/);
  });

  it("restricts the seed function to service_role", () => {
    assert.ok(
      MIGRATION_SQL.includes(
        "REVOKE ALL ON FUNCTION public.rr_seed_requirement_policies(uuid) FROM authenticated"
      )
    );
    assert.ok(
      MIGRATION_SQL.includes(
        "GRANT EXECUTE ON FUNCTION public.rr_seed_requirement_policies(uuid) TO service_role"
      )
    );
  });
});

// ---------------------------------------------------------------------------
// The Phase 3 HTTP surface
// ---------------------------------------------------------------------------
//
// Structural, in the same spirit as tests/api-contract.test.ts: the properties asserted
// are architectural ("every handler passes through the gate", "no handler takes a company
// id it was handed without checking it"), and a structural check catches the regression in
// a NEW endpoint that a request-level test of the existing ones never would.

import { readdirSync, statSync } from "node:fs";
import {
  PROTECTED_ROUTE_PREFIXES,
  canAccessRouteForRole,
} from "@/lib/server/auth-routing";

function collectRouteFiles(relativeDir: string): string[] {
  const absolute = path.join(REPO_ROOT, relativeDir);
  const found: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") found.push(full);
    }
  }
  walk(absolute);
  return found;
}

const RR_ROUTES = collectRouteFiles("app/api/road-recovery");

const PHASE3_ROUTES = [
  "app/api/road-recovery/requirements/policies/route.ts",
  "app/api/road-recovery/jobs/[serviceJobId]/requirements/route.ts",
  "app/api/road-recovery/jobs/[serviceJobId]/compliance/route.ts",
  "app/api/road-recovery/jobs/[serviceJobId]/evidence-links/route.ts",
  "app/api/road-recovery/jobs/[serviceJobId]/waivers/route.ts",
  "app/api/road-recovery/exceptions/route.ts",
  "app/api/road-recovery/exceptions/[exceptionId]/route.ts",
];

describe("Phase 3 — the HTTP surface is gated", () => {
  it("ships every Phase 3 endpoint", () => {
    const relative = RR_ROUTES.map((file) =>
      path.relative(REPO_ROOT, file).split(path.sep).join("/")
    );
    for (const expected of PHASE3_ROUTES) {
      assert.ok(relative.includes(expected), `missing route: ${expected}`);
    }
  });

  it("routes every handler through requireApiContext", () => {
    for (const file of RR_ROUTES) {
      const source = readFileSync(file, "utf8");
      const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
      assert.ok(handlers.length > 0, `${file} exports no handler`);
      const gates = [...source.matchAll(/requireApiContext\(/g)];
      assert.ok(
        gates.length >= handlers.length,
        `${path.basename(path.dirname(file))} has ${handlers.length} handlers but ${gates.length} gate calls`
      );
    }
  });

  it("never reads the tenant id straight from the body without the gate verifying it", () => {
    // requireApiContext(request, body.companyId) is correct: it VERIFIES the supplied id
    // against the caller's own membership. Using body.companyId anywhere else would trust
    // a value the caller controls.
    for (const file of RR_ROUTES) {
      const source = readFileSync(file, "utf8");
      const uses = [...source.matchAll(/body\.companyId/g)].length;
      const gated = [...source.matchAll(/requireApiContext\(request, body\.companyId\)/g)].length;
      assert.equal(
        uses,
        gated,
        `${path.relative(REPO_ROOT, file)} uses body.companyId outside requireApiContext`
      );
    }
  });

  it("passes the VERIFIED company id to the service layer, never the raw one", () => {
    for (const file of RR_ROUTES) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        /companyId:\s*asText\(body\.companyId\)/.test(source),
        false,
        `${path.relative(REPO_ROOT, file)} forwards an unverified companyId`
      );
    }
  });

  it("takes the actor's identity from the session, never from the request", () => {
    for (const file of RR_ROUTES) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        /actorEmail:\s*asText\(body\./.test(source) || /waivedBy:\s*asText\(body\./.test(source),
        false,
        `${path.relative(REPO_ROOT, file)} accepts an actor identity from the caller`
      );
    }
  });

  it("keeps the new screens behind the protected /road-recovery prefix", () => {
    assert.ok((PROTECTED_ROUTE_PREFIXES as readonly string[]).includes("/road-recovery"));

    for (const route of [
      "/road-recovery/compliance",
      "/road-recovery/exceptions",
      "/road-recovery/requirements",
    ]) {
      assert.equal(canAccessRouteForRole("owner", route), true, `owner cannot reach ${route}`);
      assert.equal(canAccessRouteForRole("manager", route), true, `manager cannot reach ${route}`);
      // A driver gets their own jobs screen, not the controller's compliance workspace.
      assert.equal(canAccessRouteForRole("employee", route), false, `employee reached ${route}`);
    }
    assert.equal(canAccessRouteForRole("employee", "/road-recovery/driver"), true);
  });
});

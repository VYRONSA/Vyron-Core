/**
 * Phase 6 migration security, schema safety and vocabulary parity (sql/081).
 *
 * Same discipline as Phases 0-5: every tenant-isolation defect this repository has
 * actually hit was a property of the migration TEXT, so the text is asserted directly.
 * Runtime behaviour is proven separately against real PostgreSQL.
 *
 * The two assertions that matter most:
 *
 *   1. Phase 6 creates NO second intelligence, action, outcome or root-cause store.
 *      Exactly one new table exists, and it holds targets rather than facts.
 *
 *   2. Every view is security_invoker. Phase 5 shipped a view that leaked across tenants
 *      because a PostgreSQL view runs as its OWNER by default; that is now asserted
 *      statically for every view Road & Recovery has.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { RR_METRIC_KEYS } from "@/lib/road-recovery/intelligence/metric-catalogue";
import { RR_ACTION_TYPES, RR_TRIGGER_LABELS } from "@/lib/road-recovery/intelligence/triggers";
import { WORKFLOW_PIPELINE_STAGES } from "@/lib/workflow-orchestration-engine";

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

const RAW = migration("081-road-recovery-intelligence.sql");
const SQL = executable(RAW);
const HARDENING = migration("049-release-candidate-security-hardening.sql");
const HARDENING_SQL = executable(HARDENING);

/**
 * Executable SQL with string literals blanked out.
 *
 * An identifier can never live inside a quoted string, so this is what to scan when the
 * question is "does this migration CREATE a thing called X". Scanning the raw text instead
 * would flag the COMMENT that explicitly disclaims building a ledger.
 */
const IDENTIFIERS = SQL.replace(/'(?:[^']|'')*'/g, "''");

/** Extracts a quoted string list from a CHECK constraint body. */
function checkList(source: string, anchor: string): string[] {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `could not find ${anchor}`);
  const open = source.indexOf("(", start + anchor.length);
  let depth = 0;
  let end = open;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  return [...source.slice(open, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

// ---------------------------------------------------------------------------
describe("Phase 6 migration — no second system", () => {
  it("creates exactly one new table", () => {
    const tables = [...SQL.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? public\.(\w+)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(tables, ["rr_intelligence_thresholds"]);
  });

  it("creates no duplicate fact table", () => {
    for (const forbidden of [
      "rr_intelligence_metrics",
      "rr_intelligence_facts",
      "rr_job_metrics",
      "rr_metric_snapshots",
      "rr_health_scores",
      "rr_kpi_results",
    ]) {
      assert.equal(
        SQL.includes(forbidden),
        false,
        `${forbidden} would be a second copy of facts Phases 0-5 already record`
      );
    }
  });

  it("creates no second action, outcome or root-cause system", () => {
    for (const forbidden of [
      "rr_actions",
      "rr_action_",
      "rr_recommendations",
      "rr_outcomes",
      "rr_outcome_",
      "rr_root_cause",
      "rr_approvals",
      "rr_automation",
    ]) {
      assert.equal(SQL.includes(forbidden), false, `${forbidden} duplicates an existing system`);
    }
  });

  it("creates no finance object", () => {
    // VYRON CORE prepares operational and billing INFORMATION. VYRON FINANCE owns money.
    // Scanned against IDENTIFIERS rather than the raw text, so the COMMENT that disclaims
    // being a ledger does not itself read as building one.
    for (const forbidden of [
      "invoice",
      "payment",
      "credit_note",
      "debtor",
      "ledger",
      "journal",
      "xero",
      "tax_invoice",
      "statement_run",
    ]) {
      assert.equal(
        IDENTIFIERS.toLowerCase().includes(forbidden),
        false,
        `sql/081 declares "${forbidden}", which belongs to VYRON FINANCE`
      );
    }
  });

  it("declares no finance relation of any kind", () => {
    const created = [
      ...IDENTIFIERS.matchAll(
        /CREATE (?:TABLE|VIEW|OR REPLACE VIEW|MATERIALIZED VIEW)(?: IF NOT EXISTS)? public\.(\w+)/g
      ),
    ].map((match) => match[1].toLowerCase());
    for (const relation of created) {
      assert.equal(
        /invoice|payment|debtor|ledger|credit|journal|tax/.test(relation),
        false,
        `${relation} is a finance relation`
      );
    }
  });

  it("does not modify a protected table", () => {
    for (const table of [
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
    ]) {
      assert.equal(
        new RegExp(`ALTER TABLE (?:IF EXISTS )?public\\.${table}\\b`).test(SQL),
        false,
        `sql/081 alters protected table ${table}`
      );
      assert.equal(
        new RegExp(`DROP TABLE[^;]*${table}\\b`).test(SQL),
        false,
        `sql/081 drops protected table ${table}`
      );
    }
  });

  it("never drops or truncates anything", () => {
    assert.equal(/DROP TABLE/i.test(SQL), false);
    assert.equal(/TRUNCATE (?!.*FROM)/i.test(SQL.replace(/REVOKE[^;]+;/g, "")), false);
    assert.equal(/DROP COLUMN/i.test(SQL), false);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — metric vocabulary parity", () => {
  it("matches the TypeScript catalogue exactly", () => {
    const inSql = checkList(SQL, "metric_key IN");
    assert.deepEqual(
      [...inSql].sort(),
      [...RR_METRIC_KEYS].sort(),
      "the database metric vocabulary and the engine catalogue have drifted apart"
    );
  });

  it("lists no metric twice", () => {
    const inSql = checkList(SQL, "metric_key IN");
    assert.equal(new Set(inSql).size, inSql.length);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — shared vocabulary extensions", () => {
  it("adds every Road & Recovery action type to the shared CHECK", () => {
    const inSql = checkList(SQL, "action_type IN");
    for (const actionType of RR_ACTION_TYPES) {
      assert.ok(
        inSql.includes(actionType),
        `"${actionType}" is missing from the action_type CHECK, so preparing that action would fail`
      );
    }
  });

  it("preserves every existing workforce action type", () => {
    const inSql = checkList(SQL, "action_type IN");
    for (const existing of [
      "Create Warning",
      "Create HR Case",
      "Approve Leave",
      "Reject Leave",
      "Assign Employee",
      "Move Employee",
      "Create Roster Change",
      "Create Field Job",
      "Escalate Exception",
      "Mark Payroll Item For Review",
    ]) {
      assert.ok(inSql.includes(existing), `${existing} was dropped from the action_type CHECK`);
    }
  });

  it("adds every Road & Recovery trigger to the shared CHECK", () => {
    const inSql = checkList(SQL, "trigger_type IS NULL OR trigger_type IN");
    for (const trigger of RR_TRIGGER_LABELS) {
      assert.ok(
        inSql.includes(trigger),
        `"${trigger}" is missing from the trigger_type CHECK, so the action would be rejected`
      );
    }
  });

  it("preserves every existing workforce trigger", () => {
    const inSql = checkList(SQL, "trigger_type IS NULL OR trigger_type IN");
    for (const existing of [
      "Late Arrival",
      "Absence Alert",
      "Overtime Spike",
      "Leave Conflict",
      "Compliance Failure",
      "Payroll Blocked",
      "Workforce Intelligence Alert",
    ]) {
      assert.ok(inSql.includes(existing), `${existing} was dropped from the trigger_type CHECK`);
    }
  });

  it("accepts every pipeline stage the orchestration engine can emit", () => {
    // orchestrateWorkflow() returns "Triggered" for a freshly prepared action, and the
    // sql/048 CHECK omitted it. Preparing a DRAFT action would have violated the
    // constraint; sql/081 closes that gap.
    const inSql = checkList(SQL, "pipeline_stage IS NULL OR pipeline_stage IN");
    for (const stage of WORKFLOW_PIPELINE_STAGES) {
      assert.ok(inSql.includes(stage), `pipeline stage "${stage}" would be rejected by the CHECK`);
    }
    assert.ok(inSql.includes("Detected"), "the pre-existing Detected stage was dropped");
  });

  it("guards the vocabulary extension when the table is absent", () => {
    assert.match(SQL, /to_regclass\('public\.workforce_automation_actions'\) IS NULL/);
  });

  it("guards each vocabulary on the presence of its own column", () => {
    // trigger_type and pipeline_stage arrived in sql/048. A project on sql/022 alone has
    // the table without them, and constraining a column that does not exist is an error.
    for (const column of ["trigger_type", "pipeline_stage"]) {
      assert.match(
        SQL,
        new RegExp(`column_name = '${column}'`),
        `the ${column} vocabulary is not guarded by that column existing`
      );
    }
  });

  it("drops BOTH historical action_type constraints", () => {
    // sql/022 named its constraint *_type_check; sql/048 added *_action_type_check without
    // dropping it. Both were enforced, so extending only the newer name left the older one
    // silently rejecting every new action type. Runtime validation caught this.
    assert.match(SQL, /DROP CONSTRAINT workforce_automation_actions_type_check/);
    assert.match(SQL, /DROP CONSTRAINT workforce_automation_actions_action_type_check/);
  });

  it("leaves exactly one action_type constraint behind", () => {
    const added = [...SQL.matchAll(/ADD CONSTRAINT workforce_automation_actions_(\w*action_type\w*)/g)];
    assert.equal(added.length, 1, "more than one action_type constraint is created");
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — view security", () => {
  const views = ["rr_job_timing", "rr_dispatch_performance", "rr_storage_position", "rr_job_margin"];

  it("creates every view WITH (security_invoker = true)", () => {
    for (const view of views) {
      assert.match(
        SQL,
        new RegExp(`CREATE OR REPLACE VIEW public\\.${view}\\s+WITH \\(security_invoker = true\\)`),
        `${view} is not security_invoker and will leak across tenants`
      );
    }
  });

  it("creates no view without the option", () => {
    const declared = [...SQL.matchAll(/CREATE OR REPLACE VIEW public\.(\w+)\s+WITH \(([^)]*)\)/g)];
    const all = [...SQL.matchAll(/CREATE (?:OR REPLACE )?VIEW public\.(\w+)/g)];
    assert.equal(
      declared.length,
      all.length,
      "a view is created without an explicit WITH clause, so it will run as its owner"
    );
    for (const match of declared) {
      assert.match(match[2], /security_invoker = true/);
    }
  });

  it("revokes anon on every view and on the new table", () => {
    for (const relation of [...views.filter((view) => view !== "rr_job_margin"), "rr_intelligence_thresholds"]) {
      assert.ok(
        SQL.includes(`REVOKE ALL ON public.${relation} FROM anon`),
        `anon is not revoked on ${relation}`
      );
    }
  });

  it("grants only SELECT on the views", () => {
    for (const view of views.filter((entry) => entry !== "rr_job_margin")) {
      assert.ok(SQL.includes(`GRANT SELECT ON public.${view} TO authenticated`));
      assert.equal(
        new RegExp(`GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\\.${view}`).test(SQL),
        false,
        `${view} is writable, but it is a read-only projection`
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — tenant isolation", () => {
  it("declares company_id NOT NULL with a companies foreign key", () => {
    assert.match(
      SQL,
      /company_id uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/
    );
  });

  it("uses a composite foreign key for the counterparty reference", () => {
    // (company_id, counterparty_id) rather than counterparty_id alone: a counterparty from
    // another tenant cannot be referenced even if a policy were somehow bypassed.
    assert.match(
      SQL,
      /FOREIGN KEY \(company_id, counterparty_id\)\s*\n\s*REFERENCES public\.rr_counterparties \(company_id, id\)/
    );
  });

  it("enables row level security", () => {
    assert.ok(SQL.includes("ALTER TABLE public.rr_intelligence_thresholds ENABLE ROW LEVEL SECURITY"));
  });

  it("creates a tenant isolation policy with both USING and WITH CHECK", () => {
    assert.match(SQL, /CREATE POLICY rr_intelligence_thresholds_tenant_isolation/);
    assert.match(SQL, /USING \(\s*public\.vyron_is_platform_operator\(\)/);
    assert.match(SQL, /WITH CHECK \(\s*public\.vyron_is_platform_operator\(\)/);
  });

  it("never writes USING (true)", () => {
    assert.equal(/USING\s*\(\s*true\s*\)/i.test(SQL), false);
    assert.equal(/WITH CHECK\s*\(\s*true\s*\)/i.test(SQL), false);
  });

  it("uses the sql/030 tenant helpers", () => {
    assert.ok(SQL.includes("public.vyron_user_company_ids()"));
    assert.ok(SQL.includes("public.vyron_is_platform_operator()"));
    assert.match(SQL, /to_regprocedure\('public\.vyron_user_company_ids\(\)'\) IS NULL/);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — threshold immutability", () => {
  it("grants SELECT, INSERT and UPDATE but never DELETE", () => {
    assert.ok(
      SQL.includes("GRANT SELECT, INSERT, UPDATE ON public.rr_intelligence_thresholds TO authenticated")
    );
    assert.ok(
      SQL.includes("REVOKE DELETE, TRUNCATE ON public.rr_intelligence_thresholds FROM authenticated")
    );
  });

  it("binds the guard to the TABLE so it also constrains service_role", () => {
    // A grant only constrains a role. A trigger on the table constrains everyone,
    // including the service key that bypasses RLS entirely.
    assert.match(
      SQL,
      /CREATE TRIGGER rr_intelligence_thresholds_guard\s*\n\s*BEFORE UPDATE OR DELETE ON public\.rr_intelligence_thresholds/
    );
  });

  it("refuses a DELETE in the guard", () => {
    assert.match(SQL, /IF TG_OP = 'DELETE' THEN\s*\n\s*RAISE EXCEPTION/);
  });

  it("freezes every column that defines what the target says", () => {
    for (const column of [
      "metric_key",
      "service_code",
      "counterparty_id",
      "target_value",
      "warning_value",
      "critical_value",
      "unit",
      "severity",
      "effective_from",
      "version",
    ]) {
      assert.match(
        SQL,
        new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
        `${column} can be edited, which would rewrite the target a past breach was judged against`
      );
    }
  });

  it("refuses to reactivate a retired version", () => {
    assert.match(SQL, /OLD\.active = false AND NEW\.active = true/);
  });

  it("requires a retirement to say who and when", () => {
    assert.match(SQL, /active = true OR \(retired_at IS NOT NULL AND retired_by IS NOT NULL\)/);
  });

  it("permits only one active version per scope", () => {
    assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_thresholds_active_scope/);
    assert.match(SQL, /WHERE active = true/);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — sql/049 grant matrix", () => {
  it("registers the threshold table in the non-deletable branch", () => {
    // The Phase 3, 4 and 5 lesson: a table missing from 049 has its grants re-widened the
    // next time 049 runs, leaving the trigger as the only defence.
    const branch = HARDENING_SQL.match(
      /ELSIF tbl IN \(([^)]*'rr_billing_disputes'[^)]*)\) THEN/
    );
    assert.ok(branch, "could not find the non-deletable branch in sql/049");
    assert.ok(
      branch[1].includes("rr_intelligence_thresholds"),
      "rr_intelligence_thresholds is not registered in sql/049, so a later run would re-grant DELETE"
    );
  });

  it("keeps that branch granting SELECT, INSERT, UPDATE and revoking DELETE", () => {
    assert.match(
      HARDENING_SQL,
      /REVOKE DELETE, TRUNCATE ON public\.%I FROM authenticated/
    );
    assert.match(HARDENING_SQL, /GRANT SELECT, INSERT, UPDATE ON public\.%I TO authenticated/);
  });

  it("documents why the table is non-deletable", () => {
    assert.match(HARDENING, /rr_intelligence_thresholds \(sql\/081\)/);
  });

  it("does not move any Phase 3-5 table into a different branch", () => {
    for (const table of [
      "rr_service_state_events",
      "rr_standby_summary",
      "rr_charge_calculations",
      "rr_custody_holdings",
      "rr_job_rate_snapshot",
    ]) {
      assert.ok(HARDENING_SQL.includes(`'${table}'`), `${table} disappeared from sql/049`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — rr_job_margin correctness fix", () => {
  it("no longer coalesces a missing cost to zero", () => {
    // The Phase 5 view reported a 100% margin for any job with no cost record.
    assert.equal(
      /COALESCE\(jc\.total_cost, 0\)/.test(SQL),
      false,
      "a missing cost is still being coalesced to zero, which reads as pure profit"
    );
  });

  it("returns NULL margin when cost is unknown", () => {
    assert.match(SQL, /WHEN jc\.total_cost IS NULL THEN NULL/);
  });

  it("exposes has_cost_data so no consumer has to infer it", () => {
    assert.match(SQL, /\(jc\.total_cost IS NOT NULL\) AS has_cost_data/);
  });

  it("keeps the optional cost dependency degrading to NULL rather than zero", () => {
    assert.match(SQL, /NULL::numeric AS total_cost/);
    assert.equal(
      /0::numeric AS total_cost/.test(SQL),
      false,
      "the absent-dependency branch still reports zero cost"
    );
  });

  it("preserves the existing column order so CREATE OR REPLACE succeeds", () => {
    const select = SQL.slice(SQL.indexOf("job_cost AS (__COST_SOURCE__)"));
    const order = ["expected_revenue_ex_vat", "direct_cost", "gross_margin", "margin_pct", "has_cost_data"];
    let cursor = -1;
    for (const column of order) {
      const next = select.indexOf(column);
      assert.ok(next > cursor, `${column} is out of order; CREATE OR REPLACE VIEW would fail`);
      cursor = next;
    }
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 migration — structure", () => {
  it("is transactional", () => {
    assert.match(SQL, /^\s*BEGIN;/m);
    assert.match(SQL, /COMMIT;/);
  });

  it("is idempotent", () => {
    assert.match(SQL, /CREATE TABLE IF NOT EXISTS/);
    assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.match(SQL, /DROP TRIGGER IF EXISTS/);
    assert.match(SQL, /DROP POLICY IF EXISTS/);
  });

  it("fails closed on a missing prerequisite", () => {
    for (const table of [
      "rr_service_jobs",
      "rr_service_state_events",
      "rr_dispatch_assignments",
      "rr_storage_bookings",
      "rr_job_margin",
    ]) {
      assert.match(
        SQL,
        new RegExp(`to_regclass\\('public\\.${table}'\\) IS NULL`),
        `sql/081 does not check for ${table}`
      );
    }
  });

  it("reloads the PostgREST schema cache", () => {
    assert.match(SQL, /NOTIFY pgrst, 'reload schema'/);
  });

  it("resolves workflow milestones by ROLE rather than by state name", () => {
    // Hardcoding "on_scene" would silently mis-measure BYSTAND, which arrives at
    // "arrived_on_scene".
    assert.match(SQL, /'roles' \? 'travel'/);
    assert.match(SQL, /'roles' \? 'arrival'/);
    assert.match(SQL, /'roles' \? 'dispatch_pool'/);
  });

  it("flags BYSTAND on the timing view rather than silently folding it in", () => {
    assert.match(SQL, /\(j\.workflow_key = 'bystand'\) AS is_bystand/);
  });
});

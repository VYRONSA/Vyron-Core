/**
 * Phase 5 migration security, schema safety and seed parity (sql/078, 079, 080).
 *
 * Same discipline as Phases 0-4: every tenant-isolation defect this repository has
 * actually hit was a property of the migration TEXT, so the text is asserted directly.
 * Runtime behaviour is proven separately against real PostgreSQL.
 *
 * The boundary assertion comes first, because it is the one that matters most: VYRON CORE
 * produces billing INFORMATION and must never create an invoice, a payment, a credit note
 * or a ledger entry.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { rateCardSeedRows } from "@/lib/road-recovery/rate-card-catalogue";

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

const RATE_CARDS = migration("078-road-recovery-rate-cards.sql");
const FACTS = migration("079-road-recovery-billable-facts.sql");
const REVIEW = migration("080-road-recovery-billing-review.sql");
const HARDENING = migration("049-release-candidate-security-hardening.sql");

const ALL = [RATE_CARDS, FACTS, REVIEW];
const ALL_SQL = ALL.map(executable).join("\n");

const PHASE5_TABLES = [
  "rr_rate_cards",
  "rr_rate_card_items",
  "rr_job_rate_snapshot",
  "rr_billable_facts",
  "rr_charge_calculations",
  "rr_charge_lines",
  "rr_billing_exceptions",
  "rr_billing_disputes",
] as const;

/** Everything Phases 0-4 built, which Phase 5 must leave alone. */
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
  "rr_custody_events",
  "rr_storage_accrual",
  "rr_release_authorisations",
  "mobile_workforce_evidence",
] as const;

function createTableBody(table: string): string {
  const source = ALL.find((entry) =>
    entry.includes(`CREATE TABLE IF NOT EXISTS public.${table} (`)
  );
  assert.ok(source, `no Phase 5 migration creates public.${table}`);
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
// THE PRODUCT BOUNDARY
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — VYRON CORE does not invoice", () => {
  it("creates exactly the eight approved billing-intelligence tables", () => {
    const created = ALL.flatMap((source) =>
      [...source.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((match) => match[1])
    );
    assert.deepEqual([...created].sort(), [...PHASE5_TABLES].sort());
  });

  it("creates NO finance table by any of the forbidden names", () => {
    for (const forbidden of [
      "billing_accounts",
      "billing_documents",
      "billing_document_lines",
      "billing_payments",
      "billing_number_sequences",
      "billing_tax_rates",
      "rr_invoices",
      "invoices",
      "invoice_lines",
      "payments",
      "credit_notes",
      "debtors",
    ]) {
      assert.equal(
        new RegExp(`CREATE TABLE[^;]*public\\.${forbidden}\\b`).test(ALL_SQL),
        false,
        `Phase 5 creates public.${forbidden}, which belongs to VYRON FINANCE`
      );
    }
  });

  it("creates no invoice-numbering sequence", () => {
    assert.equal(/CREATE SEQUENCE/i.test(ALL_SQL), false);
    assert.equal(/invoice_number/i.test(ALL_SQL), false);
  });

  it("says in the migrations themselves where CORE stops", () => {
    for (const source of ALL) {
      assert.match(source, /VYRON FINANCE/, "a Phase 5 migration does not state the boundary");
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant boundary
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — tenant boundary", () => {
  it("gives every table a NOT NULL company_id referencing companies", () => {
    for (const table of PHASE5_TABLES) {
      assert.match(
        createTableBody(table),
        /company_id uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/,
        `${table} does not carry a mandatory company_id`
      );
    }
  });

  it("enables row level security on every table", () => {
    for (const table of PHASE5_TABLES) {
      assert.ok(
        ALL_SQL.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} does not enable RLS`
      );
    }
  });

  it("writes every policy against the sql/030 helpers, never USING (true)", () => {
    assert.equal(/USING\s*\(\s*true\s*\)/i.test(ALL_SQL), false);
    assert.equal(/WITH CHECK\s*\(\s*true\s*\)/i.test(ALL_SQL), false);
    assert.match(ALL_SQL, /CREATE POLICY %I_tenant_isolation/);
    assert.match(ALL_SQL, /vyron_is_platform_operator\(\)/);
    assert.match(ALL_SQL, /vyron_user_company_ids\(\)/);

    // Every table must appear in one of the policy loops.
    for (const table of PHASE5_TABLES) {
      assert.ok(ALL_SQL.includes(`'${table}'`), `${table} is not covered by a policy loop`);
    }
  });

  it("revokes everything from anon on every table and the margin view", () => {
    for (const table of PHASE5_TABLES) {
      assert.ok(
        ALL_SQL.includes(`REVOKE ALL ON public.${table} FROM anon`),
        `${table} does not revoke anon`
      );
    }
    assert.ok(ALL_SQL.includes("REVOKE ALL ON public.rr_job_margin FROM anon"));
  });

  it("grants nothing to anon anywhere", () => {
    assert.equal(/GRANT[^;]*TO anon/i.test(ALL_SQL), false);
  });

  it("defends cross-tenant references with composite foreign keys", () => {
    for (const table of PHASE5_TABLES) {
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
    for (const table of PHASE5_TABLES) {
      assert.match(
        createTableBody(table),
        /UNIQUE \(company_id, id\)/,
        `${table} cannot be the target of a composite foreign key`
      );
    }
  });

  it("indexes every table for tenant-scoped lookup", () => {
    for (const table of PHASE5_TABLES) {
      assert.match(
        ALL_SQL,
        new RegExp(`CREATE (UNIQUE )?INDEX IF NOT EXISTS \\w+\\s+ON public\\.${table} \\(company_id`),
        `${table} has no company-scoped index`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Immutability and sealing
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — what is frozen stays frozen", () => {
  it("refuses UPDATE on the per-job rate snapshot at BOTH layers", () => {
    assert.ok(ALL_SQL.includes("REVOKE UPDATE ON public.rr_job_rate_snapshot FROM authenticated"));
    assert.match(
      ALL_SQL,
      /CREATE TRIGGER rr_job_rate_snapshot_immutable[\s\S]*?BEFORE UPDATE ON public\.rr_job_rate_snapshot/
    );
  });

  it("seals charge calculations and lines at BOTH layers", () => {
    for (const table of ["rr_charge_calculations", "rr_charge_lines"]) {
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
        `${table} has no append-only trigger, so service_role could still rewrite it`
      );
    }
  });

  it("keeps billable facts and disputes append-only with only a narrow update", () => {
    for (const table of ["rr_billable_facts", "rr_billing_disputes"]) {
      assert.ok(
        ALL_SQL.includes(`GRANT SELECT, INSERT, UPDATE ON public.${table} TO authenticated`),
        `${table} does not take the narrow grant`
      );
      assert.ok(
        ALL_SQL.includes(`REVOKE DELETE, TRUNCATE ON public.${table} FROM authenticated`),
        `${table} permits deletion`
      );
      assert.match(ALL_SQL, new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}`));
    }
  });

  it("names exactly which columns a fact may move, and no more", () => {
    // The trigger enumerates everything that must NOT change. If a new column is added
    // to the table it must be added here too, or a fact becomes quietly editable.
    const trigger = FACTS.slice(
      FACTS.indexOf("CREATE OR REPLACE FUNCTION public.rr_billable_facts_forbid_mutation"),
      FACTS.indexOf("DROP TRIGGER IF EXISTS rr_billable_facts_append_only")
    );
    for (const column of [
      "fact_code", "quantity", "unit", "source", "source_ref",
      "source_detail", "evidence_id", "occurred_at", "recorded_by", "service_job_id",
    ]) {
      assert.match(trigger, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
        `the append-only trigger does not protect ${column}`);
    }
  });

  it("freezes what a dispute originally claimed", () => {
    const trigger = REVIEW.slice(
      REVIEW.indexOf("CREATE OR REPLACE FUNCTION public.rr_billing_disputes_forbid_mutation"),
      REVIEW.indexOf("DROP TRIGGER IF EXISTS rr_billing_disputes_append_only")
    );
    for (const column of [
      "dispute_type", "original_quantity", "disputed_quantity", "reason", "raised_by", "raised_at",
    ]) {
      assert.match(trigger, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
        `the dispute trigger does not protect ${column}`);
    }
  });

  it("uses ON DELETE RESTRICT for every record that justifies a charge", () => {
    for (const table of [
      "rr_job_rate_snapshot",
      "rr_billable_facts",
      "rr_charge_calculations",
      "rr_charge_lines",
      "rr_billing_exceptions",
      "rr_billing_disputes",
    ]) {
      const body = createTableBody(table);
      const jobFk = body.match(/FOREIGN KEY \(company_id, service_job_id\)[\s\S]*?ON DELETE (\w+)/);
      assert.ok(jobFk, `${table} has no composite foreign key to the service job`);
      assert.equal(jobFk[1], "RESTRICT", `${table} lets a priced job be deleted`);
    }
  });
});

// ---------------------------------------------------------------------------
// CHECK constraints
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — a record cannot lie about itself", () => {
  it("keeps every total equal to subtotal plus VAT", () => {
    for (const table of ["rr_charge_calculations", "rr_charge_lines"]) {
      assert.match(
        createTableBody(table),
        /total_incl_vat = subtotal_ex_vat \+ vat_amount/,
        `${table} can store a total that does not add up`
      );
    }
  });

  it("forbids a zero-rated or exempt line from carrying VAT", () => {
    assert.match(
      createTableBody("rr_charge_lines"),
      /vat_treatment = 'standard' OR vat_amount = 0/
    );
  });

  it("forbids a calculation claiming completeness while reporting gaps", () => {
    assert.match(
      createTableBody("rr_charge_calculations"),
      /status <> 'calculated'[\s\S]*?cardinality\(missing_facts\) = 0[\s\S]*?cardinality\(unrated_facts\) = 0/
    );
  });

  it("requires every charge line to explain itself", () => {
    assert.match(createTableBody("rr_charge_lines"), /length\(trim\(reason\)\) > 0/);
  });

  it("requires a captured distance to carry its odometer readings", () => {
    assert.match(
      createTableBody("rr_billable_facts"),
      /source_detail \? 'odometer_start_km' AND source_detail \? 'odometer_end_km'/
    );
  });

  it("requires a percentage loading to say what it loads", () => {
    assert.match(
      createTableBody("rr_rate_card_items"),
      /basis <> 'percentage' OR cardinality\(applies_to\) > 0/
    );
  });

  it("constrains the vocabularies to what the pure engines declare", () => {
    const items = createTableBody("rr_rate_card_items");
    assert.match(items, /basis IN \('flat','per_km','per_hour','per_day','per_unit','percentage'\)/);
    assert.match(items, /vat_treatment IN \('standard','zero_rated','exempt'\)/);
    assert.match(createTableBody("rr_charge_calculations"), /status IN \('calculated','incomplete','not_chargeable'\)/);
    assert.match(createTableBody("rr_billable_facts"), /status IN \('provisional','frozen','disputed','superseded'\)/);
  });

  it("keeps a VAT rate plausible", () => {
    assert.match(createTableBody("rr_rate_cards"), /vat_rate >= 0 AND vat_rate <= 1/);
    assert.match(createTableBody("rr_job_rate_snapshot"), /vat_rate >= 0 AND vat_rate <= 1/);
  });

  it("permits only one ACTIVE rate-card version and one ACTIVE fact per code", () => {
    assert.match(
      RATE_CARDS,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_rate_cards_active[\s\S]*?WHERE active/
    );
    assert.match(
      FACTS,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_billable_facts_active[\s\S]*?WHERE status IN \('provisional', 'frozen', 'disputed'\)/
    );
  });

  it("requires a resolved billing exception and a concluded dispute to name who decided", () => {
    assert.match(
      createTableBody("rr_billing_exceptions"),
      /resolution_status NOT IN \('resolved','waived'\)[\s\S]*?resolved_at IS NOT NULL AND resolved_by IS NOT NULL/
    );
    assert.match(
      createTableBody("rr_billing_disputes"),
      /status NOT IN \('upheld','rejected'\)[\s\S]*?reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL/
    );
  });
});

// ---------------------------------------------------------------------------
// BYSTAND separation
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — BYSTAND cannot be given recovery charges", () => {
  it("enforces the separation with a trigger, because a CHECK cannot reach the parent card", () => {
    assert.match(
      RATE_CARDS,
      /CREATE OR REPLACE FUNCTION public\.rr_rate_card_items_bystand_separation/
    );
    assert.match(
      RATE_CARDS,
      /CREATE TRIGGER rr_rate_card_items_bystand[\s\S]*?BEFORE INSERT OR UPDATE ON public\.rr_rate_card_items/
    );
  });

  it("forbids exactly the recovery charge codes", () => {
    const fn = RATE_CARDS.slice(
      RATE_CARDS.indexOf("rr_rate_card_items_bystand_separation"),
      RATE_CARDS.indexOf("DROP TRIGGER IF EXISTS rr_rate_card_items_bystand")
    );
    for (const forbidden of [
      "tow_distance", "loading", "unloading", "delivery",
      "storage_days", "custody_handling", "recovery_hours", "release_fee",
    ]) {
      assert.ok(fn.includes(`'${forbidden}'`), `BYSTAND separation permits ${forbidden}`);
    }
  });
});

// ---------------------------------------------------------------------------
// The margin view
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — margin is a derived view, not a ledger", () => {
  it("is a VIEW, so it can never drift from its sources", () => {
    assert.match(REVIEW, /CREATE OR REPLACE VIEW public\.rr_job_margin/);
    assert.equal(/CREATE TABLE[^;]*rr_job_margin/.test(REVIEW), false);
  });

  it("IS SECURITY_INVOKER — without it the view leaks every tenant's margin", () => {
    // A PostgreSQL view runs with its OWNER's privileges by default, so RLS on the
    // underlying tables is evaluated as the owner and tenant isolation is bypassed
    // entirely. Runtime validation caught exactly that leak.
    assert.match(
      REVIEW,
      /CREATE OR REPLACE VIEW public\.rr_job_margin\s+WITH \(security_invoker = true\)/,
      "rr_job_margin is not security_invoker and will leak across tenants"
    );
  });

  it("consumes the EXISTING field cost intelligence and invents no cost", () => {
    assert.match(REVIEW, /public\.field_job_costs/);
    assert.equal(/INSERT INTO public\.field_job_costs/.test(REVIEW), false);
  });

  it("treats the cost module as OPTIONAL, so R&R installs without it", () => {
    assert.match(REVIEW, /to_regclass\('public\.field_job_costs'\) IS NULL/);
    assert.match(REVIEW, /RAISE NOTICE/);
  });

  it("reports margin percentage as NULL rather than zero when revenue is unknown", () => {
    assert.match(REVIEW, /ELSE NULL\s*\n\s*END AS margin_pct/);
  });
});

// ---------------------------------------------------------------------------
// Protected tables
// ---------------------------------------------------------------------------

describe("Phase 5 migrations — Phases 0-4 are left alone", () => {
  it("alters only leave_public_holidays, and only additively", () => {
    const altered = new Set(
      [...ALL_SQL.matchAll(/ALTER TABLE (?:IF EXISTS )?public\.(\w+)/g)].map((match) => match[1])
    );
    for (const table of altered) {
      assert.ok(
        table === "leave_public_holidays" || (PHASE5_TABLES as readonly string[]).includes(table),
        `Phase 5 alters public.${table}, which is outside its scope`
      );
    }

    const statements = [...ALL_SQL.matchAll(/ALTER TABLE\s+public\.leave_public_holidays([\s\S]*?);/g)];
    assert.ok(statements.length > 0, "the approved holiday reuse is missing");
    for (const [statement] of statements) {
      assert.match(statement, /ADD COLUMN IF NOT EXISTS/);
      assert.equal(/DROP COLUMN|ALTER COLUMN|SET DATA TYPE/.test(statement), false);
    }
  });

  it("REUSES the existing holiday calendar rather than creating a second one", () => {
    // Table NAMES only — `public_holiday` is a legitimate column on a sealed calculation,
    // and matching the whole CREATE TABLE body would flag it.
    const created = [...ALL_SQL.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(
      (match) => match[1]
    );
    for (const table of created) {
      assert.equal(
        /holiday|calendar/i.test(table),
        false,
        `Phase 5 created a second holiday calendar: ${table}`
      );
    }
    assert.match(RATE_CARDS, /leave_public_holidays/);
  });

  it("treats the holiday calendar as OPTIONAL, so R&R installs without the Leave module", () => {
    assert.match(RATE_CARDS, /to_regclass\('public\.leave_public_holidays'\) IS NULL/);
    assert.equal(
      /Prerequisite missing: public\.leave_public_holidays/.test(RATE_CARDS),
      false,
      "the holiday calendar is still a hard prerequisite"
    );
  });

  it("writes to no protected table", () => {
    for (const table of PROTECTED_TABLES) {
      assert.equal(
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) public\\.${table}\\b`).test(ALL_SQL),
        false,
        `Phase 5 writes to protected table public.${table}`
      );
    }
  });

  it("drops nothing but its own policies, triggers and view", () => {
    const drops = [...ALL_SQL.matchAll(/DROP (\w+)/g)].map((match) => match[1].toUpperCase());
    for (const kind of drops) {
      assert.ok(["POLICY", "TRIGGER", "VIEW"].includes(kind), `Phase 5 issues DROP ${kind}`);
    }
    assert.equal(/DROP TABLE|TRUNCATE TABLE/i.test(ALL_SQL), false);
  });

  it("never touches the field_jobs status CHECK", () => {
    assert.equal(/field_jobs_status_check/.test(ALL_SQL), false);
  });
});

// ---------------------------------------------------------------------------
// sql/049 agreement
// ---------------------------------------------------------------------------

describe("Phase 5 — sql/049 expresses the same intent as the migrations", () => {
  it("lists the sealed Phase 5 tables in the append-only branch", () => {
    const branch = HARDENING.slice(
      HARDENING.indexOf("IF tbl IN ("),
      HARDENING.indexOf("ELSIF tbl IN (")
    );
    for (const table of ["rr_charge_calculations", "rr_charge_lines"]) {
      assert.ok(branch.includes(table), `${table} is missing from the append-only branch`);
    }
  });

  it("lists the narrow-update Phase 5 tables in the non-deletable branch", () => {
    const branch = HARDENING.slice(HARDENING.indexOf("ELSIF tbl IN ('rr_authorisations'"));
    for (const table of ["rr_billable_facts", "rr_billing_disputes"]) {
      assert.ok(branch.includes(table), `${table} is missing from the non-deletable branch`);
    }
    assert.match(branch, /REVOKE DELETE, TRUNCATE ON public\.%I FROM authenticated/);
  });

  it("puts the rate snapshot in the immutable-but-deletable branch", () => {
    const branch = HARDENING.slice(HARDENING.indexOf("ELSIF tbl IN ('rr_evidence_requirements'"));
    assert.ok(branch.includes("rr_job_rate_snapshot"), "the rate snapshot can be re-widened by 049");
    assert.match(branch, /REVOKE UPDATE, TRUNCATE ON public\.%I FROM authenticated/);
  });

  it("still applies RLS, tenant isolation and anon revocation to every Phase 5 table", () => {
    for (const table of PHASE5_TABLES) {
      assert.equal(
        new RegExp(`table_name NOT IN \\([^)]*${table}`).test(HARDENING),
        false,
        `${table} was excluded from the sql/049 loop`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Seed parity
// ---------------------------------------------------------------------------

function generatedBlock(label: string): string {
  const start = `-- >>> GENERATED: ${label} (see header) >>>`;
  const end = `-- <<< GENERATED: ${label} <<<`;
  const a = RATE_CARDS.indexOf(start);
  const b = RATE_CARDS.indexOf(end);
  assert.ok(a >= 0, `sql/078 is missing the "${label}" block start marker`);
  assert.ok(b > a, `sql/078 is missing the "${label}" block end marker`);
  return RATE_CARDS.slice(a + start.length, b);
}

function parseRateSeeds(): Map<
  string,
  { serviceCode: string | null; version: number; currency: string; vatRate: number; items: Record<string, unknown>[] }
> {
  const block = generatedBlock("RATE CARDS");
  const pattern =
    /\('([a-z0-9_]+)',\s*(?:'([a-z_]+)'|NULL),\s*(\d+),\s*'([A-Z]+)',\s*([\d.]+),\s*\$rr_rate\$([\s\S]*?)\$rr_rate\$::jsonb\)/g;
  const found = new Map<
    string,
    { serviceCode: string | null; version: number; currency: string; vatRate: number; items: Record<string, unknown>[] }
  >();
  for (const match of block.matchAll(pattern)) {
    found.set(match[1], {
      serviceCode: match[2] ?? null,
      version: Number(match[3]),
      currency: match[4],
      vatRate: Number(match[5]),
      items: JSON.parse(match[6]),
    });
  }
  return found;
}

describe("Phase 5 — seed parity between sql/078 and the catalogue", () => {
  const parsed = parseRateSeeds();
  const expected = rateCardSeedRows();

  it("seeds exactly the rate cards the catalogue declares", () => {
    assert.deepEqual([...parsed.keys()].sort(), expected.map((row) => row.policy_key).sort());
  });

  it("matches every card, charge by charge", () => {
    for (const row of expected) {
      const found = parsed.get(row.policy_key);
      assert.ok(found, `sql/078 does not seed ${row.policy_key}`);
      assert.equal(found.serviceCode, row.service_code, `${row.policy_key} service_code differs`);
      assert.equal(found.version, row.version, `${row.policy_key} version differs`);
      assert.equal(found.currency, row.currency, `${row.policy_key} currency differs`);
      assert.equal(found.vatRate, row.vat_rate, `${row.policy_key} VAT rate differs`);
      assert.deepEqual(
        found.items,
        row.items,
        `${row.policy_key} charges differ between sql/078 and rate-card-catalogue.ts`
      );
    }
  });

  it("SHIPS NO PRICES — rates are unregulated in South Africa", () => {
    for (const [key, card] of parsed) {
      for (const item of card.items) {
        assert.equal(Number(item.rate_amount), 0, `${key}/${String(item.charge_code)} ships a price`);
      }
    }
  });

  it("seeds tenant DEFAULTS: no seeded card is bound to a counterparty", () => {
    const seedFn = RATE_CARDS.slice(RATE_CARDS.indexOf("CREATE OR REPLACE FUNCTION public.rr_seed_rate_cards"));
    assert.match(
      seedFn,
      /\(company_id, policy_key, counterparty_id, service_code, version, active,[\s\S]*?p_company_id, seed\.policy_key, NULL,/
    );
  });

  it("is idempotent — re-running skips a card that already exists", () => {
    const seedFn = RATE_CARDS.slice(RATE_CARDS.indexOf("CREATE OR REPLACE FUNCTION public.rr_seed_rate_cards"));
    assert.match(seedFn, /IF EXISTS \([\s\S]*?rr_rate_cards[\s\S]*?CONTINUE;/);
  });

  it("restricts the seed function to service_role", () => {
    assert.ok(executable(RATE_CARDS).includes("REVOKE ALL ON FUNCTION public.rr_seed_rate_cards(uuid) FROM authenticated"));
    assert.ok(executable(RATE_CARDS).includes("GRANT EXECUTE ON FUNCTION public.rr_seed_rate_cards(uuid) TO service_role"));
  });

  it("leaves no unreplaced placeholder", () => {
    assert.equal(/__[A-Z_]+__|TODO|PLACEHOLDER/.test(generatedBlock("RATE CARDS")), false);
  });
});

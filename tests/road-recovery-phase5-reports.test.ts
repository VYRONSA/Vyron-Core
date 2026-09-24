/**
 * Phase 5 — the twelve operational billing reports, against a REAL database.
 *
 * Runs after tests/road-recovery-phase5-integration.test.ts has populated the tenant with
 * priced jobs, disputes and exceptions, so these assertions run over realistic data rather
 * than fixtures invented for the reports themselves.
 *
 * The boundary is asserted per report: none of them may leak an invoice, a payment or a
 * ledger concept, because VYRON CORE has none.
 *
 *   RR_TEST_PSQL=<path to psql> RR_TEST_DB=rr_itest npm test
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";

import {
  RR_BILLING_REPORTS,
  authorisationVsActualReport,
  billingExceptionsReport,
  billingReadinessReport,
  billingReportToCsv,
  bystandBillingReport,
  counterpartySummaryReport,
  disputedDistanceReport,
  awaitingFinanceReport,
  outstandingInformationReport,
  profitabilityReport,
  runBillingReport,
  storageBillingReport,
  towDistanceReport,
} from "@/lib/road-recovery/billing-reports";

const CONFIG = readTestDatabaseConfig();
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTROLLER = "controller@alpha.test";

let db: PgTestClient;
let owner: PgTestClient;

const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Phase 5 billing reports", () => {
    it("skipped: set RR_TEST_PSQL and RR_TEST_DB to run against a disposable database", () => {
      assert.ok(true);
    });
  });
}

before(async () => {
  if (!CONFIG) return;
  db = createPgTestClient(CONFIG, { kind: "authenticated", email: CONTROLLER });
  owner = createPgTestClient(CONFIG, { kind: "owner" });

  // ---------------------------------------------------------------------------
  // FIXTURES
  // ---------------------------------------------------------------------------
  //
  // This suite used to assert against whatever the Phase 5 INTEGRATION suite happened to
  // leave in the database. Node runs test files in parallel, so "happened to" was doing a
  // lot of work: on a clean database four of these reports had nothing to report on, and
  // the suite failed for a reason that had nothing to do with the reports.
  //
  // It now seeds its own data, through the SERVICE LAYER, so every assertion below is
  // about data this file put there. Not one assertion was relaxed to make that work.
  await seedReportFixtures();
});

/**
 * Everything the twelve reports need in order to have something to report.
 *
 * Each fixture exists because a specific report would otherwise be empty, and an empty
 * report proves nothing:
 *
 *   a priced tow          the distance, readiness, profitability and pack reports
 *   an out-of-tolerance   the QUERIED row on the tow distance report — an operational
 *   odometer capture      event, produced by capturing a distance far from the estimate
 *                         rather than by writing a status into the database
 *   a distance dispute    the disputed-distance report, which must show that the
 *                         driver's ORIGINAL reading survived the challenge
 *   a sealed storage      the storage report, which must read the SEALED accrual
 *   accrual
 *   a BYSTAND attendance  the BYSTAND report, which must show standing time and no tow
 *   an escalated billing  the billing exceptions report, which must link to the EXISTING
 *   exception             action pipeline rather than to a Road & Recovery one
 */
async function seedReportFixtures(): Promise<void> {
  const {
    priceCard,
    seedBillableTow,
    seedBystandAttendance,
    seedSealedStorage,
  } = await import("./support/rr-lifecycle");

  // Real rates, because a zero-rated card BLOCKS by design and would report nothing.
  //
  // ACCIDENT RECOVERY, not TOW-IN. Rate cards are per service code and per tenant, so two
  // suites pricing the same card are mutating shared state — and node runs test files in
  // parallel. This suite priced tow_in with an admin fee, the Phase 5 integration E2E
  // asserts an exact tow_in total, and the two collided. Using a different service code
  // means neither suite can perturb the other's arithmetic, whatever either does next.
  priceCard(owner, "accident_recovery", {
    callout: 850,
    tow_distance: 22,
    loading: 350,
    unloading: 350,
    admin_fee: 150,
  });
  // vehicle_movement is deliberately LEFT AT ZERO. The Phase 5 integration suite uses it
  // as its "missing rate" case, and pricing it here would make that test pass for the
  // wrong reason. A shared rate card is shared state: price only what this suite needs.

  // 1. A clean, in-tolerance tow.
  // The dispatch estimate for these fixtures is ~11.2 km (Epping depot to the N1 origin)
  // and the tolerance is 25%, so a 12 km capture is comfortably WITHIN tolerance and must
  // come out billing-ready.
  await seedBillableTow(db, owner, {
    title: `REPORTS in-tolerance ${Date.now()}`,
    serviceCode: "accident_recovery",
    odometerStartKm: 100_000,
    odometerEndKm: 100_012,
    // An authorised CEILING, so the authorisation-vs-actual report has something to
    // compare the sealed expected charge against.
    authorisedAmount: 4500,
  });

  // 2. A tow whose captured distance is far from the dispatch estimate. The billing
  //    service raises the disputed_distance exception itself — the test does not write
  //    the status, it provokes the condition.
  // Far outside the 25% tolerance, so the billing service raises disputed_distance itself.
  const queried = await seedBillableTow(db, owner, {
    title: `REPORTS out-of-tolerance ${Date.now()}`,
    serviceCode: "accident_recovery",
    odometerStartKm: 200_000,
    odometerEndKm: 200_480,
  });

  // 3. A formal dispute against that capture, preserving the original reading.
  const factRows = owner.sql(
    `SELECT id, quantity FROM public.rr_billable_facts
      WHERE company_id = '${ALPHA}' AND service_job_id = '${queried.serviceJobId}'
        AND fact_code = 'tow_distance' AND status <> 'superseded'
      ORDER BY recorded_at DESC LIMIT 1`
  );
  if (factRows.length > 0) {
    const fact = factRows[0] as { id: string; quantity: number };
    owner.sql(
      `INSERT INTO public.rr_billing_disputes
         (company_id, service_job_id, dispute_type, fact_id, original_quantity,
          disputed_quantity, unit, raised_by, raised_by_party, reason, status)
       VALUES ('${ALPHA}', '${queried.serviceJobId}', 'distance', '${fact.id}',
         ${fact.quantity}, 120, 'km', '${CONTROLLER}', 'counterparty',
         'Assistance provider states the route was shorter than the captured odometer distance.',
         'open')
       RETURNING id`
    );
  }

  // 4. A sealed storage accrual.
  await seedSealedStorage(db, owner, { title: `REPORTS storage ${Date.now()}`, daysHeld: 6 });

  // BYSTAND and STORAGE have one card per tenant and cannot be side-stepped by choosing a
  // different service. They are priced at the SAME values the Phase 5 integration suite
  // uses, so whichever suite writes last, both see the numbers they expect.
  priceCard(owner, "bystand", { callout: 400, standing_time: 480 });
  priceCard(owner, "storage", { storage_days: 350, release_fee: 250 });

  // 5. A BYSTAND attendance with a sealed standby summary, PRICED.
  //    The BYSTAND report reads billable facts, and standing time only becomes a fact
  //    when the sealed summary is derived — so sealing alone is not enough.
  const bystand = await seedBystandAttendance(db, owner, {
    title: `REPORTS bystand ${Date.now()}`,
    billableHours: 2.5,
    pausedHours: 0.5,
  });

  const {
    calculateAndSealCharges: sealBystandCharges,
    deriveSealedFacts: deriveBystandFacts,
    freezeBillableFacts: freezeBystandFacts,
    resolveAndFreezeRateCard: freezeBystandRate,
  } = await import("@/lib/road-recovery/billing-service");

  await deriveBystandFacts(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId: bystand.serviceJobId,
  });
  await freezeBystandFacts(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId: bystand.serviceJobId,
  });
  const bystandRate = await freezeBystandRate(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId: bystand.serviceJobId,
  });
  assert.ok(bystandRate.ok, bystandRate.ok ? "" : `bystand rate failed: ${bystandRate.message}`);
  const bystandCharged = await sealBystandCharges(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId: bystand.serviceJobId,
  });
  assert.ok(
    bystandCharged.ok,
    bystandCharged.ok ? "" : `bystand charges failed: ${bystandCharged.message}`
  );

  // 6. A billing exception escalated into the EXISTING action queue. raiseBillingException
  //    is what performs the escalation, so calling it is what proves the link is real.
  const { raiseBillingException } = await import("@/lib/road-recovery/billing-service");
  const escalated = await raiseBillingException(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId: queried.serviceJobId,
    exceptionCode: "disputed_distance",
    severity: "high",
    detail: "Captured distance is materially above the dispatch estimate.",
    detectedBy: "billing_admin",
  });
  assert.ok(escalated.ok, escalated.ok ? "" : `billing exception failed: ${escalated.message}`);
}

// ---------------------------------------------------------------------------
// Every report
// ---------------------------------------------------------------------------

describeIf("Phase 5 — all twelve reports", () => {
  it("ships exactly twelve, and every one runs", async () => {
    assert.equal(RR_BILLING_REPORTS.length, 12);

    for (const key of RR_BILLING_REPORTS) {
      const result = await runBillingReport(db as never, key, { companyId: ALPHA });
      assert.ok(result.ok, result.ok ? "" : `${key} failed: ${result.message}`);
      assert.equal(result.data.key, key);
      assert.ok(result.data.columns.length > 0, `${key} has no columns`);
      assert.ok(result.data.label.length > 0);
    }
  });

  it("every report declares that it is NOT an invoice", async () => {
    for (const key of RR_BILLING_REPORTS) {
      const result = await runBillingReport(db as never, key, { companyId: ALPHA });
      assert.ok(result.ok, result.ok ? "" : result.message);
      assert.match(result.data.disclaimer, /Not an invoice/i, `${key} has no disclaimer`);
      assert.match(result.data.disclaimer, /VYRON FINANCE/, `${key} does not name VYRON FINANCE`);
    }
  });

  it("no report leaks a finance concept", async () => {
    for (const key of RR_BILLING_REPORTS) {
      const result = await runBillingReport(db as never, key, { companyId: ALPHA });
      assert.ok(result.ok, result.ok ? "" : result.message);
      const serialised = JSON.stringify(result.data);
      assert.equal(
        /"invoiceNumber"|"paymentId"|"ledgerEntry"|"creditNote"/.test(serialised),
        false,
        `${key} leaks a finance concept`
      );
    }
  });

  it("rejects a report key that does not exist", async () => {
    const result = await runBillingReport(db as never, "make_me_money" as never, {
      companyId: ALPHA,
    });
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// 1-2. Readiness and the Finance queue
// ---------------------------------------------------------------------------

describeIf("Phase 5 — readiness reports", () => {
  it("BILLING READINESS separates ready from blocked, always with a reason", async () => {
    const result = await billingReadinessReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0, "no jobs on the readiness report");

    const ready = result.data.rows.filter((row) => row.readiness === "READY");
    const blocked = result.data.rows.filter((row) => row.readiness === "BLOCKED");
    assert.ok(ready.length > 0, "not one job came out ready");
    assert.ok(blocked.length > 0, "not one job came out blocked");

    for (const row of blocked) {
      assert.ok(
        (row.blockingReasons as string[]).length > 0,
        `${row.jobRef} is blocked with no reason given`
      );
    }
    assert.equal(
      (result.data.summary.ready as number) + (result.data.summary.blocked as number),
      result.data.summary.jobs
    );
  });

  it("READY FOR FINANCE lists only complete information, and no invoice exists", async () => {
    const result = await awaitingFinanceReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);

    for (const row of result.data.rows) {
      assert.equal(row.readiness, "READY");
    }
    assert.match(String(result.data.summary.note), /No invoice exists in UMORA/);

    const tables = owner.sql(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public'
          AND (table_name LIKE '%invoice%' OR table_name LIKE '%credit_note%'
            OR table_name LIKE '%ledger%' OR table_name LIKE '%debtor%')`
    );
    assert.equal(Number((tables[0] as { n: number }).n), 0, "a finance table exists in VYRON CORE");
  });
});

// ---------------------------------------------------------------------------
// 4. BYSTAND
// ---------------------------------------------------------------------------

describeIf("Phase 5 — the BYSTAND report proves the separation", () => {
  it("shows standing time and NO tow, storage, custody or delivery charge", async () => {
    const result = await bystandBillingReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0, "no BYSTAND jobs on the report");

    assert.equal(
      result.data.summary.separationViolations,
      0,
      "the BYSTAND report found a recovery charge"
    );

    for (const row of result.data.rows) {
      assert.deepEqual(
        row.separationViolations,
        [],
        `a BYSTAND job carries ${JSON.stringify(row.separationViolations)}`
      );
    }

    const priced = result.data.rows.find((row) => row.billableHours !== null);
    assert.ok(priced, "no BYSTAND job carried billable hours");
    assert.equal(priced.billableHours, 2.5);
    assert.equal(priced.pausedHours, 0.5);
    assert.equal(priced.sealedBy, "rr-standby-1.0.0");
  });

  it("no BYSTAND charge line of a forbidden code exists in the database at all", () => {
    const rows = owner.sql(
      `SELECT l.charge_code
         FROM public.rr_charge_lines l
         JOIN public.rr_service_jobs j ON j.id = l.service_job_id
        WHERE l.company_id = '${ALPHA}'
          AND j.workflow_key = 'bystand'
          AND l.charge_code IN ('tow_distance','loading','unloading','delivery',
                                'storage_days','custody_handling','recovery_hours','release_fee')`
    );
    assert.deepEqual(rows, [], "a BYSTAND job has a recovery charge line");
  });
});

// ---------------------------------------------------------------------------
// 5. Storage
// ---------------------------------------------------------------------------

describeIf("Phase 5 — the storage report consumes the sealed accrual", () => {
  it("reads the sealed duration and exposes the calculator version", async () => {
    const result = await storageBillingReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0, "no storage bookings on the report");

    const sealed = result.data.rows.find((row) => row.calculatorVersion !== null);
    assert.ok(sealed, "no storage row carried a sealed calculator version");
    assert.equal(sealed.calculatorVersion, "rr-storage-accrual-1.0.0");
    // 6 elapsed days as Phase 4 sealed them; 5 chargeable after the contract grace day.
    assert.equal(sealed.elapsedDays, 6);
    assert.equal(sealed.chargeableDays, 5);
    assert.match(String(result.data.summary.note), /never recalculated/i);
  });

  it("the elapsed days on the report EQUAL the sealed row, byte for byte", async () => {
    // Asserts the INVARIANT rather than a hardcoded number, so the test does not depend
    // on another suite having seeded a particular accrual first.
    const sealed = owner.sql(
      `SELECT a.service_job_id, a.elapsed_days, a.calculator_version
         FROM public.rr_storage_accrual a
        WHERE a.company_id = '${ALPHA}'
        ORDER BY a.sealed_at DESC LIMIT 1`
    ) as Record<string, unknown>[];

    if (sealed.length === 0) {
      assert.ok(true, "no sealed accrual in this database; nothing to reconcile");
      return;
    }

    const result = await storageBillingReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);

    const row = result.data.rows.find(
      (entry) => entry.serviceJobId === String(sealed[0].service_job_id)
    );
    assert.ok(row, "the sealed accrual does not appear on the storage report");
    assert.equal(
      row.elapsedDays,
      Number(sealed[0].elapsed_days),
      "the report recomputed the duration instead of reading the sealed row"
    );
    assert.equal(row.calculatorVersion, String(sealed[0].calculator_version));
  });
});

// ---------------------------------------------------------------------------
// 6-7. Distance and disputes
// ---------------------------------------------------------------------------

describeIf("Phase 5 — distance reports", () => {
  it("TOW DISTANCE shows the odometer readings and the dispatch comparison", async () => {
    const result = await towDistanceReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);

    const captured = result.data.rows.find((row) => row.odometerStart !== null);
    assert.ok(captured, "no odometer capture on the distance report");
    assert.equal(
      captured.capturedKm,
      (captured.odometerEnd as number) - (captured.odometerStart as number),
      "the captured distance does not equal the odometer difference"
    );

    const queried = result.data.rows.find((row) => row.status === "QUERIED");
    assert.ok(queried, "the out-of-tolerance capture was not flagged");
    assert.ok((queried.variancePercent as number) > (queried.tolerancePercent as number));
    assert.match(String(result.data.summary.note), /odometer is the commercial source/i);
  });

  it("DISPUTED DISTANCE preserves the driver's original reading", async () => {
    const result = await disputedDistanceReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0, "no distance disputes on the report");

    for (const row of result.data.rows) {
      assert.ok(row.originalKm !== null, "a dispute lost the driver's original reading");
      assert.ok(String(row.reason).length > 0, "a dispute has no reason");
    }
    assert.match(String(result.data.summary.note), /never overwritten/i);
  });
});

// ---------------------------------------------------------------------------
// 8-12. The rest
// ---------------------------------------------------------------------------

describeIf("Phase 5 — commercial and exception reports", () => {
  it("AUTHORISATION VS ACTUAL compares the ceiling without enforcing it", async () => {
    const result = await authorisationVsActualReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);

    const withCeiling = result.data.rows.find((row) => row.authorisedAmount !== null);
    assert.ok(withCeiling, "no job carried an authorised amount");
    assert.equal(
      withCeiling.variance,
      Math.round(
        ((withCeiling.expectedAmount as number) - (withCeiling.authorisedAmount as number)) * 100
      ) / 100
    );
    assert.match(String(result.data.summary.note), /not a limit UMORA enforces/i);
  });

  it("COUNTERPARTY SUMMARY reconciles ready plus blocked against total jobs", async () => {
    const result = await counterpartySummaryReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0);

    for (const row of result.data.rows) {
      assert.equal(
        (row.ready as number) + (row.blocked as number),
        row.jobs as number,
        `${row.counterparty} totals do not reconcile`
      );
    }
  });

  it("PROFITABILITY reports margin as UNKNOWN rather than inventing cost", async () => {
    const result = await profitabilityReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);

    for (const row of result.data.rows) {
      assert.ok((row.expectedRevenue as number) > 0, "a priced job shows no revenue");
      if (row.directCost === null) {
        assert.equal(row.grossMargin, null, "margin was reported without cost data");
        assert.equal(row.marginPct, null);
      }
    }
    assert.ok(typeof result.data.summary.note === "string");
  });

  it("OUTSTANDING groups every blocked job by its first blocking reason", async () => {
    const result = await outstandingInformationReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0, "nothing outstanding, yet blocked jobs exist");

    const total = result.data.rows.reduce((sum, row) => sum + (row.jobs as number), 0);
    assert.equal(total, result.data.summary.blockedJobs, "grouping lost or duplicated a job");
  });

  it("BILLING EXCEPTIONS links to the EXISTING Action Intelligence pipeline", async () => {
    const result = await billingExceptionsReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.ok(result.data.rows.length > 0, "no billing exceptions on the report");

    const escalated = result.data.rows.find((row) => row.actionId !== null);
    assert.ok(escalated, "no exception was escalated");
    assert.equal(escalated.actionStatus, "Pending Approval");
    assert.match(String(result.data.summary.note), /no second action system/i);

    // Severity first, so a controller sees what matters at the top.
    const severities = result.data.rows.map((row) => String(row.severity));
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let index = 1; index < severities.length; index += 1) {
      assert.ok(
        (rank[severities[index - 1]] ?? 9) <= (rank[severities[index]] ?? 9),
        "exceptions are not ordered by severity"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describeIf("Phase 5 — report export", () => {
  it("exports CSV with the boundary stated in the file itself", async () => {
    const result = await billingReadinessReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);

    const csv = billingReportToCsv(result.data);
    assert.match(csv, /UMORA — Billing Readiness/);
    assert.match(csv, /Not an invoice/i);
    assert.ok(csv.split("\n").length > 5, "the CSV has no rows");
    // Every column header is present.
    for (const column of result.data.columns) {
      assert.ok(csv.includes(column.label), `the CSV omits the ${column.label} column`);
    }
  });

  it("escapes a value containing a comma or a quote", async () => {
    const result = await billingReadinessReport(db as never, { companyId: ALPHA });
    assert.ok(result.ok, result.ok ? "" : result.message);
    const csv = billingReportToCsv(result.data);
    // Blocking reasons are sentences with commas; they must be quoted, not split.
    for (const line of csv.split("\n")) {
      const quotes = (line.match(/"/g) || []).length;
      assert.equal(quotes % 2, 0, `unbalanced quoting in CSV line: ${line.slice(0, 60)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Report-level tenant isolation
// ---------------------------------------------------------------------------

describeIf("Phase 5 — a report can never cross the tenant boundary", () => {
  it("CROSS-TENANT REPORT REQUEST returns EMPTY, never another tenant's data", async () => {
    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    for (const key of RR_BILLING_REPORTS) {
      const result = await runBillingReport(bravo as never, key, { companyId: ALPHA });
      assert.ok(result.ok, result.ok ? "" : `${key} errored: ${result.message}`);
      assert.equal(
        result.data.rows.length,
        0,
        `${key} served ${result.data.rows.length} of alpha's rows to bravo`
      );
    }
  });

  it("ANON is served nothing by any report", async () => {
    const anon = createPgTestClient(CONFIG!, { kind: "anon" });

    for (const key of RR_BILLING_REPORTS) {
      const result = await runBillingReport(anon as never, key, { companyId: ALPHA });
      // Either refused outright, or empty. Never data.
      if (result.ok) {
        assert.equal(result.data.rows.length, 0, `${key} served rows to anon`);
      }
    }
  });
});

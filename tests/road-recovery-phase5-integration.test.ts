/**
 * Phase 5 SERVICE-LAYER integration and end-to-end — BILLING INTELLIGENCE.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY THIS SUITE ENFORCES
 * ---------------------------------------------------------------------------
 *
 * VYRON CORE produces billing INFORMATION and stops. There is ZERO expectation anywhere
 * in this file that CORE creates an invoice, a payment, a credit note or a ledger entry —
 * and one test asserts that no such table exists at all.
 *
 * Each E2E ends at a Billing Information Pack.
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

import { createServiceJob, transitionServiceJob } from "@/lib/road-recovery/job-service";
import {
  calculateAndSealCharges,
  deriveSealedFacts,
  evaluateBillingReadiness,
  freezeBillableFacts,
  raiseBillingException,
  recordBillableFact,
  recordOdometerCapture,
  resolveAndFreezeRateCard,
} from "@/lib/road-recovery/billing-service";
import {
  RR_BILLING_PACK_CONTRACT_VERSION,
  billingPackToCsv,
  billingPackToJson,
  buildBillingPack,
} from "@/lib/road-recovery/billing-pack";

const CONFIG = readTestDatabaseConfig();
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTROLLER = "controller@alpha.test";
const COUNTERPARTY = "c0000000-0000-4000-8000-00000000000a";
const YARD = "11110000-0000-4000-8000-00000000aaaa";

let db: PgTestClient;
let owner: PgTestClient;

const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Phase 5 billing integration", () => {
    it("skipped: set RR_TEST_PSQL and RR_TEST_DB to run against a disposable database", () => {
      assert.ok(true);
    });
  });
}

before(() => {
  if (!CONFIG) return;
  db = createPgTestClient(CONFIG, { kind: "authenticated", email: CONTROLLER });
  owner = createPgTestClient(CONFIG, { kind: "owner" });
});

function suffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Puts real rates on a shipped card so a job can actually be priced. */
function priceCard(serviceCode: string, rates: Record<string, number>) {
  for (const [chargeCode, amount] of Object.entries(rates)) {
    owner.exec(
      `UPDATE public.rr_rate_card_items i
          SET rate_amount = ${amount}
         FROM public.rr_rate_cards c
        WHERE i.rate_card_id = c.id
          AND i.company_id = '${ALPHA}'
          AND c.service_code = '${serviceCode}'
          AND i.charge_code = '${chargeCode}'`
    );
  }
}

function authorise(serviceJobId: string, serviceCode: string, amount: number | null = null) {
  owner.sql(
    `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
       authorisation_number, claim_reference, po_number, authorised_service_code, authorised_amount)
     VALUES ('${ALPHA}', '${serviceJobId}', '${COUNTERPARTY}', 'AUTH-${suffix()}',
       'CLM-${suffix()}', 'PO-${suffix()}', '${serviceCode}', ${amount === null ? "NULL" : amount})
     RETURNING id`
  );
}

async function createJob(serviceCode: string, title: string, withDestination = true) {
  const created = await createServiceJob(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceCode,
    title,
    counterpartyId: COUNTERPARTY,
    originLabel: "N1 northbound",
    originLatitude: -33.9249,
    originLongitude: 18.4241,
    ...(withDestination
      ? { destinationLabel: "Alpha Yard", destinationAddress: "12 Yard Road", destinationType: "storage_yard" }
      : {}),
    vehicleRegistration: `CA ${suffix()}`,
  });
  assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
  return created.data;
}

/** Satisfies every invoice-scope requirement so the Phase 3 evidence gate passes. */
async function satisfyEvidence(serviceJobId: string, fieldJobId: string) {
  const { evaluateJobCompliance, linkEvidenceToRequirements } = await import(
    "@/lib/road-recovery/requirements-service"
  );
  const compliance = await evaluateJobCompliance(db as never, { companyId: ALPHA, serviceJobId });
  assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);

  for (const result of compliance.data.compliance.results) {
    if (!result.blocking) continue;
    if (result.evidenceKind === "gps" || result.evidenceKind === "authorisation") continue;
    const needed = Math.max(1, result.minCount - result.capturedCount);
    for (let index = 0; index < needed; index += 1) {
      const rows = owner.sql(
        `INSERT INTO public.mobile_workforce_evidence
           (company_id, employee_id, job_id, service_job_id, evidence_type,
            storage_bucket, storage_path, captured_by_role)
         VALUES ('${ALPHA}', 'd0000000-0000-4000-8000-00000000000a', '${fieldJobId}',
           '${serviceJobId}', 'other', 'rr-evidence',
           '${ALPHA}/${serviceJobId}/${suffix()}.jpg', 'driver')
         RETURNING id`
      );
      const linked = await linkEvidenceToRequirements(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId,
        evidenceId: String((rows[0] as { id: string }).id),
        requirementCodes: [result.requirementCode],
      });
      assert.ok(linked.ok, linked.ok ? "" : linked.message);
    }
  }
}

/** GPS-verified arrival, which satisfies the gps_arrival requirement. */
function recordGpsArrival(fieldJobId: string) {
  owner.sql(
    `INSERT INTO public.mobile_gps_validations
       (company_id, employee_id, job_id, reference_type,
        employee_latitude, employee_longitude, site_latitude, site_longitude,
        radius_meters, distance_meters, inside_radius)
     VALUES ('${ALPHA}', 'd0000000-0000-4000-8000-00000000000a', '${fieldJobId}',
       'arrive_site', -33.9255, 18.4243, -33.9249, 18.4241, 200, 70, true)
     RETURNING id`
  );
}

async function driveTow(serviceJobId: string) {
  const states = [
    "authorisation_pending", "authorised", "dispatch_pending", "assigned", "accepted",
    "en_route", "on_scene", "assessing", "loading", "secured", "departing_scene",
    "in_transit", "arrived_destination", "offloading", "handover_pending", "handed_over",
    "paperwork_complete", "evidence_complete",
  ];
  for (const toState of states) {
    const result = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      toState,
    });
    assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
  }
}

// ---------------------------------------------------------------------------
// THE BOUNDARY
// ---------------------------------------------------------------------------

describeIf("Phase 5 — VYRON CORE does not invoice", () => {
  it("creates NO invoice, payment, credit-note or ledger table anywhere", () => {
    const rows = owner.sql(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name LIKE '%invoice%'
            OR table_name LIKE '%credit_note%'
            OR table_name LIKE '%ledger%'
            OR table_name LIKE '%debtor%'
            OR table_name = 'billing_documents'
            OR table_name = 'billing_document_lines'
            OR table_name = 'billing_payments'
            OR table_name = 'billing_number_sequences'
            OR table_name = 'billing_tax_rates'
            OR table_name = 'billing_accounts')`
    ) as Record<string, unknown>[];
    assert.deepEqual(
      rows.map((row) => String(row.table_name)),
      [],
      "VYRON CORE created a finance table; invoicing belongs to VYRON FINANCE"
    );
  });

  it("the pack states plainly that it is not a tax invoice", async () => {
    const job = await createJob("tow_in", "Boundary disclaimer");
    const pack = await buildBillingPack(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(pack.ok, pack.ok ? "" : pack.message);
    assert.match(pack.data.disclaimer, /not a tax invoice/i);
    assert.match(pack.data.disclaimer, /VYRON FINANCE/);
    assert.equal(pack.data.contractVersion, RR_BILLING_PACK_CONTRACT_VERSION);
    // No invoice number, ever.
    assert.equal("invoiceNumber" in pack.data, false);
  });
});

// ---------------------------------------------------------------------------
// E2E 1 — TOW-IN
// ---------------------------------------------------------------------------

describeIf("Phase 5 — E2E 1: TOW-IN", () => {
  it("create -> authorise -> dispatch -> arrive -> odometer -> facts -> rate -> charges -> readiness -> PACK", async () => {
    priceCard("tow_in", { callout: 650, tow_distance: 22, loading: 300, unloading: 200, delivery: 150 });

    const job = await createJob("tow_in", "E2E tow-in billing");
    authorise(job.serviceJobId, "tow_in", 5000);
    recordGpsArrival(job.fieldJobId);
    await driveTow(job.serviceJobId);
    await satisfyEvidence(job.serviceJobId, job.fieldJobId);

    // ODOMETER CAPTURE — the primary commercial distance source.
    const odometer = await recordOdometerCapture(db as never, {
      companyId: ALPHA,
      actorEmail: "driver.a@alpha.test",
      serviceJobId: job.serviceJobId,
      odometerStartKm: 120450,
      odometerEndKm: 120492,
      vehicleId: "40000000-0000-4000-8000-00000000000a",
      latitude: -33.9255,
      longitude: 18.4243,
    });
    assert.ok(odometer.ok, odometer.ok ? "" : odometer.message);
    assert.equal(odometer.data.distanceKm, 42);

    // Facts the tow rate card also prices.
    for (const [factCode, quantity, unit] of [
      ["loading", 1, "each"],
      ["unloading", 1, "each"],
      ["delivery", 1, "each"],
    ] as const) {
      const recorded = await recordBillableFact(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId: job.serviceJobId,
        factCode,
        quantity,
        unit,
        source: "manual",
      });
      assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);
    }

    const frozen = await freezeBillableFacts(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(frozen.ok, frozen.ok ? "" : frozen.message);

    // RESOLVE AND FREEZE THE RATE CARD.
    const rate = await resolveAndFreezeRateCard(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(rate.ok, rate.ok ? "" : rate.message);
    assert.equal(rate.data.conflicted, false);
    assert.equal(rate.data.policyKey, "default_rate_tow_in");

    // CALCULATE AND SEAL.
    const charged = await calculateAndSealCharges(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(charged.ok, charged.ok ? "" : charged.message);
    assert.equal(
      charged.data.result.status,
      "calculated",
      `missing=${charged.data.result.missingFacts.join(",")} unrated=${charged.data.result.unratedFacts.join(",")}`
    );

    // 650 call-out + 42 km at 22 + 300 + 200 + 150 = 2224 ex VAT
    assert.equal(charged.data.result.subtotalExVat, 650 + 42 * 22 + 300 + 200 + 150);
    assert.equal(charged.data.result.vatAmount, Math.round(charged.data.result.subtotalExVat * 0.15 * 100) / 100);

    // READINESS.
    const readiness = await evaluateBillingReadiness(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(readiness.ok, readiness.ok ? "" : readiness.message);
    assert.equal(
      readiness.data.ready,
      true,
      `blocked: ${readiness.data.blockingReasons.join(" ")}`
    );

    // THE PACK.
    const pack = await buildBillingPack(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(pack.ok, pack.ok ? "" : pack.message);

    assert.equal(pack.data.billTo.kind, "counterparty");
    assert.ok(pack.data.billTo.name, "the pack has no bill-to name");
    assert.ok(pack.data.authorisation.claimReference, "the pack has no claim reference");
    assert.ok(pack.data.vehicle.registration, "the pack has no vehicle registration");
    assert.equal(pack.data.rateCard.policyKey, "default_rate_tow_in");
    assert.ok(pack.data.charges.lines.length >= 5);
    assert.equal(pack.data.readiness.ready, true);
    assert.ok(pack.data.evidence.length > 0, "the pack references no evidence");

    // The authorised ceiling is compared, not enforced — that is a controller's call.
    assert.equal(pack.data.authorisation.authorisedAmount, 5000);
    assert.equal(
      pack.data.authorisation.varianceToAuthorised,
      Math.round((pack.data.charges.totalInclVat - 5000) * 100) / 100
    );

    // Every line explains itself.
    for (const line of pack.data.charges.lines) {
      assert.ok(line.reason.length > 0, `${line.chargeCode} has no explanation`);
    }

    // Exports work and stay in the same shape.
    const csv = billingPackToCsv(pack.data);
    assert.match(csv, /NOT A TAX INVOICE/);
    assert.match(csv, /Expected total incl VAT/);
    const json = JSON.parse(billingPackToJson(pack.data));
    assert.equal(json.contractVersion, RR_BILLING_PACK_CONTRACT_VERSION);
  });
});

// ---------------------------------------------------------------------------
// E2E 2 — BYSTAND
// ---------------------------------------------------------------------------

describeIf("Phase 5 — E2E 2: BYSTAND", () => {
  it("seals standby, prices standing time, and produces NO tow or storage charge", async () => {
    priceCard("bystand", { callout: 400, standing_time: 480 });

    const job = await createJob("bystand", "E2E bystand billing", false);
    authorise(job.serviceJobId, "bystand");
    recordGpsArrival(job.fieldJobId);

    for (const toState of [
      "bystand_requested", "authorisation_pending", "authorised", "assigned", "accepted",
      "en_route", "arrived_on_scene", "standing_by", "stand_down_requested", "stood_down",
      "departed_scene", "report_submitted", "evidence_complete",
    ]) {
      const result = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId: job.serviceJobId,
        toState,
      });
      assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
    }

    // A sealed Phase 2 standby summary: 2.5 billable hours, 0.5 paused.
    owner.sql(
      `INSERT INTO public.rr_standby_summary
         (company_id, service_job_id, sealed_reason, total_billable_seconds,
          total_paused_seconds, calculator_version, sealed_by)
       VALUES ('${ALPHA}', '${job.serviceJobId}', 'stand_down', 9000, 1800,
         'rr-standby-1.0.0', '${CONTROLLER}')
       RETURNING id`
    );

    const derived = await deriveSealedFacts(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(derived.ok, derived.ok ? "" : derived.message);
    assert.ok(derived.data.derived.includes("standing_time"));
    assert.ok(derived.data.derived.includes("paused_time"));

    await satisfyEvidence(job.serviceJobId, job.fieldJobId);
    await freezeBillableFacts(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });
    await resolveAndFreezeRateCard(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });

    const charged = await calculateAndSealCharges(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(charged.ok, charged.ok ? "" : charged.message);

    // 400 call-out + 2.5 hours at 480 = 1600
    assert.equal(charged.data.result.subtotalExVat, 400 + 2.5 * 480);

    // THE INVARIANT: no tow, storage, custody, loading or delivery charge — ever.
    const codes = charged.data.result.lines.map((line) => line.chargeCode);
    for (const forbidden of [
      "tow_distance", "loading", "unloading", "delivery", "storage_days",
      "custody_handling", "recovery_hours", "release_fee",
    ]) {
      assert.equal(codes.includes(forbidden as never), false, `BYSTAND billed ${forbidden}`);
    }

    const pack = await buildBillingPack(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(pack.ok, pack.ok ? "" : pack.message);
    assert.equal(pack.data.job.workflowKey, "bystand");
    assert.equal(pack.data.job.destinationLabel, null, "a BYSTAND pack carried a destination");

    // Paused time is VISIBLE on the pack rather than quietly omitted.
    assert.ok(
      pack.data.facts.some((fact) => fact.factCode === "paused_time"),
      "paused time is not shown on the pack"
    );
    // And it carries the Phase 2 calculator version that sealed it.
    const standing = pack.data.facts.find((fact) => fact.factCode === "standing_time");
    assert.ok(standing);
    assert.equal(standing.source, "sealed_summary");
    assert.equal(standing.calculationVersion, "rr-standby-1.0.0");
  });
});

// ---------------------------------------------------------------------------
// E2E 3 — STORAGE
// ---------------------------------------------------------------------------

describeIf("Phase 5 — E2E 3: STORAGE", () => {
  it("consumes the SEALED accrual without recalculating duration", async () => {
    priceCard("storage", { storage_days: 350, release_fee: 250 });

    const job = await createJob("storage", "E2E storage billing", false);
    authorise(job.serviceJobId, "storage");
    recordGpsArrival(job.fieldJobId);

    for (const toState of ["checked_in", "stored"]) {
      const result = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId: job.serviceJobId,
        toState,
      });
      assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
    }

    // A sealed Phase 4 accrual: 6 elapsed days, 5 chargeable after the yard's own free day.
    const booking = owner.sql(
      `INSERT INTO public.rr_storage_bookings
         (company_id, service_job_id, yard_id, rate_basis, rate_amount, free_days, status,
          checked_in_at, checked_out_at)
       VALUES ('${ALPHA}', '${job.serviceJobId}', '${YARD}', 'per_day', 350, 1, 'checked_out',
         now() - interval '6 days', now())
       RETURNING id`
    );
    const bookingId = String((booking[0] as { id: string }).id);

    owner.sql(
      `INSERT INTO public.rr_storage_accrual
         (company_id, service_job_id, booking_id, sealed_reason, period_start, period_end,
          chargeable_days, free_days_applied, elapsed_days, rate_basis, rate_amount,
          billable_units, amount, calculator_version, sealed_by)
       VALUES ('${ALPHA}', '${job.serviceJobId}', '${bookingId}', 'check_out',
         now() - interval '6 days', now(), 5, 1, 6, 'per_day', 350, 5, 1750,
         'rr-storage-accrual-1.0.0', '${CONTROLLER}')
       RETURNING id`
    );

    const derived = await deriveSealedFacts(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(derived.ok, derived.ok ? "" : derived.message);
    assert.ok(derived.data.derived.includes("storage_days"));

    // The fact carries the SEALED calculator version and points at the sealed row.
    const facts = owner.sql(
      `SELECT quantity, source, source_ref, calculation_version FROM public.rr_billable_facts
        WHERE service_job_id='${job.serviceJobId}' AND fact_code='storage_days'`
    ) as Record<string, unknown>[];
    assert.equal(facts.length, 1);
    assert.equal(Number(facts[0].quantity), 6, "storage duration was recalculated, not read");
    assert.equal(String(facts[0].source), "sealed_summary");
    assert.equal(String(facts[0].calculation_version), "rr-storage-accrual-1.0.0");

    await recordBillableFact(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      factCode: "callout",
      quantity: 1,
      unit: "each",
      source: "system",
    });

    await freezeBillableFacts(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });
    await resolveAndFreezeRateCard(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });

    const charged = await calculateAndSealCharges(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(charged.ok, charged.ok ? "" : charged.message);

    // 6 elapsed days, the CONTRACT's grace day deducted by the rate card = 5 charged.
    const storageLine = charged.data.result.lines.find((line) => line.chargeCode === "storage_days");
    assert.ok(storageLine, "no storage line was produced");
    assert.equal(storageLine.quantity, 6);
    assert.equal(storageLine.chargeableQuantity, 5);
    assert.equal(storageLine.subtotalExVat, 1750);

    const pack = await buildBillingPack(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(pack.ok, pack.ok ? "" : pack.message);
    const packFact = pack.data.facts.find((fact) => fact.factCode === "storage_days");
    assert.ok(packFact);
    assert.equal(packFact.calculationVersion, "rr-storage-accrual-1.0.0");
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE PATHS
// ---------------------------------------------------------------------------

describeIf("Phase 5 — a gap always BLOCKS", () => {
  it("MISSING RATE -> BLOCKED", async () => {
    // vehicle_movement is left with the shipped zero rates.
    const job = await createJob("vehicle_movement", "Missing rate");
    authorise(job.serviceJobId, "vehicle_movement");

    await recordBillableFact(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      factCode: "tow_distance",
      quantity: 30,
      unit: "km",
      source: "manual",
    });
    await freezeBillableFacts(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });
    await resolveAndFreezeRateCard(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });

    const charged = await calculateAndSealCharges(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(charged.ok, charged.ok ? "" : charged.message);
    // A zero rate is NOT a free tow.
    assert.notEqual(charged.data.result.status, "calculated");

    const readiness = await evaluateBillingReadiness(db as never, { companyId: ALPHA, serviceJobId: job.serviceJobId });
    assert.ok(readiness.ok, readiness.ok ? "" : readiness.message);
    assert.equal(readiness.data.ready, false);
    assert.ok(readiness.data.gates.find((gate) => gate.gate === "charges_calculated" && !gate.ok));
  });

  it("MISSING EVIDENCE -> BLOCKED", async () => {
    priceCard("tow_in", { callout: 650, tow_distance: 22 });
    const job = await createJob("tow_in", "Missing evidence");
    authorise(job.serviceJobId, "tow_in");

    const readiness = await evaluateBillingReadiness(db as never, { companyId: ALPHA, serviceJobId: job.serviceJobId });
    assert.ok(readiness.ok, readiness.ok ? "" : readiness.message);
    assert.equal(readiness.data.ready, false);
    const gate = readiness.data.gates.find((entry) => entry.gate === "evidence_complete");
    assert.ok(gate);
    assert.equal(gate.ok, false);
  });

  it("EXPIRED AUTHORISATION -> BLOCKED", async () => {
    const job = await createJob("tow_in", "Expired authorisation");
    owner.sql(
      `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
         authorisation_number, authorised_service_code, expires_at)
       VALUES ('${ALPHA}', '${job.serviceJobId}', '${COUNTERPARTY}', 'AUTH-${suffix()}',
         'tow_in', now() - interval '10 days')
       RETURNING id`
    );

    const readiness = await evaluateBillingReadiness(db as never, { companyId: ALPHA, serviceJobId: job.serviceJobId });
    assert.ok(readiness.ok, readiness.ok ? "" : readiness.message);
    const gate = readiness.data.gates.find((entry) => entry.gate === "authorisation_valid");
    assert.ok(gate);
    assert.equal(gate.ok, false);
    assert.match(gate.detail, /expired/i);
  });

  it("DISTANCE OUTSIDE TOLERANCE -> DISPUTED_DISTANCE, and the driver's fact stands", async () => {
    const job = await createJob("tow_in", "Disputed distance");
    // A dispatch estimate of 10 km against a captured 42 km — far outside tolerance.
    owner.sql(
      `INSERT INTO public.rr_dispatch_candidates
         (company_id, service_job_id, evaluation_id, employee_id, eligible, distance_km, engine_version)
       VALUES ('${ALPHA}', '${job.serviceJobId}', gen_random_uuid(),
         'd0000000-0000-4000-8000-00000000000a', true, 10, 'rr-dispatch-1.0.0')
       RETURNING id`
    );

    const odometer = await recordOdometerCapture(db as never, {
      companyId: ALPHA,
      actorEmail: "driver.a@alpha.test",
      serviceJobId: job.serviceJobId,
      odometerStartKm: 200000,
      odometerEndKm: 200042,
    });
    assert.ok(odometer.ok, odometer.ok ? "" : odometer.message);
    assert.equal(odometer.data.queried, true, "a 320% variance was not queried");
    assert.ok(odometer.data.disputeId, "no dispute was raised");

    // The DRIVER'S reading is what was recorded — unaltered.
    assert.equal(odometer.data.distanceKm, 42);
    const facts = owner.sql(
      `SELECT quantity, source_detail FROM public.rr_billable_facts
        WHERE service_job_id='${job.serviceJobId}' AND fact_code='tow_distance'`
    ) as Record<string, unknown>[];
    assert.equal(Number(facts[0].quantity), 42, "the driver's distance was overwritten");

    // And the exception blocks billing.
    const readiness = await evaluateBillingReadiness(db as never, { companyId: ALPHA, serviceJobId: job.serviceJobId });
    assert.ok(readiness.ok, readiness.ok ? "" : readiness.message);
    const gate = readiness.data.gates.find((entry) => entry.gate === "no_blocking_exceptions");
    assert.ok(gate);
    assert.equal(gate.ok, false);
    assert.match(gate.detail, /disputed distance/i);
  });

  it("CONFLICTING RATE -> BLOCKED, never a guess", async () => {
    const job = await createJob("jump_start", "Conflicting rate");
    // A second, equally specific active card for the same service.
    owner.sql(
      `INSERT INTO public.rr_rate_cards (company_id, policy_key, service_code, version, active, vat_rate)
       VALUES ('${ALPHA}', 'rival_rate_jump_start', 'jump_start', 1, true, 0.15)
       RETURNING id`
    );

    const rate = await resolveAndFreezeRateCard(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(rate.ok, rate.ok ? "" : rate.message);
    assert.equal(rate.data.conflicted, true);
    assert.equal(rate.data.snapshotId, null, "a conflicted resolution froze a rate card anyway");
    assert.match(rate.data.reason, /Resolve the conflict/);

    // Clean up so the conflict does not leak into other tests.
    owner.exec(`DELETE FROM public.rr_rate_cards WHERE policy_key = 'rival_rate_jump_start'`);
  });

  it("INCOMPLETE BILLING INFORMATION -> BLOCKED", async () => {
    const job = await createJob("tow_in", "Incomplete information");
    await raiseBillingException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      exceptionCode: "incomplete_billing_information",
      severity: "high",
      detail: "The counterparty reference is missing.",
    });

    const readiness = await evaluateBillingReadiness(db as never, { companyId: ALPHA, serviceJobId: job.serviceJobId });
    assert.ok(readiness.ok, readiness.ok ? "" : readiness.message);
    assert.equal(readiness.data.ready, false);
    assert.ok(readiness.data.blockingReasons.some((reason) => /incomplete billing information/i.test(reason)));
  });

  it("a high-severity billing exception escalates through the EXISTING action queue", async () => {
    const job = await createJob("tow_in", "Escalated billing exception");
    const raised = await raiseBillingException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      exceptionCode: "authorisation_exceeded",
      severity: "critical",
      detail: "The expected charge exceeds the authorised amount.",
    });
    assert.ok(raised.ok, raised.ok ? "" : raised.message);

    const rows = owner.sql(
      `SELECT e.automation_action_id, a.action_type, a.status, a.source_module
         FROM public.rr_billing_exceptions e
         JOIN public.workforce_automation_actions a ON a.id = e.automation_action_id
        WHERE e.id = '${raised.data.exceptionId}'`
    ) as Record<string, unknown>[];
    assert.equal(rows.length, 1, "the exception did not reach the existing action queue");
    assert.equal(String(rows[0].action_type), "Escalate Exception");
    assert.equal(String(rows[0].status), "Pending Approval");
    assert.equal(String(rows[0].source_module), "Road & Recovery Billing");
  });
});

// ---------------------------------------------------------------------------
// IMMUTABILITY
// ---------------------------------------------------------------------------

describeIf("Phase 5 — sealed information cannot be rewritten", () => {
  it("ATTEMPT TO MODIFY A SEALED CHARGE -> REFUSED", async () => {
    priceCard("roadside_assistance", { callout: 500 });
    const job = await createJob("roadside_assistance", "Sealed charge");
    await recordBillableFact(db as never, {
      companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId,
      factCode: "callout", quantity: 1, unit: "each", source: "system",
    });
    await freezeBillableFacts(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });
    await resolveAndFreezeRateCard(db as never, { companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId });
    const charged = await calculateAndSealCharges(db as never, {
      companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId,
    });
    assert.ok(charged.ok, charged.ok ? "" : charged.message);

    assert.throws(
      () => owner.exec(`UPDATE public.rr_charge_calculations SET total_incl_vat = 1 WHERE id = '${charged.data.calculationId}'`),
      /sealed append-only/i
    );
    assert.throws(
      () => owner.exec(`UPDATE public.rr_charge_lines SET subtotal_ex_vat = 1 WHERE calculation_id = '${charged.data.calculationId}'`),
      /sealed calculation/i
    );
    assert.throws(
      () => owner.exec(`DELETE FROM public.rr_charge_calculations WHERE id = '${charged.data.calculationId}'`),
      /sealed append-only/i
    );
  });

  it("ATTEMPT TO MODIFY A HISTORICAL RATE SNAPSHOT -> REFUSED", async () => {
    const job = await createJob("tow_in", "Snapshot immutability");
    const rate = await resolveAndFreezeRateCard(db as never, {
      companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId,
    });
    assert.ok(rate.ok, rate.ok ? "" : rate.message);

    assert.throws(
      () => owner.exec(`UPDATE public.rr_job_rate_snapshot SET vat_rate = 0.99 WHERE id = '${rate.data.snapshotId}'`),
      /immutable per-job rate snapshot/i
    );
  });

  it("ATTEMPT TO OVERWRITE THE DRIVER'S DISTANCE -> REFUSED", async () => {
    const job = await createJob("tow_in", "Driver distance immutability");
    const odometer = await recordOdometerCapture(db as never, {
      companyId: ALPHA,
      actorEmail: "driver.a@alpha.test",
      serviceJobId: job.serviceJobId,
      odometerStartKm: 300000,
      odometerEndKm: 300055,
    });
    assert.ok(odometer.ok, odometer.ok ? "" : odometer.message);

    assert.throws(
      () => owner.exec(`UPDATE public.rr_billable_facts SET quantity = 5 WHERE id = '${odometer.data.factId}'`),
      /cannot be altered/i
    );
    assert.throws(
      () => owner.exec(`DELETE FROM public.rr_billable_facts WHERE id = '${odometer.data.factId}'`),
      /append-only/i
    );

    // A CORRECTION is a new fact that supersedes; the original survives intact.
    const corrected = await recordBillableFact(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      factCode: "tow_distance",
      quantity: 50,
      unit: "km",
      source: "manual",
      notes: "Controller review: odometer misread.",
      supersedesFactId: odometer.data.factId,
    });
    assert.ok(corrected.ok, corrected.ok ? "" : corrected.message);

    const rows = owner.sql(
      `SELECT quantity, status, superseded_by FROM public.rr_billable_facts
        WHERE service_job_id='${job.serviceJobId}' AND fact_code='tow_distance'
        ORDER BY recorded_at`
    ) as Record<string, unknown>[];
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].quantity), 55, "the driver's original reading was lost");
    assert.equal(String(rows[0].status), "superseded");
    assert.ok(rows[0].superseded_by, "the superseded fact does not point at its replacement");
    assert.equal(Number(rows[1].quantity), 50);
  });

  it("a republished rate card cannot re-price a job already priced", async () => {
    priceCard("heavy_recovery", { callout: 1000, recovery_hours: 900 });
    const job = await createJob("heavy_recovery", "Frozen pricing");

    const first = await resolveAndFreezeRateCard(db as never, {
      companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId,
    });
    assert.ok(first.ok, first.ok ? "" : first.message);

    // The operator doubles their rates afterwards.
    priceCard("heavy_recovery", { callout: 2000, recovery_hours: 1800 });

    const second = await resolveAndFreezeRateCard(db as never, {
      companyId: ALPHA, actorEmail: CONTROLLER, serviceJobId: job.serviceJobId,
    });
    assert.ok(second.ok, second.ok ? "" : second.message);
    assert.equal(second.data.snapshotId, first.data.snapshotId, "the job was re-priced");

    const snapshot = owner.sql(
      `SELECT items FROM public.rr_job_rate_snapshot WHERE id='${first.data.snapshotId}'`
    ) as Record<string, unknown>[];
    const items = snapshot[0].items as Record<string, unknown>[];
    const callout = items.find((item) => String(item.charge_code) === "callout");
    assert.ok(callout);
    assert.equal(Number(callout.rate_amount), 1000, "the frozen snapshot moved with the rate card");
  });
});

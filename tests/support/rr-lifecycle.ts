/**
 * VYRON CORE — Road & Recovery lifecycle seeder (Phase 7).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * Several Phase 5 suites asserted against data they did not create. They passed only
 * because another suite happened to have run first and left the right rows behind — and
 * node runs test FILES IN PARALLEL, so "first" was never guaranteed. The moment the
 * harness built a clean database, four of those assertions failed: not because the product
 * was broken, but because the tests had no fixtures of their own.
 *
 * This module gives them fixtures. It drives a job through the REAL SERVICE LAYER — the
 * same functions the API routes call — so seeding a fixture exercises job creation, the
 * state machine, the guards, evidence linking, custody, storage, sealing and charging
 * rather than bypassing them with INSERTs.
 *
 * That distinction matters: a fixture built with raw INSERTs would let a broken
 * createServiceJob() or a broken guard pass unnoticed, which is precisely the failure
 * mode a regression net is supposed to prevent.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It creates no invoice, no payment and no ledger entry, because VYRON CORE has none.
 * The furthest it goes is a SEALED EXPECTED CHARGE and a Billing Information Pack, which
 * is where VYRON CORE stops and VYRON FINANCE begins.
 */

import assert from "node:assert/strict";
import type { PgTestClient } from "./pg-query-transport";

export const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
export const BRAVO = "bbbbbbbb-0000-4000-8000-000000000002";
export const ALPHA_CONTROLLER = "controller@alpha.test";
export const BRAVO_CONTROLLER = "controller@bravo.test";
export const THANDI = "d0000000-0000-4000-8000-00000000000a";
export const SIPHO_NO_CERT = "d0000000-0000-4000-8000-00000000000b";
export const LERATO_EXPIRED = "d0000000-0000-4000-8000-00000000000c";
export const ALPHA_TRUCK = "40000000-0000-4000-8000-00000000000a";
export const ALPHA_TRUCK_OOS = "40000000-0000-4000-8000-00000000000b";
export const ALPHA_TRUCK_LIGHT = "40000000-0000-4000-8000-00000000000c";
export const ASSISTANCE_PROVIDER = "c0000000-0000-4000-8000-00000000000a";
export const INSURER = "c0000000-0000-4000-8000-00000000000b";
export const FLEET_CLIENT = "c0000000-0000-4000-8000-00000000000c";
export const YARD = "11110000-0000-4000-8000-00000000aaaa";

/** The full tow workflow, in order. Used to drive a job to completion. */
export const TOW_STATES = [
  "authorisation_pending", "authorised", "dispatch_pending", "assigned", "accepted",
  "en_route", "on_scene", "assessing", "loading", "secured", "departing_scene",
  "in_transit", "arrived_destination", "offloading", "handover_pending", "handed_over",
  "paperwork_complete", "evidence_complete",
] as const;

export function suffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Puts real rates on the shipped rate card so a job can actually be priced.
 *
 * The cards sql/078 seeds carry ZERO rates by design: VYRON CORE does not invent a
 * customer's commercial pricing. A test that wants a priced job therefore has to state
 * the prices, exactly as an operator would.
 */
export function priceCard(
  owner: PgTestClient,
  serviceCode: string,
  rates: Record<string, number>,
  companyId = ALPHA
): void {
  for (const [chargeCode, amount] of Object.entries(rates)) {
    owner.exec(
      `UPDATE public.rr_rate_card_items i
          SET rate_amount = ${amount}
         FROM public.rr_rate_cards c
        WHERE i.rate_card_id = c.id
          AND i.company_id = '${companyId}'
          AND c.service_code = '${serviceCode}'
          AND i.charge_code = '${chargeCode}'`
    );
  }
}

export function authorise(
  owner: PgTestClient,
  input: {
    serviceJobId: string;
    serviceCode: string;
    amount?: number | null;
    counterpartyId?: string;
    companyId?: string;
  }
): void {
  const company = input.companyId ?? ALPHA;
  const counterparty = input.counterpartyId ?? ASSISTANCE_PROVIDER;
  owner.sql(
    `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
       authorisation_number, claim_reference, po_number, authorised_service_code, authorised_amount)
     VALUES ('${company}', '${input.serviceJobId}', '${counterparty}', 'AUTH-${suffix()}',
       'CLM-${suffix()}', 'PO-${suffix()}', '${input.serviceCode}',
       ${input.amount === null || input.amount === undefined ? "NULL" : input.amount})
     RETURNING id`
  );
}

export async function createJob(
  db: PgTestClient,
  input: {
    serviceCode: string;
    title: string;
    withDestination?: boolean;
    counterpartyId?: string;
    companyId?: string;
    actorEmail?: string;
  }
): Promise<{ serviceJobId: string; fieldJobId: string }> {
  const { createServiceJob } = await import("@/lib/road-recovery/job-service");
  const created = await createServiceJob(db as never, {
    companyId: input.companyId ?? ALPHA,
    actorEmail: input.actorEmail ?? ALPHA_CONTROLLER,
    serviceCode: input.serviceCode,
    title: input.title,
    counterpartyId: input.counterpartyId ?? ASSISTANCE_PROVIDER,
    originLabel: "N1 northbound",
    originLatitude: -33.9249,
    originLongitude: 18.4241,
    ...(input.withDestination !== false
      ? {
          destinationLabel: "Alpha Main Yard",
          destinationAddress: "14 Recovery Road, Epping",
          destinationType: "storage_yard",
        }
      : {}),
    vehicleRegistration: `CA ${suffix()}`,
  });
  assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
  return created.data as { serviceJobId: string; fieldJobId: string };
}

/** GPS-verified arrival, which satisfies the gps_arrival requirement. */
export function recordGpsArrival(owner: PgTestClient, fieldJobId: string, companyId = ALPHA): void {
  owner.sql(
    `INSERT INTO public.mobile_gps_validations
       (company_id, employee_id, job_id, reference_type,
        employee_latitude, employee_longitude, site_latitude, site_longitude,
        radius_meters, distance_meters, inside_radius)
     VALUES ('${companyId}', '${THANDI}', '${fieldJobId}',
       'arrive_site', -33.9255, 18.4243, -33.9249, 18.4241, 200, 70, true)
     RETURNING id`
  );
}

/** Satisfies every blocking invoice-scope requirement so the Phase 3 evidence gate passes. */
export async function satisfyEvidence(
  db: PgTestClient,
  owner: PgTestClient,
  input: { serviceJobId: string; fieldJobId: string; companyId?: string; actorEmail?: string }
): Promise<void> {
  const company = input.companyId ?? ALPHA;
  const actor = input.actorEmail ?? ALPHA_CONTROLLER;
  const { evaluateJobCompliance, linkEvidenceToRequirements } = await import(
    "@/lib/road-recovery/requirements-service"
  );

  const compliance = await evaluateJobCompliance(db as never, {
    companyId: company,
    serviceJobId: input.serviceJobId,
  });
  assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);

  for (const result of compliance.data.compliance.results) {
    if (!result.blocking) continue;
    // GPS and authorisation are satisfied by their own records, not by an uploaded file.
    if (result.evidenceKind === "gps" || result.evidenceKind === "authorisation") continue;

    const needed = Math.max(1, result.minCount - result.capturedCount);
    for (let index = 0; index < needed; index += 1) {
      const rows = owner.sql(
        `INSERT INTO public.mobile_workforce_evidence
           (company_id, employee_id, job_id, service_job_id, evidence_type,
            storage_bucket, storage_path, captured_by_role)
         VALUES ('${company}', '${THANDI}', '${input.fieldJobId}',
           '${input.serviceJobId}', 'other', 'rr-evidence',
           '${company}/${input.serviceJobId}/${suffix()}.jpg', 'driver')
         RETURNING id`
      );
      const linked = await linkEvidenceToRequirements(db as never, {
        companyId: company,
        actorEmail: actor,
        serviceJobId: input.serviceJobId,
        evidenceId: String((rows[0] as { id: string }).id),
        requirementCodes: [result.requirementCode],
      });
      assert.ok(linked.ok, linked.ok ? "" : linked.message);
    }
  }
}

/**
 * Drives a job to a target state, following ITS OWN published workflow.
 *
 * The six Road & Recovery workflows do not share a state list — a heavy recovery has
 * `rigging` and `recovery_in_progress` where a tow-in has `assessing` and `loading`.
 * Hardcoding one path made the seeder silently tow-in-only, and it failed the moment a
 * heavy recovery was seeded.
 *
 * The route is computed from the workflow definition in the database, which is the same
 * definition the state machine enforces, so this can never walk a path the product would
 * refuse. Each hop is a real transitionServiceJob() call, guards and all.
 */
export async function driveToState(
  db: PgTestClient,
  owner: PgTestClient,
  input: {
    serviceJobId: string;
    target: string;
    companyId?: string;
    actorEmail?: string;
    /**
     * Guards this fixture has actually satisfied.
     *
     * Defaults to `authorisation_valid`, because every seeded job is authorised before it
     * is driven. Anything not listed here is treated as unsatisfiable and its transitions
     * are routed around rather than attempted and refused.
     */
    satisfiableGuards?: readonly string[];
  }
): Promise<void> {
  const company = input.companyId ?? ALPHA;
  const actor = input.actorEmail ?? ALPHA_CONTROLLER;
  const satisfiable = new Set(input.satisfiableGuards ?? ["authorisation_valid"]);

  const jobRows = owner.sql(
    `SELECT service_state, workflow_key, workflow_version
       FROM public.rr_service_jobs WHERE company_id = '${company}' AND id = '${input.serviceJobId}'`
  );
  assert.equal(jobRows.length, 1, "job not found while planning its route");
  const job = jobRows[0] as { service_state: string; workflow_key: string; workflow_version: number };

  const edgeRows = owner.sql(
    `SELECT t->>'from' AS "from", t->>'to' AS "to",
            COALESCE(t->'guards', '[]'::jsonb)::text AS guards
       FROM public.rr_workflow_definitions d, LATERAL jsonb_array_elements(d.definition->'transitions') AS t
      WHERE d.company_id = '${company}'
        AND d.workflow_key = '${job.workflow_key}'
        AND d.version = ${job.workflow_version}`
  ) as Array<{ from: string; to: string; guards: string }>;

  // Breadth-first, so the route taken is the SHORTEST legal one.
  //
  // Two kinds of edge are excluded, both deliberately:
  //
  //   A wildcard `from` is a cancellation edge. It "reaches" any state by cancelling the
  //   job, which is not the journey a fixture wants.
  //
  //   A transition guarded by something this fixture cannot satisfy. Guards FAIL CLOSED,
  //   so routing through one produces a refusal rather than a shortcut — the shortest
  //   path from `logged` runs through `skip_authorisation`, which is guarded by
  //   `authorisation_not_required` and is false for a job that was authorised. Excluding
  //   it makes the planner take the authorised route, which is the one the fixture set up.
  const edges = new Map<string, string[]>();
  for (const edge of edgeRows) {
    if (edge.from === "*") continue;
    const guards = JSON.parse(edge.guards || "[]") as string[];
    if (guards.some((guard) => !satisfiable.has(guard))) continue;
    const bucket = edges.get(edge.from);
    if (bucket) bucket.push(edge.to);
    else edges.set(edge.from, [edge.to]);
  }

  const previous = new Map<string, string>();
  const queue = [job.service_state];
  const seen = new Set([job.service_state]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === input.target) break;
    for (const next of edges.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      queue.push(next);
    }
  }

  assert.ok(
    seen.has(input.target),
    `no route from "${job.service_state}" to "${input.target}" in workflow "${job.workflow_key}"`
  );

  const route: string[] = [];
  for (let step = input.target; step !== job.service_state; step = previous.get(step) as string) {
    route.unshift(step);
  }

  const { transitionServiceJob } = await import("@/lib/road-recovery/job-service");
  for (const toState of route) {
    const result = await transitionServiceJob(db as never, {
      companyId: company,
      actorEmail: actor,
      serviceJobId: input.serviceJobId,
      toState,
      reason: "Phase 7 lifecycle fixture",
    });
    assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
  }
}

/** Drives a job to evidence_complete along its own workflow. */
export async function driveTow(
  db: PgTestClient,
  owner: PgTestClient,
  input: { serviceJobId: string; companyId?: string; actorEmail?: string }
): Promise<void> {
  await driveToState(db, owner, { ...input, target: "evidence_complete" });
}

export type SeededTow = {
  serviceJobId: string;
  fieldJobId: string;
  calculationId: string | null;
};

/**
 * A complete, billable tow job.
 *
 * CREATE -> AUTHORISE -> DRIVE -> GPS ARRIVAL -> EVIDENCE -> COMPLIANCE -> ODOMETER
 * -> FACTS -> RATE -> SEALED CHARGES.
 *
 * `odometerKm` drives the distance the driver captured. Passing a value far from the
 * dispatch estimate is how a test produces an out-of-tolerance capture, which is a real
 * operational event rather than something forced into the database.
 */
export async function seedBillableTow(
  db: PgTestClient,
  owner: PgTestClient,
  input: {
    title: string;
    serviceCode?: string;
    odometerStartKm?: number;
    odometerEndKm?: number;
    counterpartyId?: string;
    authorisedAmount?: number | null;
  }
): Promise<SeededTow> {
  const serviceCode = input.serviceCode ?? "tow_in";

  const job = await createJob(db, {
    serviceCode,
    title: input.title,
    counterpartyId: input.counterpartyId,
  });

  authorise(owner, {
    serviceJobId: job.serviceJobId,
    serviceCode,
    amount: input.authorisedAmount ?? null,
    counterpartyId: input.counterpartyId,
  });

  // A real dispatch evaluation, so the job carries a dispatch distance ESTIMATE. Without
  // one, recordOdometerCapture() has nothing to compare the driver's capture against and
  // can never flag a variance — which is the condition several reports exist to surface.
  const { evaluateAndPersistCandidates } = await import("@/lib/road-recovery/dispatch-data");
  const evaluated = await evaluateAndPersistCandidates(db as never, {
    companyId: ALPHA,
    serviceJobId: job.serviceJobId,
    evaluatedBy: ALPHA_CONTROLLER,
    evaluatedAt: new Date().toISOString(),
    evaluationId: crypto.randomUUID(),
  });
  assert.equal(evaluated.error, null, `dispatch evaluation failed: ${evaluated.error}`);

  recordGpsArrival(owner, job.fieldJobId);
  await driveTow(db, owner, { serviceJobId: job.serviceJobId });
  await satisfyEvidence(db, owner, {
    serviceJobId: job.serviceJobId,
    fieldJobId: job.fieldJobId,
  });

  const {
    calculateAndSealCharges,
    deriveSealedFacts,
    freezeBillableFacts,
    recordOdometerCapture,
    resolveAndFreezeRateCard,
  } = await import("@/lib/road-recovery/billing-service");

  const odometer = await recordOdometerCapture(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
    odometerStartKm: input.odometerStartKm ?? 100_000,
    odometerEndKm: input.odometerEndKm ?? 100_042,
    vehicleId: ALPHA_TRUCK,
    latitude: -33.9249,
    longitude: 18.4241,
    notes: "Roadside capture",
  });
  assert.ok(odometer.ok, odometer.ok ? "" : `odometer capture failed: ${odometer.message}`);

  await deriveSealedFacts(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
  });
  await freezeBillableFacts(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
  });

  const rate = await resolveAndFreezeRateCard(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
  });
  assert.ok(rate.ok, rate.ok ? "" : `rate resolution failed: ${rate.message}`);

  const charged = await calculateAndSealCharges(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
  });
  assert.ok(charged.ok, charged.ok ? "" : `charge calculation failed: ${charged.message}`);

  return {
    serviceJobId: job.serviceJobId,
    fieldJobId: job.fieldJobId,
    calculationId: charged.ok ? charged.data.calculationId : null,
  };
}

/**
 * A storage job that has been taken into custody, stored, and had its accrual SEALED.
 *
 * The accrual is sealed by checking the vehicle out, which is the only path that produces
 * one. Sealing it any other way would mean the storage report was reading a row the
 * product never actually writes.
 */
/**
 * A storage job taken into custody, stored, released, and with its accrual SEALED.
 *
 * The storage SERVICES drive the workflow transitions themselves — checking a vehicle in
 * moves the job to `stored`, checking it out moves it through release. Driving those
 * transitions by hand here would test a sequence the product never performs.
 *
 * The accrual is sealed by the check-OUT, which is the only path that produces one.
 */
export async function seedSealedStorage(
  db: PgTestClient,
  owner: PgTestClient,
  input: { title: string; daysHeld?: number }
): Promise<{ serviceJobId: string; fieldJobId: string; bookingId: string | null }> {
  const days = input.daysHeld ?? 6;

  const job = await createJob(db, {
    serviceCode: "storage",
    title: input.title,
    withDestination: true,
  });

  const { recordCustodyEvent } = await import("@/lib/road-recovery/custody-service");
  const { checkVehicleIntoStorage, checkVehicleOutOfStorage } = await import(
    "@/lib/road-recovery/storage-service"
  );
  const { recordReleaseAuthority, verifyReleaseAuthority } = await import(
    "@/lib/road-recovery/release-service"
  );

  const taken = await recordCustodyEvent(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
    eventType: "taken",
    holderType: "operator",
    holderName: "Alpha Recovery",
    locationLabel: "N1 northbound",
    latitude: -33.9249,
    longitude: 18.4241,
  });
  assert.ok(taken.ok, taken.ok ? "" : `custody take failed: ${taken.message}`);

  const checkedIn = await checkVehicleIntoStorage(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
    yardId: YARD,
    bayReference: `BAY-${suffix()}`,
    rateBasis: "per_day",
    rateAmount: 150,
    freeDays: 1,
    storageCondition: "outdoor",
  });
  assert.ok(checkedIn.ok, checkedIn.ok ? "" : `check-in failed: ${checkedIn.message}`);
  const bookingId = checkedIn.ok ? (checkedIn.data as { bookingId: string }).bookingId : null;

  // Back-date the check-in so a real number of days has elapsed. The storage clock is
  // server-stamped, so this is the only honest way to age an occupancy without waiting.
  //
  // The hour of slack matters: the accrual rounds a part-day UP, so checking out a moment
  // after a whole number of days would elapse `days + epsilon` and seal `days + 1`.
  if (bookingId) {
    owner.exec(
      `UPDATE public.rr_storage_bookings
          SET checked_in_at = now() - interval '${days} days' + interval '1 hour'
        WHERE company_id = '${ALPHA}' AND id = '${bookingId}'`
    );
  }

  const authority = await recordReleaseAuthority(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
    authorityType: "release",
    authorityParty: "owner",
    authorityPartyName: "M. Petersen",
    authorityReference: `REL-${suffix()}`,
    collectorName: "M. Petersen",
    collectorIdNumber: "8801015000087",
    collectorCapacity: "owner",
  });
  assert.ok(authority.ok, authority.ok ? "" : `release authority failed: ${authority.message}`);

  const verified = await verifyReleaseAuthority(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    authorityId: authority.ok ? (authority.data as { authorityId: string }).authorityId : "",
    verificationMethod: "identity_document",
  });
  assert.ok(verified.ok, verified.ok ? "" : `authority verification failed: ${verified.message}`);

  // The release SCOPE has its own evidence requirements, and the guard fails closed.
  await satisfyReleaseEvidence(db, owner, {
    serviceJobId: job.serviceJobId,
    fieldJobId: job.fieldJobId,
  });

  // Checking out is what SEALS the accrual.
  const checkedOut = await checkVehicleOutOfStorage(db as never, {
    companyId: ALPHA,
    actorEmail: ALPHA_CONTROLLER,
    serviceJobId: job.serviceJobId,
    collectorName: "M. Petersen",
    collectorCapacity: "owner",
    collectorIdNumber: "8801015000087",
    conditionOnDeparture: "unchanged",
  });
  assert.ok(checkedOut.ok, checkedOut.ok ? "" : `check-out failed: ${checkedOut.message}`);

  return { serviceJobId: job.serviceJobId, fieldJobId: job.fieldJobId, bookingId };
}

/** Satisfies the RELEASE-scope evidence requirements, which are separate from invoice scope. */
export async function satisfyReleaseEvidence(
  db: PgTestClient,
  owner: PgTestClient,
  input: { serviceJobId: string; fieldJobId: string }
): Promise<void> {
  const { evaluateJobCompliance, linkEvidenceToRequirements } = await import(
    "@/lib/road-recovery/requirements-service"
  );

  const compliance = await evaluateJobCompliance(db as never, {
    companyId: ALPHA,
    serviceJobId: input.serviceJobId,
    scope: "release",
  });
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
         VALUES ('${ALPHA}', '${THANDI}', '${input.fieldJobId}',
           '${input.serviceJobId}', 'other', 'rr-evidence',
           '${ALPHA}/${input.serviceJobId}/${suffix()}.jpg', 'driver')
         RETURNING id`
      );
      const linked = await linkEvidenceToRequirements(db as never, {
        companyId: ALPHA,
        actorEmail: ALPHA_CONTROLLER,
        serviceJobId: input.serviceJobId,
        evidenceId: String((rows[0] as { id: string }).id),
        requirementCodes: [result.requirementCode],
      });
      assert.ok(linked.ok, linked.ok ? "" : linked.message);
    }
  }
}

/**
 * A BYSTAND attendance with a SEALED standby summary.
 *
 * The attendance itself is driven through the real workflow, so the state machine, the
 * BYSTAND v2 transitions and the stand-down path are all exercised.
 *
 * The SUMMARY, however, is inserted with explicit figures rather than being produced by
 * sealStandbySummary(). That is deliberate, and worth explaining:
 *
 *   * A test drives a job in milliseconds, so a genuinely-driven attendance accrues
 *     almost no standing time and cannot produce the multi-hour figures a report test
 *     needs to assert against.
 *   * Back-dating the transition history is not an option and should not be: the state
 *     event log is APPEND-ONLY and its trigger refuses the UPDATE. That protection is
 *     load-bearing and stays.
 *   * `transitionServiceJob()` stamps `occurred_at` server-side on purpose, so a caller
 *     cannot backdate a transition. That is correct and stays too.
 *
 * The standby TIMER has its own dedicated coverage — the pure standby-timer suite and the
 * Phase 2 BYSTAND suite both drive it properly. What THIS fixture serves is the reports
 * suite, whose subject is whether a report reads a sealed summary correctly. Inserting
 * the sealed fact is legitimate for that: rr_standby_summary is an append-only fact
 * table, and INSERT is exactly the operation it exists to accept.
 */
export async function seedBystandAttendance(
  db: PgTestClient,
  owner: PgTestClient,
  input: { title: string; billableHours?: number; pausedHours?: number }
): Promise<{ serviceJobId: string; fieldJobId: string }> {
  const billableSeconds = Math.round((input.billableHours ?? 2.5) * 3600);
  const pausedSeconds = Math.round((input.pausedHours ?? 0.5) * 3600);

  const job = await createJob(db, {
    serviceCode: "bystand",
    title: input.title,
    withDestination: false,
  });

  authorise(owner, { serviceJobId: job.serviceJobId, serviceCode: "bystand" });
  recordGpsArrival(owner, job.fieldJobId);

  const { transitionServiceJob } = await import("@/lib/road-recovery/job-service");

  // The BYSTAND v2 path, exactly as the published workflow defines it. A stand-down is a
  // REQUEST followed by the stand-down itself, because somebody has to ask.
  for (const toState of [
    "bystand_requested", "authorisation_pending", "authorised", "assigned", "accepted",
    "en_route", "arrived_on_scene", "standing_by", "stand_down_requested", "stood_down",
  ]) {
    const moved = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState,
      ...(toState === "stand_down_requested" || toState === "stood_down"
        ? { reason: "Scene cleared by SAPS" }
        : {}),
    });
    assert.ok(moved.ok, moved.ok ? "" : `bystand transition to ${toState} failed: ${moved.message}`);
  }

  const { RR_STANDBY_CALCULATOR_VERSION } = await import("@/lib/road-recovery/standby-timer");

  owner.sql(
    `INSERT INTO public.rr_standby_summary
       (company_id, service_job_id, sealed_reason, sealed_by,
        total_billable_seconds, total_paused_seconds,
        standing_interval_count, paused_interval_count,
        first_standing_at, last_standing_ended_at,
        interval_breakdown, paused_breakdown, anomalies,
        time_to_scene_seconds, stand_down_response_seconds, calculator_version)
     VALUES ('${ALPHA}', '${job.serviceJobId}', 'stand_down', '${ALPHA_CONTROLLER}',
        ${billableSeconds}, ${pausedSeconds}, 1, ${pausedSeconds > 0 ? 1 : 0},
        now() - interval '3 hours', now(),
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        1800, 300, '${RR_STANDBY_CALCULATOR_VERSION}')
     RETURNING id`
  );

  return job;
}

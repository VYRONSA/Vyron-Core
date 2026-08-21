/**
 * REGRESSION — a finished job gives the driver and the truck back (DEF-02).
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS LOCKS DOWN
 * ---------------------------------------------------------------------------
 *
 * `rr_dispatch_assignments` has always permitted `completed` and `cancelled`, and nothing
 * ever wrote either one. acceptAssignment() set `accepted`, marked the truck `on_job`, and
 * no code path moved either on. Dispatch eligibility is computed from exactly
 * `assignment_status IN ('offered','accepted')` (lib/road-recovery/dispatch-data.ts), so
 * the consequence was permanent rather than temporary:
 *
 *     a driver who completed ONE job was reported "already committed to another job"
 *     for every dispatch afterwards, and their truck as "on job"
 *
 * With one truck and one certified driver — the shape of a small operator — the board
 * could dispatch nothing at all after the first job.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND WHY IN THIS ORDER
 * ---------------------------------------------------------------------------
 *
 * The test drives a REAL job to completion through the service layer and then asks the
 * REAL dispatch engine whether the driver is available again. Asserting the eligibility
 * answer rather than only the column values is deliberate: the column is the mechanism,
 * but "can this driver be dispatched" is the behaviour that was broken, and a future
 * change that keeps the column tidy while still reporting a conflict would be caught here.
 *
 * The cancellation case is asserted separately because it exercises a different branch:
 * `rr_dispatch_assignments_crew_row_check` refuses any status other than
 * accepted / completed / reassigned once acceptance has created the crew record, so an
 * accepted assignment on a CANCELLED job must still close as `completed`. Getting that
 * wrong fails the constraint and — because the release is best-effort by design — fails
 * silently, which is precisely the original defect wearing a different hat.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, before } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";

import {
  acceptAssignment,
  offerAssignment,
  transitionServiceJob,
} from "@/lib/road-recovery/job-service";

import {
  ALPHA,
  ALPHA_CONTROLLER,
  authorise,
  createJob,
  recordGpsArrival,
  satisfyEvidence,
} from "./support/rr-lifecycle";

const CONFIG = readTestDatabaseConfig();
const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Road & Recovery dispatch release", () => {
    it("skipped — no disposable database configured (set RR_TEST_PSQL / RR_TEST_DB)", () => {
      assert.ok(true);
    });
  });
}

describeIf("Road & Recovery — a finished job releases its driver and truck", () => {
  let db: PgTestClient;
  let owner: PgTestClient;

  before(() => {
    if (!CONFIG) return;
    db = createPgTestClient(CONFIG, { kind: "authenticated", email: ALPHA_CONTROLLER });
    owner = createPgTestClient(CONFIG, { kind: "owner" });
  });

  /**
   * A driver and a truck that belong to THIS suite alone.
   *
   * The shared fixtures give Alpha exactly one dispatchable driver (Thandi) and one
   * serviceable truck, and several suites compete for them. `node --test` runs test FILES
   * concurrently against one database, so a suite that frees "every live assignment" to
   * get a clean start pulls the driver out from under whichever suite is mid-dispatch —
   * and is pulled out from under in turn. Both failures look like the defect under test,
   * which is the worst possible way for a regression net to fail.
   *
   * Owning the fixtures removes the contention rather than managing it. The ids are fixed
   * and prefixed so they are recognisable in a database dump, and the driver carries the
   * same certifications Thandi does, because eligibility is what this suite asserts.
   */
  const DRIVER = "d0000000-0000-4000-8000-00000000dd01";
  const VEHICLE = "40000000-0000-4000-8000-00000000ee01";
  const PROFILE = "40000000-0000-4000-8000-00000000ff01";

  function seedOwnFleet(): void {
    owner.exec(
      `INSERT INTO public.employees (id, company_id, employee_number, first_name, last_name, active)
       VALUES ('${DRIVER}', '${ALPHA}', 'EMP-REL-1', 'Release', 'Regression', true)
       ON CONFLICT (id) DO UPDATE SET active = true`
    );
    for (const [suffix, type, blocks] of [
      ["01", "drivers_licence", "true"],
      ["02", "prdp", "true"],
      ["03", "recovery_competency", "false"],
    ] as const) {
      owner.exec(
        `INSERT INTO public.rr_driver_certifications
           (id, company_id, employee_id, certification_type, identifier, issuing_authority,
            issued_at, expires_at, blocks_dispatch, status)
         VALUES ('c1000000-0000-4000-8000-00000000cc${suffix}', '${ALPHA}', '${DRIVER}',
            '${type}', 'REL-${suffix}', 'DoT',
            now() - interval '1 year', now() + interval '3 years', ${blocks}, 'active')
         ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at, status = 'active'`
      );
    }
    owner.exec(
      `INSERT INTO public.field_vehicles
         (id, company_id, registration, make_model, status, vehicle_type, assigned_employee_id)
       VALUES ('${VEHICLE}', '${ALPHA}', 'CA REL-001', 'Isuzu FTR Flatbed', 'available',
               'heavy_commercial', '${DRIVER}')
       ON CONFLICT (id) DO UPDATE SET status = 'available', assigned_employee_id = EXCLUDED.assigned_employee_id`
    );
    owner.exec(
      `INSERT INTO public.rr_tow_truck_profiles
         (id, company_id, field_vehicle_id, tow_class, gvm_kg, payload_capacity_kg, carries_count,
          has_winch, winch_capacity_kg, has_boom, has_underlift, has_dollies,
          availability_status, operational_status, base_label, base_latitude, base_longitude,
          current_latitude, current_longitude, location_updated_at)
       VALUES ('${PROFILE}', '${ALPHA}', '${VEHICLE}', 'flatbed', 16000, 8000, 1,
          true, 5000, false, false, true,
          'available', 'operational', 'Epping Depot', -33.9350, 18.5450,
          -33.9350, 18.5450, now())
       ON CONFLICT (id) DO UPDATE SET availability_status = 'available', operational_status = 'operational'`
    );
  }

  /** Frees only THIS suite's truck and assignments. Nothing shared is touched. */
  function resetFleet(): void {
    seedOwnFleet();
    owner.exec(
      `UPDATE public.rr_dispatch_assignments SET assignment_status = 'completed'
       WHERE company_id = '${ALPHA}' AND employee_id = '${DRIVER}'
         AND assignment_status IN ('offered', 'accepted')`
    );
    owner.exec(
      `UPDATE public.rr_tow_truck_profiles SET availability_status = 'available'
       WHERE company_id = '${ALPHA}' AND field_vehicle_id = '${VEHICLE}'`
    );
  }

  function assignmentStatus(serviceJobId: string): string {
    const rows = owner.sql(
      `SELECT assignment_status FROM public.rr_dispatch_assignments
       WHERE service_job_id = '${serviceJobId}'`
    );
    return rows.length ? String((rows[0] as { assignment_status: string }).assignment_status) : "none";
  }

  function truckAvailability(): string {
    const rows = owner.sql(
      `SELECT availability_status FROM public.rr_tow_truck_profiles
       WHERE company_id = '${ALPHA}' AND field_vehicle_id = '${VEHICLE}'`
    );
    return rows.length
      ? String((rows[0] as { availability_status: string }).availability_status)
      : "none";
  }

  /** The REAL dispatch engine, asked the question the board asks. */
  async function evaluate(serviceJobId: string) {
    const { evaluateAndPersistCandidates } = await import("@/lib/road-recovery/dispatch-data");
    const result = await evaluateAndPersistCandidates(db as never, {
      companyId: ALPHA,
      serviceJobId,
      evaluatedBy: ALPHA_CONTROLLER,
      evaluatedAt: new Date().toISOString(),
      evaluationId: randomUUID(),
    });
    assert.ok(result.evaluation, `evaluation failed: ${result.error}`);
    return result.evaluation;
  }

  /** Drives a fresh tow job as far as an ACCEPTED assignment. */
  async function jobWithAcceptedDriver(): Promise<{ serviceJobId: string; fieldJobId: string }> {
    resetFleet();
    const { serviceJobId, fieldJobId } = await createJob(db, {
      serviceCode: "tow_in",
      title: "Dispatch release regression",
    });
    authorise(owner, { serviceJobId, serviceCode: "tow_in" });

    for (const toState of ["authorisation_pending", "authorised", "dispatch_pending"]) {
      const moved = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: ALPHA_CONTROLLER,
        serviceJobId,
        toState,
      });
      assert.ok(moved.ok, moved.ok ? "" : `could not reach ${toState}: ${moved.message}`);
    }

    const offered = await offerAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId,
      employeeId: DRIVER,
      fieldVehicleId: VEHICLE,
    });
    assert.ok(offered.ok, offered.ok ? "" : `offer failed: ${offered.message}`);

    const accepted = await acceptAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      assignmentId: (offered.data as { assignmentId: string }).assignmentId,
    });
    assert.ok(accepted.ok, accepted.ok ? "" : `accept failed: ${accepted.message}`);

    return { serviceJobId, fieldJobId };
  }

  it("holds the driver and the truck while the job is still running", async () => {
    const { serviceJobId } = await jobWithAcceptedDriver();

    assert.equal(assignmentStatus(serviceJobId), "accepted", "the assignment should be live");
    assert.equal(truckAvailability(), "on_job", "the truck should be committed");

    const other = await createJob(db, { serviceCode: "tow_in", title: "Competing job" });
    const evaluation = await evaluate(other.serviceJobId);

    const thandi = evaluation.candidates.find((entry) => entry.employeeId === DRIVER);
    assert.ok(thandi, "the suite's own driver should still be evaluated, just not eligible");
    assert.equal(thandi.eligible, false, "a committed driver must not be eligible");
    assert.ok(
      thandi.eligibilityFailures.some((failure) => failure.code === "driver_has_conflicting_assignment"),
      "the conflict must be reported as the reason"
    );
  });

  it("releases the driver, the truck and eligibility when the job completes", async () => {
    const { serviceJobId, fieldJobId } = await jobWithAcceptedDriver();

    // Straight down the tow graph to a Completed physical status.
    for (const toState of [
      "en_route", "on_scene", "assessing", "loading", "secured", "departing_scene",
      "in_transit", "arrived_destination", "offloading", "handover_pending",
      "handed_over", "paperwork_complete",
    ]) {
      const moved = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: ALPHA_CONTROLLER,
        serviceJobId,
        toState,
      });
      assert.ok(moved.ok, moved.ok ? "" : `could not reach ${toState}: ${moved.message}`);
    }

    // paperwork_complete is still "On Site". The release must happen at the first state
    // whose PHYSICAL status is Completed, not at a state name this test hard-codes.
    assert.equal(assignmentStatus(serviceJobId), "accepted", "not finished yet");

    // evidence_complete is resolved SERVER-side and deliberately overwrites anything a
    // caller supplies, so the evidence has to be real.
    recordGpsArrival(owner, fieldJobId);
    await satisfyEvidence(db, owner, { serviceJobId, fieldJobId });

    const evidenceComplete = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId,
      toState: "evidence_complete",
    });
    assert.ok(
      evidenceComplete.ok,
      evidenceComplete.ok ? "" : `evidence_complete refused: ${evidenceComplete.message}`
    );

    const invoiceReady = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId,
      toState: "invoice_ready",
    });
    assert.ok(invoiceReady.ok, invoiceReady.ok ? "" : `invoice_ready refused: ${invoiceReady.message}`);
    assert.equal(invoiceReady.data.physicalStatus, "Completed");

    assert.equal(assignmentStatus(serviceJobId), "completed", "the assignment must be closed");
    assert.equal(truckAvailability(), "available", "the truck must be released");

    const next = await createJob(db, { serviceCode: "tow_in", title: "Next job after completion" });
    const evaluation = await evaluate(next.serviceJobId);

    const thandi = evaluation.candidates.find((entry) => entry.employeeId === DRIVER);
    assert.ok(thandi, "the suite's own driver should be evaluated for the next job");
    assert.ok(
      !thandi.eligibilityFailures.some((f) => f.code === "driver_has_conflicting_assignment"),
      `a completed job must not leave a conflict behind: ${JSON.stringify(thandi.eligibilityFailures)}`
    );
    assert.equal(thandi.eligible, true, "the driver must be dispatchable again");
  });

  it("closes an ACCEPTED assignment as completed when the job is cancelled", async () => {
    const { serviceJobId } = await jobWithAcceptedDriver();

    const cancelled = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId,
      toState: "cancelled",
      reason: "Customer stood the job down before collection.",
    });
    assert.ok(cancelled.ok, cancelled.ok ? "" : `cancel refused: ${cancelled.message}`);
    assert.equal(cancelled.data.physicalStatus, "Cancelled");

    // NOT "cancelled": rr_dispatch_assignments_crew_row_check refuses that once a crew
    // record exists, and the failure would be silent.
    assert.equal(
      assignmentStatus(serviceJobId),
      "completed",
      "an accepted assignment must close as completed even when the job is cancelled"
    );
    assert.equal(truckAvailability(), "available", "the truck must be released on cancellation too");
  });

  it("cancels an assignment that was only OFFERED", async () => {
    resetFleet();
    const { serviceJobId } = await createJob(db, {
      serviceCode: "tow_in",
      title: "Offer withdrawn regression",
    });
    authorise(owner, { serviceJobId, serviceCode: "tow_in" });
    for (const toState of ["authorisation_pending", "authorised", "dispatch_pending"]) {
      await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: ALPHA_CONTROLLER,
        serviceJobId,
        toState,
      });
    }
    const offered = await offerAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId,
      employeeId: DRIVER,
      fieldVehicleId: VEHICLE,
    });
    assert.ok(offered.ok, offered.ok ? "" : `offer failed: ${offered.message}`);
    assert.equal(assignmentStatus(serviceJobId), "offered");

    const cancelled = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: ALPHA_CONTROLLER,
      serviceJobId,
      toState: "cancelled",
      reason: "Job cancelled before the driver responded.",
    });
    assert.ok(cancelled.ok, cancelled.ok ? "" : `cancel refused: ${cancelled.message}`);

    // No crew record was ever created, so the honest status IS cancelled.
    assert.equal(assignmentStatus(serviceJobId), "cancelled");
  });
});

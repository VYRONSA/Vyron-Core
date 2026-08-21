/**
 * Road & Recovery SERVICE-LAYER integration tests.
 *
 * Phases 0-2 proved the pure functions (unit tests) and the schema (PostgreSQL runtime
 * assertions), but the glue between them — lib/road-recovery/job-service.ts and
 * lib/road-recovery/bystand-service.ts — was only covered by typecheck and build. This
 * suite closes that gap by calling those functions FOR REAL against a real PostgreSQL
 * database, with RLS, triggers, CHECK constraints, composite foreign keys and grants all
 * active.
 *
 * Nothing about the security model is relaxed to make the tests pass:
 *   - statements run as `authenticated` with a tenant's JWT claims, so RLS applies
 *   - the append-only triggers are live
 *   - workflow state validation runs through the real state machine
 *   - timestamps are stamped by the SERVER, never supplied by the test
 *
 * SKIPS (rather than fails) when no disposable database is configured, so `npm test`
 * stays green on a machine without PostgreSQL. It never falls back to a default
 * connection, so it cannot reach a real project.
 *
 *   RR_TEST_PSQL=<path to psql> RR_TEST_DB=rr_itest npm test
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import {
  createPgTestClient,
  readTestDatabaseConfig,
  type PgTestClient,
} from "./support/pg-query-transport";

import {
  acceptAssignment,
  createServiceJob,
  declineAssignment,
  driverRecordArrival,
  driverStartTravel,
  offerAssignment,
  transitionServiceJob,
} from "@/lib/road-recovery/job-service";

import {
  beginStandingBy,
  computeStandbyForJob,
  confirmStandDown,
  convertBystandToRecovery,
  pauseStanding,
  recordBystandEvidence,
  requestStandDown,
  requireBystandJob,
  resumeStanding,
  sealStandbySummary,
  submitObservationReport,
} from "@/lib/road-recovery/bystand-service";

import { stateForRole } from "@/lib/road-recovery/state-machine";

const CONFIG = readTestDatabaseConfig();
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const BRAVO = "bbbbbbbb-0000-4000-8000-000000000002";
const CONTROLLER = "controller@alpha.test";
const THANDI = "d0000000-0000-4000-8000-00000000000a";
const ALPHA_TRUCK = "40000000-0000-4000-8000-00000000000a";

/** The service layer is exercised as a signed-in tenant user, so RLS is genuinely on. */
let db: PgTestClient;
/** Owner client, used ONLY to set up fixtures and to assert from outside a tenant. */
let owner: PgTestClient;

const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Road & Recovery service-layer integration", () => {
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

/** Unique-ish suffix so repeated runs do not collide on job_ref/authorisation number. */
function suffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createBystand(title: string) {
  const created = await createServiceJob(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceCode: "bystand",
    title,
    originLabel: "N1 northbound",
    originLatitude: -33.9249,
    originLongitude: 18.4241,
    vehicleRegistration: `CA ${suffix()}`,
  });
  assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
  return created.data;
}

/** Drives a job to standing_by through the REAL service functions. */
async function driveToStandingBy(serviceJobId: string) {
  const steps = ["bystand_requested", "authorisation_pending", "authorised"];
  for (const toState of steps) {
    const result = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      toState,
    });
    assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
  }

  // An authorisation must exist before dispatch: the guard is resolved from the DATABASE,
  // never trusted from the caller.
  owner.sql(
    `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
       authorisation_number, authorised_service_code)
     VALUES ('${ALPHA}', '${serviceJobId}', 'c0000000-0000-4000-8000-00000000000a',
       'AUTH-${suffix()}', 'bystand') RETURNING id`
  );

  const offered = await offerAssignment(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    employeeId: THANDI,
    fieldVehicleId: ALPHA_TRUCK,
  });
  assert.ok(offered.ok, offered.ok ? "" : `offerAssignment failed: ${offered.message}`);

  const accepted = await acceptAssignment(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    assignmentId: offered.data.assignmentId,
  });
  assert.ok(accepted.ok, accepted.ok ? "" : `acceptAssignment failed: ${accepted.message}`);

  const travelled = await driverStartTravel(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    employeeId: THANDI,
    latitude: -33.87,
    longitude: 18.45,
  });
  assert.ok(travelled.ok, travelled.ok ? "" : `driverStartTravel failed: ${travelled.message}`);

  const arrived = await driverRecordArrival(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    employeeId: THANDI,
    latitude: -33.9255,
    longitude: 18.4243,
    accuracy: 8,
  });
  assert.ok(arrived.ok, arrived.ok ? "" : `driverRecordArrival failed: ${arrived.message}`);

  const standing = await beginStandingBy(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    latitude: -33.9255,
    longitude: 18.4243,
  });
  assert.ok(standing.ok, standing.ok ? "" : `beginStandingBy failed: ${standing.message}`);

  return { arrived: arrived.ok ? arrived.data : null };
}

// ===========================================================================

describeIf("service layer — BYSTAND lifecycle", () => {
  it("creates a BYSTAND job on the ACTIVE workflow version", async () => {
    const job = await createBystand("Integration: create");

    const rows = owner.sql(
      `SELECT workflow_key, workflow_version, service_state, destination_label
         FROM public.rr_service_jobs WHERE id = '${job.serviceJobId}'`
    );
    assert.equal(rows[0].workflow_key, "bystand");
    assert.equal(rows[0].workflow_version, 2, "new jobs must pick up the active version");
    assert.equal(rows[0].service_state, "logged");
    assert.equal(rows[0].destination_label, null);

    // The 1:1 spine row exists and field_jobs.status is the PHYSICAL status.
    const spine = owner.sql(
      `SELECT status FROM public.field_jobs WHERE id = '${job.fieldJobId}'`
    );
    assert.equal(spine[0].status, "Pending");
  });

  it("loads a BYSTAND job and refuses a non-BYSTAND one", async () => {
    const job = await createBystand("Integration: require");
    const loaded = await requireBystandJob(db as never, ALPHA, job.serviceJobId);
    assert.ok(loaded.ok);
    assert.equal(loaded.ok && loaded.data.workflowKey, "bystand");
    assert.equal(loaded.ok && loaded.data.serviceCode, "bystand");

    const tow = await createServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceCode: "tow_in",
      title: "Integration: a tow, not a bystand",
    });
    assert.ok(tow.ok);
    const refused = await requireBystandJob(db as never, ALPHA, tow.ok ? tow.data.serviceJobId : "");
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.status, 409);
  });

  it("runs begin -> pause -> resume -> request -> stand-down and SEALS the result", async () => {
    const job = await createBystand("Integration: full standing lifecycle");
    await driveToStandingBy(job.serviceJobId);

    const paused = await pauseStanding(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      pauseState: "scene_handover_to_authority",
      reason: "Scene handed to SAPS",
    });
    assert.ok(paused.ok, paused.ok ? "" : `pauseStanding failed: ${paused.message}`);

    const resumed = await resumeStanding(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(resumed.ok, resumed.ok ? "" : `resumeStanding failed: ${resumed.message}`);

    const requested = await requestStandDown(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      requestedBy: "Control Room",
      channel: "radio",
      reason: "Scene cleared",
    });
    assert.ok(requested.ok, requested.ok ? "" : `requestStandDown failed: ${requested.message}`);

    const stoodDown = await confirmStandDown(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(stoodDown.ok, stoodDown.ok ? "" : `confirmStandDown failed: ${stoodDown.message}`);
    assert.equal(stoodDown.ok && stoodDown.data.toState, "stood_down");

    // The seal is real, and it came from the calculator, not the caller.
    const sealed = owner.sql(
      `SELECT total_billable_seconds, total_paused_seconds, standing_interval_count,
              paused_interval_count, calculator_version, sealed_reason
         FROM public.rr_standby_summary WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(sealed.length, 1, "stand-down must seal exactly one summary");
    assert.equal(sealed[0].sealed_reason, "stand_down");
    assert.equal(sealed[0].standing_interval_count, 2, "two standing intervals: before and after the pause");
    assert.equal(sealed[0].paused_interval_count, 1);
    assert.equal(sealed[0].calculator_version, "rr-standby-1.0.0");
    assert.ok(Number(sealed[0].total_billable_seconds) >= 0);

    // Paused time is excluded from billable time by construction.
    const detail = owner.sql(
      `SELECT stand_down_requested_by, stand_down_channel
         FROM public.rr_bystand_details WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(detail[0].stand_down_requested_by, "Control Room");
    assert.equal(detail[0].stand_down_channel, "radio");
  });

  it("computes standing time from the persisted event stream", async () => {
    const job = await createBystand("Integration: compute");
    await driveToStandingBy(job.serviceJobId);

    const computed = await computeStandbyForJob(
      db as never,
      ALPHA,
      job.serviceJobId,
      new Date().toISOString()
    );
    assert.ok(computed.ok, computed.ok ? "" : computed.message);
    assert.equal(computed.ok && computed.data.computation.standingNow, true);
    assert.equal(computed.ok && computed.data.computation.intervals.length, 1);
    assert.deepEqual(computed.ok ? computed.data.computation.anomalies : null, []);
    // SLA-lite is derived, with no targets.
    assert.ok(computed.ok && computed.data.timings.timeToSceneSeconds !== undefined);
  });

  it("records the observation report and advances the workflow", async () => {
    const job = await createBystand("Integration: report");
    await driveToStandingBy(job.serviceJobId);
    await requestStandDown(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    await confirmStandDown(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "departed_scene",
    });

    const report = await submitObservationReport(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      summary: "SAPS attended; scene released without recovery.",
    });
    assert.ok(report.ok, report.ok ? "" : report.message);
    assert.equal(report.ok && report.data.toState, "report_submitted");

    const stored = owner.sql(
      `SELECT report_summary, report_submitted_by FROM public.rr_bystand_details
        WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.match(String(stored[0].report_summary), /SAPS attended/);
    assert.equal(stored[0].report_submitted_by, CONTROLLER);
  });

  it("records evidence as a Storage PATH, never base64", async () => {
    const job = await createBystand("Integration: evidence");
    const loaded = await requireBystandJob(db as never, ALPHA, job.serviceJobId);
    assert.ok(loaded.ok);

    const evidence = await recordBystandEvidence(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      employeeId: THANDI,
      serviceJobId: job.serviceJobId,
      fieldJobId: job.fieldJobId,
      evidenceType: "bystand_scene",
      storagePath: `${ALPHA}/${job.serviceJobId}/scene.jpg`,
      latitude: -33.9249,
      longitude: 18.4241,
    });
    assert.ok(evidence.ok, evidence.ok ? "" : evidence.message);

    const rows = owner.sql(
      `SELECT storage_bucket, storage_path, photo_url, evidence_type
         FROM public.mobile_workforce_evidence WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(rows[0].storage_bucket, "rr-evidence");
    assert.match(String(rows[0].storage_path), /scene\.jpg$/);
    assert.equal(rows[0].photo_url, null, "no base64 payload may be written");
    assert.equal(rows[0].evidence_type, "bystand_scene");
  });

  it("rejects an unknown evidence type before it reaches the database", async () => {
    const job = await createBystand("Integration: bad evidence");
    const result = await recordBystandEvidence(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      employeeId: THANDI,
      serviceJobId: job.serviceJobId,
      fieldJobId: job.fieldJobId,
      evidenceType: "not_a_type" as never,
    });
    assert.equal(result.ok, false);
  });
});

describeIf("service layer — server-authoritative time", () => {
  it("stamps transitions with SERVER time and ignores a client-supplied timestamp", async () => {
    const job = await createBystand("Integration: server time");
    await driveToStandingBy(job.serviceJobId);

    // A device claiming an absurd time must not influence anything recorded.
    const bogusClientTime = "2001-01-01T00:00:00.000Z";
    const paused = await pauseStanding(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      pauseState: "weather_hold",
      reason: "Storm",
      clientReportedAt: bogusClientTime,
    });
    assert.ok(paused.ok, paused.ok ? "" : paused.message);

    const events = owner.sql(
      `SELECT occurred_at FROM public.rr_service_state_events
        WHERE service_job_id = '${job.serviceJobId}' ORDER BY occurred_at`
    );
    for (const event of events) {
      const recorded = new Date(String(event.occurred_at)).getTime();
      assert.ok(
        recorded > new Date("2020-01-01T00:00:00Z").getTime(),
        `a client timestamp leaked into occurred_at: ${event.occurred_at}`
      );
    }

    // And the billable figure is unaffected by the bogus client time.
    const computed = await computeStandbyForJob(
      db as never,
      ALPHA,
      job.serviceJobId,
      new Date().toISOString()
    );
    assert.ok(computed.ok);
    assert.ok(
      computed.ok && computed.data.computation.totalBillableSeconds < 60 * 60,
      "billable time must reflect real elapsed server time, not a 2001 client claim"
    );
  });

  it("orders the event stream by server time", async () => {
    const job = await createBystand("Integration: ordering");
    await driveToStandingBy(job.serviceJobId);

    const events = owner.sql(
      `SELECT occurred_at, to_state FROM public.rr_service_state_events
        WHERE service_job_id = '${job.serviceJobId}' ORDER BY occurred_at`
    );
    const times = events.map((row) => new Date(String(row.occurred_at)).getTime());
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i] >= times[i - 1], "server timestamps must be monotonic");
    }
    assert.equal(events[events.length - 1].to_state, "standing_by");
  });
});

describeIf("service layer — conversion to recovery", () => {
  it("creates a SEPARATE recovery job and leaves the BYSTAND intact", async () => {
    const job = await createBystand("Integration: conversion");
    await driveToStandingBy(job.serviceJobId);

    const evidence = await recordBystandEvidence(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      employeeId: THANDI,
      serviceJobId: job.serviceJobId,
      fieldJobId: job.fieldJobId,
      evidenceType: "bystand_scene",
      storagePath: `${ALPHA}/${job.serviceJobId}/pre-conversion.jpg`,
    });
    assert.ok(evidence.ok);

    const converted = await convertBystandToRecovery(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      reason: "Vehicle not driveable after authority release",
      destinationType: "repairer",
      destinationLabel: "Alpha Panelbeaters",
    });
    assert.ok(converted.ok, converted.ok ? "" : `conversion failed: ${converted.message}`);
    const result = converted.ok ? converted.data : null;
    assert.ok(result);

    // Two genuinely separate jobs.
    assert.notEqual(result!.recoveryServiceJobId, job.serviceJobId);
    assert.notEqual(result!.recoveryFieldJobId, job.fieldJobId);

    // The original is untouched as a BYSTAND.
    const original = owner.sql(
      `SELECT workflow_key, service_state, destination_label, destination_type,
              destination_latitude, destination_longitude
         FROM public.rr_service_jobs WHERE id = '${job.serviceJobId}'`
    );
    assert.equal(original[0].workflow_key, "bystand");
    assert.equal(original[0].service_state, "converted_to_recovery");
    assert.equal(original[0].destination_label, null);
    assert.equal(original[0].destination_type, null);
    assert.equal(original[0].destination_latitude, null);
    assert.equal(original[0].destination_longitude, null);

    // The new job is a recovery, with its own workflow and the destination.
    const recovery = owner.sql(
      `SELECT workflow_key, service_state, destination_label, spawned_from_service_job_id
         FROM public.rr_service_jobs WHERE id = '${result!.recoveryServiceJobId}'`
    );
    assert.equal(recovery[0].workflow_key, "tow_recovery");
    assert.equal(recovery[0].service_state, "logged");
    assert.equal(recovery[0].destination_label, "Alpha Panelbeaters");
    assert.equal(recovery[0].spawned_from_service_job_id, job.serviceJobId);

    // The BYSTAND keeps its evidence.
    const keptEvidence = owner.sql(
      `SELECT count(*)::int AS n FROM public.mobile_workforce_evidence
        WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(keptEvidence[0].n, 1);

    // The BYSTAND keeps its own sealed standing billing; the recovery has none.
    const bystandSeal = owner.sql(
      `SELECT sealed_reason, total_billable_seconds FROM public.rr_standby_summary
        WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(bystandSeal.length, 1);
    assert.equal(bystandSeal[0].sealed_reason, "conversion");

    const recoverySeal = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_standby_summary
        WHERE service_job_id = '${result!.recoveryServiceJobId}'`
    );
    assert.equal(recoverySeal[0].n, 0, "a recovery job has no standing billing");

    // And the linkage is recorded on the BYSTAND detail row.
    const detail = owner.sql(
      `SELECT converted_service_job_id, conversion_reason FROM public.rr_bystand_details
        WHERE service_job_id = '${job.serviceJobId}'`
    );
    assert.equal(detail[0].converted_service_job_id, result!.recoveryServiceJobId);
    assert.match(String(detail[0].conversion_reason), /not driveable/);
  });

  it("refuses a conversion with no reason", async () => {
    const job = await createBystand("Integration: conversion no reason");
    await driveToStandingBy(job.serviceJobId);
    const result = await convertBystandToRecovery(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      reason: "   ",
    });
    assert.equal(result.ok, false);
  });

  it("refuses to convert a job that is not standing by", async () => {
    const job = await createBystand("Integration: conversion wrong state");
    const result = await convertBystandToRecovery(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      reason: "Too early",
    });
    assert.equal(result.ok, false, "the state machine must refuse this");
  });
});

describeIf("service layer — generic workflow awareness", () => {
  it("resolves ARRIVAL per workflow: BYSTAND lands on arrived_on_scene", async () => {
    const job = await createBystand("Integration: bystand arrival");
    await driveToStandingBy(job.serviceJobId);

    const events = owner.sql(
      `SELECT to_state FROM public.rr_service_state_events
        WHERE service_job_id = '${job.serviceJobId}' ORDER BY occurred_at`
    );
    const states = events.map((row) => String(row.to_state));
    assert.ok(
      states.includes("arrived_on_scene"),
      "arrival must land on the BYSTAND arrival state, not the tow one"
    );
    assert.ok(!states.includes("on_scene"), "BYSTAND must never enter the tow arrival state");
    assert.equal(stateForRole("bystand", "arrival", 2), "arrived_on_scene");
  });

  it("resolves ARRIVAL per workflow: a tow lands on on_scene", async () => {
    const tow = await createServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceCode: "tow_in",
      title: "Integration: tow arrival",
      originLatitude: -33.9249,
      originLongitude: 18.4241,
      destinationType: "repairer",
      destinationLabel: "Alpha Panelbeaters",
    });
    assert.ok(tow.ok);
    const serviceJobId = tow.ok ? tow.data.serviceJobId : "";

    for (const toState of ["authorisation_pending", "authorised"]) {
      const step = await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId,
        toState,
      });
      assert.ok(step.ok, step.ok ? "" : step.message);
    }

    owner.sql(
      `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
         authorisation_number, authorised_service_code)
       VALUES ('${ALPHA}', '${serviceJobId}', 'c0000000-0000-4000-8000-00000000000a',
         'AUTH-${suffix()}', 'tow_in') RETURNING id`
    );

    const released = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      toState: "dispatch_pending",
    });
    assert.ok(released.ok, released.ok ? "" : released.message);

    const offered = await offerAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      employeeId: THANDI,
      fieldVehicleId: ALPHA_TRUCK,
    });
    assert.ok(offered.ok, offered.ok ? "" : offered.message);
    const accepted = await acceptAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      assignmentId: offered.data.assignmentId,
    });
    assert.ok(accepted.ok);

    await driverStartTravel(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      employeeId: THANDI,
      latitude: -33.87,
      longitude: 18.45,
    });
    const arrived = await driverRecordArrival(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      employeeId: THANDI,
      latitude: -33.9255,
      longitude: 18.4243,
    });
    assert.ok(arrived.ok, arrived.ok ? "" : arrived.message);

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id = '${serviceJobId}'`
    );
    assert.equal(state[0].service_state, "on_scene", "a tow must arrive at on_scene");
    assert.equal(stateForRole("tow_recovery", "arrival"), "on_scene");
  });

  it("resolves DECLINE per workflow: BYSTAND returns to authorised, not dispatch_pending", async () => {
    const job = await createBystand("Integration: bystand decline");
    for (const toState of ["bystand_requested", "authorisation_pending", "authorised"]) {
      await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId: job.serviceJobId,
        toState,
      });
    }
    owner.sql(
      `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
         authorisation_number, authorised_service_code)
       VALUES ('${ALPHA}', '${job.serviceJobId}', 'c0000000-0000-4000-8000-00000000000a',
         'AUTH-${suffix()}', 'bystand') RETURNING id`
    );

    const offered = await offerAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
      fieldVehicleId: ALPHA_TRUCK,
    });
    assert.ok(offered.ok, offered.ok ? "" : offered.message);

    const declined = await declineAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      assignmentId: offered.data.assignmentId,
      reason: "Committed elsewhere",
    });
    assert.ok(declined.ok, declined.ok ? "" : `declineAssignment failed: ${declined.message}`);

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id = '${job.serviceJobId}'`
    );
    assert.equal(
      state[0].service_state,
      "authorised",
      "BYSTAND has no dispatch_pending; a decline must return it to authorised"
    );
    assert.equal(stateForRole("bystand", "dispatch_pool", 2), "authorised");

    // A declined offer must NOT have produced a confirmed crew row.
    const crew = owner.sql(
      `SELECT count(*)::int AS n FROM public.field_job_assignments WHERE job_id = '${job.fieldJobId}'`
    );
    assert.equal(crew[0].n, 0, "a declined offer must never create a crew assignment");
  });

  it("writes the confirmed crew row on ACCEPTANCE, into the existing table", async () => {
    const job = await createBystand("Integration: crew row");
    await driveToStandingBy(job.serviceJobId);

    const crew = owner.sql(
      `SELECT employee_id, role, status FROM public.field_job_assignments
        WHERE job_id = '${job.fieldJobId}'`
    );
    assert.equal(crew.length, 1);
    assert.equal(crew[0].employee_id, THANDI);
    assert.equal(crew[0].role, "primary");
  });

  it("maps every state down to a valid field_jobs.status", async () => {
    const job = await createBystand("Integration: physical status");
    await driveToStandingBy(job.serviceJobId);

    const spine = owner.sql(
      `SELECT f.status FROM public.field_jobs f
         JOIN public.rr_service_jobs j ON j.field_job_id = f.id
        WHERE j.id = '${job.serviceJobId}'`
    );
    assert.equal(spine[0].status, "On Site", "standing_by maps down to On Site");

    const allowed = ["Pending", "Dispatched", "Travelling", "On Site", "Completed", "Cancelled"];
    const everyStatus = owner.sql(
      `SELECT DISTINCT physical_status_after AS s FROM public.rr_service_state_events
        WHERE service_job_id = '${job.serviceJobId}' AND physical_status_after IS NOT NULL`
    );
    for (const row of everyStatus) {
      assert.ok(allowed.includes(String(row.s)), `unexpected physical status ${row.s}`);
    }
  });

  it("refuses an illegal transition through the real state machine", async () => {
    const job = await createBystand("Integration: illegal transition");
    const result = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "closed",
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 400);
  });

  it("refuses dispatch when no valid authorisation exists (guard resolved from the DB)", async () => {
    const job = await createBystand("Integration: no authorisation");
    for (const toState of ["bystand_requested", "authorisation_pending", "authorised"]) {
      await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId: job.serviceJobId,
        toState,
      });
    }
    const offered = await offerAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
    });
    assert.equal(offered.ok, false, "no authorisation means no dispatch");
    assert.equal(offered.ok === false && offered.status, 409);
  });
});

describeIf("service layer — security is not bypassed", () => {
  it("refuses to load another tenant's job (RLS)", async () => {
    const job = await createBystand("Integration: isolation");
    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    const loaded = await requireBystandJob(bravo as never, BRAVO, job.serviceJobId);
    assert.equal(loaded.ok, false, "Bravo must not see Alpha's job");
    assert.equal(loaded.ok === false && loaded.status, 404);
  });

  it("cannot transition another tenant's job", async () => {
    const job = await createBystand("Integration: cross-tenant transition");
    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    const result = await transitionServiceJob(bravo as never, {
      companyId: BRAVO,
      actorEmail: "controller@bravo.test",
      serviceJobId: job.serviceJobId,
      toState: "bystand_requested",
    });
    assert.equal(result.ok, false);

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id = '${job.serviceJobId}'`
    );
    assert.equal(state[0].service_state, "logged", "the job must be untouched");
  });

  it("cannot seal billing onto another tenant's job", async () => {
    const job = await createBystand("Integration: cross-tenant seal");
    await driveToStandingBy(job.serviceJobId);

    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });
    const sealed = await sealStandbySummary(bravo as never, {
      companyId: BRAVO,
      actorEmail: "controller@bravo.test",
      serviceJobId: job.serviceJobId,
      sealedReason: "stand_down",
    });
    assert.equal(sealed.ok, false, "Bravo must not seal Alpha's billing");

    const seals = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_standby_summary
        WHERE service_job_id = '${job.serviceJobId}' AND company_id = '${BRAVO}'`
    );
    assert.equal(seals[0].n, 0);
  });

  it("the append-only trigger is live during service-layer writes", async () => {
    const job = await createBystand("Integration: append-only");
    await driveToStandingBy(job.serviceJobId);
    await requestStandDown(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });
    await confirmStandDown(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
    });

    assert.throws(
      () =>
        owner.sql(
          `UPDATE public.rr_standby_summary SET total_billable_seconds = 1
            WHERE service_job_id = '${job.serviceJobId}' RETURNING id`
        ),
      /append-only/,
      "the sealed summary must remain immutable even for the owner"
    );

    assert.throws(
      () =>
        owner.sql(
          `UPDATE public.rr_service_state_events SET reason = 'tampered'
            WHERE service_job_id = '${job.serviceJobId}' RETURNING id`
        ),
      /append-only/,
      "the state event log must remain immutable"
    );
  });

  it("records an audit trail for the acting company only", async () => {
    const job = await createBystand("Integration: audit");
    const audits = owner.sql(
      `SELECT company_id, user_email, entity_type FROM public.vyron_audit_log
        WHERE entity_id = '${job.serviceJobId}'`
    );
    assert.ok(audits.length >= 1, "job creation must be audited");
    for (const row of audits) {
      assert.equal(row.company_id, ALPHA);
      assert.equal(row.user_email, CONTROLLER);
    }
  });
});

describeIf("service layer — GPS-verified arrival", () => {
  it("writes a GPS validation row and refuses an arrival with no coordinates", async () => {
    const job = await createBystand("Integration: gps");
    for (const toState of ["bystand_requested", "authorisation_pending", "authorised"]) {
      await transitionServiceJob(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId: job.serviceJobId,
        toState,
      });
    }
    owner.sql(
      `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
         authorisation_number, authorised_service_code)
       VALUES ('${ALPHA}', '${job.serviceJobId}', 'c0000000-0000-4000-8000-00000000000a',
         'AUTH-${suffix()}', 'bystand') RETURNING id`
    );
    const offered = await offerAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
      fieldVehicleId: ALPHA_TRUCK,
    });
    assert.ok(offered.ok);
    await acceptAssignment(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      assignmentId: offered.data.assignmentId,
    });
    await driverStartTravel(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
    });

    // No coordinates: refused outright.
    const noGps = await driverRecordArrival(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
      latitude: null,
      longitude: null,
    });
    assert.equal(noGps.ok, false, "arrival must require GPS evidence");

    // Far away: refused unless an explicit reason is supplied.
    const farAway = await driverRecordArrival(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
      latitude: -34.5,
      longitude: 19.5,
    });
    assert.equal(farAway.ok, false);
    assert.equal(farAway.ok === false && farAway.status, 422);

    // On scene: accepted and verified.
    const onScene = await driverRecordArrival(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      employeeId: THANDI,
      latitude: -33.9255,
      longitude: 18.4243,
      accuracy: 6,
    });
    assert.ok(onScene.ok, onScene.ok ? "" : onScene.message);
    assert.equal(onScene.ok && onScene.data.gpsVerified, true);

    const validations = owner.sql(
      `SELECT inside_radius, reference_type FROM public.mobile_gps_validations
        WHERE job_id = '${job.fieldJobId}' ORDER BY validated_at`
    );
    assert.ok(validations.length >= 2, "every attempt is recorded as evidence");
    assert.equal(validations[validations.length - 1].inside_radius, true);
    assert.equal(validations[0].reference_type, "rr_scene_arrival");
  });
});

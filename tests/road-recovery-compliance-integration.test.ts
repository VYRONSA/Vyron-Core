/**
 * Phase 3 SERVICE-LAYER integration: the compliance path, end to end.
 *
 * THE POINT OF THIS SUITE
 *
 * `evidence_complete` has guarded `ready_to_invoice` since Phase 0, but until Phase 3
 * nothing resolved it. Guards fail closed, so no job could actually reach invoice_ready
 * through the service layer — and the Phase 2 end-to-end tests did not catch it because
 * they wrote state events directly in SQL rather than calling transitionServiceJob().
 *
 * So this suite calls the REAL service functions against a REAL PostgreSQL database and
 * proves both directions:
 *
 *   NEGATIVE  missing evidence  -> compliance fails -> invoice_ready is REFUSED
 *   POSITIVE  evidence captured -> compliance passes -> invoice_ready SUCCEEDS
 *
 * Nothing about the security model is relaxed to make it pass: statements run as
 * `authenticated` with a tenant's JWT claims so RLS applies, triggers and CHECKs are live,
 * and the guard context is resolved server-side and deliberately overwritten, so a caller
 * asserting `evidence_complete: true` changes nothing.
 *
 * SKIPS (rather than fails) without a disposable database, and never falls back to a
 * default connection, so it cannot reach a real project.
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
  acceptAssignment,
  createServiceJob,
  driverRecordArrival,
  driverStartTravel,
  offerAssignment,
  transitionServiceJob,
} from "@/lib/road-recovery/job-service";

import {
  createRequirementSnapshot,
  evaluateJobCompliance,
  linkEvidenceToRequirements,
  publishRequirementPolicy,
  raiseJobException,
  recordComplianceEvaluation,
  resolveJobException,
  waiveRequirement,
} from "@/lib/road-recovery/requirements-service";

const CONFIG = readTestDatabaseConfig();
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const BRAVO = "bbbbbbbb-0000-4000-8000-000000000002";
const CONTROLLER = "controller@alpha.test";
const THANDI = "d0000000-0000-4000-8000-00000000000a";
const ALPHA_TRUCK = "40000000-0000-4000-8000-00000000000a";
const ALPHA_COUNTERPARTY = "c0000000-0000-4000-8000-00000000000a";

let db: PgTestClient;
let owner: PgTestClient;

const describeIf = CONFIG ? describe : describe.skip;

if (!CONFIG) {
  describe("Phase 3 compliance integration", () => {
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

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/** Creates a tow_in job with a destination, so the destination-conditional rules apply. */
async function createTow(title: string, options: { counterparty?: boolean } = {}) {
  const created = await createServiceJob(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceCode: "tow_in",
    title,
    counterpartyId: options.counterparty === false ? null : ALPHA_COUNTERPARTY,
    originLabel: "N1 northbound",
    originLatitude: -33.9249,
    originLongitude: 18.4241,
    destinationLabel: "Alpha Yard",
    destinationAddress: "12 Yard Road, Cape Town",
    destinationType: "storage_yard",
    vehicleRegistration: `CA ${suffix()}`,
  });
  assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
  return created.data;
}

/** Records an authorisation, exactly as Phase 1 does. */
function authorise(serviceJobId: string) {
  owner.sql(
    `INSERT INTO public.rr_authorisations (company_id, service_job_id, counterparty_id,
       authorisation_number, authorised_service_code)
     VALUES ('${ALPHA}', '${serviceJobId}', '${ALPHA_COUNTERPARTY}',
       'AUTH-${suffix()}', 'tow_in') RETURNING id`
  );
}

/**
 * Inserts one evidence item into the EXISTING repository. Never modifies its schema.
 *
 * `evidence_type` stays inside mobile_workforce_evidence's OWN vocabulary — Phase 3 adds
 * nothing to it. What the item means for Road & Recovery is carried by the LINK, which is
 * also the only correct place for it: one photograph may satisfy several requirements.
 */
function captureEvidence(serviceJobId: string, fieldJobId: string, kind = "other"): string {
  const rows = owner.sql(
    `INSERT INTO public.mobile_workforce_evidence
       (company_id, employee_id, job_id, service_job_id, evidence_type,
        storage_bucket, storage_path, captured_by_role)
     VALUES ('${ALPHA}', '${THANDI}', '${fieldJobId}', '${serviceJobId}', '${esc(kind)}',
       'rr-evidence', '${ALPHA}/${serviceJobId}/${suffix()}.jpg', 'driver')
     RETURNING id`
  );
  return String((rows[0] as { id: string }).id);
}

/** Drives a job through dispatch to on_scene using the REAL service functions. */
async function driveToOnScene(serviceJobId: string) {
  // createServiceJob leaves the job at the workflow's initial state already.
  for (const toState of ["authorisation_pending", "authorised"]) {
    const result = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId,
      toState,
    });
    assert.ok(result.ok, result.ok ? "" : `transition to ${toState} failed: ${result.message}`);
  }

  authorise(serviceJobId);

  const dispatched = await transitionServiceJob(db as never, {
    companyId: ALPHA,
    actorEmail: CONTROLLER,
    serviceJobId,
    toState: "dispatch_pending",
  });
  assert.ok(dispatched.ok, dispatched.ok ? "" : `dispatch failed: ${dispatched.message}`);

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
}

/** Walks the physical remainder of the tow up to the state that gates invoicing. */
async function driveToEvidenceComplete(serviceJobId: string) {
  const states = [
    "assessing",
    "loading",
    "secured",
    "departing_scene",
    "in_transit",
    "arrived_destination",
    "offloading",
    "handover_pending",
    "handed_over",
    "paperwork_complete",
    "evidence_complete",
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

/** Captures and links whatever the job still needs, honouring minCount. */
async function satisfyOutstanding(serviceJobId: string, fieldJobId: string) {
  const compliance = await evaluateJobCompliance(db as never, {
    companyId: ALPHA,
    serviceJobId,
  });
  assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);

  for (const result of compliance.data.compliance.results) {
    if (!result.applicable || result.satisfied) continue;
    // GPS and authorisation requirements are satisfied by their own records, not by a
    // photograph, so they are never linked here.
    if (result.evidenceKind === "gps" || result.evidenceKind === "authorisation") continue;

    const needed = Math.max(1, result.minCount - result.capturedCount);
    for (let index = 0; index < needed; index += 1) {
      const evidenceId = captureEvidence(serviceJobId, fieldJobId);
      const linked = await linkEvidenceToRequirements(db as never, {
        companyId: ALPHA,
        actorEmail: CONTROLLER,
        serviceJobId,
        evidenceId,
        requirementCodes: [result.requirementCode],
      });
      assert.ok(linked.ok, linked.ok ? "" : `link failed: ${linked.message}`);
    }
  }
}

// ---------------------------------------------------------------------------

describeIf("Phase 3 — the compliance path through the service layer", () => {
  it("STEP 1 — creating a job freezes its requirement snapshot", async () => {
    const job = await createTow("Step 1 snapshot");

    assert.ok(job.requirementPolicyKey, "no requirement policy was resolved at creation");
    assert.ok(job.requirementCount > 0, "no requirements were snapshotted");

    const rows = owner.sql(
      `SELECT requirement_code, policy_key, policy_version FROM public.rr_evidence_requirements
        WHERE company_id='${ALPHA}' AND service_job_id='${job.serviceJobId}'`
    );
    assert.equal(rows.length, job.requirementCount);
  });

  it("STEP 2 — the snapshot is immutable, so a later policy edit cannot rewrite history", async () => {
    const job = await createTow("Step 2 immutability");

    assert.throws(
      () =>
        owner.sql(
          `UPDATE public.rr_evidence_requirements SET min_count = 99
            WHERE company_id='${ALPHA}' AND service_job_id='${job.serviceJobId}'
            RETURNING id`
        ),
      /immutable/i
    );

    // Publishing a NEW policy version does not touch the existing job either.
    const before = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_evidence_requirements
        WHERE service_job_id='${job.serviceJobId}'`
    );

    const published = await publishRequirementPolicy(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      policyKey: `edited_${suffix().toLowerCase()}`,
      serviceCode: "tow_in",
      items: [
        {
          requirementCode: "brand_new_rule",
          label: "A rule invented after the job existed",
          evidenceKind: "photo",
        },
      ],
    });
    assert.ok(published.ok, published.ok ? "" : published.message);

    const after = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_evidence_requirements
        WHERE service_job_id='${job.serviceJobId}'`
    );
    assert.deepEqual(after, before, "a policy change altered an existing job's requirements");

    const codes = owner.sql(
      `SELECT requirement_code FROM public.rr_evidence_requirements
        WHERE service_job_id='${job.serviceJobId}' AND requirement_code='brand_new_rule'`
    );
    assert.equal(codes.length, 0);
  });

  it("STEP 3 — an authorisation satisfies the authorisation requirement, computed server-side", async () => {
    const job = await createTow("Step 3 authorisation");

    const beforeAuth = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(beforeAuth.ok, beforeAuth.ok ? "" : beforeAuth.message);
    const authBefore = beforeAuth.data.compliance.results.find(
      (entry) => entry.requirementCode === "authorisation_record"
    );
    assert.ok(authBefore);
    assert.equal(authBefore.satisfied, false);

    authorise(job.serviceJobId);

    const afterAuth = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(afterAuth.ok, afterAuth.ok ? "" : afterAuth.message);
    const authAfter = afterAuth.data.compliance.results.find(
      (entry) => entry.requirementCode === "authorisation_record"
    );
    assert.ok(authAfter);
    assert.equal(authAfter.satisfied, true, "an active authorisation did not satisfy its requirement");
  });

  it("STEP 4 — dispatch, acceptance, travel and GPS arrival all still work", async () => {
    const job = await createTow("Step 4 dispatch");
    await driveToOnScene(job.serviceJobId);

    const rows = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id='${job.serviceJobId}'`
    );
    assert.equal((rows[0] as { service_state: string }).service_state, "on_scene");
  });

  it("STEP 5 — GPS-verified arrival satisfies the gps_arrival requirement", async () => {
    const job = await createTow("Step 5 gps");
    await driveToOnScene(job.serviceJobId);

    const compliance = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);
    const gps = compliance.data.compliance.results.find(
      (entry) => entry.requirementCode === "gps_arrival"
    );
    assert.ok(gps);
    assert.equal(gps.satisfied, true, "a GPS-verified arrival did not satisfy gps_arrival");
  });

  // -------------------------------------------------------------------------
  // THE CRITICAL ACCEPTANCE CRITERION — the negative path
  // -------------------------------------------------------------------------

  it("STEP 6 — invoice_ready with missing evidence MUST FAIL", async () => {
    const job = await createTow("Step 6 blocked");
    await driveToOnScene(job.serviceJobId);
    await driveToEvidenceComplete(job.serviceJobId);

    const compliance = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);
    assert.equal(compliance.data.compliance.evidenceComplete, false);
    assert.equal(compliance.data.compliance.status, "non_compliant");
    assert.ok(compliance.data.compliance.blocking.length > 0);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "invoice_ready",
    });

    assert.equal(attempt.ok, false, "invoice_ready succeeded with mandatory evidence missing");

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id='${job.serviceJobId}'`
    );
    assert.equal(
      (state[0] as { service_state: string }).service_state,
      "evidence_complete",
      "the job moved despite the refusal"
    );
  });

  it("STEP 6b — a client asserting evidence_complete: true is IGNORED", async () => {
    const job = await createTow("Step 6b spoofed guard");
    await driveToOnScene(job.serviceJobId);
    await driveToEvidenceComplete(job.serviceJobId);

    const attempt = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "invoice_ready",
      // A hostile or buggy client claiming the job is complete.
      context: { evidence_complete: true, authorisation_valid: true } as never,
    });

    assert.equal(attempt.ok, false, "a client-supplied guard value was trusted");

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id='${job.serviceJobId}'`
    );
    assert.equal((state[0] as { service_state: string }).service_state, "evidence_complete");
  });

  // -------------------------------------------------------------------------
  // THE CRITICAL ACCEPTANCE CRITERION — the positive path
  // -------------------------------------------------------------------------

  it("STEP 7-9 — capture evidence, compliance passes, invoice_ready MUST SUCCEED", async () => {
    const job = await createTow("Step 7-9 full path");
    await driveToOnScene(job.serviceJobId);
    await driveToEvidenceComplete(job.serviceJobId);

    // STEP 7 — capture and link every outstanding requirement.
    await satisfyOutstanding(job.serviceJobId, job.fieldJobId);

    // STEP 8 — compliance now passes, computed from the database.
    const compliance = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);
    assert.equal(
      compliance.data.compliance.evidenceComplete,
      true,
      `still blocking: ${compliance.data.compliance.blocking.join(", ")}`
    );
    assert.equal(compliance.data.compliance.status, "compliant");
    assert.equal(compliance.data.compliance.completenessPercent, 100);

    // STEP 9 — the transition the whole phase exists to unblock.
    const invoiced = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "invoice_ready",
    });
    assert.ok(invoiced.ok, invoiced.ok ? "" : `invoice_ready refused: ${invoiced.message}`);

    const state = owner.sql(
      `SELECT service_state FROM public.rr_service_jobs WHERE id='${job.serviceJobId}'`
    );
    assert.equal((state[0] as { service_state: string }).service_state, "invoice_ready");
  });

  it("STEP 10 — a waiver unblocks the job, and is never silent", async () => {
    const job = await createTow("Step 10 waiver");
    await driveToOnScene(job.serviceJobId);
    await driveToEvidenceComplete(job.serviceJobId);

    const before = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(before.ok, before.ok ? "" : before.message);
    const blockingCodes = before.data.compliance.blocking;
    assert.ok(blockingCodes.length > 0);

    // Waive one; capture the rest. The job must then bill as waived_compliant, never as
    // plain "compliant".
    const waivedCode = blockingCodes[0];
    const waived = await waiveRequirement(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      requirementCode: waivedCode,
      reasonCode: "vehicle_inaccessible",
      reasonDetail: "Scene closed by SAPS before the driver could photograph it.",
    });
    assert.ok(waived.ok, waived.ok ? "" : waived.message);

    await satisfyOutstanding(job.serviceJobId, job.fieldJobId);

    const after = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(after.ok, after.ok ? "" : after.message);
    assert.equal(after.data.compliance.evidenceComplete, true);
    assert.equal(after.data.compliance.status, "waived_compliant");
    assert.ok(after.data.compliance.waived.includes(waivedCode));

    const entry = after.data.compliance.results.find(
      (result) => result.requirementCode === waivedCode
    );
    assert.ok(entry);
    assert.equal(entry.waiver?.reasonCode, "vehicle_inaccessible");
    assert.equal(entry.waiver?.waivedBy, CONTROLLER);

    const invoiced = await transitionServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      toState: "invoice_ready",
    });
    assert.ok(invoiced.ok, invoiced.ok ? "" : `invoice_ready refused: ${invoiced.message}`);
  });

  it("STEP 11 — a sealed evaluation is immutable and records who sealed it", async () => {
    const job = await createTow("Step 11 sealed");

    const sealed = await recordComplianceEvaluation(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
      actorEmail: CONTROLLER,
      scope: "invoice",
    });
    assert.ok(sealed.ok, sealed.ok ? "" : sealed.message);

    const rows = owner.sql(
      `SELECT status, evidence_complete, engine_version, evaluated_by
         FROM public.rr_compliance_evaluations WHERE id='${sealed.data.evaluationId}'`
    );
    assert.equal(rows.length, 1);
    const row = rows[0] as Record<string, unknown>;
    assert.equal(row.evaluated_by, CONTROLLER);
    assert.equal(String(row.engine_version), "rr-compliance-1.0.0");

    assert.throws(
      () =>
        owner.sql(
          `UPDATE public.rr_compliance_evaluations SET status='compliant'
            WHERE id='${sealed.data.evaluationId}' RETURNING id`
        ),
      /append-only|not permitted|immutable/i
    );
  });
});

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

describeIf("Phase 3 — exceptions route through the existing action queue", () => {
  it("raises an exception and escalates a high-severity one for approval", async () => {
    const job = await createTow("Exception escalation");

    const raised = await raiseJobException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      exceptionCode: "vehicle_inaccessible",
      severity: "high",
      detail: "Vehicle is down an embankment and cannot be reached by the assigned truck.",
      detectedBy: "controller",
    });
    assert.ok(raised.ok, raised.ok ? "" : raised.message);

    const rows = owner.sql(
      `SELECT severity, resolution_status, automation_action_id, state_at_detection
         FROM public.rr_job_exceptions WHERE id='${raised.data.exceptionId}'`
    );
    const row = rows[0] as Record<string, unknown>;
    assert.equal(row.severity, "high");
    assert.equal(row.resolution_status, "open");
    assert.ok(row.automation_action_id, "a high-severity exception was not escalated");

    // It went into the EXISTING approval queue, not a parallel one.
    const actions = owner.sql(
      `SELECT action_type, status, source_module FROM public.workforce_automation_actions
        WHERE id='${String(row.automation_action_id)}'`
    );
    assert.equal(actions.length, 1);
    const action = actions[0] as Record<string, unknown>;
    assert.equal(action.action_type, "Escalate Exception");
    assert.equal(action.status, "Pending Approval");
    assert.equal(action.source_module, "Road & Recovery");
  });

  it("does not escalate a low-severity exception", async () => {
    const job = await createTow("Exception low severity");

    const raised = await raiseJobException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      exceptionCode: "gps_unavailable",
      severity: "low",
      detectedBy: "driver",
    });
    assert.ok(raised.ok, raised.ok ? "" : raised.message);

    const rows = owner.sql(
      `SELECT automation_action_id FROM public.rr_job_exceptions WHERE id='${raised.data.exceptionId}'`
    );
    assert.equal((rows[0] as Record<string, unknown>).automation_action_id, null);
  });

  it("records who resolved an exception, and when", async () => {
    const job = await createTow("Exception resolution");

    const raised = await raiseJobException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      exceptionCode: "customer_refused_signature",
      severity: "medium",
    });
    assert.ok(raised.ok, raised.ok ? "" : raised.message);

    const resolved = await resolveJobException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      exceptionId: raised.data.exceptionId,
      resolutionStatus: "resolved",
      resolutionAction: "counselled",
      resolutionNotes: "Customer signed after the process was explained.",
    });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.message);

    const rows = owner.sql(
      `SELECT resolution_status, resolved_by, resolved_at FROM public.rr_job_exceptions
        WHERE id='${raised.data.exceptionId}'`
    );
    const row = rows[0] as Record<string, unknown>;
    assert.equal(row.resolution_status, "resolved");
    assert.equal(row.resolved_by, CONTROLLER);
    assert.ok(row.resolved_at);
  });

  it("refuses an unknown exception code at the database, not only in the API", async () => {
    const job = await createTow("Exception unknown code");
    const raised = await raiseJobException(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      exceptionCode: "driver_was_rude",
    });
    assert.equal(raised.ok, false);
  });
});

// ---------------------------------------------------------------------------
// BYSTAND
// ---------------------------------------------------------------------------

describeIf("Phase 3 — BYSTAND keeps its own requirements", () => {
  async function createBystand(title: string) {
    const created = await createServiceJob(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceCode: "bystand",
      title,
      counterpartyId: ALPHA_COUNTERPARTY,
      originLabel: "N2 eastbound",
      originLatitude: -33.9249,
      originLongitude: 18.4241,
      vehicleRegistration: `CA ${suffix()}`,
    });
    assert.ok(created.ok, created.ok ? "" : `createServiceJob failed: ${created.message}`);
    return created.data;
  }

  it("snapshots the BYSTAND policy, not the tow policy", async () => {
    const job = await createBystand("BYSTAND snapshot");

    const rows = owner.sql(
      `SELECT requirement_code, policy_key FROM public.rr_evidence_requirements
        WHERE service_job_id='${job.serviceJobId}' ORDER BY sort_order`
    ) as Record<string, unknown>[];

    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(String(row.policy_key), "default_bystand");
    }

    const codes = rows.map((row) => String(row.requirement_code));
    assert.ok(codes.includes("bystand_periodic_presence"));
    assert.ok(codes.includes("bystand_observation_report"));
    assert.ok(codes.includes("bystand_stand_down_record"));
  });

  it("requires nothing about destinations, loading, custody or delivery", async () => {
    const job = await createBystand("BYSTAND separation");

    const rows = owner.sql(
      `SELECT requirement_code, evidence_kind FROM public.rr_evidence_requirements
        WHERE service_job_id='${job.serviceJobId}'`
    ) as Record<string, unknown>[];

    for (const row of rows) {
      const code = String(row.requirement_code);
      for (const word of [
        "destination",
        "delivery",
        "handover",
        "custody",
        "loading",
        "securing",
        "unload",
        "tow",
      ]) {
        assert.equal(
          code.includes(word),
          false,
          `BYSTAND job requires "${code}", which is a recovery concern`
        );
      }
      assert.notEqual(String(row.evidence_kind), "handover");
    }
  });

  it("requires periodic presence more than once — a single photo is not an attendance", async () => {
    const job = await createBystand("BYSTAND presence count");

    const rows = owner.sql(
      `SELECT min_count FROM public.rr_evidence_requirements
        WHERE service_job_id='${job.serviceJobId}' AND requirement_code='bystand_periodic_presence'`
    ) as Record<string, unknown>[];

    assert.equal(rows.length, 1);
    assert.ok(Number(rows[0].min_count) >= 2);

    // One capture is not enough.
    const evidenceId = captureEvidence(job.serviceJobId, job.fieldJobId);
    const linked = await linkEvidenceToRequirements(db as never, {
      companyId: ALPHA,
      actorEmail: CONTROLLER,
      serviceJobId: job.serviceJobId,
      evidenceId,
      requirementCodes: ["bystand_periodic_presence"],
    });
    assert.ok(linked.ok, linked.ok ? "" : linked.message);

    const compliance = await evaluateJobCompliance(db as never, {
      companyId: ALPHA,
      serviceJobId: job.serviceJobId,
    });
    assert.ok(compliance.ok, compliance.ok ? "" : compliance.message);
    const presence = compliance.data.compliance.results.find(
      (entry) => entry.requirementCode === "bystand_periodic_presence"
    );
    assert.ok(presence);
    assert.equal(presence.satisfied, false, "one capture satisfied a multi-capture requirement");
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation through the service layer
// ---------------------------------------------------------------------------

describeIf("Phase 3 — the tenant boundary holds through the service layer", () => {
  it("cannot evaluate another tenant's job", async () => {
    const job = await createTow("Cross-tenant evaluation");

    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    const result = await evaluateJobCompliance(bravo as never, {
      companyId: BRAVO,
      serviceJobId: job.serviceJobId,
    });
    assert.equal(result.ok, false, "another tenant evaluated this job");
  });

  it("cannot waive a requirement on another tenant's job", async () => {
    const job = await createTow("Cross-tenant waiver");

    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    const result = await waiveRequirement(bravo as never, {
      companyId: BRAVO,
      actorEmail: "controller@bravo.test",
      serviceJobId: job.serviceJobId,
      requirementCode: "registration_photo",
      reasonCode: "vehicle_inaccessible",
    });
    assert.equal(result.ok, false, "another tenant waived a requirement on this job");

    const leaked = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_requirement_waivers
        WHERE service_job_id='${job.serviceJobId}'`
    );
    assert.equal(Number((leaked[0] as { n: number }).n), 0);
  });

  it("refuses to snapshot requirements onto another tenant's job", async () => {
    const job = await createTow("Cross-tenant snapshot");

    const bravo = createPgTestClient(CONFIG!, {
      kind: "authenticated",
      email: "controller@bravo.test",
    });

    const result = await createRequirementSnapshot(bravo as never, {
      companyId: BRAVO,
      serviceJobId: job.serviceJobId,
      serviceCode: "tow_in",
      counterpartyId: null,
      at: new Date().toISOString(),
    });

    // Either refused outright, or it wrote nothing that alpha can see.
    const rows = owner.sql(
      `SELECT count(*)::int AS n FROM public.rr_evidence_requirements
        WHERE company_id='${BRAVO}' AND service_job_id='${job.serviceJobId}'`
    );
    assert.equal(
      Number((rows[0] as { n: number }).n),
      0,
      `bravo wrote requirements onto an alpha job (ok=${result.ok})`
    );
  });
});

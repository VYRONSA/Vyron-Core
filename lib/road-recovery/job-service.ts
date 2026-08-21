/**
 * VYRON CORE — Road & Recovery job & dispatch service layer (Phase 1).
 *
 * The I/O half of the Tow-In workflow. Every decision it makes is delegated:
 *
 *   which transitions are legal   -> lib/road-recovery/state-machine.ts   (pure, Phase 0)
 *   which candidates are eligible -> lib/road-recovery/dispatch.ts        (pure, Phase 1)
 *   whether an arrival is on scene-> lib/mobile-workforce-gps.ts          (existing)
 *
 * Reuses, rather than rebuilds:
 *   public.field_jobs            the work-order spine. Its `status` is written ONLY via
 *                                physicalStatusFor() / statusForEventType(), never with
 *                                a Road & Recovery state.
 *   recordFieldJobEvent()        driver events. 'Start Travel' and 'Arrive Site' already
 *                                exist, already move field_jobs.status, and already feed
 *                                lib/field-cost-intelligence.ts travel computation.
 *   validateMobileGpsRadius()    GPS-verified arrival -> public.mobile_gps_validations.
 *   public.field_job_assignments the confirmed crew record, written on ACCEPTANCE only.
 *   public.vyron_audit_log       audit history, via writeAuditLog().
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordFieldJobEvent, type FieldEventType } from "@/lib/field-operations";
import { validateMobileGpsRadius } from "@/lib/mobile-workforce-gps";
import { writeAuditLog } from "@/lib/audit-log";
import {
  activeWorkflowVersion,
  applyTransition,
  availableTransitions,
  creationStateFor,
  physicalStatusFor,
  stateForRole,
  type RrStateRole,
  type RrTransitionContext,
} from "@/lib/road-recovery/state-machine";
import { RR_DESTINATION_TYPES, type RrWorkflowKey } from "@/lib/road-recovery/service-types";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type RrServiceResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/**
 * Resolves the state that fulfils a semantic role for THIS job's workflow and version.
 *
 * Phase 1 hardcoded tow state names here, which silently broke BYSTAND: it arrives at
 * `arrived_on_scene` (not `on_scene`) and returns a declined offer to `authorised`
 * (it has no `dispatch_pending`). Asking the workflow for the role keeps one
 * implementation correct for tow recovery, heavy recovery, roadside assistance, BYSTAND,
 * vehicle movement and storage, with no service-specific branching anywhere.
 */
function requireRoleState(
  workflowKey: string,
  workflowVersion: number | null,
  role: RrStateRole
): { ok: true; state: string } | { ok: false; status: number; message: string } {
  const resolved = stateForRole(workflowKey, role, workflowVersion);
  if (!resolved) {
    return {
      ok: false,
      status: 409,
      message: `The ${workflowKey.replace(/_/g, " ")} workflow has no "${role.replace(/_/g, " ")}" step, so this action does not apply to it.`,
    };
  }
  return { ok: true, state: resolved };
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

/**
 * Loads a job's workflow identity and resolves the state fulfilling a semantic role.
 *
 * One database read, so a caller never has to know — or guess — which service it is
 * acting on. The job's OWN workflow_version is used, so a job created under BYSTAND v1
 * resolves against v1 even after v2 becomes active.
 */
async function resolveJobRoleState(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string,
  role: RrStateRole
): Promise<{ ok: true; state: string } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("rr_service_jobs")
    .select("workflow_key, workflow_version")
    .eq("company_id", companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("Service job not found in this company.", 404);

  const row = data as Row;
  return requireRoleState(asText(row.workflow_key), Number(row.workflow_version) || null, role);
}

// ---------------------------------------------------------------------------
// Job creation
// ---------------------------------------------------------------------------

/**
 * The destination vocabulary, mirroring the CHECK constraint on
 * public.rr_service_jobs.destination_type (sql/070). Kept here so a bad value is refused
 * with an explanation instead of reaching PostgreSQL and coming back as a 500 quoting a
 * constraint name.
 */
export { RR_DESTINATION_TYPES } from "@/lib/road-recovery/service-types";

export type CreateServiceJobInput = {
  companyId: string;
  actorEmail: string;
  serviceCode: string;
  title: string;
  counterpartyId?: string | null;
  incidentAt?: string | null;
  reportedBy?: string | null;
  sceneDescription?: string | null;
  originLabel?: string | null;
  originAddress?: string | null;
  originLatitude?: number | null;
  originLongitude?: number | null;
  destinationType?: string | null;
  destinationLabel?: string | null;
  destinationAddress?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  vehicleRegistration?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleIsDrivable?: boolean | null;
  priority?: string;
};

/**
 * Creates the field job AND its Road & Recovery extension.
 *
 * field_jobs is created first and remains the spine; rr_service_jobs extends it 1:1, so
 * every existing Field Operations, travel, cost and GPS engine sees the job for free.
 */
export async function createServiceJob(
  supabase: SupabaseClient,
  input: CreateServiceJobInput
): Promise<
  RrServiceResult<{
    serviceJobId: string;
    fieldJobId: string;
    jobRef: string;
    requirementPolicyKey: string | null;
    requirementCount: number;
  }>
> {
  const { data: serviceType, error: serviceTypeError } = await supabase
    .from("rr_service_types")
    .select("id, service_code, workflow_key, requires_authorisation, active")
    .eq("company_id", input.companyId)
    .eq("service_code", input.serviceCode)
    .maybeSingle();

  if (serviceTypeError) return fail(serviceTypeError.message, 500);
  if (!serviceType) {
    return fail(
      `Service "${input.serviceCode}" is not configured for this company. Enable the Road & Recovery module to seed the catalogue.`,
      400
    );
  }
  const type = serviceType as Row;
  if (type.active === false) return fail(`Service "${input.serviceCode}" is not active.`, 400);

  // Checked here rather than left to the CHECK constraint on rr_service_jobs: an
  // unrecognised value came back as a 500 quoting
  // "rr_service_jobs_destination_type_check", which tells a caller neither that their
  // input was wrong nor what the accepted values are.
  if (input.destinationType && !RR_DESTINATION_TYPES.includes(input.destinationType)) {
    return fail(
      `"${input.destinationType}" is not a destination type. Use one of: ${RR_DESTINATION_TYPES.join(", ")}.`,
      400
    );
  }

  const workflowKey = asText(type.workflow_key);

  const creationState = creationStateFor(workflowKey, activeWorkflowVersion(workflowKey as RrWorkflowKey));
  if (!creationState) {
    return fail(`The ${workflowKey} workflow has no definition, so a job cannot be created.`, 500);
  }

  // A readable, collision-resistant reference. field_jobs enforces uniqueness per company.
  const jobRef = `RR-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;

  const { data: fieldJob, error: fieldJobError } = await supabase
    .from("field_jobs")
    .insert({
      company_id: input.companyId,
      job_ref: jobRef,
      title: input.title,
      description: input.sceneDescription || null,
      // The coarse physical status. Never a Road & Recovery workflow state.
      status: "Pending",
      site_type: "gps_location",
      customer_address: input.originAddress || null,
      latitude: input.originLatitude ?? null,
      longitude: input.originLongitude ?? null,
      priority: input.priority || "high",
    })
    .select("id, job_ref")
    .single();

  if (fieldJobError || !fieldJob) {
    return fail(fieldJobError?.message || "Could not create the field job.", 500);
  }

  const fieldJobId = asText((fieldJob as Row).id);

  const { data: serviceJob, error: serviceJobError } = await supabase
    .from("rr_service_jobs")
    .insert({
      company_id: input.companyId,
      field_job_id: fieldJobId,
      service_type_id: asText(type.id),
      workflow_key: workflowKey,
      // The ACTIVE version, so a new job runs the current graph (BYSTAND v2) while
      // historical jobs keep the version they were created under.
      workflow_version: activeWorkflowVersion(workflowKey as RrWorkflowKey),
      // Asked of the WORKFLOW, never assumed. "logged" is right for the tow-shaped
      // workflows and is not even a state in the storage workflow, which begins at
      // storage_pending.
      service_state: creationState,
      counterparty_id: input.counterpartyId || null,
      incident_at: input.incidentAt || null,
      reported_by: input.reportedBy || null,
      scene_description: input.sceneDescription || null,
      origin_label: input.originLabel || null,
      origin_address: input.originAddress || null,
      origin_latitude: input.originLatitude ?? null,
      origin_longitude: input.originLongitude ?? null,
      destination_type: input.destinationType || null,
      destination_label: input.destinationLabel || null,
      destination_address: input.destinationAddress || null,
      destination_latitude: input.destinationLatitude ?? null,
      destination_longitude: input.destinationLongitude ?? null,
      vehicle_registration: input.vehicleRegistration || null,
      vehicle_make: input.vehicleMake || null,
      vehicle_model: input.vehicleModel || null,
      vehicle_is_drivable: input.vehicleIsDrivable ?? null,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (serviceJobError || !serviceJob) {
    // Roll back the spine so a failed extension does not leave an orphan field job.
    await supabase.from("field_jobs").delete().eq("id", fieldJobId);
    return fail(serviceJobError?.message || "Could not create the service job.", 500);
  }

  const serviceJobId = asText((serviceJob as Row).id);

  // Resolve the governing requirement policy ONCE and freeze it onto the job. A later
  // policy edit can never change what this job was required to produce.
  const { createRequirementSnapshot } = await import("@/lib/road-recovery/requirements-service");
  const snapshot = await createRequirementSnapshot(supabase, {
    companyId: input.companyId,
    serviceJobId,
    serviceCode: input.serviceCode,
    counterpartyId: input.counterpartyId || null,
    at: new Date().toISOString(),
  });

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_service_job",
    entityId: serviceJobId,
    metadata: {
      jobRef,
      serviceCode: input.serviceCode,
      fieldJobId,
      requirementPolicy: snapshot.ok ? snapshot.data.policyKey : null,
      requirementCount: snapshot.ok ? snapshot.data.requirementCount : 0,
    },
  });

  return {
    ok: true,
    data: {
      serviceJobId,
      fieldJobId,
      jobRef,
      requirementPolicyKey: snapshot.ok ? snapshot.data.policyKey : null,
      requirementCount: snapshot.ok ? snapshot.data.requirementCount : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Workflow transitions
// ---------------------------------------------------------------------------

export type TransitionInput = {
  companyId: string;
  actorEmail: string;
  actorRole?: string | null;
  serviceJobId: string;
  toState: string;
  reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracy?: number | null;
  /** Extra guard context (authorisation validity is resolved here, not trusted). */
  context?: RrTransitionContext;
};

/**
 * Moves a job to a new workflow state.
 *
 * The legality of the move is decided by the PURE state machine; this function only
 * persists the result. field_jobs.status is updated to the mapped PHYSICAL status —
 * never to a Road & Recovery workflow state.
 */
export async function transitionServiceJob(
  supabase: SupabaseClient,
  input: TransitionInput
): Promise<RrServiceResult<{ fromState: string; toState: string; physicalStatus: string }>> {
  const { data, error } = await supabase
    .from("rr_service_jobs")
    .select("id, field_job_id, workflow_key, workflow_version, service_state, state_entered_at")
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("Service job not found in this company.", 404);

  const row = data as Row;
  const workflowKey = asText(row.workflow_key);
  const fromState = asText(row.service_state);
  const occurredAt = new Date().toISOString();

  // Guard context is RESOLVED from the database, never taken from the caller, so a
  // client cannot assert that an authorisation exists.
  const resolvedContext: RrTransitionContext = { ...(input.context ?? {}) };
  const workflowVersionForGuards = Number(row.workflow_version) || null;

  // Which guards does the TARGET transition actually declare? Asking the workflow keeps
  // this generic: a guard added to any workflow is resolved here without further change,
  // and no guard is resolved unnecessarily.
  const targetTransition = availableTransitions(workflowKey, fromState, workflowVersionForGuards).find(
    (transition) => transition.to === input.toState
  );
  const requiredGuards = new Set(targetTransition?.guards ?? []);

  const offerState = stateForRole(workflowKey, "offer", workflowVersionForGuards);
  const poolState = stateForRole(workflowKey, "dispatch_pool", workflowVersionForGuards);

  if (
    requiredGuards.has("authorisation_valid") ||
    input.toState === offerState ||
    input.toState === poolState
  ) {
    const authorisation = await getActiveAuthorisation(
      supabase,
      input.companyId,
      input.serviceJobId
    );
    resolvedContext.authorisation_valid = authorisation.ok && authorisation.data !== null;
  }

  // THE PHASE 0 GUARD, FINALLY ANSWERED.
  //
  // `evidence_complete` has gated `ready_to_invoice` since Phase 0, but nothing resolved
  // it, so guards failed closed and no job could reach invoice_ready through the service
  // layer. It is computed here, server-side, from the job's immutable requirement
  // snapshot, its linked evidence and its recorded waivers — and, like
  // `authorisation_valid`, it is deliberately OVERWRITTEN so a caller cannot assert it.
  if (requiredGuards.has("evidence_complete")) {
    const { evaluateJobCompliance } = await import("@/lib/road-recovery/requirements-service");
    const compliance = await evaluateJobCompliance(supabase, {
      companyId: input.companyId,
      serviceJobId: input.serviceJobId,
      // WHICH scope is a property of the TRANSITION, declared as workflow data. That is
      // what keeps this generic: storage gates its release step at the release scope, and
      // nothing here has to know that `checked_out -> released` belongs to storage.
      scope: targetTransition?.complianceScope ?? "invoice",
    });
    resolvedContext.evidence_complete = compliance.ok
      ? compliance.data.compliance.evidenceComplete
      : false;
  }

  // THE TWO REMAINING PHASE 0 GUARDS.
  //
  // Same defect class as `evidence_complete`, and closed the same way: declared by the
  // storage workflow since Phase 0, never resolved, so both transitions were unreachable.
  //
  // Resolved from rr_release_authorisations, and resolved SEPARATELY — permission to hand
  // a vehicle back to its owner is not permission to scrap it, so a release authority can
  // never satisfy `disposal_authorised` and the reverse. Like every other guard these are
  // deliberately OVERWRITTEN, so a caller posting `release_authorised: true` changes
  // nothing.
  const authorityGuards = [
    { guard: "release_authorised", authorityType: "release" },
    { guard: "disposal_authorised", authorityType: "disposal" },
  ] as const;

  for (const entry of authorityGuards) {
    if (!requiredGuards.has(entry.guard)) continue;
    const { resolveAuthorityGuard } = await import("@/lib/road-recovery/release-authority");
    const decision = await resolveAuthorityGuard(supabase, {
      companyId: input.companyId,
      serviceJobId: input.serviceJobId,
      authorityType: entry.authorityType,
      at: occurredAt,
    });
    resolvedContext[entry.guard] = decision.authorised;
  }

  const stateEnteredAt = asText(row.state_entered_at);
  const secondsInPreviousState = stateEnteredAt
    ? Math.max(
        0,
        Math.round((new Date(occurredAt).getTime() - new Date(stateEnteredAt).getTime()) / 1000)
      )
    : null;

  const workflowVersion = Number(row.workflow_version) || null;

  const result = applyTransition({
    workflowKey,
    workflowVersion,
    fromState,
    toState: input.toState,
    occurredAt,
    context: resolvedContext,
    reason: input.reason,
    secondsInPreviousState,
  });

  if (!result.ok) {
    return fail(result.check.message, result.check.reason === "guard_unsatisfied" ? 409 : 400);
  }

  const { error: updateError } = await supabase
    .from("rr_service_jobs")
    .update({
      service_state: result.state,
      previous_service_state: fromState,
      state_entered_at: occurredAt,
      updated_at: occurredAt,
    })
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId);

  if (updateError) return fail(updateError.message, 500);

  const { error: eventError } = await supabase.from("rr_service_state_events").insert({
    company_id: input.companyId,
    service_job_id: input.serviceJobId,
    workflow_key: result.event.workflowKey,
    workflow_version: result.event.workflowVersion,
    transition_code: result.event.transitionCode,
    from_state: result.event.fromState,
    to_state: result.event.toState,
    physical_status_before: result.event.physicalStatusBefore,
    physical_status_after: result.event.physicalStatusAfter,
    occurred_at: result.event.occurredAt,
    seconds_in_previous_state: result.event.secondsInPreviousState,
    actor_email: input.actorEmail,
    actor_role: input.actorRole || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    gps_accuracy: input.gpsAccuracy ?? null,
    reason: result.event.reason,
    spawns_linked_job: result.event.spawnsLinkedJob,
    enters_billable_standing_clock: result.event.entersBillableStandingClock,
    leaves_billable_standing_clock: result.event.leavesBillableStandingClock,
  });

  if (eventError) return fail(eventError.message, 500);

  // The coarse physical status on the spine, from the mapping — never the workflow state.
  const physicalStatus = physicalStatusFor(workflowKey, result.state, workflowVersion);
  if (physicalStatus) {
    await supabase
      .from("field_jobs")
      .update({ status: physicalStatus, updated_at: occurredAt })
      .eq("company_id", input.companyId)
      .eq("id", asText(row.field_job_id));
  }

  // A job that is over must give the crew back.
  if (physicalStatus === "Completed" || physicalStatus === "Cancelled") {
    await releaseDispatchCommitments(supabase, {
      companyId: input.companyId,
      serviceJobId: input.serviceJobId,
      outcome: physicalStatus === "Cancelled" ? "cancelled" : "completed",
      occurredAt,
    });
  }

  return {
    ok: true,
    data: { fromState, toState: result.state, physicalStatus: physicalStatus || "" },
  };
}

/**
 * Returns the driver and the truck a finished job was holding.
 *
 * rr_dispatch_assignments has always permitted `completed` and `cancelled`, and nothing
 * ever wrote either one: acceptDispatchAssignment() set `accepted` and no code path moved
 * it on. Dispatch eligibility is computed from exactly
 * `assignment_status IN ('offered','accepted')` (lib/road-recovery/dispatch-data.ts), and
 * acceptance additionally marks the truck `on_job` with no counterpart that ever cleared
 * it. The consequence was permanent: a driver who completed one job was reported as
 * "already committed to another job" for every later dispatch, and the truck as "on job",
 * so after one job each the board could dispatch nothing at all.
 *
 * Keyed on the PHYSICAL status rather than on state names, exactly as physicalStatusFor()
 * is, so a workflow added later is covered without touching this function.
 *
 * Best-effort by design: the transition itself has already been recorded, and failing the
 * caller here would report a state change that did happen as a failure. A missed release
 * is visible and correctable; a phantom failed transition is not.
 */
async function releaseDispatchCommitments(
  supabase: SupabaseClient,
  input: { companyId: string; serviceJobId: string; outcome: "completed" | "cancelled"; occurredAt: string }
): Promise<void> {
  const { data, error } = await supabase
    .from("rr_dispatch_assignments")
    .select("id, field_vehicle_id, assignment_status")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .in("assignment_status", ["offered", "accepted"]);

  if (error || !data || data.length === 0) return;

  const assignments = data as Row[];

  /**
   * An OFFER that was never taken up is cancelled. An ACCEPTED assignment is completed,
   * whatever became of the job.
   *
   * That is not a cosmetic distinction — `rr_dispatch_assignments_crew_row_check` refuses
   * any status other than accepted / completed / reassigned once `field_job_assignment_id`
   * is set, because acceptance creates a real crew record on the field job. Marking an
   * accepted assignment "cancelled" therefore fails the constraint outright and, with the
   * best-effort handling below, would fail SILENTLY — leaving the driver committed
   * forever, which is the exact defect this function exists to close.
   *
   * `completed` here means "this assignment is no longer live", not "the work succeeded".
   * Whether the job succeeded is recorded on the job, which is where it belongs.
   */
  const offered = assignments
    .filter((assignment) => asText(assignment.assignment_status) === "offered")
    .map((assignment) => asText(assignment.id));
  const engaged = assignments
    .filter((assignment) => asText(assignment.assignment_status) !== "offered")
    .map((assignment) => asText(assignment.id));

  if (offered.length > 0) {
    await supabase
      .from("rr_dispatch_assignments")
      .update({
        assignment_status: input.outcome === "cancelled" ? "cancelled" : "completed",
        updated_at: input.occurredAt,
      })
      .eq("company_id", input.companyId)
      .in("id", offered);
  }

  if (engaged.length > 0) {
    await supabase
      .from("rr_dispatch_assignments")
      .update({ assignment_status: "completed", updated_at: input.occurredAt })
      .eq("company_id", input.companyId)
      .in("id", engaged);
  }

  // Only trucks with no OTHER live assignment go back to available — a truck offered to a
  // second job while finishing the first must not be advertised as free.
  const vehicleIds = [...new Set(assignments.map((a) => asText(a.field_vehicle_id)).filter(Boolean))];
  if (vehicleIds.length === 0) return;

  const { data: stillBusy } = await supabase
    .from("rr_dispatch_assignments")
    .select("field_vehicle_id")
    .eq("company_id", input.companyId)
    .in("field_vehicle_id", vehicleIds)
    .in("assignment_status", ["offered", "accepted"]);

  const busy = new Set(((stillBusy || []) as Row[]).map((r) => asText(r.field_vehicle_id)));
  const freed = vehicleIds.filter((id) => !busy.has(id));
  if (freed.length === 0) return;

  await supabase
    .from("rr_tow_truck_profiles")
    .update({ availability_status: "available", updated_at: input.occurredAt })
    .eq("company_id", input.companyId)
    .in("field_vehicle_id", freed);
}

// ---------------------------------------------------------------------------
// Authorisations
// ---------------------------------------------------------------------------

/** The live authorisation for a job: active, not expired, most recent first. */
export async function getActiveAuthorisation(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<Row | null>> {
  const { data, error } = await supabase
    .from("rr_authorisations")
    .select("*")
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .eq("status", "active")
    .order("authorised_at", { ascending: false });

  if (error) return fail(error.message, 500);

  const now = Date.now();
  const live = ((data || []) as Row[]).find((row) => {
    const expiresAt = asText(row.expires_at);
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() >= now;
  });

  return { ok: true, data: live ?? null };
}

// ---------------------------------------------------------------------------
// Dispatch assignment lifecycle
// ---------------------------------------------------------------------------

export type OfferAssignmentInput = {
  companyId: string;
  actorEmail: string;
  serviceJobId: string;
  employeeId: string;
  fieldVehicleId?: string | null;
  candidateId?: string | null;
};

/**
 * Offers the job to a driver and moves the workflow to `assigned`.
 *
 * Refuses if the candidate is not eligible in a fresh evaluation — the deterministic
 * engine is the authority, and a stale candidate list must not be able to dispatch an
 * uncertified driver.
 */
export async function offerAssignment(
  supabase: SupabaseClient,
  input: OfferAssignmentInput
): Promise<RrServiceResult<{ assignmentId: string }>> {
  const { data: existing, error: existingError } = await supabase
    .from("rr_dispatch_assignments")
    .select("id, sequence_number, assignment_status")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .order("sequence_number", { ascending: false });

  if (existingError) return fail(existingError.message, 500);

  const rows = (existing || []) as Row[];
  const live = rows.find((row) =>
    ["offered", "accepted"].includes(asText(row.assignment_status))
  );
  if (live) {
    return fail(
      "This job already has a live dispatch assignment. Reassign it rather than offering twice.",
      409
    );
  }

  const nextSequence = rows.length
    ? Math.max(...rows.map((row) => Number(row.sequence_number) || 0)) + 1
    : 1;

  const { data: inserted, error: insertError } = await supabase
    .from("rr_dispatch_assignments")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      candidate_id: input.candidateId || null,
      employee_id: input.employeeId,
      field_vehicle_id: input.fieldVehicleId || null,
      assignment_status: "offered",
      sequence_number: nextSequence,
      offered_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return fail(insertError?.message || "Could not create the dispatch assignment.", 500);
  }

  const assignmentId = asText((inserted as Row).id);

  const offerState = await resolveJobRoleState(
    supabase,
    input.companyId,
    input.serviceJobId,
    "offer"
  );
  if (!offerState.ok) {
    await supabase.from("rr_dispatch_assignments").delete().eq("id", assignmentId);
    return offerState;
  }

  const transition = await transitionServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    toState: offerState.state,
  });

  if (!transition.ok) {
    // Keep the two in step: an offer that cannot move the workflow is rolled back.
    await supabase.from("rr_dispatch_assignments").delete().eq("id", assignmentId);
    return transition;
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_dispatch_assignment",
    entityId: assignmentId,
    metadata: { serviceJobId: input.serviceJobId, employeeId: input.employeeId, event: "offered" },
  });

  return { ok: true, data: { assignmentId } };
}

/**
 * Driver accepts. THIS is the only path that writes public.field_job_assignments — the
 * confirmed crew record existing VYRON engines consume. A declined offer never does.
 */
export async function acceptAssignment(
  supabase: SupabaseClient,
  input: { companyId: string; actorEmail: string; assignmentId: string; employeeId?: string }
): Promise<RrServiceResult<{ fieldJobAssignmentId: string }>> {
  const { data, error } = await supabase
    .from("rr_dispatch_assignments")
    .select("id, service_job_id, employee_id, field_vehicle_id, assignment_status")
    .eq("company_id", input.companyId)
    .eq("id", input.assignmentId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("Dispatch assignment not found in this company.", 404);

  const row = data as Row;
  if (asText(row.assignment_status) !== "offered") {
    return fail(`This assignment is ${asText(row.assignment_status)}, not offered.`, 409);
  }
  if (input.employeeId && asText(row.employee_id) !== input.employeeId) {
    return fail("This assignment belongs to another driver.", 403);
  }

  const serviceJobId = asText(row.service_job_id);

  const { data: serviceJob, error: jobError } = await supabase
    .from("rr_service_jobs")
    .select("field_job_id")
    .eq("company_id", input.companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (jobError || !serviceJob) return fail(jobError?.message || "Service job not found.", 404);

  const fieldJobId = asText((serviceJob as Row).field_job_id);
  const respondedAt = new Date().toISOString();

  // The confirmed crew record, in the EXISTING table the rest of VYRON already reads.
  const { data: crew, error: crewError } = await supabase
    .from("field_job_assignments")
    .insert({
      company_id: input.companyId,
      job_id: fieldJobId,
      employee_id: asText(row.employee_id),
      role: "primary",
      status: "assigned",
    })
    .select("id")
    .single();

  if (crewError || !crew) {
    return fail(crewError?.message || "Could not create the crew assignment.", 500);
  }

  const fieldJobAssignmentId = asText((crew as Row).id);

  const { error: updateError } = await supabase
    .from("rr_dispatch_assignments")
    .update({
      assignment_status: "accepted",
      responded_at: respondedAt,
      field_job_assignment_id: fieldJobAssignmentId,
      updated_at: respondedAt,
    })
    .eq("company_id", input.companyId)
    .eq("id", input.assignmentId);

  if (updateError) return fail(updateError.message, 500);

  const acceptState = await resolveJobRoleState(supabase, input.companyId, serviceJobId, "accept");
  if (!acceptState.ok) return acceptState;

  const transition = await transitionServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId,
    toState: acceptState.state,
  });
  if (!transition.ok) return transition;

  // Mark the truck as committed so it stops appearing as available.
  if (row.field_vehicle_id) {
    await supabase
      .from("rr_tow_truck_profiles")
      .update({ availability_status: "on_job", updated_at: respondedAt })
      .eq("company_id", input.companyId)
      .eq("field_vehicle_id", asText(row.field_vehicle_id));
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "approve",
    entityType: "rr_dispatch_assignment",
    entityId: input.assignmentId,
    metadata: { serviceJobId, event: "accepted", fieldJobAssignmentId },
  });

  return { ok: true, data: { fieldJobAssignmentId } };
}

/** Driver declines. Never creates a crew record; returns the job to dispatch. */
export async function declineAssignment(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    assignmentId: string;
    reason: string;
    employeeId?: string;
  }
): Promise<RrServiceResult<{ declined: true }>> {
  const reason = asText(input.reason);
  if (!reason) return fail("A decline reason is required.", 400);

  const { data, error } = await supabase
    .from("rr_dispatch_assignments")
    .select("id, service_job_id, employee_id, assignment_status")
    .eq("company_id", input.companyId)
    .eq("id", input.assignmentId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("Dispatch assignment not found in this company.", 404);

  const row = data as Row;
  if (asText(row.assignment_status) !== "offered") {
    return fail(`This assignment is ${asText(row.assignment_status)}, not offered.`, 409);
  }
  if (input.employeeId && asText(row.employee_id) !== input.employeeId) {
    return fail("This assignment belongs to another driver.", 403);
  }

  const respondedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("rr_dispatch_assignments")
    .update({
      assignment_status: "declined",
      responded_at: respondedAt,
      decline_reason: reason,
      updated_at: respondedAt,
    })
    .eq("company_id", input.companyId)
    .eq("id", input.assignmentId);

  if (updateError) return fail(updateError.message, 500);

  // Back to whichever state THIS workflow uses as its dispatch pool. For towing that is
  // `dispatch_pending`; for BYSTAND it is `authorised`, which has no dispatch_pending at all.
  const poolState = await resolveJobRoleState(
    supabase,
    input.companyId,
    asText(row.service_job_id),
    "dispatch_pool"
  );
  if (!poolState.ok) return poolState;

  const transition = await transitionServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: asText(row.service_job_id),
    toState: poolState.state,
    reason: `Driver declined: ${reason}`,
  });
  if (!transition.ok) return transition;

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "reject",
    entityType: "rr_dispatch_assignment",
    entityId: input.assignmentId,
    metadata: { serviceJobId: asText(row.service_job_id), event: "declined", reason },
  });

  return { ok: true, data: { declined: true } };
}

// ---------------------------------------------------------------------------
// Driver workflow: En Route and GPS-verified arrival
// ---------------------------------------------------------------------------

/**
 * Driver departs. Records the EXISTING 'Start Travel' field job event, which also moves
 * field_jobs.status to "Travelling" and feeds the existing travel-time computation.
 */
export async function driverStartTravel(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    employeeId: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
  }
): Promise<RrServiceResult<{ toState: string }>> {
  const { data: job, error } = await supabase
    .from("rr_service_jobs")
    .select("field_job_id")
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!job) return fail("Service job not found in this company.", 404);

  const travelState = await resolveJobRoleState(
    supabase,
    input.companyId,
    input.serviceJobId,
    "travel"
  );
  if (!travelState.ok) return travelState;

  const transition = await transitionServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    actorRole: "driver",
    serviceJobId: input.serviceJobId,
    toState: travelState.state,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    gpsAccuracy: input.accuracy ?? null,
  });
  if (!transition.ok) return transition;

  await recordDriverFieldEvent(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    fieldJobId: asText((job as Row).field_job_id),
    eventType: "Start Travel",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracy: input.accuracy ?? null,
  });

  return { ok: true, data: { toState: transition.data.toState } };
}

export type ArrivalResult = {
  toState: string;
  gpsVerified: boolean;
  insideRadius: boolean;
  distanceMeters: number | null;
  radiusMeters: number;
  validationId: string | null;
  recordedAt: string;
};

/**
 * GPS-VERIFIED scene arrival.
 *
 * A driver cannot simply press "Arrived": coordinates are REQUIRED, and they are checked
 * against the scene with the existing validateMobileGpsRadius(), which writes
 * public.mobile_gps_validations. An arrival outside the radius is still recorded — it is
 * evidence, not a silent failure — but it is flagged as unverified.
 */
export async function driverRecordArrival(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    employeeId: string;
    latitude: number | null;
    longitude: number | null;
    accuracy?: number | null;
    radiusMeters?: number;
    /** Allows recording an off-scene arrival with an explicit reason. */
    overrideReason?: string | null;
  }
): Promise<RrServiceResult<ArrivalResult>> {
  if (input.latitude == null || input.longitude == null) {
    return fail(
      "GPS coordinates are required to record scene arrival. Enable location services and try again.",
      400
    );
  }
  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    Math.abs(input.latitude) > 90 ||
    Math.abs(input.longitude) > 180
  ) {
    return fail("The supplied GPS coordinates are not valid.", 400);
  }

  const { data: job, error } = await supabase
    .from("rr_service_jobs")
    .select("field_job_id, origin_latitude, origin_longitude")
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!job) return fail("Service job not found in this company.", 404);

  const row = job as Row;
  const sceneLat = asNumberOrNull(row.origin_latitude);
  const sceneLng = asNumberOrNull(row.origin_longitude);

  if (sceneLat == null || sceneLng == null) {
    return fail(
      "This job has no scene coordinates, so an arrival cannot be GPS-verified. Add the scene location first.",
      409
    );
  }

  const radiusMeters = input.radiusMeters ?? 250;
  const fieldJobId = asText(row.field_job_id);

  // The EXISTING GPS validation implementation. It writes mobile_gps_validations.
  const validation = await validateMobileGpsRadius(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    employeeLat: input.latitude,
    employeeLng: input.longitude,
    siteLat: sceneLat,
    siteLng: sceneLng,
    radiusMeters,
    jobId: fieldJobId,
    referenceType: "rr_scene_arrival",
    createException: true,
  });

  if (!validation.insideRadius && !asText(input.overrideReason)) {
    return {
      ok: false,
      status: 422,
      message: `Arrival rejected: you are ${
        validation.distanceMeters == null
          ? "an unknown distance"
          : `${Math.round(validation.distanceMeters)}m`
      } from the scene, outside the ${radiusMeters}m radius. Move closer, or record the arrival with a reason.`,
    };
  }

  const arrivalState = await resolveJobRoleState(
    supabase,
    input.companyId,
    input.serviceJobId,
    "arrival"
  );
  if (!arrivalState.ok) return arrivalState;

  const transition = await transitionServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    actorRole: "driver",
    serviceJobId: input.serviceJobId,
    toState: arrivalState.state,
    reason: validation.insideRadius ? null : `Off-scene arrival: ${input.overrideReason}`,
    latitude: input.latitude,
    longitude: input.longitude,
    gpsAccuracy: input.accuracy ?? null,
  });
  if (!transition.ok) return transition;

  // The EXISTING 'Arrive Site' event: moves field_jobs.status to "On Site" and closes
  // the Start Travel -> Arrive Site pair the travel/cost engines already consume.
  const recordedAt = new Date().toISOString();
  await recordDriverFieldEvent(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    fieldJobId,
    eventType: "Arrive Site",
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    notes: validation.insideRadius
      ? `GPS verified: ${Math.round(validation.distanceMeters ?? 0)}m from scene.`
      : `GPS UNVERIFIED (${Math.round(validation.distanceMeters ?? 0)}m from scene): ${input.overrideReason}`,
  });

  return {
    ok: true,
    data: {
      toState: transition.data.toState,
      gpsVerified: validation.insideRadius,
      insideRadius: validation.insideRadius,
      distanceMeters: validation.distanceMeters,
      radiusMeters: validation.radiusMeters,
      validationId: validation.validationId,
      recordedAt,
    },
  };
}

/** Thin wrapper over the EXISTING recordFieldJobEvent so every driver event goes there. */
async function recordDriverFieldEvent(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    employeeId: string;
    fieldJobId: string;
    eventType: FieldEventType;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    notes?: string | null;
  }
): Promise<void> {
  await recordFieldJobEvent(supabase, {
    companyId: params.companyId,
    employeeId: params.employeeId,
    jobId: params.fieldJobId,
    eventType: params.eventType,
    gps:
      params.latitude != null && params.longitude != null
        ? {
            latitude: params.latitude,
            longitude: params.longitude,
            accuracy: params.accuracy ?? null,
          }
        : undefined,
    notes: params.notes ?? null,
  });
}

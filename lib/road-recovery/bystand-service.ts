/**
 * VYRON CORE — BYSTAND operations service layer (Phase 2).
 *
 * The I/O half of BYSTAND. Every decision is delegated to a pure module:
 *
 *   which transitions are legal -> lib/road-recovery/state-machine.ts  (pure)
 *   how much time is billable   -> lib/road-recovery/standby-timer.ts  (pure)
 *   whether arrival is on scene -> lib/mobile-workforce-gps.ts         (existing)
 *
 * ---------------------------------------------------------------------------
 * SERVER-AUTHORITATIVE TIME
 * ---------------------------------------------------------------------------
 *
 * Every billing-relevant moment — begin standing, pause, resume, request stand-down,
 * stand-down, convert — is stamped HERE, on the server, by transitionServiceJob(). A
 * client-reported time is accepted only as telemetry and is written into the state
 * event's `metadata`, never into `occurred_at`. A device with a wrong clock therefore
 * cannot change what a counterparty is billed.
 *
 * ---------------------------------------------------------------------------
 * NO SERVICE-SPECIFIC STATE NAMES
 * ---------------------------------------------------------------------------
 *
 * This module is the one place that legitimately knows BYSTAND semantics, so it names
 * bystand transition targets directly. Everything generic (offer, accept, travel,
 * arrival, dispatch pool) still resolves through state roles in job-service.ts, so no
 * other service is affected.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import {
  createServiceJob,
  transitionServiceJob,
  type RrServiceResult,
} from "@/lib/road-recovery/job-service";
import {
  getWorkflowDefinition,
  isBillableStandingState,
  stateForRole,
} from "@/lib/road-recovery/state-machine";
import {
  computeBystandTimings,
  computeStandbyTime,
  RR_STANDBY_CALCULATOR_VERSION,
  type RrStandbyComputation,
} from "@/lib/road-recovery/standby-timer";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

/** Paused states for a workflow version, read from the definition rather than hardcoded. */
function pausedStatesFor(workflowKey: string, version: number | null): string[] {
  const definition = getWorkflowDefinition(workflowKey, version);
  if (!definition) return [];
  return definition.states.filter((entry) => entry.kind === "paused").map((entry) => entry.state);
}

export type BystandJobContext = {
  serviceJobId: string;
  fieldJobId: string;
  companyId: string;
  workflowKey: string;
  workflowVersion: number | null;
  serviceState: string;
  serviceCode: string;
};

/** Loads a job and refuses if it is not a BYSTAND attendance. */
export async function requireBystandJob(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<BystandJobContext>> {
  const { data, error } = await supabase
    .from("rr_service_jobs")
    .select("id, field_job_id, workflow_key, workflow_version, service_state, service_type_id")
    .eq("company_id", companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("Service job not found in this company.", 404);

  const row = data as Row;
  if (asText(row.workflow_key) !== "bystand") {
    return fail("This job is not a BYSTAND attendance.", 409);
  }

  const { data: type } = await supabase
    .from("rr_service_types")
    .select("service_code")
    .eq("company_id", companyId)
    .eq("id", asText(row.service_type_id))
    .maybeSingle();

  return {
    ok: true,
    data: {
      serviceJobId: asText(row.id),
      fieldJobId: asText(row.field_job_id),
      companyId,
      workflowKey: asText(row.workflow_key),
      workflowVersion: Number(row.workflow_version) || null,
      serviceState: asText(row.service_state),
      serviceCode: asText((type as Row | null)?.service_code) || "bystand",
    },
  };
}

// ---------------------------------------------------------------------------
// Standing clock control
// ---------------------------------------------------------------------------

/**
 * A BYSTAND transition, always stamped with SERVER time.
 *
 * `clientReportedAt` is telemetry only. It is stored in the state event's metadata so a
 * discrepancy can be investigated later, and it never influences billable time.
 */
async function bystandTransition(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    actorRole?: string | null;
    serviceJobId: string;
    toState: string;
    reason?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    clientReportedAt?: string | null;
  }
): Promise<RrServiceResult<{ fromState: string; toState: string }>> {
  const result = await transitionServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole ?? null,
    serviceJobId: input.serviceJobId,
    toState: input.toState,
    reason: input.reason ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    gpsAccuracy: input.accuracy ?? null,
  });
  if (!result.ok) return result;

  if (input.clientReportedAt) {
    // Telemetry only. Attached to the most recent event for this job so a clock-skew
    // investigation has something to compare against, without touching occurred_at.
    const { data: latest } = await supabase
      .from("rr_service_state_events")
      .select("id, metadata")
      .eq("company_id", input.companyId)
      .eq("service_job_id", input.serviceJobId)
      .order("occurred_at", { ascending: false })
      .limit(1);
    const row = ((latest || []) as Row[])[0];
    if (row) {
      // rr_service_state_events is append-only, so the telemetry is recorded on the
      // BYSTAND detail row instead of mutating the sealed event.
      await supabase
        .from("rr_bystand_details")
        .update({
          report_observations: {
            ...(typeof row.metadata === "object" && row.metadata ? row.metadata : {}),
            last_client_reported_at: input.clientReportedAt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", input.companyId)
        .eq("service_job_id", input.serviceJobId);
    }
  }

  return { ok: true, data: { fromState: result.data.fromState, toState: result.data.toState } };
}

/** Driver begins standing by. THIS is where billable time starts, and nowhere else. */
export async function beginStandingBy(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    clientReportedAt?: string | null;
  }
): Promise<RrServiceResult<{ toState: string; standingSince: string }>> {
  const job = await requireBystandJob(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  const standingState = stateForRole("bystand", "standing", job.data.workflowVersion);
  if (!standingState) return fail("This workflow has no standing-by state.", 409);

  const result = await bystandTransition(supabase, {
    ...input,
    actorRole: "driver",
    toState: standingState,
  });
  if (!result.ok) return result;

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_bystand_standing",
    entityId: input.serviceJobId,
    metadata: { event: "begin_standing_by", serverStamped: true },
  });

  return { ok: true, data: { toState: result.data.toState, standingSince: new Date().toISOString() } };
}

/** Pause the standing clock into one of the workflow's paused states. */
export async function pauseStanding(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    pauseState: string;
    reason: string;
    clientReportedAt?: string | null;
  }
): Promise<RrServiceResult<{ toState: string }>> {
  const job = await requireBystandJob(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  if (!asText(input.reason)) return fail("A pause reason is required.", 400);

  const paused = pausedStatesFor(job.data.workflowKey, job.data.workflowVersion);
  if (!paused.includes(input.pauseState)) {
    return fail(
      `"${input.pauseState}" is not a paused state for this workflow. Available: ${paused.join(", ")}.`,
      400
    );
  }

  const result = await bystandTransition(supabase, {
    ...input,
    actorRole: "driver",
    toState: input.pauseState,
    reason: input.reason,
  });
  if (!result.ok) return result;

  return { ok: true, data: { toState: result.data.toState } };
}

/** Resume standing by from a paused state. Billable time starts accruing again. */
export async function resumeStanding(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    clientReportedAt?: string | null;
  }
): Promise<RrServiceResult<{ toState: string }>> {
  const job = await requireBystandJob(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  const standingState = stateForRole("bystand", "standing", job.data.workflowVersion);
  if (!standingState) return fail("This workflow has no standing-by state.", 409);

  const result = await bystandTransition(supabase, {
    ...input,
    actorRole: "driver",
    toState: standingState,
  });
  if (!result.ok) return result;
  return { ok: true, data: { toState: result.data.toState } };
}

// ---------------------------------------------------------------------------
// Standby computation + sealing
// ---------------------------------------------------------------------------

/** Loads the state events and computes live standing time. Read-only. */
export async function computeStandbyForJob(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string,
  now: string | null
): Promise<RrServiceResult<{ computation: RrStandbyComputation; timings: ReturnType<typeof computeBystandTimings> }>> {
  const job = await requireBystandJob(supabase, companyId, serviceJobId);
  if (!job.ok) return job;

  const { data, error } = await supabase
    .from("rr_service_state_events")
    .select(
      "occurred_at, from_state, to_state, transition_code, enters_billable_standing_clock, leaves_billable_standing_clock"
    )
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .order("occurred_at", { ascending: true });

  if (error) return fail(error.message, 500);

  const rows = (data || []) as Row[];

  const computation = computeStandbyTime({
    events: rows.map((row) => ({
      occurredAt: asText(row.occurred_at),
      fromState: row.from_state ? asText(row.from_state) : null,
      toState: asText(row.to_state),
      entersBillableStandingClock: row.enters_billable_standing_clock === true,
      leavesBillableStandingClock: row.leaves_billable_standing_clock === true,
    })),
    pausedStates: pausedStatesFor(job.data.workflowKey, job.data.workflowVersion),
    now,
  });

  const timings = computeBystandTimings(
    rows.map((row) => ({
      occurredAt: asText(row.occurred_at),
      toState: asText(row.to_state),
      transitionCode: asText(row.transition_code),
    })),
    {
      offer: stateForRole("bystand", "offer", job.data.workflowVersion),
      arrival: stateForRole("bystand", "arrival", job.data.workflowVersion),
    }
  );

  return { ok: true, data: { computation, timings } };
}

/**
 * Seals the billable standing result.
 *
 * Append-only: a re-seal writes a NEW row rather than editing what was already billed.
 * The sealed row carries the full interval breakdown and the calculator version, so the
 * figure can be defended line by line long after the calculator has moved on.
 */
export async function sealStandbySummary(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    sealedReason: "stand_down" | "conversion" | "close" | "cancellation";
  }
): Promise<RrServiceResult<{ summaryId: string; totalBillableSeconds: number; totalPausedSeconds: number }>> {
  const computed = await computeStandbyForJob(
    supabase,
    input.companyId,
    input.serviceJobId,
    new Date().toISOString()
  );
  if (!computed.ok) return computed;

  const { computation, timings } = computed.data;

  const { data, error } = await supabase
    .from("rr_standby_summary")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      sealed_reason: input.sealedReason,
      sealed_by: input.actorEmail,
      total_billable_seconds: computation.totalBillableSeconds,
      total_paused_seconds: computation.totalPausedSeconds,
      standing_interval_count: computation.intervals.length,
      paused_interval_count: computation.pausedIntervals.length,
      first_standing_at: computation.firstStandingAt,
      last_standing_ended_at: computation.lastStandingEndedAt,
      interval_breakdown: computation.intervals,
      paused_breakdown: computation.pausedIntervals,
      anomalies: computation.anomalies,
      time_to_scene_seconds: timings.timeToSceneSeconds,
      stand_down_response_seconds: timings.standDownResponseSeconds,
      calculator_version: RR_STANDBY_CALCULATOR_VERSION,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not seal the standby summary.", 500);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_standby_summary",
    entityId: asText((data as Row).id),
    metadata: {
      serviceJobId: input.serviceJobId,
      sealedReason: input.sealedReason,
      totalBillableSeconds: computation.totalBillableSeconds,
      totalPausedSeconds: computation.totalPausedSeconds,
    },
  });

  return {
    ok: true,
    data: {
      summaryId: asText((data as Row).id),
      totalBillableSeconds: computation.totalBillableSeconds,
      totalPausedSeconds: computation.totalPausedSeconds,
    },
  };
}

// ---------------------------------------------------------------------------
// Stand-down
// ---------------------------------------------------------------------------

export async function requestStandDown(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    requestedBy?: string | null;
    channel?: string | null;
    reason?: string | null;
  }
): Promise<RrServiceResult<{ toState: string }>> {
  const job = await requireBystandJob(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  const result = await bystandTransition(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    toState: "stand_down_requested",
    reason: input.reason ?? null,
  });
  if (!result.ok) return result;

  await upsertBystandDetails(supabase, input.companyId, input.serviceJobId, {
    stand_down_requested_by: input.requestedBy || null,
    stand_down_channel: input.channel || null,
    stand_down_reason: input.reason || null,
  });

  return { ok: true, data: { toState: result.data.toState } };
}

/** Confirms stand-down and SEALS the billable standing result in the same operation. */
export async function confirmStandDown(
  supabase: SupabaseClient,
  input: { companyId: string; actorEmail: string; serviceJobId: string }
): Promise<
  RrServiceResult<{ toState: string; summaryId: string; totalBillableSeconds: number; totalPausedSeconds: number }>
> {
  const result = await bystandTransition(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    toState: "stood_down",
  });
  if (!result.ok) return result;

  const sealed = await sealStandbySummary(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    sealedReason: "stand_down",
  });
  if (!sealed.ok) return sealed;

  return { ok: true, data: { toState: result.data.toState, ...sealed.data } };
}

// ---------------------------------------------------------------------------
// Convert to recovery
// ---------------------------------------------------------------------------

export type ConvertToRecoveryResult = {
  bystandServiceJobId: string;
  recoveryServiceJobId: string;
  recoveryFieldJobId: string;
  recoveryJobRef: string;
  standbySummaryId: string;
  totalBillableSeconds: number;
};

/**
 * Converts a BYSTAND attendance into a SEPARATE linked recovery job.
 *
 * The BYSTAND job is never mutated into a tow. It keeps its service type, its workflow,
 * its evidence and its standing billing, and it proceeds to its own stand-down and close.
 * The recovery is a brand-new field job + service job that points back at it.
 *
 * Ordering is deliberate: the standing clock is stopped and SEALED before the new job is
 * created, so a failure creating the recovery cannot leave the attendance billing
 * indefinitely.
 */
export async function convertBystandToRecovery(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    reason: string;
    recoveryServiceCode?: string;
    recoveryTitle?: string;
    destinationType?: string | null;
    destinationLabel?: string | null;
    destinationAddress?: string | null;
  }
): Promise<RrServiceResult<ConvertToRecoveryResult>> {
  const reason = asText(input.reason);
  if (!reason) return fail("A conversion reason is required.", 400);

  const job = await requireBystandJob(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  const { data: source, error: sourceError } = await supabase
    .from("rr_service_jobs")
    .select(
      "origin_label, origin_address, origin_latitude, origin_longitude, vehicle_registration, vehicle_make, vehicle_model, scene_description, counterparty_id, incident_at"
    )
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();
  if (sourceError) return fail(sourceError.message, 500);
  const sourceRow = (source || {}) as Row;

  // 1. Stop the standing clock. The state machine decides whether this is legal from the
  //    current state (v2 also permits it from a paused state).
  const stopped = await bystandTransition(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    toState: "converted_to_recovery",
    reason,
  });
  if (!stopped.ok) return stopped;

  // 2. Seal the attendance's own billable standing time before anything else can fail.
  const sealed = await sealStandbySummary(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    sealedReason: "conversion",
  });
  if (!sealed.ok) return sealed;

  // 3. Create the SEPARATE recovery job.
  const created = await createServiceJob(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceCode: input.recoveryServiceCode || "accident_recovery",
    title:
      input.recoveryTitle ||
      `Recovery from BYSTAND: ${asText(sourceRow.vehicle_registration) || "vehicle"}`,
    counterpartyId: asText(sourceRow.counterparty_id) || null,
    incidentAt: asText(sourceRow.incident_at) || null,
    sceneDescription: asText(sourceRow.scene_description) || null,
    originLabel: asText(sourceRow.origin_label) || null,
    originAddress: asText(sourceRow.origin_address) || null,
    originLatitude: sourceRow.origin_latitude == null ? null : Number(sourceRow.origin_latitude),
    originLongitude: sourceRow.origin_longitude == null ? null : Number(sourceRow.origin_longitude),
    destinationType: input.destinationType || null,
    destinationLabel: input.destinationLabel || null,
    destinationAddress: input.destinationAddress || null,
    vehicleRegistration: asText(sourceRow.vehicle_registration) || null,
    vehicleMake: asText(sourceRow.vehicle_make) || null,
    vehicleModel: asText(sourceRow.vehicle_model) || null,
    priority: "urgent",
  });
  if (!created.ok) return created;

  // 4. Link them, one-directionally: the recovery points back at the attendance.
  const { error: linkError } = await supabase
    .from("rr_service_jobs")
    .update({
      spawned_from_service_job_id: input.serviceJobId,
      spawn_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", created.data.serviceJobId);
  if (linkError) return fail(linkError.message, 500);

  await upsertBystandDetails(supabase, input.companyId, input.serviceJobId, {
    converted_service_job_id: created.data.serviceJobId,
    converted_at: new Date().toISOString(),
    conversion_reason: reason,
  });

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_bystand_conversion",
    entityId: input.serviceJobId,
    metadata: {
      recoveryServiceJobId: created.data.serviceJobId,
      recoveryJobRef: created.data.jobRef,
      reason,
      sealedBillableSeconds: sealed.data.totalBillableSeconds,
    },
  });

  return {
    ok: true,
    data: {
      bystandServiceJobId: input.serviceJobId,
      recoveryServiceJobId: created.data.serviceJobId,
      recoveryFieldJobId: created.data.fieldJobId,
      recoveryJobRef: created.data.jobRef,
      standbySummaryId: sealed.data.summaryId,
      totalBillableSeconds: sealed.data.totalBillableSeconds,
    },
  };
}

// ---------------------------------------------------------------------------
// Details + evidence
// ---------------------------------------------------------------------------

/** Creates or updates the BYSTAND detail row for a job. */
export async function upsertBystandDetails(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error: string | null }> {
  const { data: existing } = await supabase
    .from("rr_bystand_details")
    .select("id")
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("rr_bystand_details")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId);
    return { ok: !error, error: error?.message ?? null };
  }

  const { error } = await supabase
    .from("rr_bystand_details")
    .insert({ company_id: companyId, service_job_id: serviceJobId, ...patch });
  return { ok: !error, error: error?.message ?? null };
}

/** Submits the driver's observation report and advances the workflow. */
export async function submitObservationReport(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    summary: string;
    observations?: Record<string, unknown>;
  }
): Promise<RrServiceResult<{ toState: string }>> {
  if (!asText(input.summary)) return fail("A report summary is required.", 400);

  const job = await requireBystandJob(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  await upsertBystandDetails(supabase, input.companyId, input.serviceJobId, {
    report_summary: input.summary,
    report_observations: input.observations || {},
    report_submitted_at: new Date().toISOString(),
    report_submitted_by: input.actorEmail,
  });

  const result = await bystandTransition(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    actorRole: "driver",
    serviceJobId: input.serviceJobId,
    toState: "report_submitted",
  });
  if (!result.ok) return result;

  return { ok: true, data: { toState: result.data.toState } };
}

export const RR_BYSTAND_EVIDENCE_TYPES = [
  "bystand_scene",
  "bystand_periodic",
  "bystand_stand_down",
  "bystand_report_attachment",
] as const;

export type RrBystandEvidenceType = (typeof RR_BYSTAND_EVIDENCE_TYPES)[number];

export const RR_EVIDENCE_BUCKET = "rr-evidence";

/**
 * Records a BYSTAND evidence item.
 *
 * Files live in Supabase Storage; only the bucket, path and metadata are stored here.
 * A GPS-only presence record simply has no storage path — and because the client portal
 * filters on `photo_url IS NOT NULL`, those rows never leak into it.
 */
/**
 * Which requirement each BYSTAND capture satisfies, from the policy seeded by sql/073.
 *
 * Deliberately partial: `bystand_reason` and `bystand_conversion_reason` are recorded
 * details that come from the attendance record and the conversion, not from a capture, so
 * they have no entry here and are satisfied on their own paths.
 */
const RR_BYSTAND_EVIDENCE_REQUIREMENTS: Partial<Record<RrBystandEvidenceType, string>> = {
  bystand_scene: "bystand_scene_photo",
  bystand_periodic: "bystand_periodic_presence",
  bystand_stand_down: "bystand_stand_down_record",
  bystand_report_attachment: "bystand_observation_report",
};

export async function recordBystandEvidence(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    employeeId: string;
    serviceJobId: string;
    fieldJobId: string;
    evidenceType: RrBystandEvidenceType;
    storagePath?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<RrServiceResult<{ evidenceId: string }>> {
  if (!RR_BYSTAND_EVIDENCE_TYPES.includes(input.evidenceType)) {
    return fail(`Unknown BYSTAND evidence type: ${input.evidenceType}`, 400);
  }

  const { data, error } = await supabase
    .from("mobile_workforce_evidence")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      job_id: input.fieldJobId,
      service_job_id: input.serviceJobId,
      evidence_type: input.evidenceType,
      storage_bucket: input.storagePath ? RR_EVIDENCE_BUCKET : null,
      storage_path: input.storagePath || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      gps_accuracy: input.accuracy ?? null,
      captured_by_role: "driver",
      notes: input.notes || null,
      metadata: input.metadata || {},
      captured_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record evidence.", 500);
  const evidenceId = asText((data as Row).id);

  /**
   * Link it to the requirement it satisfies.
   *
   * Without this the driver's "Record presence" and "Scene evidence" buttons wrote a real,
   * GPS-stamped evidence row that the compliance engine never counted — because compliance
   * counts rr_evidence_links, not rows — so a BYSTAND attendance could still only reach
   * billing on waivers no matter how diligently the driver worked. The mapping is the
   * BYSTAND policy's own requirement codes (sql/073); a type with no counterpart links
   * nothing rather than guessing.
   *
   * Best-effort and deliberately non-fatal: an attendance whose policy has been customised
   * away from these codes must still record the evidence. The item is captured either way,
   * and `linkEvidenceToRequirements` skips a code the job does not have.
   */
  const requirementCode = RR_BYSTAND_EVIDENCE_REQUIREMENTS[input.evidenceType];
  if (requirementCode) {
    const { linkEvidenceToRequirements } = await import("@/lib/road-recovery/requirements-service");
    await linkEvidenceToRequirements(supabase, {
      companyId: input.companyId,
      actorEmail: input.actorEmail,
      serviceJobId: input.serviceJobId,
      evidenceId,
      requirementCodes: [requirementCode],
    });
  }

  return { ok: true, data: { evidenceId } };
}

/** True only if the job is currently accruing billable standing time. */
export function isStandingNow(context: BystandJobContext): boolean {
  return isBillableStandingState(context.workflowKey, context.serviceState, context.workflowVersion);
}

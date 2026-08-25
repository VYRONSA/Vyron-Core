/**
 * VYRON CORE — Road & Recovery dispatch data layer (Phase 1).
 *
 * ALL the I/O for dispatch lives here, and NONE of the decision logic. The decision is
 * made by lib/road-recovery/dispatch.ts, which is pure. Keeping them apart is what lets
 * the eligibility rules be unit-tested exhaustively without a database, and what stops
 * a query change from quietly altering who is eligible.
 *
 * Reuses, rather than rebuilds:
 *   public.employees                the driver (no second employee system)
 *   public.field_vehicles           truck identity and the driver<->truck pairing via
 *                                   field_vehicles.assigned_employee_id
 *   public.rr_tow_truck_profiles    tow capability only
 *   public.rr_driver_certifications competency and expiry
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RR_DISPATCH_ENGINE_VERSION,
  evaluateDispatchCandidates,
  requirementForService,
  type RrCandidateInput,
  type RrCertificationSnapshot,
  type RrDispatchEvaluation,
  type RrDriverSnapshot,
  type RrServiceRequirement,
  type RrTowClass,
  type RrTruckAvailability,
  type RrTruckSnapshot,
} from "@/lib/road-recovery/dispatch";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Loads every driver/truck pairing in the company, with the certifications and live
 * commitments the engine needs. One snapshot, evaluated in memory — no per-candidate
 * queries.
 */
export async function loadDispatchCandidates(
  supabase: SupabaseClient,
  companyId: string,
  excludeServiceJobId: string | null
): Promise<{ candidates: RrCandidateInput[]; error: string | null }> {
  const [employeesRes, trucksRes, certificationsRes, liveAssignmentsRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, company_id, first_name, last_name, active")
      .eq("company_id", companyId)
      .eq("active", true),
    supabase
      .from("rr_tow_truck_profiles")
      .select(
        "id, company_id, field_vehicle_id, tow_class, payload_capacity_kg, max_vehicle_length_m, has_winch, has_boom, equipment, availability_status, operational_status, current_latitude, current_longitude, base_latitude, base_longitude"
      )
      .eq("company_id", companyId),
    supabase
      .from("rr_driver_certifications")
      .select("employee_id, certification_type, status, expires_at, blocks_dispatch")
      .eq("company_id", companyId),
    supabase
      .from("rr_dispatch_assignments")
      .select("id, employee_id, service_job_id, assignment_status")
      .eq("company_id", companyId)
      .in("assignment_status", ["offered", "accepted"]),
  ]);

  const firstError =
    employeesRes.error || trucksRes.error || certificationsRes.error || liveAssignmentsRes.error;
  if (firstError) {
    return { candidates: [], error: firstError.message };
  }

  // Truck identity (registration) comes from field_vehicles, which also carries the
  // driver pairing. Fetched separately so a missing profile never hides a vehicle.
  const vehicleIds = ((trucksRes.data || []) as Row[])
    .map((row) => asText(row.field_vehicle_id))
    .filter(Boolean);

  const vehiclesRes = vehicleIds.length
    ? await supabase
        .from("field_vehicles")
        .select("id, company_id, registration, assigned_employee_id, status")
        .eq("company_id", companyId)
        .in("id", vehicleIds)
    : { data: [] as Row[], error: null };

  if (vehiclesRes.error) {
    return { candidates: [], error: vehiclesRes.error.message };
  }

  const vehicleById = new Map<string, Row>(
    ((vehiclesRes.data || []) as Row[]).map((row) => [asText(row.id), row])
  );

  const certificationsByEmployee = new Map<string, RrCertificationSnapshot[]>();
  for (const row of (certificationsRes.data || []) as Row[]) {
    const employeeId = asText(row.employee_id);
    const list = certificationsByEmployee.get(employeeId) ?? [];
    list.push({
      certificationType: asText(row.certification_type),
      status: asText(row.status) || "active",
      expiresAt: row.expires_at ? asText(row.expires_at) : null,
      blocksDispatch: row.blocks_dispatch !== false,
    });
    certificationsByEmployee.set(employeeId, list);
  }

  // A driver already committed to a DIFFERENT job is in conflict. A live assignment on
  // THIS job is not a conflict — that is the reassignment case.
  const conflictByEmployee = new Map<string, string>();
  for (const row of (liveAssignmentsRes.data || []) as Row[]) {
    const jobId = asText(row.service_job_id);
    if (excludeServiceJobId && jobId === excludeServiceJobId) continue;
    conflictByEmployee.set(asText(row.employee_id), asText(row.id));
  }

  const truckByEmployee = new Map<string, RrTruckSnapshot>();
  for (const row of (trucksRes.data || []) as Row[]) {
    const vehicleId = asText(row.field_vehicle_id);
    const vehicle = vehicleById.get(vehicleId);
    if (!vehicle) continue;
    const assignedEmployeeId = asText(vehicle.assigned_employee_id);
    if (!assignedEmployeeId) continue;

    const equipment = Array.isArray(row.equipment)
      ? (row.equipment as unknown[]).map((item) => asText(item))
      : [];

    truckByEmployee.set(assignedEmployeeId, {
      towTruckProfileId: asText(row.id),
      fieldVehicleId: vehicleId,
      companyId: asText(row.company_id),
      registration: asText(vehicle.registration) || null,
      towClass: (asText(row.tow_class) || "light_duty") as RrTowClass,
      payloadCapacityKg: asNumberOrNull(row.payload_capacity_kg),
      maxVehicleLengthM: asNumberOrNull(row.max_vehicle_length_m),
      hasWinch: row.has_winch === true,
      hasBoom: row.has_boom === true,
      equipment,
      availabilityStatus: (asText(row.availability_status) || "available") as RrTruckAvailability,
      operationalStatus: (asText(row.operational_status) || "operational") as
        | "operational"
        | "limited"
        | "grounded",
      // Prefer a live position; fall back to the depot so a truck without telemetry is
      // still ranked on a real distance rather than dropped.
      latitude: asNumberOrNull(row.current_latitude) ?? asNumberOrNull(row.base_latitude),
      longitude: asNumberOrNull(row.current_longitude) ?? asNumberOrNull(row.base_longitude),
    });
  }

  const candidates: RrCandidateInput[] = ((employeesRes.data || []) as Row[]).map((row) => {
    const employeeId = asText(row.id);
    const driver: RrDriverSnapshot = {
      employeeId,
      companyId: asText(row.company_id),
      displayName: `${asText(row.first_name)} ${asText(row.last_name)}`.trim() || employeeId,
      active: row.active !== false,
      certifications: certificationsByEmployee.get(employeeId) ?? [],
      conflictingAssignmentId: conflictByEmployee.get(employeeId) ?? null,
    };
    return { driver, truck: truckByEmployee.get(employeeId) ?? null };
  });

  return { candidates, error: null };
}

export type RrJobDispatchContext = {
  serviceJobId: string;
  fieldJobId: string;
  serviceCode: string;
  serviceState: string;
  workflowKey: string;
  sceneLatitude: number | null;
  sceneLongitude: number | null;
  vehicleRegistration: string | null;
};

/** Loads the job facts the engine needs, with its service code. */
export async function loadJobDispatchContext(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<{ context: RrJobDispatchContext | null; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_service_jobs")
    .select(
      "id, field_job_id, service_type_id, workflow_key, service_state, origin_latitude, origin_longitude, vehicle_registration"
    )
    .eq("company_id", companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (error) return { context: null, error: error.message };
  if (!data) return { context: null, error: "Service job not found in this company." };

  const row = data as Row;

  const { data: serviceType, error: serviceTypeError } = await supabase
    .from("rr_service_types")
    .select("service_code")
    .eq("company_id", companyId)
    .eq("id", asText(row.service_type_id))
    .maybeSingle();

  if (serviceTypeError) return { context: null, error: serviceTypeError.message };

  return {
    context: {
      serviceJobId: asText(row.id),
      fieldJobId: asText(row.field_job_id),
      serviceCode: asText((serviceType as Row | null)?.service_code) || "tow_in",
      serviceState: asText(row.service_state),
      workflowKey: asText(row.workflow_key),
      sceneLatitude: asNumberOrNull(row.origin_latitude),
      sceneLongitude: asNumberOrNull(row.origin_longitude),
      vehicleRegistration: asText(row.vehicle_registration) || null,
    },
    error: null,
  };
}

/**
 * Runs a full evaluation and PERSISTS every candidate to rr_dispatch_candidates.
 *
 * The persistence is the explainability record: eligible or not, every candidate's
 * reasoning is written, so the decision can be defended after the fact.
 */
export async function evaluateAndPersistCandidates(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    serviceJobId: string;
    evaluatedBy: string;
    evaluatedAt: string;
    evaluationId: string;
    requirementOverrides?: Partial<RrServiceRequirement>;
    /**
     * Deliberately re-include drivers who already declined THIS job.
     *
     * The controller's override, off by default.
     */
    includeDeclined?: boolean;
  }
): Promise<{ evaluation: RrDispatchEvaluation | null; error: string | null }> {
  const { context, error: contextError } = await loadJobDispatchContext(
    supabase,
    params.companyId,
    params.serviceJobId
  );
  if (contextError || !context) return { evaluation: null, error: contextError };

  const { candidates, error: candidatesError } = await loadDispatchCandidates(
    supabase,
    params.companyId,
    params.serviceJobId
  );
  if (candidatesError) return { evaluation: null, error: candidatesError };

  const requirement = requirementForService(context.serviceCode, params.requirementOverrides ?? {});

  /**
   * Who already refused THIS job.
   *
   * Read from the job's own assignment history, so the exclusion is job-scoped:
   * a driver who declines one recovery is unaffected on every other job. Read
   * under the caller's RLS like everything else here.
   */
  const { data: declinedRows } = await supabase
    .from("rr_dispatch_assignments")
    .select("employee_id,decline_reason,responded_at")
    .eq("company_id", params.companyId)
    .eq("service_job_id", params.serviceJobId)
    .eq("assignment_status", "declined");

  const declined = (declinedRows || []).map((row) => {
    const typed = row as { employee_id: string; decline_reason: string | null; responded_at: string | null };
    return {
      employeeId: String(typed.employee_id),
      reason: typed.decline_reason,
      declinedAt: typed.responded_at,
    };
  });

  const evaluation = evaluateDispatchCandidates({
    companyId: params.companyId,
    serviceJobId: params.serviceJobId,
    scene: { latitude: context.sceneLatitude, longitude: context.sceneLongitude },
    requirement,
    candidates,
    evaluatedAt: params.evaluatedAt,
    declined,
    includeDeclined: params.includeDeclined === true,
  });

  if (evaluation.candidates.length > 0) {
    const rows = evaluation.candidates.map((candidate) => ({
      company_id: params.companyId,
      service_job_id: params.serviceJobId,
      evaluation_id: params.evaluationId,
      evaluated_at: params.evaluatedAt,
      evaluated_by: params.evaluatedBy,
      employee_id: candidate.employeeId,
      field_vehicle_id: candidate.fieldVehicleId,
      tow_truck_profile_id: candidate.towTruckProfileId,
      eligible: candidate.eligible,
      eligibility_failures: candidate.eligibilityFailures,
      distance_km: candidate.distanceKm,
      capability_result: candidate.capabilityResult,
      certification_result: candidate.certificationResult,
      availability_status: candidate.availabilityStatus,
      conflicting_assignment_id: candidate.conflictingAssignmentId,
      score_components: candidate.scoreComponents,
      final_score: candidate.finalScore,
      rank: candidate.rank,
      recommended: candidate.recommended,
      recommendation_reason: candidate.recommendationReason,
      engine_version: RR_DISPATCH_ENGINE_VERSION,
    }));

    const { error: insertError } = await supabase.from("rr_dispatch_candidates").insert(rows);
    if (insertError) return { evaluation: null, error: insertError.message };
  }

  return { evaluation, error: null };
}

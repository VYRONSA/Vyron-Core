import { NextRequest, NextResponse } from "next/server";
import { computeStandbyTime } from "@/lib/road-recovery/standby-timer";
import { getWorkflowDefinition } from "@/lib/road-recovery/state-machine";
import {
  errorResponse,
  parseError,
  requireApiContext,
  resolveDriverEmployeeId,
} from "@/lib/road-recovery/api";

/** Narrow an unknown row value to a trimmed string; "" when absent. */
function asId(value: unknown): string {
  return String(value ?? "").trim();
}

/** The signed-in driver's own dispatch inbox. Identity comes from the session. */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const driver = await resolveDriverEmployeeId(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      context.ctx.auth.email
    );
    if (!driver.ok) return errorResponse(driver.message, driver.status);

    const { data: assignments, error } = await context.ctx.auth.supabase
      .from("rr_dispatch_assignments")
      .select(
        "id,service_job_id,assignment_status,offered_at,responded_at,field_vehicle_id,notes"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("employee_id", driver.employeeId)
      .in("assignment_status", ["offered", "accepted"])
      .order("offered_at", { ascending: false });

    if (error) return errorResponse("Could not load your assignments.", 500);

    const jobIds = ((assignments || []) as { service_job_id: string }[]).map(
      (row) => row.service_job_id
    );

    const { data: jobs } = jobIds.length
      ? await context.ctx.auth.supabase
          .from("rr_service_jobs")
          .select(
            "id,workflow_key,workflow_version,service_state,origin_label,origin_address,origin_latitude,origin_longitude,destination_label,destination_address,destination_latitude,destination_longitude,vehicle_registration,vehicle_make,vehicle_model,vehicle_colour,vehicle_is_drivable,scene_description,field_job_id,service_type_id,casualty_flag,hazmat_flag"
          )
          .eq("company_id", context.ctx.companyId)
          .in("id", jobIds)
      : { data: [] };

    // BYSTAND jobs carry their live standing snapshot, computed on the SERVER from the
    // append-only state-event stream. The driver's device never supplies a billable number.
    type JobRow = Record<string, unknown>;
    const jobRows = (jobs || []) as JobRow[];
    const bystandIds = jobRows
      .filter((row) => String(row.workflow_key) === "bystand")
      .map((row) => String(row.id));

    const { data: events } = bystandIds.length
      ? await context.ctx.auth.supabase
          .from("rr_service_state_events")
          .select(
            "service_job_id,occurred_at,from_state,to_state,enters_billable_standing_clock,leaves_billable_standing_clock"
          )
          .eq("company_id", context.ctx.companyId)
          .in("service_job_id", bystandIds)
          .order("occurred_at", { ascending: true })
      : { data: [] };

    const now = new Date().toISOString();
    const eventsByJob = new Map<string, JobRow[]>();
    for (const row of ((events || []) as JobRow[])) {
      const key = String(row.service_job_id);
      const list = eventsByJob.get(key) ?? [];
      list.push(row);
      eventsByJob.set(key, list);
    }

    const enrichedJobs = jobRows.map((row) => {
      if (String(row.workflow_key) !== "bystand") return row;
      const version = Number(row.workflow_version) || null;
      const definition = getWorkflowDefinition("bystand", version);
      const pausedStates = (definition?.states || [])
        .filter((entry) => entry.kind === "paused")
        .map((entry) => entry.state);

      const standby = computeStandbyTime({
        events: (eventsByJob.get(String(row.id)) ?? []).map((event) => ({
          occurredAt: String(event.occurred_at),
          fromState: event.from_state ? String(event.from_state) : null,
          toState: String(event.to_state),
          entersBillableStandingClock: event.enters_billable_standing_clock === true,
          leavesBillableStandingClock: event.leaves_billable_standing_clock === true,
        })),
        pausedStates,
        now,
      });

      return {
        ...row,
        pausedStates,
        standby: {
          totalBillableSeconds: standby.totalBillableSeconds,
          totalPausedSeconds: standby.totalPausedSeconds,
          standingNow: standby.standingNow,
          intervalCount: standby.intervals.length,
        },
      };
    });

    /**
     * The three things a driver decides on that do NOT live on rr_service_jobs.
     *
     * The job reference and priority are on the parent field_jobs row, the service name
     * on rr_service_types, and the truck on rr_tow_truck_profiles. Fetched in one batch
     * per table and joined in memory, tenant-filtered throughout, so the driver card can
     * show "RR-2026-00124 · Accident Recovery · HIGH · TOW-04" without another round trip
     * from the device.
     */
    const fieldJobIds = jobRows.map((r) => asId(r.field_job_id)).filter(Boolean);
    const serviceTypeIds = jobRows.map((r) => asId(r.service_type_id)).filter(Boolean);
    const vehicleIds = ((assignments || []) as JobRow[])
      .map((r) => asId(r.field_vehicle_id))
      .filter(Boolean);

    const [parents, types, trucks] = await Promise.all([
      fieldJobIds.length
        ? context.ctx.auth.supabase
            .from("field_jobs")
            .select("id,job_ref,priority,title,customer_name")
            .eq("company_id", context.ctx.companyId)
            .in("id", fieldJobIds)
        : Promise.resolve({ data: [] }),
      serviceTypeIds.length
        ? context.ctx.auth.supabase
            .from("rr_service_types")
            .select("id,name,service_code")
            .eq("company_id", context.ctx.companyId)
            .in("id", serviceTypeIds)
        : Promise.resolve({ data: [] }),
      vehicleIds.length
        ? context.ctx.auth.supabase
            .from("rr_tow_truck_profiles")
            .select("field_vehicle_id,tow_class")
            .eq("company_id", context.ctx.companyId)
            .in("field_vehicle_id", vehicleIds)
        : Promise.resolve({ data: [] }),
    ]);

    const parentById = new Map(
      ((parents.data || []) as JobRow[]).map((r) => [asId(r.id), r])
    );
    const typeById = new Map(((types.data || []) as JobRow[]).map((r) => [asId(r.id), r]));
    const truckByVehicle = new Map(
      ((trucks.data || []) as JobRow[]).map((r) => [asId(r.field_vehicle_id), r])
    );

    // Registration is the driver's name for the truck and lives on field_vehicles;
    // rr_tow_truck_profiles carries only tow capability.
    const { data: vehicleRows } = vehicleIds.length
      ? await context.ctx.auth.supabase
          .from("field_vehicles")
          .select("id,registration,make_model")
          .eq("company_id", context.ctx.companyId)
          .in("id", vehicleIds)
      : { data: [] };
    const vehicleById = new Map(
      ((vehicleRows || []) as JobRow[]).map((r) => [asId(r.id), r])
    );

    /**
     * The evidence each job still needs.
     *
     * Folded into THIS payload rather than fetched per job: a driver on a weak
     * connection should pay for one request, not one plus N. The requirement
     * snapshot (rr_evidence_requirements) is what the compliance engine counts,
     * and rr_evidence_links records what has been satisfied, so the two together
     * are the same arithmetic the Compliance screen performs.
     */
    const { data: requirementRows } = jobIds.length
      ? await context.ctx.auth.supabase
          .from("rr_evidence_requirements")
          .select("service_job_id,requirement_code,label,mandatory")
          .eq("company_id", context.ctx.companyId)
          .in("service_job_id", jobIds)
      : { data: [] };

    const { data: linkRows } = jobIds.length
      ? await context.ctx.auth.supabase
          .from("rr_evidence_links")
          .select("service_job_id,requirement_code")
          .eq("company_id", context.ctx.companyId)
          .in("service_job_id", jobIds)
      : { data: [] };

    const satisfiedByJob = new Map<string, Set<string>>();
    for (const row of ((linkRows || []) as JobRow[])) {
      const job = asId(row.service_job_id);
      const set = satisfiedByJob.get(job) ?? new Set<string>();
      set.add(asId(row.requirement_code));
      satisfiedByJob.set(job, set);
    }

    const requirementsByJob = new Map<string, { required: number; satisfied: number; missingLabels: string[] }>();
    for (const row of ((requirementRows || []) as JobRow[])) {
      // Optional items are shown to the driver but never counted as blocking.
      if (row.mandatory === false) continue;
      const job = asId(row.service_job_id);
      const code = asId(row.requirement_code);
      const summary = requirementsByJob.get(job) ?? { required: 0, satisfied: 0, missingLabels: [] };
      summary.required += 1;
      if ((satisfiedByJob.get(job) ?? new Set()).has(code)) summary.satisfied += 1;
      else summary.missingLabels.push(asId(row.label) || code);
      requirementsByJob.set(job, summary);
    }

    const decoratedJobs = enrichedJobs.map((row) => {
      const parent = parentById.get(asId(row.field_job_id));
      const type = typeById.get(asId(row.service_type_id));
      return {
        ...row,
        job_ref: parent ? asId(parent.job_ref) || null : null,
        priority: parent ? asId(parent.priority) || null : null,
        customer_name: parent ? asId(parent.customer_name) || null : null,
        service_type_name: type ? asId(type.name) || null : null,
        service_code: type ? asId(type.service_code) || null : null,
        requirements: requirementsByJob.get(asId(row.id)) ?? null,
      };
    });

    const decoratedAssignments = ((assignments || []) as JobRow[]).map((row) => {
      const truck = truckByVehicle.get(asId(row.field_vehicle_id));
      const vehicle = vehicleById.get(asId(row.field_vehicle_id));
      const label = [
        vehicle ? asId(vehicle.registration) : "",
        truck ? asId(truck.tow_class).replace(/_/g, " ") : "",
      ].filter(Boolean).join(" · ");
      return { ...row, vehicle_label: label || null };
    });

    return NextResponse.json({
      ok: true,
      employeeId: driver.employeeId,
      fetchedAt: now,
      assignments: decoratedAssignments,
      jobs: decoratedJobs,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

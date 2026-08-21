import { NextRequest, NextResponse } from "next/server";
import { computeStandbyTime } from "@/lib/road-recovery/standby-timer";
import { getWorkflowDefinition } from "@/lib/road-recovery/state-machine";
import {
  errorResponse,
  parseError,
  requireApiContext,
  resolveDriverEmployeeId,
} from "@/lib/road-recovery/api";

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
      .select("id,service_job_id,assignment_status,offered_at,responded_at,field_vehicle_id")
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
            "id,workflow_key,workflow_version,service_state,origin_label,origin_address,origin_latitude,origin_longitude,destination_label,vehicle_registration,vehicle_make,vehicle_model,scene_description"
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

    return NextResponse.json({
      ok: true,
      employeeId: driver.employeeId,
      fetchedAt: now,
      assignments: assignments || [],
      jobs: enrichedJobs,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

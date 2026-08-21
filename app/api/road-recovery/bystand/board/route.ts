import { NextRequest, NextResponse } from "next/server";
import { computeBystandTimings, computeStandbyTime } from "@/lib/road-recovery/standby-timer";
import { getWorkflowDefinition, stateForRole } from "@/lib/road-recovery/state-machine";
import { errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

type Row = Record<string, unknown>;

/**
 * The BYSTAND board in one read.
 *
 * Standing time is DERIVED per job from the state-event stream, on the server, using the
 * server clock — the board never trusts a client for a billable number.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const companyId = context.ctx.companyId;
    const supabase = context.ctx.auth.supabase;
    const now = new Date().toISOString();

    const { data: jobs, error: jobsError } = await supabase
      .from("rr_service_jobs")
      .select(
        "id,field_job_id,workflow_key,workflow_version,service_state,state_entered_at,counterparty_id,origin_label,origin_address,origin_latitude,origin_longitude,vehicle_registration,vehicle_make,vehicle_model,scene_description,spawned_from_service_job_id,created_at"
      )
      .eq("company_id", companyId)
      .eq("workflow_key", "bystand")
      .eq("record_status", "active")
      .order("created_at", { ascending: false })
      .limit(200);

    if (jobsError) return errorResponse("Could not load the BYSTAND board.", 500);

    const jobRows = (jobs || []) as Row[];
    const jobIds = jobRows.map((row) => String(row.id));

    const [eventsRes, detailsRes, assignmentsRes, summariesRes, reasonsRes, counterpartiesRes] =
      await Promise.all([
      jobIds.length
        ? supabase
            .from("rr_service_state_events")
            .select(
              "service_job_id,occurred_at,from_state,to_state,transition_code,enters_billable_standing_clock,leaves_billable_standing_clock"
            )
            .eq("company_id", companyId)
            .in("service_job_id", jobIds)
            .order("occurred_at", { ascending: true })
        : { data: [], error: null },
      jobIds.length
        ? supabase
            .from("rr_bystand_details")
            .select(
              "service_job_id,reason_code_id,reason_detail,authority_on_scene,stand_down_requested_by,converted_service_job_id,report_submitted_at"
            )
            .eq("company_id", companyId)
            .in("service_job_id", jobIds)
        : { data: [], error: null },
      jobIds.length
        ? supabase
            .from("rr_dispatch_assignments")
            .select("service_job_id,employee_id,field_vehicle_id,assignment_status")
            .eq("company_id", companyId)
            .in("service_job_id", jobIds)
            .in("assignment_status", ["offered", "accepted"])
        : { data: [], error: null },
      jobIds.length
        ? supabase
            .from("rr_standby_summary")
            .select("service_job_id,total_billable_seconds,total_paused_seconds,sealed_at,sealed_reason")
            .eq("company_id", companyId)
            .in("service_job_id", jobIds)
            .order("sealed_at", { ascending: false })
        : { data: [], error: null },
      supabase
        .from("rr_bystand_reason_codes")
        .select("id,reason_code,label")
        .eq("company_id", companyId),
      // The authorisation panel on this board needs somewhere to send the bill. Fetched
      // here rather than by the panel so the board stays one request per poll.
      supabase
        .from("rr_counterparties")
        .select("id,legal_name,counterparty_code")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("legal_name", { ascending: true }),
    ]);

    const eventsByJob = new Map<string, Row[]>();
    for (const row of ((eventsRes.data || []) as Row[])) {
      const key = String(row.service_job_id);
      const list = eventsByJob.get(key) ?? [];
      list.push(row);
      eventsByJob.set(key, list);
    }

    const employeeIds = [
      ...new Set(((assignmentsRes.data || []) as Row[]).map((row) => String(row.employee_id))),
    ];
    const { data: employees } = employeeIds.length
      ? await supabase
          .from("employees")
          .select("id,first_name,last_name")
          .eq("company_id", companyId)
          .in("id", employeeIds)
      : { data: [] };

    const vehicleIds = [
      ...new Set(
        ((assignmentsRes.data || []) as Row[])
          .map((row) => String(row.field_vehicle_id || ""))
          .filter(Boolean)
      ),
    ];
    const { data: vehicles } = vehicleIds.length
      ? await supabase
          .from("field_vehicles")
          .select("id,registration")
          .eq("company_id", companyId)
          .in("id", vehicleIds)
      : { data: [] };

    const sealedByJob = new Map<string, Row>();
    for (const row of ((summariesRes.data || []) as Row[])) {
      const key = String(row.service_job_id);
      if (!sealedByJob.has(key)) sealedByJob.set(key, row);
    }

    const enriched = jobRows.map((job) => {
      const id = String(job.id);
      const version = Number(job.workflow_version) || null;
      const definition = getWorkflowDefinition("bystand", version);
      const pausedStates = (definition?.states || [])
        .filter((entry) => entry.kind === "paused")
        .map((entry) => entry.state);

      const rawEvents = eventsByJob.get(id) ?? [];
      const standby = computeStandbyTime({
        events: rawEvents.map((row) => ({
          occurredAt: String(row.occurred_at),
          fromState: row.from_state ? String(row.from_state) : null,
          toState: String(row.to_state),
          entersBillableStandingClock: row.enters_billable_standing_clock === true,
          leavesBillableStandingClock: row.leaves_billable_standing_clock === true,
        })),
        pausedStates,
        now,
      });

      const timings = computeBystandTimings(
        rawEvents.map((row) => ({
          occurredAt: String(row.occurred_at),
          toState: String(row.to_state),
          transitionCode: String(row.transition_code),
        })),
        {
          offer: stateForRole("bystand", "offer", version),
          arrival: stateForRole("bystand", "arrival", version),
        }
      );

      return {
        ...job,
        standby: {
          totalBillableSeconds: standby.totalBillableSeconds,
          totalPausedSeconds: standby.totalPausedSeconds,
          standingNow: standby.standingNow,
          intervalCount: standby.intervals.length,
        },
        timings,
        sealed: sealedByJob.get(id) || null,
        pausedStates,
      };
    });

    return NextResponse.json({
      ok: true,
      fetchedAt: now,
      jobs: enriched,
      details: detailsRes.data || [],
      assignments: assignmentsRes.data || [],
      reasons: reasonsRes.data || [],
      counterparties: counterpartiesRes.data || [],
      employees: employees || [],
      vehicles: vehicles || [],
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

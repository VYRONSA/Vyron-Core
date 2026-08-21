import { NextRequest, NextResponse } from "next/server";
import { errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * One aggregate read for the Dispatch Board and the Live Operations Wall.
 *
 * A single endpoint keeps the polling cost to one request per interval per screen
 * rather than one per lane, which matters because this is polled every 15-20 seconds.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const companyId = context.ctx.companyId;
    const supabase = context.ctx.auth.supabase;

    const [jobsRes, assignmentsRes, authorisationsRes, serviceTypesRes, counterpartiesRes] =
      await Promise.all([
        supabase
          .from("rr_service_jobs")
          .select(
            "id,field_job_id,service_type_id,workflow_key,workflow_version,service_state,state_entered_at,counterparty_id,origin_label,origin_address,origin_latitude,origin_longitude,destination_label,vehicle_registration,vehicle_make,vehicle_model,scene_description,created_at"
          )
          .eq("company_id", companyId)
          .eq("record_status", "active")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("rr_dispatch_assignments")
          .select(
            "id,service_job_id,employee_id,field_vehicle_id,assignment_status,offered_at,responded_at,decline_reason"
          )
          .eq("company_id", companyId)
          .in("assignment_status", ["offered", "accepted"]),
        supabase
          .from("rr_authorisations")
          .select("id,service_job_id,authorisation_number,claim_reference,status,expires_at")
          .eq("company_id", companyId)
          .eq("status", "active"),
        supabase
          .from("rr_service_types")
          .select("id,service_code,name")
          .eq("company_id", companyId),
        supabase
          .from("rr_counterparties")
          .select("id,legal_name,counterparty_code")
          .eq("company_id", companyId),
      ]);

    const firstError =
      jobsRes.error ||
      assignmentsRes.error ||
      authorisationsRes.error ||
      serviceTypesRes.error ||
      counterpartiesRes.error;
    if (firstError) return errorResponse("Could not load the dispatch board.", 500);

    const employeeIds = [
      ...new Set(
        ((assignmentsRes.data || []) as { employee_id: string }[]).map((row) => row.employee_id)
      ),
    ];

    const { data: employees } = employeeIds.length
      ? await supabase
          .from("employees")
          .select("id,first_name,last_name")
          .eq("company_id", companyId)
          .in("id", employeeIds)
      : { data: [] };

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      jobs: jobsRes.data || [],
      assignments: assignmentsRes.data || [],
      authorisations: authorisationsRes.data || [],
      serviceTypes: serviceTypesRes.data || [],
      counterparties: counterpartiesRes.data || [],
      employees: employees || [],
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

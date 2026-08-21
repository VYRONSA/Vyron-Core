import { NextRequest, NextResponse } from "next/server";
import { computeStandbyForJob } from "@/lib/road-recovery/bystand-service";
import { asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * Live standby timer + SLA-lite measurements.
 *
 * Derived from public.rr_service_state_events on every read, using the SERVER clock for
 * "now". Nothing here is client-supplied.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const serviceJobId = asText(resolved.serviceJobId);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    const result = await computeStandbyForJob(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      serviceJobId,
      new Date().toISOString()
    );
    if (!result.ok) return errorResponse(result.message, result.status);

    const { data: sealed } = await context.ctx.auth.supabase
      .from("rr_standby_summary")
      .select("id,sealed_reason,sealed_at,total_billable_seconds,total_paused_seconds")
      .eq("company_id", context.ctx.companyId)
      .eq("service_job_id", serviceJobId)
      .order("sealed_at", { ascending: false })
      .limit(1);

    return NextResponse.json({
      ok: true,
      computedAt: new Date().toISOString(),
      standby: result.data.computation,
      timings: result.data.timings,
      sealed: ((sealed || []) as unknown[])[0] || null,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

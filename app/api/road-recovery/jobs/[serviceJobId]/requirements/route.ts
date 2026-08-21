import { NextRequest, NextResponse } from "next/server";
import { evaluateJobCompliance } from "@/lib/road-recovery/requirements-service";
import { asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * The job's requirement checklist, with live satisfaction state.
 *
 * Read from the job's IMMUTABLE snapshot, so it shows what THIS job was required to
 * produce — not what the current policy would demand of a new job.
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

    const result = await evaluateJobCompliance(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      serviceJobId,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({
      ok: true,
      requirements: result.data.requirements,
      compliance: result.data.compliance,
      facts: result.data.facts,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

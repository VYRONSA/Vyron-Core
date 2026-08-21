import { NextRequest, NextResponse } from "next/server";
import { waiveRequirement } from "@/lib/road-recovery/requirements-service";
import { RR_WAIVER_REASON_CODES } from "@/lib/road-recovery/requirements";
import { asText, errorResponse, parseError, readJson, requireApiContext } from "@/lib/road-recovery/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const { data, error } = await context.ctx.auth.supabase
      .from("rr_requirement_waivers")
      .select("id,requirement_code,reason_code,reason_detail,waived_by,approved_at,exception_id")
      .eq("company_id", context.ctx.companyId)
      .eq("service_job_id", asText(resolved.serviceJobId))
      .order("approved_at", { ascending: false });

    if (error) return errorResponse("Could not load waivers.", 500);
    return NextResponse.json({ ok: true, waivers: data || [], reasonCodes: RR_WAIVER_REASON_CODES });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Records a waiver.
 *
 * A reason code is mandatory and an authoriser is taken from the SESSION, never from the
 * body — a waiver must always name a real person who accepted the risk.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const requirementCode = asText(body.requirementCode);
    const reasonCode = asText(body.reasonCode);
    if (!requirementCode) return errorResponse("requirementCode is required.", 400);
    if (!reasonCode) return errorResponse("A waiver reason code is required.", 400);
    if (!(RR_WAIVER_REASON_CODES as readonly string[]).includes(reasonCode)) {
      return errorResponse(`"${reasonCode}" is not a recognised waiver reason.`, 400);
    }

    const resolved = await params;
    const result = await waiveRequirement(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      requirementCode,
      reasonCode,
      reasonDetail: asText(body.reasonDetail) || null,
      exceptionId: asText(body.exceptionId) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, waiverId: result.data.waiverId });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

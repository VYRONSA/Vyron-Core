import { NextRequest, NextResponse } from "next/server";
import { raiseJobException } from "@/lib/road-recovery/requirements-service";
import {
  RR_EXCEPTION_CODES,
  RR_EXCEPTION_SEVERITIES,
} from "@/lib/road-recovery/requirements";
import { asText, errorResponse, parseError, readJson, requireApiContext } from "@/lib/road-recovery/api";

/** The exceptions board. Open and acknowledged by default. */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const params = request.nextUrl.searchParams;
    const serviceJobId = asText(params.get("serviceJobId"));
    const status = asText(params.get("status"));
    const limit = Math.min(Number(params.get("limit") || 200) || 200, 500);

    let query = context.ctx.auth.supabase
      .from("rr_job_exceptions")
      .select(
        "id,service_job_id,exception_code,severity,detail,detected_by,detected_by_actor,state_at_detection,requirement_code,resolution_status,resolution_action,resolution_notes,resolved_by,resolved_at,waiver_id,automation_action_id,created_at"
      )
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (serviceJobId) query = query.eq("service_job_id", serviceJobId);
    if (status === "open") query = query.in("resolution_status", ["open", "acknowledged"]);
    else if (status) query = query.eq("resolution_status", status);

    const { data, error } = await query;
    if (error) return errorResponse("Could not load exceptions.", 500);

    return NextResponse.json({
      ok: true,
      exceptions: data || [],
      codes: RR_EXCEPTION_CODES,
      severities: RR_EXCEPTION_SEVERITIES,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceJobId = asText(body.serviceJobId);
    const exceptionCode = asText(body.exceptionCode);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);
    if (!(RR_EXCEPTION_CODES as readonly string[]).includes(exceptionCode)) {
      return errorResponse(`"${exceptionCode}" is not a recognised exception code.`, 400);
    }

    const severity = asText(body.severity) || "medium";
    if (!(RR_EXCEPTION_SEVERITIES as readonly string[]).includes(severity)) {
      return errorResponse(`"${severity}" is not a recognised severity.`, 400);
    }

    const result = await raiseJobException(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId,
      exceptionCode,
      severity,
      detail: asText(body.detail) || null,
      detectedBy: asText(body.detectedBy) || "controller",
      requirementCode: asText(body.requirementCode) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, exceptionId: result.data.exceptionId });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

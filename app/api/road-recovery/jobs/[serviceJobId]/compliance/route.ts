import { NextRequest, NextResponse } from "next/server";
import {
  evaluateJobCompliance,
  recordComplianceEvaluation,
} from "@/lib/road-recovery/requirements-service";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** Live compliance, plus the history of sealed evaluations. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const serviceJobId = asText(resolved.serviceJobId);

    const live = await evaluateJobCompliance(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      serviceJobId,
    });
    if (!live.ok) return errorResponse(live.message, live.status);

    const { data: history } = await context.ctx.auth.supabase
      .from("rr_compliance_evaluations")
      .select(
        "id,status,evidence_complete,scope,missing_codes,waived_codes,blocking_codes,completeness_percent,engine_version,evaluated_at,evaluated_by"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("service_job_id", serviceJobId)
      .order("evaluated_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      ok: true,
      compliance: live.data.compliance,
      history: history || [],
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Evaluates AND seals an immutable verdict. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const result = await recordComplianceEvaluation(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      serviceJobId: asText(resolved.serviceJobId),
      actorEmail: context.ctx.auth.email,
      scope: (asText(body.scope) || "invoice") as "transition" | "invoice" | "release" | "pack",
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({
      ok: true,
      evaluationId: result.data.evaluationId,
      compliance: result.data.compliance,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

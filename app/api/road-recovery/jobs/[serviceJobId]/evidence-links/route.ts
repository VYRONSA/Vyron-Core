import { NextRequest, NextResponse } from "next/server";
import { linkEvidenceToRequirements } from "@/lib/road-recovery/requirements-service";
import { asText, errorResponse, parseError, readJson, requireApiContext } from "@/lib/road-recovery/api";

/** The evidence timeline: every captured item and the requirements it satisfies. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const serviceJobId = asText(resolved.serviceJobId);

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_evidence_links")
      .select(
        "id,evidence_id,requirement_code,verification_status,rejected_reason,verified_by,verified_at,linked_by,created_at"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("service_job_id", serviceJobId)
      .order("created_at", { ascending: true });

    if (error) return errorResponse("Could not load the evidence timeline.", 500);
    return NextResponse.json({ ok: true, links: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Links one captured evidence item to one or more requirements. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const evidenceId = asText(body.evidenceId);
    const codes = Array.isArray(body.requirementCodes)
      ? body.requirementCodes.map((code) => asText(code)).filter(Boolean)
      : [];

    if (!evidenceId) return errorResponse("evidenceId is required.", 400);
    if (codes.length === 0) return errorResponse("At least one requirementCode is required.", 400);

    const result = await linkEvidenceToRequirements(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      evidenceId,
      requirementCodes: codes,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

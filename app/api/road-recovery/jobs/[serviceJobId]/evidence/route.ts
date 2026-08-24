import { NextRequest, NextResponse } from "next/server";
import { captureJobEvidence } from "@/lib/road-recovery/requirements-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  runIdempotentMutation,
} from "@/lib/road-recovery/api";

/**
 * Captures evidence against a Road & Recovery job.
 *
 * The way in that only BYSTAND had. It writes to the EXISTING repository
 * (public.mobile_workforce_evidence) and links to the EXISTING requirement snapshot
 * through public.rr_evidence_links — the table the compliance engine already counts. No
 * new evidence store, no second document system.
 *
 * The bytes never pass through here. The browser uploads them straight to the private
 * `rr-evidence` bucket under its own session, where the sql/072 policy allows a write only
 * beneath the caller's own company folder; this endpoint receives the resulting PATH. That
 * ordering matters: a caller who forges a path for another tenant never got the upload
 * accepted in the first place, and the path they send points at nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const serviceJobId = asText(resolved.serviceJobId);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    const supabase = context.ctx.auth.supabase;
    const companyId = context.ctx.companyId;

    // The job is re-read under the caller's RLS rather than trusted from the body: it
    // confirms the job is theirs AND yields the field_jobs spine id the evidence row needs.
    const { data: job, error: jobError } = await supabase
      .from("rr_service_jobs")
      .select("id, field_job_id")
      .eq("company_id", companyId)
      .eq("id", serviceJobId)
      .maybeSingle();

    if (jobError) return errorResponse("Could not load the job.", 500);
    if (!job) return errorResponse("Service job not found in this company.", 404);

    /**
     * Who captured this.
     *
     * mobile_workforce_evidence.employee_id is NOT NULL, and it should be: evidence with
     * no named capturer is worth very little in a dispute. The signed-in user is resolved
     * to their employee record by email — the same link /driver/* uses — and a caller with
     * no such record is told exactly what to fix rather than getting a constraint error.
     */
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .ilike("email", context.ctx.auth.email)
      .eq("active", true)
      .maybeSingle();

    if (employeeError) return errorResponse("Could not resolve the capturing employee.", 500);
    if (!employee) {
      return errorResponse(
        "Your sign-in is not linked to an active employee record in this company, so evidence cannot be attributed to you. Add your email address to your employee record and try again.",
        403
      );
    }

    const requirementCodes = Array.isArray(body.requirementCodes)
      ? body.requirementCodes.map((code: unknown) => asText(code)).filter(Boolean)
      : [];

    /**
     * Idempotent when the client supplies an operationId.
     *
     * Evidence is the case that most needs it: the binary is uploaded to storage
     * FIRST and this call records it. If the response is lost after the row was
     * written, a naive retry would file the same photograph twice against the
     * same job. The receipt replays the original result instead.
     */
    return await runIdempotentMutation(
      context.ctx,
      body,
      "capture_evidence",
      serviceJobId,
      async () => await captureJobEvidence(supabase, {
      companyId,
      actorEmail: context.ctx.auth.email,
      employeeId: String((employee as { id: string }).id),
      serviceJobId,
      fieldJobId: asText((job as { field_job_id: string }).field_job_id),
      evidenceType: asText(body.evidenceType) === "rr_custody" ? "rr_custody" : "rr_requirement",
      capturedByRole: asText(body.capturedByRole) || "controller",
      requirementCodes,
      storagePath: asText(body.storagePath) || null,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
      accuracy: asNumberOrNull(body.accuracy),
      notes: asText(body.notes) || null,
      metadata:
        typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : {},
      })
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Everything captured against this job, newest first. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const { data, error } = await context.ctx.auth.supabase
      .from("mobile_workforce_evidence")
      .select(
        "id,evidence_type,storage_bucket,storage_path,latitude,longitude,gps_accuracy,captured_at,captured_by_role,notes,metadata,employee_id"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("service_job_id", asText(resolved.serviceJobId))
      .order("captured_at", { ascending: false })
      .limit(200);

    if (error) return errorResponse("Could not load the captured evidence.", 500);
    return NextResponse.json({ ok: true, evidence: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

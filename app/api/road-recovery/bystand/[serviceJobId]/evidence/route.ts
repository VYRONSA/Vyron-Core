import { NextRequest, NextResponse } from "next/server";
import {
  recordBystandEvidence,
  requireBystandJob,
  RR_BYSTAND_EVIDENCE_TYPES,
  RR_EVIDENCE_BUCKET,
  type RrBystandEvidenceType,
} from "@/lib/road-recovery/bystand-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  runIdempotentMutation,
  resolveDriverEmployeeId,
} from "@/lib/road-recovery/api";

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
        "id,evidence_type,storage_bucket,storage_path,latitude,longitude,gps_accuracy,captured_at,notes,metadata"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("service_job_id", asText(resolved.serviceJobId))
      .order("captured_at", { ascending: false });

    if (error) return errorResponse("Could not load evidence.", 500);
    return NextResponse.json({ ok: true, bucket: RR_EVIDENCE_BUCKET, evidence: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Records an evidence item. The FILE is uploaded to Storage by the client under the
 * tenant-scoped path <company_id>/<service_job_id>/..., which the bucket policy enforces;
 * only the path and metadata are stored here.
 *
 * A GPS-only presence record simply has no storagePath.
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
    const evidenceType = asText(body.evidenceType) as RrBystandEvidenceType;

    if (!RR_BYSTAND_EVIDENCE_TYPES.includes(evidenceType)) {
      return errorResponse(
        `evidenceType must be one of: ${RR_BYSTAND_EVIDENCE_TYPES.join(", ")}.`,
        400
      );
    }

    const job = await requireBystandJob(context.ctx.auth.supabase, context.ctx.companyId, serviceJobId);
    if (!job.ok) return errorResponse(job.message, job.status);

    const driver = await resolveDriverEmployeeId(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      context.ctx.auth.email
    );
    if (!driver.ok) return errorResponse(driver.message, driver.status);

    const storagePath = asText(body.storagePath) || null;
    // The path must sit under this tenant's prefix, matching the Storage policy.
    if (storagePath && !storagePath.startsWith(`${context.ctx.companyId}/`)) {
      return errorResponse(
        "storagePath must begin with the company id, matching the rr-evidence bucket policy.",
        400
      );
    }

    return await runIdempotentMutation(
      context.ctx,
      body,
      "capture_evidence",
      serviceJobId,
      async () =>
      await recordBystandEvidence(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        actorEmail: context.ctx.auth.email,
        employeeId: driver.employeeId,
        serviceJobId,
        fieldJobId: job.data.fieldJobId,
        evidenceType,
        storagePath,
        latitude: asNumberOrNull(body.latitude),
        longitude: asNumberOrNull(body.longitude),
        accuracy: asNumberOrNull(body.accuracy),
        notes: asText(body.notes) || null,
        metadata:
          body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? (body.metadata as Record<string, unknown>)
            : {},
      })
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Files a photograph against an incident.
 *
 * REUSES the existing evidence store rather than adding one. Incident media is
 * an ordinary mobile_workforce_evidence row with evidence_type 'incident' — a
 * value that CHECK already permitted — and metadata.incidentId as the link.
 * service_job_id stays NULL because it is foreign-keyed to rr_service_jobs and
 * an incident is not a job.
 *
 * The bytes never pass through here. The browser uploads straight to the
 * private rr-evidence bucket under its own session, where the sql/072 policy
 * permits a write only beneath the caller's own company folder; this endpoint
 * receives the resulting PATH. A forged path for another tenant was never
 * accepted by storage in the first place.
 *
 * Idempotent: the same storage path cannot be filed twice, so a retry after a
 * lost response replays instead of duplicating the photograph.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return fail(context.message, context.status);

    const { companyId, auth } = context.ctx;
    const resolved = await params;
    const incidentId = asText(resolved.incidentId);
    if (!incidentId) return fail("An incident reference is required.", 400);

    const storagePath = asText(body.storagePath);
    if (!storagePath) return fail("A stored file is required.", 400);

    // The path must sit beneath this tenant's own folder. Storage enforces this
    // too; checking here means a forged path is refused with a clear answer
    // rather than filing a row that points at nothing.
    if (!storagePath.startsWith(`${companyId}/`)) {
      return fail("That file does not belong to this workspace.", 403);
    }

    const { data: employee } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .ilike("email", auth.email)
      .eq("active", true)
      .maybeSingle();

    if (!employee) {
      return fail(
        "Your sign-in is not linked to an active employee record in this workspace, so evidence cannot be attributed to you.",
        403
      );
    }

    /**
     * The incident row may not exist yet, and that is expected.
     *
     * Photographs are captured before the report is finished, and the queue may
     * drain them first. The evidence is filed regardless, carrying its
     * incidentId, so the two reconcile whichever order they arrive in. What
     * matters is that the storage path proved the tenant (checked above) and the
     * employee proved themselves (resolved from the session).
     */

    const { data: existing } = await auth.supabase
      .from("mobile_workforce_evidence")
      .select("id")
      .eq("company_id", companyId)
      .eq("storage_path", storagePath)
      .maybeSingle();

    if (existing) {
      const replayed = NextResponse.json({
        ok: true,
        evidenceId: String((existing as { id: string }).id),
        replayed: true,
      });
      replayed.headers.set("x-rr-operation", "replayed");
      return replayed;
    }

    const { data, error } = await auth.supabase
      .from("mobile_workforce_evidence")
      .insert({
        company_id: companyId,
        employee_id: String((employee as { id: string }).id),
        evidence_type: "incident",
        storage_bucket: "rr-evidence",
        storage_path: storagePath,
        latitude: num(body.latitude),
        longitude: num(body.longitude),
        gps_accuracy: num(body.accuracy),
        captured_by_role: "employee",
        metadata: { ...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}), incidentId },
      })
      .select("id")
      .single();

    if (error || !data) return fail("Could not attach this photo. It is still saved on your device.", 503);

    const response = NextResponse.json({
      ok: true,
      evidenceId: String((data as { id: string }).id),
      replayed: false,
    });
    response.headers.set("x-rr-operation", "executed");
    return response;
  } catch (error: unknown) {
    return fail(parseError(error), 500);
  }
}

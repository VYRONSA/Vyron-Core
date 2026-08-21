import { NextRequest, NextResponse } from "next/server";
import { createServiceJob } from "@/lib/road-recovery/job-service";
import { upsertBystandDetails } from "@/lib/road-recovery/bystand-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/**
 * Creates a BYSTAND attendance.
 *
 * Destination fields are deliberately NOT accepted: a BYSTAND job takes no vehicle
 * anywhere, and the database CHECK (rr_service_jobs_bystand_no_destination) would refuse
 * them anyway.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const title = asText(body.title);
    if (!title) return errorResponse("title is required.", 400);

    const created = await createServiceJob(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceCode: "bystand",
      title,
      counterpartyId: asText(body.counterpartyId) || null,
      incidentAt: asText(body.incidentAt) || null,
      reportedBy: asText(body.reportedBy) || null,
      sceneDescription: asText(body.sceneDescription) || null,
      originLabel: asText(body.originLabel) || null,
      originAddress: asText(body.originAddress) || null,
      originLatitude: asNumberOrNull(body.originLatitude),
      originLongitude: asNumberOrNull(body.originLongitude),
      vehicleRegistration: asText(body.vehicleRegistration) || null,
      vehicleMake: asText(body.vehicleMake) || null,
      vehicleModel: asText(body.vehicleModel) || null,
      priority: asText(body.priority) || "high",
    });

    if (!created.ok) return errorResponse(created.message, created.status);

    await upsertBystandDetails(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      created.data.serviceJobId,
      {
        reason_code_id: asText(body.reasonCodeId) || null,
        reason_detail: asText(body.reasonDetail) || null,
        requested_by_name: asText(body.requestedByName) || null,
        requested_by_contact: asText(body.requestedByContact) || null,
        requesting_authority: asText(body.requestingAuthority) || null,
        authority_on_scene: asText(body.authorityOnScene) || null,
        created_by: context.ctx.auth.email,
      }
    );

    return NextResponse.json({ ok: true, ...created.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

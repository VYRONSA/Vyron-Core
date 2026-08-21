import { NextRequest, NextResponse } from "next/server";
import { createServiceJob } from "@/lib/road-recovery/job-service";
import {
  asBooleanOrNull,
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  serviceResponse,
} from "@/lib/road-recovery/api";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const state = asText(request.nextUrl.searchParams.get("state"));
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100) || 100, 300);

    let query = context.ctx.auth.supabase
      .from("rr_service_jobs")
      .select(
        "id,field_job_id,service_type_id,workflow_key,service_state,state_entered_at,counterparty_id,origin_label,origin_address,origin_latitude,origin_longitude,destination_label,vehicle_registration,vehicle_make,vehicle_model,created_at"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("record_status", "active")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (state) query = query.eq("service_state", state);

    const { data, error } = await query;
    if (error) return errorResponse("Could not load Road & Recovery jobs.", 500);
    return NextResponse.json({ ok: true, jobs: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceCode = asText(body.serviceCode);
    const title = asText(body.title);
    if (!serviceCode || !title) {
      return errorResponse("serviceCode and title are required.", 400);
    }

    const result = await createServiceJob(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceCode,
      title,
      counterpartyId: asText(body.counterpartyId) || null,
      incidentAt: asText(body.incidentAt) || null,
      reportedBy: asText(body.reportedBy) || null,
      sceneDescription: asText(body.sceneDescription) || null,
      originLabel: asText(body.originLabel) || null,
      originAddress: asText(body.originAddress) || null,
      originLatitude: asNumberOrNull(body.originLatitude),
      originLongitude: asNumberOrNull(body.originLongitude),
      destinationType: asText(body.destinationType) || null,
      destinationLabel: asText(body.destinationLabel) || null,
      destinationAddress: asText(body.destinationAddress) || null,
      destinationLatitude: asNumberOrNull(body.destinationLatitude),
      destinationLongitude: asNumberOrNull(body.destinationLongitude),
      vehicleRegistration: asText(body.vehicleRegistration) || null,
      vehicleMake: asText(body.vehicleMake) || null,
      vehicleModel: asText(body.vehicleModel) || null,
      vehicleIsDrivable: asBooleanOrNull(body.vehicleIsDrivable),
      priority: asText(body.priority) || "high",
    });

    return serviceResponse(result);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { NextRequest } from "next/server";
import { driverRecordArrival } from "@/lib/road-recovery/job-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  resolveDriverEmployeeId,
  serviceResponse,
} from "@/lib/road-recovery/api";

/**
 * GPS-VERIFIED scene arrival.
 *
 * Coordinates are mandatory. The server validates them against the scene using the
 * existing validateMobileGpsRadius(); a driver cannot record arrival by pressing a
 * button without evidence.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceJobId = asText(body.serviceJobId);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    const driver = await resolveDriverEmployeeId(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      context.ctx.auth.email
    );
    if (!driver.ok) return errorResponse(driver.message, driver.status);

    const result = await driverRecordArrival(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId,
      employeeId: driver.employeeId,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
      accuracy: asNumberOrNull(body.accuracy),
      radiusMeters: asNumberOrNull(body.radiusMeters) ?? undefined,
      overrideReason: asText(body.overrideReason) || null,
    });

    return serviceResponse(result);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

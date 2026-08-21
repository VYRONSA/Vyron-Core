import { NextRequest } from "next/server";
import { transitionServiceJob } from "@/lib/road-recovery/job-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  serviceResponse,
} from "@/lib/road-recovery/api";

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
    const toState = asText(body.toState);
    if (!serviceJobId || !toState) {
      return errorResponse("serviceJobId and toState are required.", 400);
    }

    const result = await transitionServiceJob(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId,
      toState,
      reason: asText(body.reason) || null,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
      gpsAccuracy: asNumberOrNull(body.accuracy),
    });

    return serviceResponse(result);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

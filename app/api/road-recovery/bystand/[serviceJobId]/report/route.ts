import { NextRequest } from "next/server";
import { submitObservationReport } from "@/lib/road-recovery/bystand-service";
import {
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
    const summary = asText(body.summary);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);
    if (!summary) return errorResponse("A report summary is required.", 400);

    const observations =
      body.observations && typeof body.observations === "object" && !Array.isArray(body.observations)
        ? (body.observations as Record<string, unknown>)
        : {};

    return serviceResponse(
      await submitObservationReport(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        actorEmail: context.ctx.auth.email,
        serviceJobId,
        summary,
        observations,
      })
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { NextRequest } from "next/server";
import {
  beginStandingBy,
  pauseStanding,
  resumeStanding,
} from "@/lib/road-recovery/bystand-service";
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
 * Standing clock control: begin / pause / resume.
 *
 * The SERVER stamps every one of these moments. A clientReportedAt may be supplied and is
 * retained as telemetry only — it never determines billable time.
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
    const action = asText(body.action).toLowerCase();
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    const shared = {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId,
      clientReportedAt: asText(body.clientReportedAt) || null,
    };

    if (action === "begin") {
      return await runIdempotentMutation(
      context.ctx,
      body,
      "transition",
      serviceJobId,
      async () =>
        await beginStandingBy(context.ctx.auth.supabase, {
          ...shared,
          latitude: asNumberOrNull(body.latitude),
          longitude: asNumberOrNull(body.longitude),
          accuracy: asNumberOrNull(body.accuracy),
        })
      );
    }

    if (action === "pause") {
      return await runIdempotentMutation(
      context.ctx,
      body,
      "transition",
      serviceJobId,
      async () =>
        await pauseStanding(context.ctx.auth.supabase, {
          ...shared,
          pauseState: asText(body.pauseState),
          reason: asText(body.reason),
        })
      );
    }

    if (action === "resume") {
      return await runIdempotentMutation(
      context.ctx,
      body,
      "transition",
      serviceJobId,
      async () =>await resumeStanding(context.ctx.auth.supabase, shared));
    }

    return errorResponse('action must be one of "begin", "pause" or "resume".', 400);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

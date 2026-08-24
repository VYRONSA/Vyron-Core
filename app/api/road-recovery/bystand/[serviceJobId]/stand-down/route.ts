import { NextRequest } from "next/server";
import { confirmStandDown, requestStandDown } from "@/lib/road-recovery/bystand-service";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  runIdempotentMutation,
} from "@/lib/road-recovery/api";

/** Stand-down: request (controller or driver) then confirm, which SEALS the billing. */
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
    const action = asText(body.action).toLowerCase() || "request";
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    if (action === "request") {
      return await runIdempotentMutation(
      context.ctx,
      body,
      "transition",
      serviceJobId,
      async () =>
        await requestStandDown(context.ctx.auth.supabase, {
          companyId: context.ctx.companyId,
          actorEmail: context.ctx.auth.email,
          serviceJobId,
          requestedBy: asText(body.requestedBy) || null,
          channel: asText(body.channel) || null,
          reason: asText(body.reason) || null,
        })
      );
    }

    if (action === "confirm") {
      return await runIdempotentMutation(
      context.ctx,
      body,
      "transition",
      serviceJobId,
      async () =>
        await confirmStandDown(context.ctx.auth.supabase, {
          companyId: context.ctx.companyId,
          actorEmail: context.ctx.auth.email,
          serviceJobId,
        })
      );
    }

    return errorResponse('action must be "request" or "confirm".', 400);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

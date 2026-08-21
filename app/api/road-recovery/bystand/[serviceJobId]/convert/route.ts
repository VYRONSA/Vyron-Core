import { NextRequest } from "next/server";
import { convertBystandToRecovery } from "@/lib/road-recovery/bystand-service";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  serviceResponse,
} from "@/lib/road-recovery/api";

/**
 * Converts a BYSTAND attendance into a SEPARATE linked recovery job.
 *
 * The attendance is never mutated into a tow: it keeps its service type, its evidence and
 * its standing billing, and closes on its own terms.
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
    const reason = asText(body.reason);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);
    if (!reason) return errorResponse("A conversion reason is required.", 400);

    return serviceResponse(
      await convertBystandToRecovery(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        actorEmail: context.ctx.auth.email,
        serviceJobId,
        reason,
        recoveryServiceCode: asText(body.recoveryServiceCode) || undefined,
        recoveryTitle: asText(body.recoveryTitle) || undefined,
        destinationType: asText(body.destinationType) || null,
        destinationLabel: asText(body.destinationLabel) || null,
        destinationAddress: asText(body.destinationAddress) || null,
      })
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

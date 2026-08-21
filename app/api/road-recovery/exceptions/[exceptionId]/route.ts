import { NextRequest, NextResponse } from "next/server";
import { resolveJobException } from "@/lib/road-recovery/requirements-service";
import { asText, errorResponse, parseError, readJson, requireApiContext } from "@/lib/road-recovery/api";

const RESOLUTIONS = ["acknowledged", "resolved", "waived", "cancelled"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ exceptionId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolutionStatus = asText(body.resolutionStatus);
    if (!(RESOLUTIONS as readonly string[]).includes(resolutionStatus)) {
      return errorResponse(
        `resolutionStatus must be one of: ${RESOLUTIONS.join(", ")}.`,
        400
      );
    }

    const resolved = await params;
    const result = await resolveJobException(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      exceptionId: asText(resolved.exceptionId),
      resolutionStatus: resolutionStatus as (typeof RESOLUTIONS)[number],
      resolutionAction: asText(body.resolutionAction) || null,
      resolutionNotes: asText(body.resolutionNotes) || null,
      waiverId: asText(body.waiverId) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createCustodyYard, listCustodyYards } from "@/lib/road-recovery/custody-service";
import {
  asBooleanOrNull,
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const result = await listCustodyYards(context.ctx.auth.supabase, context.ctx.companyId, {
      activeOnly: request.nextUrl.searchParams.get("includeInactive") !== "true",
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, yards: result.data.yards });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const yardCode = asText(body.yardCode);
    const name = asText(body.name);
    if (!yardCode || !name) return errorResponse("yardCode and name are required.", 400);

    const result = await createCustodyYard(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      yardCode,
      name,
      address: asText(body.address) || null,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
      securityLevel: asText(body.securityLevel) || "secure",
      covered: asBooleanOrNull(body.covered) === true,
      capacity: asNumberOrNull(body.capacity),
      operatingHours: asText(body.operatingHours) || null,
      contactName: asText(body.contactName) || null,
      contactNumber: asText(body.contactNumber) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, yardId: result.data.yardId });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

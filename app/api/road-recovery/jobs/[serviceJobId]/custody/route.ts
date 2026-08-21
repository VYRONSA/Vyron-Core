import { NextRequest, NextResponse } from "next/server";
import {
  RR_CUSTODY_EVENT_TYPES,
  RR_CUSTODY_HOLDER_TYPES,
  getCustodyChain,
  recordCustodyEvent,
  type RrCustodyEventType,
  type RrCustodyHolderType,
} from "@/lib/road-recovery/custody-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** The chain, the current holding, and the items that came with the vehicle. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const result = await getCustodyChain(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      asText(resolved.serviceJobId)
    );
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({
      ok: true,
      events: result.data.events,
      holding: result.data.holding,
      items: result.data.items,
      eventTypes: RR_CUSTODY_EVENT_TYPES,
      holderTypes: RR_CUSTODY_HOLDER_TYPES,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Appends one custody event.
 *
 * The actor is taken from the SESSION, and `occurred_at` is stamped by the database — a
 * custody timestamp a client can set is a custody timestamp a client can move.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const eventType = asText(body.eventType);
    const holderType = asText(body.holderType);
    if (!(RR_CUSTODY_EVENT_TYPES as readonly string[]).includes(eventType)) {
      return errorResponse(`"${eventType}" is not a recognised custody event.`, 400);
    }
    if (!(RR_CUSTODY_HOLDER_TYPES as readonly string[]).includes(holderType)) {
      return errorResponse(`"${holderType}" is not a recognised custody holder.`, 400);
    }

    const resolved = await params;
    const result = await recordCustodyEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      eventType: eventType as RrCustodyEventType,
      holderType: holderType as RrCustodyHolderType,
      holderName: asText(body.holderName),
      yardId: asText(body.yardId) || null,
      actorRole: asText(body.actorRole) || "controller",
      receivingPartyName: asText(body.receivingPartyName) || null,
      receivingPartyCapacity: asText(body.receivingPartyCapacity) || null,
      receivingPartyIdNumber: asText(body.receivingPartyIdNumber) || null,
      receivingPartyContact: asText(body.receivingPartyContact) || null,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
      locationLabel: asText(body.locationLabel) || null,
      authorityId: asText(body.authorityId) || null,
      evidenceId: asText(body.evidenceId) || null,
      reason: asText(body.reason) || null,
      notes: asText(body.notes) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

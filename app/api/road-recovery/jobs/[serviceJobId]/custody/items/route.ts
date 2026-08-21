import { NextRequest, NextResponse } from "next/server";
import {
  RR_CUSTODY_ITEM_TYPES,
  handOverCustodyItem,
  recordCustodyItem,
} from "@/lib/road-recovery/custody-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** Records a key, document or belonging received with the vehicle. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const itemType = asText(body.itemType);
    if (!(RR_CUSTODY_ITEM_TYPES as readonly string[]).includes(itemType)) {
      return errorResponse(`"${itemType}" is not a recognised custody item type.`, 400);
    }

    const resolved = await params;
    const result = await recordCustodyItem(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      itemType,
      description: asText(body.description),
      quantity: asNumberOrNull(body.quantity) ?? 1,
      itemCondition: asText(body.itemCondition) || null,
      receivedEventId: asText(body.receivedEventId) || null,
      evidenceId: asText(body.evidenceId) || null,
      notes: asText(body.notes) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, itemId: result.data.itemId });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Records that an item left with a named person, in a stated capacity. */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const itemId = asText(body.itemId);
    const handedOverToName = asText(body.handedOverToName);
    const handedOverToCapacity = asText(body.handedOverToCapacity);
    if (!itemId) return errorResponse("itemId is required.", 400);
    if (!handedOverToName || !handedOverToCapacity) {
      return errorResponse(
        "Handing over an item must name who took it and in what capacity.",
        400
      );
    }

    const result = await handOverCustodyItem(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      itemId,
      handedOverEventId: asText(body.handedOverEventId) || null,
      handedOverToName,
      handedOverToCapacity,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  measureRoadRecoveryOutcome,
  prepareRoadRecoveryAction,
} from "@/lib/road-recovery/intelligence-service";
import { asText, errorResponse, parseError, readJson, requireApiContext } from "@/lib/road-recovery/api";

/**
 * Turns a Road & Recovery recommendation into an action.
 *
 * The action is written to workforce_automation_actions through the EXISTING automation
 * engine, which orchestrates it, assigns the owner and approval chain, captures the BEFORE
 * metrics, and writes the audit entry. There is no Road & Recovery action table and no
 * second approval queue: an operations director should see one list of what the business
 * has decided to do, not one list per module.
 *
 * The actor is taken from the SESSION, never from the body.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const findingKey = asText(body.findingKey);
    if (!findingKey) return errorResponse("findingKey is required.", 400);

    const result = await prepareRoadRecoveryAction(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      findingKey,
      submitToQueue: body.submitToQueue !== false,
      options: {
        companyId: context.ctx.companyId,
        fromIso: asText(body.from) || null,
        toIso: asText(body.to) || null,
        asOfIso: asText(body.asOf) || null,
      },
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Measures whether an action actually improved the metric that raised it.
 *
 * Re-measures the same metric over a window of the same length and writes the result to
 * the EXISTING outcome columns. When either side of the comparison is missing, the outcome
 * is recorded as UNMEASURED rather than as "no improvement" — those are different answers
 * and only one of them is a criticism of the person who did the work.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const actionId = asText(body.actionId);
    if (!actionId) return errorResponse("actionId is required.", 400);

    const result = await measureRoadRecoveryOutcome(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actionId,
      actorEmail: context.ctx.auth.email,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, outcome: result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  listThresholds,
  publishThreshold,
  retireThreshold,
} from "@/lib/road-recovery/intelligence-service";
import { RR_METRIC_CATALOGUE } from "@/lib/road-recovery/intelligence/metric-catalogue";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/**
 * Road & Recovery operational target configuration.
 *
 * These are the targets that turn NO SLA CONFIGURED into a measurable expectation. There
 * is no default set and no seeded example: a target means "the business has decided this
 * is what good looks like", and the system has no standing to decide that on the customer's
 * behalf.
 *
 * A target is never edited. Publishing retires the current version and inserts a new one,
 * so a breach recorded last March can always be replayed against March's target.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const result = await listThresholds(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    const active = result.data.thresholds.filter((entry) => entry.active);
    return NextResponse.json({
      ok: true,
      thresholds: result.data.thresholds,
      activeCount: active.length,
      catalogue: RR_METRIC_CATALOGUE,
      message:
        active.length === 0
          ? "NO SLA CONFIGURED. No operational targets have been set, so no metric can report a breach and Road & Recovery health cannot be scored. Measured values are still reported."
          : `${active.length} operational target(s) configured across ${new Set(active.map((entry) => entry.metricKey)).size} metric(s).`,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Publishes a new version of an operational target. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const targetValue = asNumberOrNull(body.targetValue);
    if (targetValue === null) {
      return errorResponse("A numeric targetValue is required.", 400);
    }

    const result = await publishThreshold(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      metricKey: asText(body.metricKey),
      serviceCode: asText(body.serviceCode) || null,
      counterpartyId: asText(body.counterpartyId) || null,
      targetValue,
      warningValue: asNumberOrNull(body.warningValue),
      criticalValue: asNumberOrNull(body.criticalValue),
      unit: asText(body.unit),
      severity: (asText(body.severity) || "medium") as "low" | "medium" | "high" | "critical",
      effectiveFromIso: asText(body.effectiveFrom) || null,
      notes: asText(body.notes) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Retires an operational target.
 *
 * PATCH, not DELETE: the row survives so historical measurements keep their reference.
 * Deleting it would erase the target a past breach was judged against.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const thresholdId = asText(body.thresholdId);
    if (!thresholdId) return errorResponse("thresholdId is required.", 400);

    const result = await retireThreshold(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      thresholdId,
      effectiveToIso: asText(body.effectiveTo) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

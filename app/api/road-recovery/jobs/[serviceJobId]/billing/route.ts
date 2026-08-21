import { NextRequest, NextResponse } from "next/server";
import {
  calculateAndSealCharges,
  deriveSealedFacts,
  evaluateBillingReadiness,
  freezeBillableFacts,
  recordOdometerCapture,
  resolveAndFreezeRateCard,
} from "@/lib/road-recovery/billing-service";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** Billing readiness for one job, with every gate and its reason. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const result = await evaluateBillingReadiness(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      serviceJobId: asText(resolved.serviceJobId),
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, readiness: result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * The billing preparation steps, performed SERVER-SIDE.
 *
 * Every one of these writes an operational or commercial record, so none of them is ever
 * performed from the browser: the browser asks for an action by name, the server decides
 * whether the caller may perform it and then calls the service layer. The actor is taken
 * from the SESSION, never from the body.
 *
 * None of these creates an invoice. They freeze facts, resolve a rate and seal an EXPECTED
 * charge — VYRON FINANCE issues the invoice.
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
    const action = asText(body.action);
    const supabase = context.ctx.auth.supabase;
    const companyId = context.ctx.companyId;
    const actorEmail = context.ctx.auth.email;

    if (action === "capture_odometer") {
      const start = asNumberOrNull(body.odometerStartKm);
      const end = asNumberOrNull(body.odometerEndKm);
      if (start === null || end === null) {
        return errorResponse("Both odometer readings are required.", 400);
      }
      const result = await recordOdometerCapture(supabase, {
        companyId,
        actorEmail,
        serviceJobId,
        odometerStartKm: start,
        odometerEndKm: end,
        vehicleId: asText(body.vehicleId) || null,
        latitude: asNumberOrNull(body.latitude),
        longitude: asNumberOrNull(body.longitude),
        evidenceId: asText(body.evidenceId) || null,
        notes: asText(body.notes) || null,
      });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({ ok: true, ...result.data });
    }

    if (action === "derive_facts") {
      const result = await deriveSealedFacts(supabase, { companyId, actorEmail, serviceJobId });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({ ok: true, ...result.data });
    }

    if (action === "freeze_facts") {
      const result = await freezeBillableFacts(supabase, { companyId, actorEmail, serviceJobId });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({ ok: true, ...result.data });
    }

    if (action === "resolve_rate") {
      const result = await resolveAndFreezeRateCard(supabase, { companyId, actorEmail, serviceJobId });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({ ok: true, ...result.data });
    }

    if (action === "calculate") {
      const result = await calculateAndSealCharges(supabase, {
        companyId,
        actorEmail,
        serviceJobId,
        dryRun: body.dryRun === true,
      });
      if (!result.ok) return errorResponse(result.message, result.status);
      return NextResponse.json({
        ok: true,
        calculationId: result.data.calculationId,
        sealed: result.data.sealed,
        result: result.data.result,
      });
    }

    // One button that runs the whole preparation, because a controller thinks in terms of
    // "prepare this job's billing information", not five separate steps.
    if (action === "prepare") {
      await deriveSealedFacts(supabase, { companyId, actorEmail, serviceJobId });
      await freezeBillableFacts(supabase, { companyId, actorEmail, serviceJobId });

      const rate = await resolveAndFreezeRateCard(supabase, { companyId, actorEmail, serviceJobId });
      if (!rate.ok) return errorResponse(rate.message, rate.status);
      if (rate.data.conflicted || !rate.data.snapshotId) {
        return NextResponse.json({ ok: true, prepared: false, reason: rate.data.reason });
      }

      const charged = await calculateAndSealCharges(supabase, { companyId, actorEmail, serviceJobId });
      if (!charged.ok) return errorResponse(charged.message, charged.status);

      const readiness = await evaluateBillingReadiness(supabase, { companyId, serviceJobId });
      if (!readiness.ok) return errorResponse(readiness.message, readiness.status);

      return NextResponse.json({
        ok: true,
        prepared: true,
        rateCard: `${rate.data.policyKey} v${rate.data.policyVersion}`,
        calculationId: charged.data.calculationId,
        status: charged.data.result.status,
        readiness: readiness.data,
      });
    }

    return errorResponse(
      'action must be one of: capture_odometer, derive_facts, freeze_facts, resolve_rate, calculate, prepare.',
      400
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

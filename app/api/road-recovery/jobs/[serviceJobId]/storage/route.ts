import { NextRequest, NextResponse } from "next/server";
import {
  checkVehicleIntoStorage,
  checkVehicleOutOfStorage,
  computeStorageAccrual,
  evaluateReleaseEligibility,
  getStoragePosition,
} from "@/lib/road-recovery/storage-service";
import {
  RR_STORAGE_CONDITIONS,
  RR_STORAGE_RATE_BASES,
  type RrStorageRateBasis,
} from "@/lib/road-recovery/storage-accrual";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** The storage position: bookings, sealed accruals, live accrual and release eligibility. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const serviceJobId = asText(resolved.serviceJobId);
    const supabase = context.ctx.auth.supabase;
    const companyId = context.ctx.companyId;

    const position = await getStoragePosition(supabase, companyId, serviceJobId);
    if (!position.ok) return errorResponse(position.message, position.status);

    // Both are informational and neither should fail the read: a job with no open booking
    // has no live accrual, and that is a normal state rather than an error.
    const live = await computeStorageAccrual(supabase, { companyId, serviceJobId });
    const eligibility = await evaluateReleaseEligibility(supabase, { companyId, serviceJobId });

    return NextResponse.json({
      ok: true,
      bookings: position.data.bookings,
      accruals: position.data.accruals,
      liveAccrual: live.ok ? live.data.accrual : null,
      eligibility: eligibility.ok ? eligibility.data : null,
      rateBases: RR_STORAGE_RATE_BASES,
      conditions: RR_STORAGE_CONDITIONS,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/** Checks a vehicle in: a custody transfer AND a booking. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const yardId = asText(body.yardId);
    if (!yardId) return errorResponse("yardId is required.", 400);

    const rateBasis = asText(body.rateBasis) || "per_day";
    if (!(RR_STORAGE_RATE_BASES as readonly string[]).includes(rateBasis)) {
      return errorResponse(`"${rateBasis}" is not a recognised rate basis.`, 400);
    }

    const resolved = await params;
    const result = await checkVehicleIntoStorage(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      yardId,
      bayReference: asText(body.bayReference) || null,
      rateBasis: rateBasis as RrStorageRateBasis,
      rateAmount: asNumberOrNull(body.rateAmount),
      freeDays: asNumberOrNull(body.freeDays) ?? 0,
      storageCondition: asText(body.storageCondition) || "outdoor",
      conditionOnArrival: asText(body.conditionOnArrival) || null,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
      evidenceId: asText(body.evidenceId) || null,
      notes: asText(body.notes) || null,
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Checks a vehicle out.
 *
 * FAILS CLOSED — the service layer refuses unless a verified release authority is in
 * force, release-scope evidence is complete, and custody is actually ours to hand over.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serviceJobId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const collectorName = asText(body.collectorName);
    const collectorCapacity = asText(body.collectorCapacity);
    if (!collectorName || !collectorCapacity) {
      return errorResponse(
        "Releasing a vehicle must name the person collecting it and the capacity they collect it in.",
        400
      );
    }

    const resolved = await params;
    const result = await checkVehicleOutOfStorage(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId: asText(resolved.serviceJobId),
      collectorName,
      collectorCapacity,
      collectorIdNumber: asText(body.collectorIdNumber) || null,
      collectorContact: asText(body.collectorContact) || null,
      conditionOnDeparture: asText(body.conditionOnDeparture) || null,
      evidenceId: asText(body.evidenceId) || null,
      latitude: asNumberOrNull(body.latitude),
      longitude: asNumberOrNull(body.longitude),
    });
    if (!result.ok) return errorResponse(result.message, result.status);

    return NextResponse.json({
      ok: true,
      bookingId: result.data.bookingId,
      accrualId: result.data.accrualId,
      custodyEventId: result.data.custodyEventId,
      accrual: result.data.accrual,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

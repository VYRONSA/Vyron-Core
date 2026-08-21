/**
 * VYRON CORE — Road & Recovery storage service layer (Phase 4, Step 3).
 *
 * ---------------------------------------------------------------------------
 * CHECKING IN PRODUCES TWO FACTS
 * ---------------------------------------------------------------------------
 *
 *   custody   possession moved to the yard              (rr_custody_events — legal)
 *   booking   the vehicle occupies a bay and is charged (rr_storage_bookings — commercial)
 *
 * Both are written here, in that order, and the booking REFERENCES the custody event
 * rather than restating it. They are separate records because they are disputed
 * separately: "you never had my car" and "you overcharged me" are different arguments.
 *
 * ---------------------------------------------------------------------------
 * CHECKING OUT IS GATED
 * ---------------------------------------------------------------------------
 *
 * A vehicle leaves the yard only when all three hold:
 *
 *   1. a verified release authority is in force   (lib/road-recovery/release-authority.ts)
 *   2. release-scope evidence is complete          (Phase 3 compliance engine)
 *   3. custody is actually ours to hand over       (the projection says we hold it)
 *
 * Fails CLOSED on every one of them.
 *
 * The charge is computed by the PURE calculator and SEALED, exactly as Phase 2 seals
 * BYSTAND standing time. Billing reads the frozen row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import { loadJobCapability, recordCustodyEvent } from "@/lib/road-recovery/custody-service";
import { resolveAuthorityGuard } from "@/lib/road-recovery/release-authority";
import {
  RR_STORAGE_CALCULATOR_VERSION,
  calculateStorageAccrual,
  type RrStorageRateBasis,
  type StorageAccrualResult,
} from "@/lib/road-recovery/storage-accrual";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export async function checkVehicleIntoStorage(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    yardId: string;
    bayReference?: string | null;
    rateBasis?: RrStorageRateBasis;
    rateAmount?: number | null;
    freeDays?: number;
    storageCondition?: string;
    conditionOnArrival?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    evidenceId?: string | null;
    notes?: string | null;
  }
): Promise<RrServiceResult<{ bookingId: string; custodyEventId: string }>> {
  const capability = await loadJobCapability(supabase, input.companyId, input.serviceJobId);
  if (!capability.ok) return capability;
  if (!capability.data.requiresStorage) {
    return fail(
      `The ${capability.data.serviceCode.replace(/_/g, " ")} service does not store vehicles, so no storage booking can be created for this job.`,
      409
    );
  }

  const { data: yard, error: yardError } = await supabase
    .from("rr_custody_yards")
    .select("id, name, active")
    .eq("company_id", input.companyId)
    .eq("id", input.yardId)
    .maybeSingle();

  if (yardError) return fail(yardError.message, 500);
  if (!yard) return fail("That yard does not exist in this company.", 404);
  if ((yard as Row).active === false) return fail("That yard is not active.", 409);

  // Possession first: the vehicle is in the yard's hands before it occupies a bay.
  const custody = await recordCustodyEvent(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    eventType: "transferred",
    holderType: "yard",
    holderName: asText((yard as Row).name),
    yardId: input.yardId,
    actorRole: "yard_operator",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    locationLabel: asText((yard as Row).name),
    evidenceId: input.evidenceId || null,
    notes: input.notes || null,
  });
  if (!custody.ok) return custody;

  const { data, error } = await supabase
    .from("rr_storage_bookings")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      yard_id: input.yardId,
      bay_reference: input.bayReference || null,
      status: "stored",
      // checked_in_at is left to the database default: server-stamped, never supplied.
      check_in_event_id: custody.data.eventId,
      rate_basis: input.rateBasis || "per_day",
      rate_amount: input.rateAmount ?? null,
      free_days: Math.max(0, Number(input.freeDays) || 0),
      storage_condition: input.storageCondition || "outdoor",
      condition_on_arrival: input.conditionOnArrival || null,
      notes: input.notes || null,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) {
    // The custody event stands: possession genuinely moved, and an append-only log must
    // not be rewritten because a commercial record failed to save.
    return fail(
      error?.message ||
        "Custody was recorded but the storage booking could not be created. Retry the booking; the custody chain is intact.",
      400
    );
  }

  const bookingId = asText((data as Row).id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_storage_booking",
    entityId: bookingId,
    metadata: {
      serviceJobId: input.serviceJobId,
      yardId: input.yardId,
      custodyEventId: custody.data.eventId,
    },
  });

  return { ok: true, data: { bookingId, custodyEventId: custody.data.eventId } };
}

// ---------------------------------------------------------------------------
// Accrual
// ---------------------------------------------------------------------------

async function loadOpenBooking(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<{ booking: Row | null; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_storage_bookings")
    .select(
      "id,yard_id,bay_reference,status,checked_in_at,checked_out_at,rate_basis,rate_amount,currency,free_days,storage_condition"
    )
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .is("checked_out_at", null)
    .maybeSingle();

  if (error) return { booking: null, error: error.message };
  return { booking: (data as Row | null) ?? null, error: null };
}

/** What the open booking has accrued so far. Read-only; seals nothing. */
export async function computeStorageAccrual(
  supabase: SupabaseClient,
  input: { companyId: string; serviceJobId: string; at?: string }
): Promise<RrServiceResult<{ bookingId: string; accrual: StorageAccrualResult }>> {
  const { booking, error } = await loadOpenBooking(supabase, input.companyId, input.serviceJobId);
  if (error) return fail(error, 500);
  if (!booking) return fail("This job has no open storage booking.", 404);

  const accrual = calculateStorageAccrual({
    checkedInAt: asText(booking.checked_in_at),
    periodEnd: input.at ?? new Date().toISOString(),
    rateBasis: asText(booking.rate_basis) as RrStorageRateBasis,
    rateAmount: asNumberOrNull(booking.rate_amount),
    freeDays: Number(booking.free_days) || 0,
  });

  return { ok: true, data: { bookingId: asText(booking.id), accrual } };
}

/** Seals an accrual as an immutable billing fact. */
async function sealAccrual(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    bookingId: string;
    accrual: StorageAccrualResult;
    currency: string;
    sealedReason: "check_out" | "periodic" | "release" | "disposal" | "cancellation";
  }
): Promise<{ accrualId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_storage_accrual")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      booking_id: input.bookingId,
      sealed_reason: input.sealedReason,
      period_start: input.accrual.periodStart,
      period_end: input.accrual.periodEnd,
      chargeable_days: input.accrual.chargeableDays,
      free_days_applied: input.accrual.freeDaysApplied,
      elapsed_days: input.accrual.elapsedDays,
      rate_basis: input.accrual.rateBasis,
      rate_amount: input.accrual.rateAmount,
      billable_units: input.accrual.billableUnits,
      currency: input.currency,
      amount: input.accrual.amount,
      calculator_version: RR_STORAGE_CALCULATOR_VERSION,
      sealed_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) return { accrualId: null, error: error?.message || "Could not seal the accrual." };
  return { accrualId: asText((data as Row).id), error: null };
}

// ---------------------------------------------------------------------------
// Check-out / release
// ---------------------------------------------------------------------------

export type ReleaseEligibility = {
  eligible: boolean;
  authorityOk: boolean;
  evidenceOk: boolean;
  custodyOk: boolean;
  reasons: string[];
};

/**
 * Answers "may this vehicle leave the yard?" without changing anything.
 *
 * All three conditions are evaluated even when the first fails, so a controller sees
 * everything outstanding at once rather than fixing one thing at a time.
 */
export async function evaluateReleaseEligibility(
  supabase: SupabaseClient,
  input: { companyId: string; serviceJobId: string; at?: string }
): Promise<RrServiceResult<ReleaseEligibility>> {
  const at = input.at ?? new Date().toISOString();
  const reasons: string[] = [];

  const authority = await resolveAuthorityGuard(supabase, {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    authorityType: "release",
    at,
  });
  if (!authority.authorised) reasons.push(authority.reason);

  const { evaluateJobCompliance } = await import("@/lib/road-recovery/requirements-service");
  const compliance = await evaluateJobCompliance(supabase, {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    scope: "release",
    at,
  });
  const evidenceOk = compliance.ok ? compliance.data.compliance.evidenceComplete : false;
  if (!evidenceOk) {
    reasons.push(
      compliance.ok
        ? `Release evidence is outstanding: ${compliance.data.compliance.blocking.join(", ").replace(/_/g, " ")}.`
        : "Release evidence could not be evaluated, so the release is refused."
    );
  }

  const { data: holding } = await supabase
    .from("rr_custody_holdings")
    .select("holder_type,released")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .maybeSingle();

  const holdingRow = holding as Row | null;
  const custodyOk =
    holdingRow !== null &&
    holdingRow.released !== true &&
    ["operator", "yard"].includes(asText(holdingRow.holder_type));
  if (!custodyOk) {
    reasons.push(
      holdingRow === null
        ? "No custody has ever been recorded for this job, so there is nothing to release."
        : holdingRow.released === true
          ? "This vehicle has already been released."
          : `Custody currently rests with ${asText(holdingRow.holder_name) || asText(holdingRow.holder_type)}, so it is not ours to hand over.`
    );
  }

  return {
    ok: true,
    data: {
      eligible: authority.authorised && evidenceOk && custodyOk,
      authorityOk: authority.authorised,
      evidenceOk,
      custodyOk,
      reasons,
    },
  };
}

/**
 * Checks a vehicle out of the yard and hands it to the collector.
 *
 * FAILS CLOSED: refuses unless every release condition holds. Seals the storage charge
 * BEFORE handing over, so the amount is frozen at the moment the vehicle left rather
 * than whenever someone later remembered to bill it.
 */
export async function checkVehicleOutOfStorage(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    collectorName: string;
    collectorCapacity: string;
    collectorIdNumber?: string | null;
    collectorContact?: string | null;
    conditionOnDeparture?: string | null;
    evidenceId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    at?: string;
  }
): Promise<
  RrServiceResult<{
    bookingId: string;
    accrualId: string | null;
    custodyEventId: string;
    accrual: StorageAccrualResult;
  }>
> {
  if (!asText(input.collectorName) || !asText(input.collectorCapacity)) {
    return fail(
      "Releasing a vehicle must name the person collecting it and the capacity they collect it in.",
      400
    );
  }

  const eligibility = await evaluateReleaseEligibility(supabase, {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    at: input.at,
  });
  if (!eligibility.ok) return eligibility;
  if (!eligibility.data.eligible) {
    return fail(`This vehicle cannot be released. ${eligibility.data.reasons.join(" ")}`, 409);
  }

  const { booking, error } = await loadOpenBooking(supabase, input.companyId, input.serviceJobId);
  if (error) return fail(error, 500);
  if (!booking) return fail("This job has no open storage booking.", 404);

  const at = input.at ?? new Date().toISOString();
  const accrual = calculateStorageAccrual({
    checkedInAt: asText(booking.checked_in_at),
    periodEnd: at,
    rateBasis: asText(booking.rate_basis) as RrStorageRateBasis,
    rateAmount: asNumberOrNull(booking.rate_amount),
    freeDays: Number(booking.free_days) || 0,
  });

  const bookingId = asText(booking.id);

  // Seal the charge FIRST. If the handover then fails, the customer has been charged for
  // storage they genuinely used and the vehicle is still in the yard — recoverable. The
  // reverse order would release the vehicle with no record of what it owed.
  const sealed = await sealAccrual(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    bookingId,
    accrual,
    currency: asText(booking.currency) || "ZAR",
    sealedReason: "check_out",
  });
  if (sealed.error) return fail(sealed.error, 400);

  const authority = await resolveAuthorityGuard(supabase, {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    authorityType: "release",
    at,
  });

  const custody = await recordCustodyEvent(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    eventType: "released",
    holderType: "owner",
    holderName: asText(input.collectorName),
    actorRole: "yard_operator",
    receivingPartyName: asText(input.collectorName),
    receivingPartyCapacity: asText(input.collectorCapacity),
    receivingPartyIdNumber: input.collectorIdNumber || null,
    receivingPartyContact: input.collectorContact || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    authorityId: authority.authorityId,
    evidenceId: input.evidenceId || null,
  });
  if (!custody.ok) return custody;

  const { error: closeError } = await supabase
    .from("rr_storage_bookings")
    .update({
      status: "checked_out",
      checked_out_at: at,
      check_out_event_id: custody.data.eventId,
      condition_on_departure: input.conditionOnDeparture || null,
      updated_at: at,
    })
    .eq("company_id", input.companyId)
    .eq("id", bookingId);

  if (closeError) return fail(closeError.message, 400);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_storage_booking",
    entityId: bookingId,
    metadata: {
      serviceJobId: input.serviceJobId,
      collector: input.collectorName,
      chargeableDays: accrual.chargeableDays,
      amount: accrual.amount,
      authorityId: authority.authorityId,
    },
  });

  return {
    ok: true,
    data: { bookingId, accrualId: sealed.accrualId, custodyEventId: custody.data.eventId, accrual },
  };
}

/** Open booking, sealed accruals and current eligibility, for the storage screen. */
export async function getStoragePosition(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<{ bookings: Row[]; accruals: Row[] }>> {
  const [bookingsRes, accrualsRes] = await Promise.all([
    supabase
      .from("rr_storage_bookings")
      .select(
        "id,yard_id,bay_reference,status,checked_in_at,checked_out_at,rate_basis,rate_amount,currency,free_days,storage_condition,condition_on_arrival,condition_on_departure"
      )
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId)
      .order("checked_in_at", { ascending: false }),
    supabase
      .from("rr_storage_accrual")
      .select(
        "id,booking_id,sealed_reason,period_start,period_end,elapsed_days,free_days_applied,chargeable_days,billable_units,rate_basis,rate_amount,currency,amount,calculator_version,sealed_by,sealed_at"
      )
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId)
      .order("sealed_at", { ascending: false }),
  ]);

  if (bookingsRes.error) return fail("Could not load the storage position.", 500);

  return {
    ok: true,
    data: {
      bookings: (bookingsRes.data || []) as Row[],
      accruals: (accrualsRes.data || []) as Row[],
    },
  };
}

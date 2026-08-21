/**
 * VYRON CORE — Road & Recovery billing intelligence service layer (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS STOPS
 * ---------------------------------------------------------------------------
 *
 * It produces BILLING INFORMATION: what happened, what is billable, which rate applied,
 * how much should be charged, what evidence supports it, and whether it is ready to be
 * invoiced. It then STOPS. No invoice, no payment, no credit note, no ledger — VYRON
 * FINANCE owns those.
 *
 * ---------------------------------------------------------------------------
 * THE DECISIONS ARE PURE
 * ---------------------------------------------------------------------------
 *
 *   which rate card applies  -> resolveRateCard()      (pure)
 *   how much it comes to     -> calculateCharges()     (pure)
 *   after-hours / holiday    -> dayContextFor()        (pure)
 *
 * This file is the I/O half: it loads, freezes and seals. Every commercial amount is
 * computed by the pure engine, never here and never by AI.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS FROZEN, AND WHY
 * ---------------------------------------------------------------------------
 *
 *   rate snapshot  frozen once, per job. A republished rate card cannot re-price a
 *                  completed job.
 *   facts          append-only. The driver's odometer reading is never overwritten; a
 *                  controller who disagrees records a dispute, and an accepted correction
 *                  is a NEW fact that supersedes the original.
 *   calculations   sealed, carrying the engine version and the rate-card version.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import {
  resolveRateCard,
  type RrChargeCode,
  type RrRateCard,
  type RrRateCardItem,
  type RrVatTreatment,
} from "@/lib/road-recovery/rate-cards";
import {
  assertNoRecoveryCharges,
  calculateCharges,
  dayContextFor,
  RR_CHARGE_ENGINE_VERSION,
  type RrBillableFact,
  type RrChargeResult,
  type RrDayContext,
} from "@/lib/road-recovery/charge-engine";
import type { RrCondition } from "@/lib/road-recovery/requirements";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

/** How far a captured distance may differ from the dispatch estimate before it is queried. */
export const RR_DISTANCE_TOLERANCE_PERCENT = 25;

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------

function rowToRateCard(cardRow: Row, itemRows: Row[]): RrRateCard {
  return {
    policyKey: asText(cardRow.policy_key),
    counterpartyId: asText(cardRow.counterparty_id) || null,
    serviceCode: asText(cardRow.service_code) || null,
    version: asNumber(cardRow.version, 1),
    active: cardRow.active !== false,
    effectiveFrom: cardRow.effective_from ? asText(cardRow.effective_from) : null,
    effectiveTo: cardRow.effective_to ? asText(cardRow.effective_to) : null,
    currency: asText(cardRow.currency) || "ZAR",
    vatRate: asNumber(cardRow.vat_rate, 0),
    items: itemRows
      .filter((item) => asText(item.rate_card_id) === asText(cardRow.id))
      .map((item) => itemRowToRateItem(item)),
  };
}

function itemRowToRateItem(item: Row): RrRateCardItem {
  return {
    chargeCode: asText(item.charge_code) as RrChargeCode,
    label: asText(item.label),
    basis: asText(item.basis) as RrRateCardItem["basis"],
    unit: asText(item.unit) || "each",
    rateAmount: asNumber(item.rate_amount),
    minimumCharge: asNumberOrNull(item.minimum_charge),
    includedQuantity: asNumber(item.included_quantity),
    bandFrom: asNumberOrNull(item.band_from),
    bandTo: asNumberOrNull(item.band_to),
    increment: asNumber(item.increment, 1) || 1,
    vatTreatment: (asText(item.vat_treatment) || "standard") as RrVatTreatment,
    optional: item.optional === true,
    condition: (item.condition ?? { always: true }) as RrCondition,
    appliesTo: (Array.isArray(item.applies_to) ? item.applies_to : []) as RrChargeCode[],
    sortOrder: asNumber(item.sort_order, 100),
  };
}

async function loadRateCards(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ cards: RrRateCard[]; byKey: Map<string, Row>; error: string | null }> {
  const [cardsRes, itemsRes] = await Promise.all([
    supabase
      .from("rr_rate_cards")
      .select(
        "id,policy_key,counterparty_id,service_code,version,active,effective_from,effective_to,currency,vat_rate"
      )
      .eq("company_id", companyId),
    supabase
      .from("rr_rate_card_items")
      .select(
        "id,rate_card_id,charge_code,label,basis,unit,rate_amount,minimum_charge,included_quantity,band_from,band_to,increment,vat_treatment,optional,condition,applies_to,sort_order"
      )
      .eq("company_id", companyId),
  ]);

  if (cardsRes.error) return { cards: [], byKey: new Map(), error: cardsRes.error.message };
  if (itemsRes.error) return { cards: [], byKey: new Map(), error: itemsRes.error.message };

  const cardRows = (cardsRes.data || []) as Row[];
  const itemRows = (itemsRes.data || []) as Row[];
  const byKey = new Map<string, Row>();
  for (const row of cardRows) byKey.set(asText(row.policy_key) + "@" + asNumber(row.version), row);

  return { cards: cardRows.map((row) => rowToRateCard(row, itemRows)), byKey, error: null };
}

export type RateSnapshotResult = {
  snapshotId: string | null;
  policyKey: string | null;
  policyVersion: number | null;
  itemCount: number;
  conflicted: boolean;
  reason: string;
};

/**
 * Resolves the governing rate card and FREEZES it onto the job.
 *
 * Frozen once. If a snapshot already exists it is returned unchanged — that is the whole
 * point: a completed job keeps the rate card it was priced under, whatever anyone
 * publishes afterwards.
 */
export async function resolveAndFreezeRateCard(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    at?: string;
  }
): Promise<RrServiceResult<RateSnapshotResult>> {
  const at = input.at ?? new Date().toISOString();

  const { data: existing } = await supabase
    .from("rr_job_rate_snapshot")
    .select("id,policy_key,policy_version,items")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .maybeSingle();

  if (existing) {
    const row = existing as Row;
    return {
      ok: true,
      data: {
        snapshotId: asText(row.id),
        policyKey: asText(row.policy_key),
        policyVersion: asNumber(row.policy_version),
        itemCount: Array.isArray(row.items) ? row.items.length : 0,
        conflicted: false,
        reason: "This job was already priced; its frozen rate card is unchanged.",
      },
    };
  }

  const job = await loadJobContext(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  const { cards, error } = await loadRateCards(supabase, input.companyId);
  if (error) return fail(error, 500);

  const resolution = resolveRateCard(cards, {
    counterpartyId: job.data.counterpartyId,
    serviceCode: job.data.serviceCode,
    at,
  });

  if (resolution.conflicted) {
    return {
      ok: true,
      data: {
        snapshotId: null,
        policyKey: null,
        policyVersion: null,
        itemCount: 0,
        conflicted: true,
        reason: resolution.reason,
      },
    };
  }

  if (!resolution.card) {
    return {
      ok: true,
      data: {
        snapshotId: null,
        policyKey: null,
        policyVersion: null,
        itemCount: 0,
        conflicted: false,
        reason: resolution.reason,
      },
    };
  }

  const card = resolution.card;
  const cardRow = cards.length > 0 ? null : null;
  void cardRow;

  const { data, error: insertError } = await supabase
    .from("rr_job_rate_snapshot")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      policy_key: card.policyKey,
      policy_version: card.version,
      counterparty_id: card.counterpartyId,
      service_code: card.serviceCode,
      currency: card.currency,
      vat_rate: card.vatRate,
      items: card.items.map((item) => ({
        charge_code: item.chargeCode,
        label: item.label,
        basis: item.basis,
        unit: item.unit,
        rate_amount: item.rateAmount,
        minimum_charge: item.minimumCharge,
        included_quantity: item.includedQuantity,
        band_from: item.bandFrom,
        band_to: item.bandTo,
        increment: item.increment,
        vat_treatment: item.vatTreatment,
        optional: item.optional,
        condition: item.condition,
        applies_to: [...item.appliesTo],
        sort_order: item.sortOrder,
      })),
      resolution_reason: resolution.reason,
      resolved_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return fail(insertError?.message || "Could not freeze the rate card.", 400);
  }

  const snapshotId = asText((data as Row).id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_job_rate_snapshot",
    entityId: snapshotId,
    metadata: {
      serviceJobId: input.serviceJobId,
      policyKey: card.policyKey,
      policyVersion: card.version,
      reason: resolution.reason,
    },
  });

  return {
    ok: true,
    data: {
      snapshotId,
      policyKey: card.policyKey,
      policyVersion: card.version,
      itemCount: card.items.length,
      conflicted: false,
      reason: resolution.reason,
    },
  };
}

/** Reads a job's frozen rate card back into the pure engine's shape. */
async function loadRateSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<{ card: RrRateCard | null; snapshotId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_job_rate_snapshot")
    .select("id,policy_key,policy_version,counterparty_id,service_code,currency,vat_rate,items")
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .maybeSingle();

  if (error) return { card: null, snapshotId: null, error: error.message };
  if (!data) return { card: null, snapshotId: null, error: null };

  const row = data as Row;
  const items = (Array.isArray(row.items) ? row.items : []) as Row[];

  return {
    snapshotId: asText(row.id),
    error: null,
    card: {
      policyKey: asText(row.policy_key),
      counterpartyId: asText(row.counterparty_id) || null,
      serviceCode: asText(row.service_code) || null,
      version: asNumber(row.policy_version, 1),
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      currency: asText(row.currency) || "ZAR",
      vatRate: asNumber(row.vat_rate),
      items: items.map((item) => itemRowToRateItem(item)),
    },
  };
}

// ---------------------------------------------------------------------------
// Job context
// ---------------------------------------------------------------------------

export type JobBillingContext = {
  serviceJobId: string;
  fieldJobId: string;
  serviceCode: string;
  workflowKey: string;
  serviceState: string;
  counterpartyId: string | null;
  hasDestination: boolean;
  createdAt: string;
};

async function loadJobContext(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<JobBillingContext>> {
  const { data, error } = await supabase
    .from("rr_service_jobs")
    .select(
      "id,field_job_id,service_type_id,workflow_key,service_state,counterparty_id,destination_label,destination_address,destination_type,created_at"
    )
    .eq("company_id", companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!data) return fail("Service job not found in this company.", 404);

  const job = data as Row;

  const { data: typeRow } = await supabase
    .from("rr_service_types")
    .select("service_code")
    .eq("company_id", companyId)
    .eq("id", asText(job.service_type_id))
    .maybeSingle();

  return {
    ok: true,
    data: {
      serviceJobId: asText(job.id),
      fieldJobId: asText(job.field_job_id),
      serviceCode: asText((typeRow as Row | null)?.service_code),
      workflowKey: asText(job.workflow_key),
      serviceState: asText(job.service_state),
      counterpartyId: asText(job.counterparty_id) || null,
      hasDestination: Boolean(
        asText(job.destination_label) || asText(job.destination_address) || asText(job.destination_type)
      ),
      createdAt: asText(job.created_at),
    },
  };
}

// ---------------------------------------------------------------------------
// Billable facts
// ---------------------------------------------------------------------------

export type RecordFactInput = {
  companyId: string;
  actorEmail: string;
  serviceJobId: string;
  factCode: string;
  quantity: number;
  unit: string;
  source: string;
  sourceRef?: string | null;
  calculationVersion?: string | null;
  sourceDetail?: Record<string, unknown>;
  evidenceId?: string | null;
  occurredAt?: string | null;
  notes?: string | null;
  /** Set when this fact replaces an earlier one; the original is superseded, never edited. */
  supersedesFactId?: string | null;
};

export async function recordBillableFact(
  supabase: SupabaseClient,
  input: RecordFactInput
): Promise<RrServiceResult<{ factId: string }>> {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    return fail(`A ${input.factCode} quantity must be zero or more.`, 400);
  }

  // Retire the fact being replaced FIRST: a partial unique index permits only one active
  // fact per code per job, so inserting before superseding would be rejected.
  if (input.supersedesFactId) {
    const { error: retireError } = await supabase
      .from("rr_billable_facts")
      .update({ status: "superseded" })
      .eq("company_id", input.companyId)
      .eq("id", input.supersedesFactId);
    // The replacement id is written back after the insert; the trigger permits only these
    // two columns to move, so nothing about the original fact itself changes.
    if (retireError) return fail(retireError.message, 400);
  }

  const { data, error } = await supabase
    .from("rr_billable_facts")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      fact_code: input.factCode,
      quantity: input.quantity,
      unit: input.unit,
      source: input.source,
      source_ref: input.sourceRef || null,
      calculation_version: input.calculationVersion || null,
      source_detail: input.sourceDetail ?? {},
      evidence_id: input.evidenceId || null,
      occurred_at: input.occurredAt || new Date().toISOString(),
      recorded_by: input.actorEmail,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record the billable fact.", 400);

  const factId = asText((data as Row).id);

  if (input.supersedesFactId) {
    await supabase
      .from("rr_billable_facts")
      .update({ superseded_by: factId })
      .eq("company_id", input.companyId)
      .eq("id", input.supersedesFactId);
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_billable_fact",
    entityId: factId,
    metadata: {
      serviceJobId: input.serviceJobId,
      factCode: input.factCode,
      quantity: input.quantity,
      source: input.source,
      supersedes: input.supersedesFactId || null,
    },
  });

  return { ok: true, data: { factId } };
}

export type OdometerCaptureResult = {
  factId: string;
  distanceKm: number;
  dispatchEstimateKm: number | null;
  variancePercent: number | null;
  queried: boolean;
  disputeId: string | null;
};

/**
 * Records the driver's odometer capture — the PRIMARY commercial distance source.
 *
 * GPS stays supporting evidence and the dispatch estimate is only a comparison baseline;
 * neither is ever used as the billable number. If the captured distance diverges from the
 * estimate beyond tolerance the fact is still recorded exactly as the driver gave it, and
 * a `disputed_distance` exception plus a dispute record are raised for controller review.
 * The driver's reading is never silently altered.
 */
export async function recordOdometerCapture(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    odometerStartKm: number;
    odometerEndKm: number;
    vehicleId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    evidenceId?: string | null;
    capturedAt?: string | null;
    notes?: string | null;
    tolerancePercent?: number;
  }
): Promise<RrServiceResult<OdometerCaptureResult>> {
  const start = asNumber(input.odometerStartKm, NaN);
  const end = asNumber(input.odometerEndKm, NaN);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return fail("Both odometer readings are required.", 400);
  }
  if (end < start) {
    return fail("The closing odometer reading cannot be lower than the opening one.", 400);
  }

  const distanceKm = Math.round((end - start) * 1000) / 1000;

  // The dispatch estimate is a straight-line truck-to-scene distance recorded at
  // dispatch-scoring time. It is a sanity check, never the billable figure.
  const { data: candidates } = await supabase
    .from("rr_dispatch_candidates")
    .select("distance_km")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .not("distance_km", "is", null)
    .limit(1);

  const estimateRow = ((candidates || []) as Row[])[0];
  const dispatchEstimateKm = estimateRow ? asNumberOrNull(estimateRow.distance_km) : null;

  const tolerance = input.tolerancePercent ?? RR_DISTANCE_TOLERANCE_PERCENT;
  let variancePercent: number | null = null;
  let queried = false;

  if (dispatchEstimateKm !== null && dispatchEstimateKm > 0) {
    variancePercent =
      Math.round((Math.abs(distanceKm - dispatchEstimateKm) / dispatchEstimateKm) * 10000) / 100;
    queried = variancePercent > tolerance;
  }

  const capturedAt = input.capturedAt || new Date().toISOString();

  const recorded = await recordBillableFact(supabase, {
    companyId: input.companyId,
    actorEmail: input.actorEmail,
    serviceJobId: input.serviceJobId,
    factCode: "tow_distance",
    quantity: distanceKm,
    unit: "km",
    source: "captured",
    sourceDetail: {
      odometer_start_km: start,
      odometer_end_km: end,
      calculated_distance_km: distanceKm,
      vehicle_id: input.vehicleId || null,
      captured_at: capturedAt,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      dispatch_estimate_km: dispatchEstimateKm,
      variance_percent: variancePercent,
      tolerance_percent: tolerance,
    },
    evidenceId: input.evidenceId || null,
    occurredAt: capturedAt,
    notes: input.notes || null,
  });
  if (!recorded.ok) return recorded;

  let disputeId: string | null = null;

  if (queried) {
    await raiseBillingException(supabase, {
      companyId: input.companyId,
      actorEmail: input.actorEmail,
      serviceJobId: input.serviceJobId,
      exceptionCode: "disputed_distance",
      severity: "high",
      factCode: "tow_distance",
      detail: `The captured distance of ${distanceKm} km differs from the dispatch estimate of ${dispatchEstimateKm} km by ${variancePercent}%, beyond the ${tolerance}% tolerance.`,
      detectedBy: "system",
    });

    const { data: dispute } = await supabase
      .from("rr_billing_disputes")
      .insert({
        company_id: input.companyId,
        service_job_id: input.serviceJobId,
        dispute_type: "distance",
        fact_id: recorded.data.factId,
        original_quantity: distanceKm,
        disputed_quantity: dispatchEstimateKm,
        unit: "km",
        raised_by: input.actorEmail,
        raised_by_party: "controller",
        reason: `Captured distance is ${variancePercent}% away from the dispatch estimate. Controller review required; the driver's reading stands until reviewed.`,
        status: "open",
      })
      .select("id")
      .single();

    disputeId = dispute ? asText((dispute as Row).id) : null;
  }

  return {
    ok: true,
    data: {
      factId: recorded.data.factId,
      distanceKm,
      dispatchEstimateKm,
      variancePercent,
      queried,
      disputeId,
    },
  };
}

/**
 * Derives the facts that come from records already sealed elsewhere.
 *
 * Storage duration is READ from rr_storage_accrual and never recalculated; BYSTAND
 * standing time is READ from rr_standby_summary. Both carry their sealing calculator
 * version onto the fact, so a charge line can always name the algorithm behind it.
 */
export async function deriveSealedFacts(
  supabase: SupabaseClient,
  input: { companyId: string; actorEmail: string; serviceJobId: string }
): Promise<RrServiceResult<{ derived: string[]; skipped: string[] }>> {
  const derived: string[] = [];
  const skipped: string[] = [];

  const { data: existing } = await supabase
    .from("rr_billable_facts")
    .select("fact_code,status")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId);

  const active = new Set(
    ((existing || []) as Row[])
      .filter((row) => asText(row.status) !== "superseded")
      .map((row) => asText(row.fact_code))
  );

  // --- BYSTAND standing time, from the sealed Phase 2 summary -----------------
  if (!active.has("standing_time")) {
    const { data: standby } = await supabase
      .from("rr_standby_summary")
      .select("id,total_billable_seconds,total_paused_seconds,calculator_version")
      .eq("company_id", input.companyId)
      .eq("service_job_id", input.serviceJobId)
      .order("sealed_at", { ascending: false })
      .limit(1);

    const summary = ((standby || []) as Row[])[0];
    if (summary) {
      const billableHours = Math.round((asNumber(summary.total_billable_seconds) / 3600) * 1000) / 1000;
      const pausedHours = Math.round((asNumber(summary.total_paused_seconds) / 3600) * 1000) / 1000;

      const standing = await recordBillableFact(supabase, {
        companyId: input.companyId,
        actorEmail: input.actorEmail,
        serviceJobId: input.serviceJobId,
        factCode: "standing_time",
        quantity: billableHours,
        unit: "hour",
        source: "sealed_summary",
        sourceRef: asText(summary.id),
        calculationVersion: asText(summary.calculator_version),
      });
      if (standing.ok) derived.push("standing_time");

      if (!active.has("paused_time")) {
        const paused = await recordBillableFact(supabase, {
          companyId: input.companyId,
          actorEmail: input.actorEmail,
          serviceJobId: input.serviceJobId,
          factCode: "paused_time",
          quantity: pausedHours,
          unit: "hour",
          source: "sealed_summary",
          sourceRef: asText(summary.id),
          calculationVersion: asText(summary.calculator_version),
        });
        if (paused.ok) derived.push("paused_time");
      }
    } else {
      skipped.push("standing_time");
    }
  }

  // --- Storage days, from the sealed Phase 4 accrual --------------------------
  if (!active.has("storage_days")) {
    const { data: accruals } = await supabase
      .from("rr_storage_accrual")
      .select("id,chargeable_days,elapsed_days,calculator_version")
      .eq("company_id", input.companyId)
      .eq("service_job_id", input.serviceJobId)
      .order("sealed_at", { ascending: false })
      .limit(1);

    const accrual = ((accruals || []) as Row[])[0];
    if (accrual) {
      // ELAPSED days, not chargeable days. The accrual already applied the yard's own
      // free-day allowance; the rate card applies the CONTRACT's grace day. Feeding the
      // post-allowance figure in would deduct the same grace twice.
      const storage = await recordBillableFact(supabase, {
        companyId: input.companyId,
        actorEmail: input.actorEmail,
        serviceJobId: input.serviceJobId,
        factCode: "storage_days",
        quantity: asNumber(accrual.elapsed_days),
        unit: "day",
        source: "sealed_summary",
        sourceRef: asText(accrual.id),
        calculationVersion: asText(accrual.calculator_version),
      });
      if (storage.ok) derived.push("storage_days");
    } else {
      skipped.push("storage_days");
    }
  }

  return { ok: true, data: { derived, skipped } };
}

/** Freezes every provisional fact, so the calculation prices a stable set. */
export async function freezeBillableFacts(
  supabase: SupabaseClient,
  input: { companyId: string; actorEmail: string; serviceJobId: string }
): Promise<RrServiceResult<{ frozen: number }>> {
  const { data, error } = await supabase
    .from("rr_billable_facts")
    .update({ status: "frozen" })
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .eq("status", "provisional")
    .select("id");

  if (error) return fail(error.message, 400);
  return { ok: true, data: { frozen: ((data || []) as Row[]).length } };
}

async function loadActiveFacts(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<{ facts: RrBillableFact[]; rows: Row[]; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_billable_facts")
    .select("id,fact_code,quantity,unit,source,source_ref,calculation_version,status,source_detail,evidence_id,occurred_at,recorded_by")
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId);

  if (error) return { facts: [], rows: [], error: error.message };

  const rows = ((data || []) as Row[]).filter((row) => asText(row.status) !== "superseded");

  return {
    rows,
    error: null,
    facts: rows.map((row) => ({
      factCode: asText(row.fact_code),
      quantity: asNumber(row.quantity),
      unit: asText(row.unit),
      source: asText(row.source),
      sourceRef: asText(row.source_ref) || null,
      calculationVersion: asText(row.calculation_version) || null,
      status: asText(row.status),
    })),
  };
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

/** Public holidays, read from the EXISTING Leave calendar. Absent module = no holidays. */
async function loadHolidays(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ dates: string[]; names: Record<string, string> }> {
  const { data, error } = await supabase
    .from("leave_public_holidays")
    .select("holiday_date,holiday_name,active")
    .eq("company_id", companyId);

  // A tenant without the Leave module simply has no holiday calendar. Failing SAFE here
  // means no holiday loading is applied, rather than a wrong one.
  if (error) return { dates: [], names: {} };

  const dates: string[] = [];
  const names: Record<string, string> = {};
  for (const row of (data || []) as Row[]) {
    if (row.active === false) continue;
    const date = asText(row.holiday_date).slice(0, 10);
    if (!date) continue;
    dates.push(date);
    names[date] = asText(row.holiday_name);
  }
  return { dates, names };
}

export type ChargeCalculationOutcome = {
  calculationId: string | null;
  result: RrChargeResult;
  sealed: boolean;
};

/**
 * Calculates the expected charge and SEALS it.
 *
 * Everything commercial is decided by the pure engine. This function loads, calls it, and
 * writes the result down with the engine version and the rate-card version attached.
 */
export async function calculateAndSealCharges(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    at?: string;
    /** Evaluate without sealing — for a preview screen. */
    dryRun?: boolean;
  }
): Promise<RrServiceResult<ChargeCalculationOutcome>> {
  const at = input.at ?? new Date().toISOString();

  const job = await loadJobContext(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  const snapshot = await loadRateSnapshot(supabase, input.companyId, input.serviceJobId);
  if (snapshot.error) return fail(snapshot.error, 500);
  if (!snapshot.card) {
    return fail(
      "This job has no frozen rate card. Resolve and freeze a rate card before calculating charges.",
      409
    );
  }

  const { facts, error: factsError } = await loadActiveFacts(
    supabase,
    input.companyId,
    input.serviceJobId
  );
  if (factsError) return fail(factsError, 500);

  const holidays = await loadHolidays(supabase, input.companyId);
  const dayContext: RrDayContext = dayContextFor(job.data.createdAt || at, {
    holidayDates: holidays.dates,
    holidayNames: holidays.names,
  });

  const result = calculateCharges({
    facts,
    rateCard: snapshot.card,
    jobFacts: {
      has_destination: job.data.hasDestination,
      counterparty_present: Boolean(job.data.counterpartyId),
      cancelled: job.data.serviceState === "cancelled",
      no_show: job.data.serviceState === "no_show",
    },
    dayContext,
    calculatedAt: at,
    serviceCode: job.data.serviceCode,
  });

  // BYSTAND may bill for standing, never for moving. The rate card cannot hold a recovery
  // charge and the database refuses one, and the calculated result is checked again here.
  if (job.data.workflowKey === "bystand") {
    try {
      assertNoRecoveryCharges(result);
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : "BYSTAND separation violated.", 500);
    }
  }

  if (input.dryRun) {
    return { ok: true, data: { calculationId: null, result, sealed: false } };
  }

  const { data, error } = await supabase
    .from("rr_charge_calculations")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      status: result.status,
      subtotal_ex_vat: result.subtotalExVat,
      vat_amount: result.vatAmount,
      total_incl_vat: result.totalInclVat,
      currency: result.currency,
      vat_rate: result.vatRate,
      missing_facts: result.missingFacts,
      unrated_facts: result.unratedFacts,
      rate_policy_key: result.ratePolicyKey,
      rate_version: result.rateVersion,
      rate_snapshot_id: snapshot.snapshotId,
      after_hours: dayContext.afterHours,
      public_holiday: dayContext.publicHoliday,
      engine_version: RR_CHARGE_ENGINE_VERSION,
      rate_engine_version: result.rateEngineVersion,
      calculated_at: at,
      calculated_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not seal the calculation.", 400);

  const calculationId = asText((data as Row).id);

  if (result.lines.length > 0) {
    const { error: linesError } = await supabase.from("rr_charge_lines").insert(
      result.lines.map((line, index) => ({
        company_id: input.companyId,
        calculation_id: calculationId,
        service_job_id: input.serviceJobId,
        charge_code: line.chargeCode,
        label: line.label,
        rule_id: line.ruleId,
        basis: line.basis,
        unit: line.unit,
        quantity: line.quantity,
        chargeable_quantity: line.chargeableQuantity,
        rate_amount: line.rateAmount,
        subtotal_ex_vat: line.subtotalExVat,
        minimum_applied: line.minimumApplied,
        vat_treatment: line.vatTreatment,
        vat_rate: line.vatRate,
        vat_amount: line.vatAmount,
        total_incl_vat: line.totalInclVat,
        reason: line.reason,
        fact_code: line.factCode,
        source_ref: line.sourceRef,
        sort_order: (index + 1) * 10,
      }))
    );
    if (linesError) return fail(linesError.message, 400);
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_charge_calculation",
    entityId: calculationId,
    metadata: {
      serviceJobId: input.serviceJobId,
      status: result.status,
      total: result.totalInclVat,
      ratePolicyKey: result.ratePolicyKey,
      engineVersion: RR_CHARGE_ENGINE_VERSION,
    },
  });

  return { ok: true, data: { calculationId, result, sealed: true } };
}

// ---------------------------------------------------------------------------
// Billing exceptions
// ---------------------------------------------------------------------------

export const RR_BILLING_EXCEPTION_CODES = [
  "missing_rate",
  "expired_rate",
  "conflicting_rate",
  "missing_distance",
  "disputed_distance",
  "missing_authorisation",
  "expired_authorisation",
  "authorisation_exceeded",
  "missing_evidence",
  "storage_overrun",
  "unapproved_additional_service",
  "missing_cancellation_reason",
  "missing_counterparty",
  "duplicate_charge",
  "incomplete_billing_information",
] as const;
export type RrBillingExceptionCode = (typeof RR_BILLING_EXCEPTION_CODES)[number];

export async function raiseBillingException(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    exceptionCode: RrBillingExceptionCode;
    severity?: string;
    detail?: string | null;
    factCode?: string | null;
    chargeCode?: string | null;
    detectedBy?: string;
  }
): Promise<RrServiceResult<{ exceptionId: string }>> {
  const severity = input.severity || "medium";

  // An open exception of the same code on the same job is not raised twice — a re-run of
  // readiness must not bury a controller in duplicates.
  const { data: existing } = await supabase
    .from("rr_billing_exceptions")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .eq("exception_code", input.exceptionCode)
    .in("resolution_status", ["open", "acknowledged"])
    .limit(1);

  const already = ((existing || []) as Row[])[0];
  if (already) return { ok: true, data: { exceptionId: asText(already.id) } };

  const { data, error } = await supabase
    .from("rr_billing_exceptions")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      exception_code: input.exceptionCode,
      severity,
      detail: input.detail || null,
      fact_code: input.factCode || null,
      charge_code: input.chargeCode || null,
      detected_by: input.detectedBy || "system",
      detected_by_actor: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not raise the billing exception.", 400);

  const exceptionId = asText((data as Row).id);

  // High-value exceptions route into the EXISTING approval queue. No second action engine.
  if (severity === "high" || severity === "critical") {
    const { data: actionRow } = await supabase
      .from("workforce_automation_actions")
      .insert({
        company_id: input.companyId,
        action_type: "Escalate Exception",
        status: "Pending Approval",
        prepared_by: input.actorEmail,
        source_module: "Road & Recovery Billing",
        reason: input.detail || `Road & Recovery billing exception: ${input.exceptionCode}`,
        payload_json: {
          billing_exception_id: exceptionId,
          service_job_id: input.serviceJobId,
          exception_code: input.exceptionCode,
          severity,
        },
      })
      .select("id")
      .single();

    if (actionRow) {
      await supabase
        .from("rr_billing_exceptions")
        .update({ automation_action_id: asText((actionRow as Row).id) })
        .eq("company_id", input.companyId)
        .eq("id", exceptionId);
    }
  }

  return { ok: true, data: { exceptionId } };
}

export async function resolveBillingException(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    exceptionId: string;
    resolutionStatus: "acknowledged" | "resolved" | "waived" | "cancelled";
    resolutionAction?: string | null;
    resolutionNotes?: string | null;
  }
): Promise<RrServiceResult<{ resolved: true }>> {
  const terminal = ["resolved", "waived"].includes(input.resolutionStatus);

  const { error } = await supabase
    .from("rr_billing_exceptions")
    .update({
      resolution_status: input.resolutionStatus,
      resolution_action: input.resolutionAction || null,
      resolution_notes: input.resolutionNotes || null,
      resolved_by: terminal ? input.actorEmail : null,
      resolved_at: terminal ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.exceptionId);

  if (error) return fail(error.message, 400);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_billing_exception",
    entityId: input.exceptionId,
    metadata: { resolutionStatus: input.resolutionStatus },
  });

  return { ok: true, data: { resolved: true } };
}

// ---------------------------------------------------------------------------
// Billing readiness
// ---------------------------------------------------------------------------

export type ReadinessGate = {
  gate: string;
  ok: boolean;
  detail: string;
};

export type BillingReadiness = {
  ready: boolean;
  gates: ReadinessGate[];
  blockingReasons: string[];
  calculationId: string | null;
  expectedTotalInclVat: number | null;
  currency: string | null;
};

/**
 * Answers "is this job ready to be invoiced?", deterministically and with reasons.
 *
 * Every gate is evaluated even when an earlier one fails, so a controller sees everything
 * outstanding at once rather than fixing one thing at a time. This is operational
 * intelligence; it produces no accounting record.
 */
export async function evaluateBillingReadiness(
  supabase: SupabaseClient,
  input: { companyId: string; serviceJobId: string; at?: string }
): Promise<RrServiceResult<BillingReadiness>> {
  const at = input.at ?? new Date().toISOString();
  const gates: ReadinessGate[] = [];

  const job = await loadJobContext(supabase, input.companyId, input.serviceJobId);
  if (!job.ok) return job;

  // 1. The operational work is finished.
  const terminalStates = ["evidence_complete", "invoice_ready", "invoiced", "closed", "released", "disposed", "report_submitted"];
  const workDone = terminalStates.includes(job.data.serviceState);
  gates.push({
    gate: "job_complete",
    ok: workDone,
    detail: workDone
      ? `The job has reached ${job.data.serviceState.replace(/_/g, " ")}.`
      : `The job is still at ${job.data.serviceState.replace(/_/g, " ")} and is not finished.`,
  });

  // 2. Phase 3 compliance — the evidence gate that already exists.
  const { evaluateJobCompliance } = await import("@/lib/road-recovery/requirements-service");
  const compliance = await evaluateJobCompliance(supabase, {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    scope: "invoice",
    at,
  });
  const evidenceOk = compliance.ok ? compliance.data.compliance.evidenceComplete : false;
  gates.push({
    gate: "evidence_complete",
    ok: evidenceOk,
    detail: evidenceOk
      ? "Required evidence is complete."
      : compliance.ok
        ? `Evidence outstanding: ${compliance.data.compliance.blocking.join(", ").replace(/_/g, " ")}.`
        : "Compliance could not be evaluated.",
  });

  // 3. A valid, unexpired authorisation, where the counterparty requires one.
  const { data: auths } = await supabase
    .from("rr_authorisations")
    .select("id,status,expires_at,authorised_amount,currency")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .eq("status", "active");

  const authRows = (auths || []) as Row[];
  const liveAuth = authRows.find((row) => {
    const expires = asText(row.expires_at);
    return !expires || new Date(expires).getTime() >= new Date(at).getTime();
  });
  const authorisationOk = !job.data.counterpartyId || Boolean(liveAuth);
  gates.push({
    gate: "authorisation_valid",
    ok: authorisationOk,
    detail: authorisationOk
      ? job.data.counterpartyId
        ? "A valid authorisation is on file."
        : "No counterparty, so no authorisation is required."
      : authRows.length > 0
        ? "Every authorisation on this job has expired."
        : "No active authorisation is on file for this counterparty.",
  });

  // 4. A frozen rate card.
  const snapshot = await loadRateSnapshot(supabase, input.companyId, input.serviceJobId);
  const rateOk = Boolean(snapshot.card);
  gates.push({
    gate: "rate_card_resolved",
    ok: rateOk,
    detail: rateOk
      ? `Priced under ${snapshot.card?.policyKey} v${snapshot.card?.version}.`
      : "No rate card has been resolved and frozen for this job.",
  });

  // 5. Facts frozen.
  const { rows: factRows } = await loadActiveFacts(supabase, input.companyId, input.serviceJobId);
  const provisional = factRows.filter((row) => asText(row.status) === "provisional");
  const factsOk = factRows.length > 0 && provisional.length === 0;
  gates.push({
    gate: "billable_facts_frozen",
    ok: factsOk,
    detail:
      factRows.length === 0
        ? "No billable facts have been recorded for this job."
        : provisional.length > 0
          ? `${provisional.length} billable fact(s) are still provisional.`
          : `${factRows.length} billable fact(s) frozen.`,
  });

  // 6. A successful sealed calculation.
  const { data: calcRows } = await supabase
    .from("rr_charge_calculations")
    .select("id,status,total_incl_vat,currency,missing_facts,unrated_facts,calculated_at")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .order("calculated_at", { ascending: false })
    .limit(1);

  const calculation = ((calcRows || []) as Row[])[0];
  const calcOk = Boolean(calculation) && asText(calculation.status) === "calculated";
  gates.push({
    gate: "charges_calculated",
    ok: calcOk,
    detail: !calculation
      ? "No charge calculation has been sealed for this job."
      : asText(calculation.status) === "calculated"
        ? `Expected charge ${asText(calculation.currency)} ${asNumber(calculation.total_incl_vat).toFixed(2)}.`
        : asText(calculation.status) === "not_chargeable"
          ? "The calculation produced no chargeable lines — the rate card has no rates set."
          : `The calculation is incomplete: ${[
              ...(Array.isArray(calculation.missing_facts) ? calculation.missing_facts : []),
              ...(Array.isArray(calculation.unrated_facts) ? calculation.unrated_facts : []),
            ]
              .join(", ")
              .replace(/_/g, " ")}.`,
  });

  // 7. No blocking billing exception.
  const { data: exceptions } = await supabase
    .from("rr_billing_exceptions")
    .select("id,exception_code,severity,resolution_status,detail")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .in("resolution_status", ["open", "acknowledged"]);

  const openExceptions = (exceptions || []) as Row[];
  const exceptionsOk = openExceptions.length === 0;
  gates.push({
    gate: "no_blocking_exceptions",
    ok: exceptionsOk,
    detail: exceptionsOk
      ? "No open billing exceptions."
      : `Open: ${openExceptions.map((row) => asText(row.exception_code).replace(/_/g, " ")).join(", ")}.`,
  });

  // 8. Someone to bill.
  const billToOk = Boolean(job.data.counterpartyId) || (await hasPrivateCustomer(supabase, input));
  gates.push({
    gate: "bill_to_known",
    ok: billToOk,
    detail: billToOk
      ? "A counterparty or customer is recorded."
      : "Neither a counterparty nor a customer is recorded, so there is nobody to bill.",
  });

  const ready = gates.every((gate) => gate.ok);

  return {
    ok: true,
    data: {
      ready,
      gates,
      blockingReasons: gates.filter((gate) => !gate.ok).map((gate) => gate.detail),
      calculationId: calculation ? asText(calculation.id) : null,
      expectedTotalInclVat: calculation ? asNumber(calculation.total_incl_vat) : null,
      currency: calculation ? asText(calculation.currency) : null,
    },
  };
}

async function hasPrivateCustomer(
  supabase: SupabaseClient,
  input: { companyId: string; serviceJobId: string }
): Promise<boolean> {
  const { data } = await supabase
    .from("rr_service_jobs")
    .select("customer_name")
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();
  return Boolean(asText((data as Row | null)?.customer_name));
}

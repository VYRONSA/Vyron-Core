/**
 * VYRON CORE — Road & Recovery charge engine (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PRODUCES
 * ---------------------------------------------------------------------------
 *
 * EXPECTED BILLING INFORMATION. Not an invoice.
 *
 *   frozen billable facts  +  frozen rate-card snapshot  ->  expected charge lines
 *
 * VYRON CORE answers what happened, what is billable, how much it should be, and why.
 * VYRON FINANCE issues the invoice, owns VAT treatment definitively, and handles debtors
 * and payments. Nothing in this file creates a document, a payment or a ledger entry.
 *
 * ---------------------------------------------------------------------------
 * PURE
 * ---------------------------------------------------------------------------
 *
 * No clock read, no I/O, no randomness. The evaluation instant and the day context are
 * passed in. The same facts and the same rate card always produce the same charge — which
 * is the property that lets a sealed calculation be re-derived and defended months later,
 * and the reason AI never computes a commercial amount.
 *
 * RR_CHARGE_ENGINE_VERSION is stamped onto every result. If the arithmetic here ever
 * changes, the version MUST change with it, and a re-calculation seals a NEW row rather
 * than re-pricing information a customer has already been shown.
 */

import type { RrCondition } from "@/lib/road-recovery/requirements";
import {
  applicableRateItems,
  bandsFor,
  RR_BYSTAND_FORBIDDEN_CHARGE_CODES,
  type RrChargeCode,
  type RrRateCard,
  type RrRateCardItem,
  type RrVatTreatment,
} from "@/lib/road-recovery/rate-cards";

export const RR_CHARGE_ENGINE_VERSION = "rr-charge-engine-1.0.0";

/** A frozen operational fact. Quantities only — never money. */
export type RrBillableFact = {
  factCode: string;
  quantity: number;
  unit: string;
  source: string;
  sourceRef: string | null;
  calculationVersion: string | null;
  status: string;
};

/**
 * When the work happened, for the after-hours and public-holiday modifiers.
 *
 * Decided OUTSIDE this engine by a pure helper (see dayContextFor), so the engine itself
 * never reads a clock or a calendar.
 */
export type RrDayContext = {
  afterHours: boolean;
  publicHoliday: boolean;
  holidayName: string | null;
};

export type RrChargeLine = {
  chargeCode: RrChargeCode;
  label: string;
  /** The rate-card item that produced this line, for audit. */
  ruleId: string;
  basis: string;
  unit: string;
  quantity: number;
  /** Quantity actually charged, after included allowance, banding and increment. */
  chargeableQuantity: number;
  rateAmount: number;
  subtotalExVat: number;
  /** True when the line was lifted to the rate card's minimum charge. */
  minimumApplied: boolean;
  vatTreatment: RrVatTreatment;
  vatRate: number;
  vatAmount: number;
  totalInclVat: number;
  /** Plain-language explanation a controller or counterparty can read. */
  reason: string;
  factCode: string | null;
  sourceRef: string | null;
};

export const RR_CHARGE_STATUSES = ["calculated", "incomplete", "not_chargeable"] as const;
export type RrChargeStatus = (typeof RR_CHARGE_STATUSES)[number];

export type RrChargeResult = {
  status: RrChargeStatus;
  lines: RrChargeLine[];
  subtotalExVat: number;
  vatAmount: number;
  totalInclVat: number;
  currency: string;
  vatRate: number;
  /** Charge codes the card declares but that had no fact to price. */
  missingFacts: string[];
  /** Facts present that the card has no rate for — a configuration gap, not a free service. */
  unratedFacts: string[];
  ratePolicyKey: string | null;
  rateVersion: number | null;
  engineVersion: string;
  rateEngineVersion: string;
  calculatedAt: string;
  dayContext: RrDayContext;
};

export type CalculateChargesInput = {
  facts: readonly RrBillableFact[];
  rateCard: RrRateCard;
  /** Job facts for declarative conditions (service code, vehicle class, casualty, …). */
  jobFacts: Record<string, unknown>;
  dayContext: RrDayContext;
  /** Stamped onto the result. Never read from a clock inside the engine. */
  calculatedAt: string;
  serviceCode: string;
};

const CENTS = 100;

/** Money is rounded to the cent once, at the point it becomes money. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * CENTS) / CENTS;
}

/** Quantities keep three decimals — kilometres and hours are not currency. */
function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Rounds a quantity UP to the next billing increment. 1.1 hours at 0.25 -> 1.25. */
function applyIncrement(quantity: number, increment: number): number {
  if (!Number.isFinite(increment) || increment <= 0) return quantity;
  return round3(Math.ceil(round3(quantity / increment) - 1e-9) * increment);
}

/**
 * The quantity that falls inside one band, after the band's own free allowance.
 *
 * Banding is cumulative, as every published tow tariff works: 0-50 km at one rate and
 * 50+ km at another means a 70 km tow bills 50 at the first and 20 at the second.
 */
function quantityInBand(quantity: number, item: RrRateCardItem): number {
  const from = item.bandFrom ?? 0;
  const to = item.bandTo ?? Number.POSITIVE_INFINITY;
  if (quantity <= from) return 0;
  const inBand = Math.min(quantity, to) - from;
  return Math.max(0, round3(inBand - item.includedQuantity));
}

function vatFor(subtotal: number, treatment: RrVatTreatment, vatRate: number): number {
  if (treatment !== "standard") return 0;
  return round2(subtotal * vatRate);
}

function describe(
  item: RrRateCardItem,
  chargeable: number,
  quantity: number,
  minimumApplied: boolean
): string {
  const parts: string[] = [];

  if (item.basis === "flat") {
    parts.push(`${item.label} charged at a flat ${item.rateAmount.toFixed(2)}.`);
  } else if (item.basis === "percentage") {
    parts.push(
      `${item.label} applied at ${(item.rateAmount * 100).toFixed(1)}% of ${item.appliesTo.join(", ")}.`
    );
  } else {
    parts.push(
      `${chargeable} ${item.unit} charged at ${item.rateAmount.toFixed(2)} per ${item.unit}.`
    );
  }

  if (item.includedQuantity > 0) {
    parts.push(`${item.includedQuantity} ${item.unit} included at no charge.`);
  }
  if (item.bandFrom !== null || item.bandTo !== null) {
    parts.push(
      `Band ${item.bandFrom ?? 0}–${item.bandTo === null ? "∞" : item.bandTo} ${item.unit}, of ${quantity} recorded.`
    );
  }
  if (item.increment !== 1 && item.basis !== "flat" && item.basis !== "percentage") {
    parts.push(`Billed in increments of ${item.increment} ${item.unit}.`);
  }
  if (minimumApplied) {
    parts.push(`Lifted to the minimum charge of ${(item.minimumCharge ?? 0).toFixed(2)}.`);
  }
  return parts.join(" ");
}

/** Which fact feeds which charge code. A code absent here is priced from a flat rule. */
const FACT_FOR_CHARGE: Partial<Record<RrChargeCode, string>> = {
  tow_distance: "tow_distance",
  travel_time: "travel_time",
  standing_time: "standing_time",
  paused_time: "paused_time",
  recovery_hours: "recovery_hours",
  storage_days: "storage_days",
  loading: "loading",
  unloading: "unloading",
  delivery: "delivery",
  equipment: "equipment",
  additional_service: "additional_service",
};

/**
 * Calculates the expected charge for a job.
 *
 * Fails LOUDLY rather than cheaply: a fact with no rate, or a rate with no fact, is
 * reported in `missingFacts` / `unratedFacts` and drives the status to `incomplete`.
 * A missing rate is a configuration gap that must block billing, never a free service.
 */
export function calculateCharges(input: CalculateChargesInput): RrChargeResult {
  const { rateCard, dayContext, serviceCode } = input;
  const vatRate = rateCard.vatRate;

  // The day context is a FACT the conditions can test, so a rate card can say
  // "this line only applies after hours" declaratively rather than in code.
  const conditionFacts: Record<string, unknown> = {
    ...input.jobFacts,
    service_code: serviceCode,
    after_hours: dayContext.afterHours,
    public_holiday: dayContext.publicHoliday,
  };

  const items = applicableRateItems(rateCard.items, conditionFacts);
  const factByCode = new Map(input.facts.map((fact) => [fact.factCode, fact]));

  const lines: RrChargeLine[] = [];
  const missingFacts: string[] = [];
  const pricedFactCodes = new Set<string>();

  // --- Pass 1: everything except percentage loadings -------------------------
  //
  // Loadings are applied to a subtotal, so they cannot be computed until the lines they
  // target exist.
  for (const item of items) {
    if (item.basis === "percentage") continue;

    const factCode = FACT_FOR_CHARGE[item.chargeCode] ?? null;

    if (item.basis === "flat") {
      // A flat charge is priced by its condition alone — a call-out fee, a cancellation.
      //
      // A rate of zero emits NO line. The shipped default cards deliberately carry zero
      // rates, and a R0.00 call-out on a billing pack reads as "this job costs nothing"
      // when the truth is "nobody has configured the rates". Emitting nothing drives the
      // result to `not_chargeable`, which billing readiness blocks on.
      const subtotal = round2(item.rateAmount);
      if (subtotal <= 0) continue;
      lines.push(buildLine(item, 1, 1, subtotal, false, vatRate, factCode, null, describe(item, 1, 1, false)));
      if (factCode) pricedFactCodes.add(factCode);
      continue;
    }

    if (!factCode) continue;

    const fact = factByCode.get(factCode);
    if (!fact) {
      // Declared but unmeasured.
      //
      // An OPTIONAL charge simply was not used — a tow that needed no specialised
      // equipment is complete, not incomplete. Only a charge the service always
      // produces counts as a gap, and only once: a banded code has several items and
      // would otherwise report the same gap repeatedly.
      if (!item.optional && !missingFacts.includes(factCode)) missingFacts.push(factCode);
      continue;
    }
    pricedFactCodes.add(factCode);

    const quantity = round3(fact.quantity);
    const bands = bandsFor(items, item.chargeCode);
    const banded = bands.length > 1 || item.bandFrom !== null || item.bandTo !== null;

    const raw = banded
      ? quantityInBand(quantity, item)
      : Math.max(0, round3(quantity - item.includedQuantity));

    const chargeable = applyIncrement(raw, item.increment);

    // A zero-quantity band contributes nothing and is not shown, UNLESS a minimum charge
    // makes it chargeable anyway (a 2 km tow that still bills the minimum).
    if (chargeable <= 0 && !item.minimumCharge) continue;

    const computed = round2(chargeable * item.rateAmount);
    const minimumApplied = item.minimumCharge !== null && computed < item.minimumCharge;
    const subtotal = minimumApplied ? round2(item.minimumCharge as number) : computed;

    if (subtotal <= 0) continue;

    lines.push(
      buildLine(
        item,
        quantity,
        chargeable,
        subtotal,
        minimumApplied,
        vatRate,
        factCode,
        fact.sourceRef,
        describe(item, chargeable, quantity, minimumApplied)
      )
    );
  }

  // --- Pass 2: percentage loadings -------------------------------------------
  for (const item of items) {
    if (item.basis !== "percentage") continue;

    const base = lines
      .filter((line) => item.appliesTo.includes(line.chargeCode))
      .reduce((total, line) => total + line.subtotalExVat, 0);

    if (base <= 0) continue;

    const subtotal = round2(base * item.rateAmount);
    if (subtotal <= 0) continue;

    lines.push(
      buildLine(item, 1, 1, subtotal, false, vatRate, null, null, describe(item, 1, 1, false))
    );
  }

  // A fact that exists but has no rate is a configuration gap. Paused time is excluded:
  // it is recorded for transparency and is normally not chargeable at all.
  const unratedFacts = input.facts
    .filter((fact) => fact.quantity > 0)
    .filter((fact) => !pricedFactCodes.has(fact.factCode))
    .filter((fact) => fact.factCode !== "paused_time")
    .map((fact) => fact.factCode);

  const subtotalExVat = round2(lines.reduce((total, line) => total + line.subtotalExVat, 0));
  const vatAmount = round2(lines.reduce((total, line) => total + line.vatAmount, 0));

  const status: RrChargeStatus =
    missingFacts.length > 0 || unratedFacts.length > 0
      ? "incomplete"
      : lines.length === 0
        ? "not_chargeable"
        : "calculated";

  return {
    status,
    lines,
    subtotalExVat,
    vatAmount,
    totalInclVat: round2(subtotalExVat + vatAmount),
    currency: rateCard.currency,
    vatRate,
    missingFacts,
    unratedFacts,
    ratePolicyKey: rateCard.policyKey,
    rateVersion: rateCard.version,
    engineVersion: RR_CHARGE_ENGINE_VERSION,
    rateEngineVersion: "rr-rate-cards-1.0.0",
    calculatedAt: input.calculatedAt,
    dayContext,
  };
}

function buildLine(
  item: RrRateCardItem,
  quantity: number,
  chargeableQuantity: number,
  subtotalExVat: number,
  minimumApplied: boolean,
  vatRate: number,
  factCode: string | null,
  sourceRef: string | null,
  reason: string
): RrChargeLine {
  const vatAmount = vatFor(subtotalExVat, item.vatTreatment, vatRate);
  return {
    chargeCode: item.chargeCode,
    label: item.label,
    ruleId: `${item.chargeCode}:${item.bandFrom ?? 0}-${item.bandTo ?? "∞"}`,
    basis: item.basis,
    unit: item.unit,
    quantity,
    chargeableQuantity,
    rateAmount: item.rateAmount,
    subtotalExVat,
    minimumApplied,
    vatTreatment: item.vatTreatment,
    vatRate: item.vatTreatment === "standard" ? vatRate : 0,
    vatAmount,
    totalInclVat: round2(subtotalExVat + vatAmount),
    reason,
    factCode,
    sourceRef,
  };
}

/**
 * Proves a calculated result carries no recovery charge.
 *
 * Used by the BYSTAND path as a last line of defence: the rate card cannot contain these
 * codes (validator + database CHECK), and the calculated result is checked again, because
 * "BYSTAND never bills for towing" is the invariant the whole vertical rests on.
 */
export function assertNoRecoveryCharges(result: RrChargeResult): void {
  for (const line of result.lines) {
    if ((RR_BYSTAND_FORBIDDEN_CHARGE_CODES as readonly string[]).includes(line.chargeCode)) {
      throw new Error(
        `A BYSTAND calculation produced a "${line.chargeCode}" charge. A bystand attendance moves nothing and stores nothing.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Day context
// ---------------------------------------------------------------------------

export type BusinessHours = {
  /** Minutes from midnight. 07:00 = 420. */
  startMinute: number;
  endMinute: number;
  /** 0 = Sunday. Days not listed are treated as outside business hours. */
  businessDays: readonly number[];
};

export const RR_DEFAULT_BUSINESS_HOURS: BusinessHours = {
  startMinute: 7 * 60,
  endMinute: 17 * 60,
  businessDays: [1, 2, 3, 4, 5],
};

/**
 * PURE. Decides whether an instant is after-hours and/or a public holiday.
 *
 * Holiday dates are passed in — read from the EXISTING public.leave_public_holidays
 * table, so Road & Recovery does not create a second holiday calendar.
 *
 * A public holiday is treated as outside business hours as well, which is how every
 * after-hours loading in this market is understood: a holiday call-out is not an
 * ordinary weekday call-out that happens to be on a holiday.
 */
export function dayContextFor(
  at: string,
  options: { holidayDates: readonly string[]; businessHours?: BusinessHours; holidayNames?: Record<string, string> }
): RrDayContext {
  const instant = new Date(at);
  const time = instant.getTime();
  if (!Number.isFinite(time)) {
    // Fails SAFE: an unreadable timestamp must not silently earn an after-hours loading.
    return { afterHours: false, publicHoliday: false, holidayName: null };
  }

  const isoDate = at.slice(0, 10);
  const publicHoliday = options.holidayDates.includes(isoDate);
  const hours = options.businessHours ?? RR_DEFAULT_BUSINESS_HOURS;

  const minuteOfDay = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  const weekday = instant.getUTCDay();

  const insideBusinessDay = hours.businessDays.includes(weekday);
  const insideBusinessHours =
    insideBusinessDay && minuteOfDay >= hours.startMinute && minuteOfDay < hours.endMinute;

  return {
    afterHours: publicHoliday || !insideBusinessHours,
    publicHoliday,
    holidayName: publicHoliday ? (options.holidayNames?.[isoDate] ?? null) : null,
  };
}

/** Re-exported so a rate-card condition and a charge condition share one grammar. */
export type { RrCondition };

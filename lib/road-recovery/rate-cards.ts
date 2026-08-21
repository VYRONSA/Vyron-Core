/**
 * VYRON CORE — Road & Recovery rate cards (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHERE IT STOPS
 * ---------------------------------------------------------------------------
 *
 * A rate card is OPERATIONAL COMMERCIAL CONFIGURATION: what a job should be charged, and
 * why. It is not an invoice, a price list in an accounting sense, or a tax table. VYRON
 * CORE determines the expected charge and stops there; VYRON FINANCE issues the invoice.
 *
 * ---------------------------------------------------------------------------
 * RATES ARE DATA
 * ---------------------------------------------------------------------------
 *
 * South African towing rates are NOT regulated — there is no national tariff, and the
 * AA, SATRA and Arrive Alive all say the same thing: agree the rate up front, in writing.
 * Every commercial term below (free kilometres, minimum charges, billing increments,
 * grace days, after-hours loadings) is therefore a negotiated per-counterparty term, and
 * lives here as DATA with effective dates. No insurer's rates are ever hardcoded, and no
 * shipped default is bound to a counterparty.
 *
 * ---------------------------------------------------------------------------
 * RESOLUTION AND VERSIONING
 * ---------------------------------------------------------------------------
 *
 * Deliberately the same shape as the Phase 3 requirement-policy engine, which is proven:
 *
 *   counterparty + service  >  counterparty  >  service  >  tenant default
 *
 * then highest version, then policy key for determinism. A job freezes the resolved card
 * into an immutable snapshot, so a completed job can never re-price because someone
 * published a new card afterwards.
 *
 * PURE. No clock read, no I/O. The evaluation instant is always passed in.
 */

import type { RrCondition } from "@/lib/road-recovery/requirements";
import { evaluateCondition } from "@/lib/road-recovery/requirements";

export const RR_RATE_ENGINE_VERSION = "rr-rate-cards-1.0.0";

/**
 * The charge vocabulary.
 *
 * Grounded in observed South African practice: a call-out fee, per-kilometre towing,
 * daily storage (commonly from the day AFTER the tow), standing time, recovery hours,
 * and the release/admin/security fees that are a frequent dispute source.
 */
export const RR_CHARGE_CODES = [
  "callout",
  "tow_distance",
  "travel_time",
  "standing_time",
  "paused_time",
  "recovery_hours",
  "loading",
  "unloading",
  "delivery",
  "storage_days",
  "custody_handling",
  "equipment",
  "additional_service",
  "cancellation",
  "no_show",
  "release_fee",
  "admin_fee",
  "security_fee",
  "after_hours_loading",
  "public_holiday_loading",
] as const;
export type RrChargeCode = (typeof RR_CHARGE_CODES)[number];

/** How a charge code is priced. */
export const RR_CHARGE_BASES = [
  "flat",
  "per_km",
  "per_hour",
  "per_day",
  "per_unit",
  /** A percentage loading applied to the subtotal of the lines it targets. */
  "percentage",
] as const;
export type RrChargeBasis = (typeof RR_CHARGE_BASES)[number];

/**
 * VAT treatment carried as rate-card DATA.
 *
 * CORE computes VAT-relevant amounts because accurate billing information requires them.
 * It is deliberately not a tax subsystem: one tenant rate, three treatments, no tax
 * periods, no returns, no ledger. The definitive treatment belongs to VYRON FINANCE.
 */
export const RR_VAT_TREATMENTS = ["standard", "zero_rated", "exempt"] as const;
export type RrVatTreatment = (typeof RR_VAT_TREATMENTS)[number];

/**
 * Charge codes a BYSTAND rate card may NEVER contain.
 *
 * A bystand attendance moves nothing and takes custody of nothing. Phase 0 already pins
 * the service type (`requires_destination/custody/storage = false`, billing basis
 * `per_hour_standing`) and Phase 0 forbids destination data on the job. This is the
 * commercial half of the same invariant, and sql/078 enforces it as a CHECK so it cannot
 * be bypassed by writing directly to the database.
 */
export const RR_BYSTAND_FORBIDDEN_CHARGE_CODES: readonly RrChargeCode[] = [
  "tow_distance",
  "loading",
  "unloading",
  "delivery",
  "storage_days",
  "custody_handling",
  "recovery_hours",
  "release_fee",
];

export const RR_BYSTAND_PERMITTED_CHARGE_CODES: readonly RrChargeCode[] = [
  "callout",
  "travel_time",
  "standing_time",
  "paused_time",
  "cancellation",
  "no_show",
  "admin_fee",
  "after_hours_loading",
  "public_holiday_loading",
  "equipment",
  "additional_service",
];

export type RrRateCardItem = {
  chargeCode: RrChargeCode;
  basis: RrChargeBasis;
  /** Display unit: "km", "hour", "day", "each", "%". */
  unit: string;
  rateAmount: number;
  /** Floor for this line. A 3 km tow still bills the minimum. */
  minimumCharge: number | null;
  /**
   * Quantity included before charging starts — free kilometres, an included first hour,
   * a storage grace day. Observed in the market: free tow to the nearest approved
   * repairer, call-out plus first hour included, storage from the day after the tow.
   */
  includedQuantity: number;
  /** Distance or time band this item applies to. Null = unbounded. */
  bandFrom: number | null;
  bandTo: number | null;
  /**
   * Billing granularity. 0.25 bills quarter-hours; 1 bills whole units. Standing time is
   * the usual consumer — "minimum hours" and increments are negotiated, never universal.
   */
  increment: number;
  vatTreatment: RrVatTreatment;
  /**
   * True when this charge is only sometimes used — specialised equipment, an extra
   * service. An optional charge with no recorded fact means "not used", never "missing",
   * so declaring a rate for it does not make every job of that service incomplete.
   */
  optional: boolean;
  /** Declarative, never executable. Same grammar as Phase 3 requirement conditions. */
  condition: RrCondition;
  /** For percentage loadings: which charge codes the loading applies to. */
  appliesTo: readonly RrChargeCode[];
  label: string;
  sortOrder: number;
};

export type RrRateCard = {
  policyKey: string;
  /** Null = applies to every counterparty (tenant default). */
  counterpartyId: string | null;
  /** Null = applies to every service type. */
  serviceCode: string | null;
  version: number;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  currency: string;
  /** The tenant VAT rate in force for this card, as a fraction (0.15 = 15%). */
  vatRate: number;
  items: readonly RrRateCardItem[];
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function withinEffectiveWindow(card: RrRateCard, at: string): boolean {
  const instant = new Date(at).getTime();
  if (!Number.isFinite(instant)) return false;
  if (card.effectiveFrom) {
    const from = new Date(card.effectiveFrom).getTime();
    if (Number.isFinite(from) && instant < from) return false;
  }
  if (card.effectiveTo) {
    const until = new Date(card.effectiveTo).getTime();
    if (Number.isFinite(until) && instant > until) return false;
  }
  return true;
}

/** counterparty + service (3) > counterparty (2) > service (1) > tenant default (0). */
function specificity(card: RrRateCard): number {
  return (card.counterpartyId ? 2 : 0) + (card.serviceCode ? 1 : 0);
}

export type RrRateResolution = {
  card: RrRateCard | null;
  /** Every card that applied, most specific first. Exposed so a conflict is visible. */
  considered: RrRateCard[];
  /**
   * True when two or more cards tie at the top on specificity AND version. That is a
   * configuration conflict a human must resolve, never something to guess at.
   */
  conflicted: boolean;
  reason: string;
};

/**
 * Resolves which rate card governs a job.
 *
 * A tie at the top is reported as a CONFLICT rather than silently broken by policy key:
 * two equally specific active cards mean the tenant has configured something ambiguous,
 * and quietly picking one would produce a defensible-looking price built on a guess.
 */
export function resolveRateCard(
  cards: readonly RrRateCard[],
  input: { counterpartyId: string | null; serviceCode: string; at: string }
): RrRateResolution {
  const candidates = cards
    .filter((card) => card.active)
    .filter((card) => withinEffectiveWindow(card, input.at))
    .filter((card) => card.counterpartyId === null || card.counterpartyId === input.counterpartyId)
    .filter((card) => card.serviceCode === null || card.serviceCode === input.serviceCode)
    .sort((a, b) => {
      const bySpecificity = specificity(b) - specificity(a);
      if (bySpecificity !== 0) return bySpecificity;
      if (b.version !== a.version) return b.version - a.version;
      return a.policyKey.localeCompare(b.policyKey);
    });

  if (candidates.length === 0) {
    return {
      card: null,
      considered: [],
      conflicted: false,
      reason: "No active rate card applies to this counterparty and service type.",
    };
  }

  const chosen = candidates[0];
  const tied = candidates.filter(
    (card) =>
      card.policyKey !== chosen.policyKey &&
      specificity(card) === specificity(chosen) &&
      card.version === chosen.version
  );

  if (tied.length > 0) {
    return {
      card: null,
      considered: candidates,
      conflicted: true,
      reason: `Two or more rate cards apply equally to this job (${[chosen, ...tied]
        .map((card) => card.policyKey)
        .join(", ")}). Resolve the conflict before this job can be priced.`,
    };
  }

  return {
    card: chosen,
    considered: candidates,
    conflicted: false,
    reason:
      chosen.counterpartyId && chosen.serviceCode
        ? `Counterparty rate card for ${chosen.serviceCode}`
        : chosen.counterpartyId
          ? "Counterparty rate card for all services"
          : chosen.serviceCode
            ? `Tenant rate card for ${chosen.serviceCode}`
            : "Tenant default rate card",
  };
}

/** The items that actually apply to a job, given its facts. */
export function applicableRateItems(
  items: readonly RrRateCardItem[],
  facts: Record<string, unknown>
): RrRateCardItem[] {
  return items
    .filter((item) => evaluateCondition(item.condition, facts))
    .slice()
    .sort((a, b) =>
      a.sortOrder === b.sortOrder ? a.chargeCode.localeCompare(b.chargeCode) : a.sortOrder - b.sortOrder
    );
}

/** Every band declared for one charge code, in ascending order. */
export function bandsFor(
  items: readonly RrRateCardItem[],
  chargeCode: RrChargeCode
): RrRateCardItem[] {
  return items
    .filter((item) => item.chargeCode === chargeCode)
    .slice()
    .sort((a, b) => (a.bandFrom ?? 0) - (b.bandFrom ?? 0));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRateCardItem(item: RrRateCardItem): void {
  if (!(RR_CHARGE_CODES as readonly string[]).includes(item.chargeCode)) {
    throw new Error(`"${item.chargeCode}" is not a recognised charge code.`);
  }
  if (!(RR_CHARGE_BASES as readonly string[]).includes(item.basis)) {
    throw new Error(`"${item.basis}" is not a recognised charge basis.`);
  }
  if (!(RR_VAT_TREATMENTS as readonly string[]).includes(item.vatTreatment)) {
    throw new Error(`"${item.vatTreatment}" is not a recognised VAT treatment.`);
  }
  if (!Number.isFinite(item.rateAmount) || item.rateAmount < 0) {
    throw new Error(`Rate for "${item.chargeCode}" must be zero or more.`);
  }
  if (item.minimumCharge !== null && item.minimumCharge < 0) {
    throw new Error(`Minimum charge for "${item.chargeCode}" cannot be negative.`);
  }
  if (item.includedQuantity < 0) {
    throw new Error(`Included quantity for "${item.chargeCode}" cannot be negative.`);
  }
  if (item.increment <= 0) {
    throw new Error(`Billing increment for "${item.chargeCode}" must be greater than zero.`);
  }
  if (item.bandFrom !== null && item.bandTo !== null && item.bandTo < item.bandFrom) {
    throw new Error(`Band for "${item.chargeCode}" ends before it begins.`);
  }
  if (item.basis === "percentage" && item.appliesTo.length === 0) {
    throw new Error(`Percentage loading "${item.chargeCode}" must say which charges it applies to.`);
  }
}

/**
 * Structural validation of a whole card, including the BYSTAND separation.
 *
 * The BYSTAND check is duplicated as a database CHECK in sql/078 on purpose: this one
 * gives an editor a useful message, that one makes the rule unbypassable.
 */
export function validateRateCard(card: RrRateCard): void {
  if (!/^[a-z0-9_]+$/.test(card.policyKey)) {
    throw new Error("A rate card key may contain only lowercase letters, digits and underscores.");
  }
  if (card.items.length === 0) {
    throw new Error(`Rate card "${card.policyKey}" contains no charges.`);
  }
  if (!Number.isFinite(card.vatRate) || card.vatRate < 0 || card.vatRate > 1) {
    throw new Error(`Rate card "${card.policyKey}" has an implausible VAT rate.`);
  }

  const seen = new Set<string>();
  for (const item of card.items) {
    // A charge code may repeat ONLY as distinct bands.
    const key = `${item.chargeCode}|${item.bandFrom ?? ""}|${item.bandTo ?? ""}`;
    if (seen.has(key)) {
      throw new Error(
        `Rate card "${card.policyKey}" declares "${item.chargeCode}" twice for the same band.`
      );
    }
    seen.add(key);
    validateRateCardItem(item);
  }

  if (card.effectiveFrom && card.effectiveTo) {
    if (new Date(card.effectiveTo).getTime() < new Date(card.effectiveFrom).getTime()) {
      throw new Error(`Rate card "${card.policyKey}" ends before it begins.`);
    }
  }

  if (card.serviceCode === "bystand") {
    assertBystandRateCardSeparation(card);
  }
}

/**
 * BYSTAND may bill for standing, not for moving.
 *
 * Throws on the first recovery charge found. A bystand attendance that needs a vehicle
 * moved produces a SEPARATE recovery job through the Phase 2 conversion architecture,
 * and that job carries its own rate card and its own commercial record.
 */
export function assertBystandRateCardSeparation(card: RrRateCard): void {
  for (const item of card.items) {
    if (RR_BYSTAND_FORBIDDEN_CHARGE_CODES.includes(item.chargeCode)) {
      throw new Error(
        `A BYSTAND rate card cannot charge "${item.chargeCode}": a bystand attendance moves nothing and stores nothing. Convert to a recovery job instead.`
      );
    }
  }
}

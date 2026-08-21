/**
 * VYRON CORE — Road & Recovery storage accrual calculator (Phase 4, Step 3).
 *
 * PURE. No clock read, no I/O, no randomness. The period is passed in, so the same
 * booking and the same instants always produce the same charge — which is the property
 * that lets a sealed accrual be re-derived and defended months later.
 *
 * This is deliberately the same shape as lib/road-recovery/standby-timer.ts (Phase 2):
 *
 *     pure calculator -> sealed append-only result -> billing reads the frozen fact
 *
 * ---------------------------------------------------------------------------
 * VERSIONING IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 *
 * RR_STORAGE_CALCULATOR_VERSION is written onto every sealed accrual. If this file's
 * arithmetic ever changes, the version MUST change with it, and a re-calculation seals a
 * NEW row rather than replacing the old one. An invoice that has already been issued must
 * remain reconcilable with the algorithm that produced it.
 */

export const RR_STORAGE_CALCULATOR_VERSION = "rr-storage-accrual-1.0.0";

export const RR_STORAGE_RATE_BASES = [
  "per_day",
  "per_calendar_day",
  "per_week",
  "per_month",
  "flat",
] as const;
export type RrStorageRateBasis = (typeof RR_STORAGE_RATE_BASES)[number];

export const RR_STORAGE_CONDITIONS = [
  "indoor",
  "outdoor",
  "covered",
  "secure_compound",
] as const;
export type RrStorageCondition = (typeof RR_STORAGE_CONDITIONS)[number];

export type StorageAccrualInput = {
  /** Server-stamped check-in. */
  checkedInAt: string;
  /** Check-out, or the instant this accrual is being taken at for an open booking. */
  periodEnd: string;
  rateBasis: RrStorageRateBasis;
  /** The rate for ONE unit of rateBasis. Null means the charge cannot be computed. */
  rateAmount: number | null;
  /** Contractual grace period before charging starts. */
  freeDays?: number;
};

export type StorageAccrualResult = {
  periodStart: string;
  periodEnd: string;
  /** Whole days the vehicle actually occupied a bay. */
  elapsedDays: number;
  freeDaysApplied: number;
  /** Days that attract a charge, after the grace period. */
  chargeableDays: number;
  /** Units of rateBasis charged. Days, weeks, months, or 1 for a flat fee. */
  billableUnits: number;
  rateBasis: RrStorageRateBasis;
  rateAmount: number | null;
  /** Null when no rate is configured — an unpriced booking is not a free one. */
  amount: number | null;
  calculatorVersion: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC midnight for an instant, so calendar-day counting ignores the time of day. */
function startOfUtcDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * How many days a stay of `ms` milliseconds occupies, under this basis.
 *
 *   per_day           any started 24-hour block is a day. A vehicle collected 25 hours
 *                     after arrival occupied two days of yard space, and every South
 *                     African tariff sheet charges it that way.
 *   per_calendar_day  counted by date boundaries, for contracts written that way.
 */
function elapsedDaysFor(
  basis: RrStorageRateBasis,
  startMs: number,
  endMs: number
): number {
  if (endMs <= startMs) return 0;

  if (basis === "per_calendar_day") {
    const days = Math.round((startOfUtcDay(endMs) - startOfUtcDay(startMs)) / MS_PER_DAY);
    // Arrival and departure on the same date is still one day of occupancy.
    return Math.max(1, days + 1);
  }

  return Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));
}

/** Units of the rate basis that `chargeableDays` amounts to. */
function billableUnitsFor(basis: RrStorageRateBasis, chargeableDays: number): number {
  if (chargeableDays <= 0) return 0;
  switch (basis) {
    case "per_week":
      return Math.ceil(chargeableDays / 7);
    case "per_month":
      // A commercial month, not a calendar one: yard tariffs quote 30-day months.
      return Math.ceil(chargeableDays / 30);
    case "flat":
      return 1;
    default:
      return chargeableDays;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes what a storage booking has accrued.
 *
 * Fails SAFE rather than closed: an unparseable period yields zero days and a null amount
 * rather than an invented charge. A billing engine reading zero raises a question; a
 * billing engine reading a guess invoices it.
 */
export function calculateStorageAccrual(input: StorageAccrualInput): StorageAccrualResult {
  const startMs = new Date(input.checkedInAt).getTime();
  const endMs = new Date(input.periodEnd).getTime();
  const freeDays = Math.max(0, Math.floor(input.freeDays ?? 0));

  const usable = Number.isFinite(startMs) && Number.isFinite(endMs);
  const elapsedDays = usable ? elapsedDaysFor(input.rateBasis, startMs, endMs) : 0;

  const freeDaysApplied = Math.min(freeDays, elapsedDays);
  const chargeableDays = Math.max(0, elapsedDays - freeDaysApplied);
  const billableUnits = billableUnitsFor(input.rateBasis, chargeableDays);

  const rateAmount =
    input.rateAmount === null || input.rateAmount === undefined || !Number.isFinite(input.rateAmount)
      ? null
      : Math.max(0, input.rateAmount);

  return {
    periodStart: input.checkedInAt,
    periodEnd: input.periodEnd,
    elapsedDays,
    freeDaysApplied,
    chargeableDays,
    billableUnits,
    rateBasis: input.rateBasis,
    rateAmount,
    amount: rateAmount === null ? null : round2(billableUnits * rateAmount),
    calculatorVersion: RR_STORAGE_CALCULATOR_VERSION,
  };
}

export function formatStorageDuration(days: number): string {
  if (days <= 0) return "less than a day";
  if (days === 1) return "1 day";
  return `${days} days`;
}

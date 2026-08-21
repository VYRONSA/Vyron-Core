/**
 * VYRON CORE — Storage intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * Historical storage duration is NEVER recomputed here. `rr_storage_accrual` is sealed:
 * the storage clock was settled once under a recorded calculator version, and a customer
 * has already been quoted against it. Re-deriving elapsed days from check-in and check-out
 * timestamps would produce a second, competing answer to a question that was closed — and
 * the two would diverge the moment a rounding rule or a free-day policy changed.
 *
 * OPEN occupancies are different: nothing has been sealed yet, so ageing is measured from
 * check-in against the as-of instant the CALLER supplies. That instant is passed in rather
 * than read from the clock, which is what lets the same report be replayed identically.
 */

/** A sealed storage accrual, from rr_storage_accrual. Never recalculated. */
export type RrStorageAccrualFact = {
  serviceJobId: string;
  bookingId: string;
  sealedReason: string;
  periodStart: string;
  periodEnd: string;
  chargeableDays: number;
  freeDaysApplied: number;
  elapsedDays: number;
  billableUnits: number;
  amount: number;
  currency: string;
  calculatorVersion: string;
  sealedAt: string;
};

/** An occupancy, from rr_storage_bookings. */
export type RrStorageBookingFact = {
  id: string;
  serviceJobId: string;
  yardId: string | null;
  yardName: string | null;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  freeDays: number | null;
  rateAmount: number | null;
  currency: string | null;
  vehicleRegistration: string | null;
};

/** Release or disposal authority, from rr_release_authorisations. */
export type RrReleaseAuthorityFact = {
  id: string;
  serviceJobId: string;
  authorityType: "release" | "disposal";
  status: string;
  issuedAt: string | null;
  validFrom: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
};

const MS_PER_DAY = 86_400_000;

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type RrStorageAgeingEntry = {
  bookingId: string;
  serviceJobId: string;
  yardName: string | null;
  vehicleRegistration: string | null;
  daysHeld: number;
  /** Whether release or disposal authority already exists and is usable. */
  authorityStatus: "released_authorised" | "disposal_authorised" | "no_authority" | "authority_not_verified";
};

export type RrStorageTotals = {
  openOccupancies: number;
  closedOccupancies: number;
  /** Open occupancies held longer than the ageing bracket. */
  over30Days: number;
  over60Days: number;
  over90Days: number;
  /** Ageing, worst first. Bounded by the caller. */
  ageing: RrStorageAgeingEntry[];
  /** null when nothing was sealed. Read from the SEAL, never recomputed. */
  averageElapsedDays: number | null;
  averageChargeableDays: number | null;
  totalFreeDaysApplied: number | null;
  totalSealedAmount: number | null;
  sealedCount: number;
  /** null when no vehicle left after an authority was issued. */
  averageReleaseDelayDays: number | null;
  /** Vehicles with usable authority that are still occupying a bay. */
  authorisedButNotCollected: number;
  /** Occupancies with no check-in instant, which cannot be aged at all. */
  unmeasurableOccupancies: number;
};

/**
 * Storage position, ageing and sealed accrual totals.
 *
 * `asOfIso` is the instant ageing is measured against and is REQUIRED. There is no default
 * of "now": a report generated today and the same report replayed next month must agree.
 */
export function storageTotals(
  bookings: readonly RrStorageBookingFact[],
  accruals: readonly RrStorageAccrualFact[],
  authorities: readonly RrReleaseAuthorityFact[],
  input: { asOfIso: string; ageingLimit: number }
): RrStorageTotals {
  const asOf = parse(input.asOfIso);

  const authorityByJob = new Map<string, RrReleaseAuthorityFact[]>();
  for (const authority of authorities) {
    const bucket = authorityByJob.get(authority.serviceJobId);
    if (bucket) bucket.push(authority);
    else authorityByJob.set(authority.serviceJobId, [authority]);
  }

  const ageing: RrStorageAgeingEntry[] = [];
  let openCount = 0;
  let closedCount = 0;
  let unmeasurable = 0;
  let authorisedButNotCollected = 0;

  for (const booking of bookings) {
    const checkedIn = parse(booking.checkedInAt);
    const checkedOut = parse(booking.checkedOutAt);

    if (checkedOut !== null) {
      closedCount += 1;
      continue;
    }
    openCount += 1;

    if (checkedIn === null || asOf === null) {
      unmeasurable += 1;
      continue;
    }

    const days = Math.max(0, (asOf - checkedIn) / MS_PER_DAY);
    const jobAuthorities = authorityByJob.get(booking.serviceJobId) ?? [];
    const usable = jobAuthorities.filter((authority) => {
      if (authority.status !== "active") return false;
      const expires = parse(authority.expiresAt);
      if (expires !== null && asOf !== null && expires <= asOf) return false;
      return true;
    });

    const verified = usable.filter((authority) => authority.verifiedAt !== null);
    let authorityStatus: RrStorageAgeingEntry["authorityStatus"];
    if (verified.some((authority) => authority.authorityType === "release")) {
      authorityStatus = "released_authorised";
      authorisedButNotCollected += 1;
    } else if (verified.some((authority) => authority.authorityType === "disposal")) {
      authorityStatus = "disposal_authorised";
      authorisedButNotCollected += 1;
    } else if (usable.length > 0) {
      authorityStatus = "authority_not_verified";
    } else {
      authorityStatus = "no_authority";
    }

    ageing.push({
      bookingId: booking.id,
      serviceJobId: booking.serviceJobId,
      yardName: booking.yardName,
      vehicleRegistration: booking.vehicleRegistration,
      daysHeld: Math.round(days * 100) / 100,
      authorityStatus,
    });
  }

  ageing.sort((a, b) => {
    if (b.daysHeld !== a.daysHeld) return b.daysHeld - a.daysHeld;
    return a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0;
  });

  // Release delay: authority issued, then the vehicle actually left. Measured only on
  // occupancies that closed, because an open one has not been released yet.
  const releaseDelays: number[] = [];
  for (const booking of bookings) {
    const checkedOut = parse(booking.checkedOutAt);
    if (checkedOut === null) continue;
    const jobAuthorities = (authorityByJob.get(booking.serviceJobId) ?? []).filter(
      (authority) => authority.authorityType === "release"
    );
    const issued = jobAuthorities
      .map((authority) => parse(authority.issuedAt))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)[0];
    if (issued === undefined || checkedOut < issued) continue;
    releaseDelays.push((checkedOut - issued) / MS_PER_DAY);
  }

  const elapsed = accruals.map((entry) => entry.elapsedDays).filter((value) => Number.isFinite(value));
  const chargeable = accruals
    .map((entry) => entry.chargeableDays)
    .filter((value) => Number.isFinite(value));

  return {
    openOccupancies: openCount,
    closedOccupancies: closedCount,
    over30Days: ageing.filter((entry) => entry.daysHeld > 30).length,
    over60Days: ageing.filter((entry) => entry.daysHeld > 60).length,
    over90Days: ageing.filter((entry) => entry.daysHeld > 90).length,
    ageing: ageing.slice(0, Math.max(0, input.ageingLimit)),
    averageElapsedDays: mean(elapsed),
    averageChargeableDays: mean(chargeable),
    totalFreeDaysApplied:
      accruals.length === 0
        ? null
        : accruals.reduce((sum, entry) => sum + (Number.isFinite(entry.freeDaysApplied) ? entry.freeDaysApplied : 0), 0),
    totalSealedAmount:
      accruals.length === 0
        ? null
        : accruals.reduce((sum, entry) => sum + (Number.isFinite(entry.amount) ? entry.amount : 0), 0),
    sealedCount: accruals.length,
    averageReleaseDelayDays: mean(releaseDelays),
    authorisedButNotCollected,
    unmeasurableOccupancies: unmeasurable,
  };
}

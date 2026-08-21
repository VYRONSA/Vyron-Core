/**
 * Phase 4 — the storage accrual calculator, as a pure function.
 *
 * Same standard as the Phase 2 standby timer: the period is passed in, so the charge is
 * reproducible from the stored booking and the instants it was taken between. A sealed
 * accrual that cannot be re-derived is not defensible in a billing dispute.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RR_STORAGE_CALCULATOR_VERSION,
  RR_STORAGE_RATE_BASES,
  calculateStorageAccrual,
  formatStorageDuration,
  type StorageAccrualInput,
} from "@/lib/road-recovery/storage-accrual";

const IN = "2026-06-01T08:00:00.000Z";

function accrual(overrides: Partial<StorageAccrualInput> = {}) {
  return calculateStorageAccrual({
    checkedInAt: IN,
    periodEnd: "2026-06-06T08:00:00.000Z",
    rateBasis: "per_day",
    rateAmount: 150,
    ...overrides,
  });
}

describe("Phase 4 — storage accrual arithmetic", () => {
  it("charges whole days for a whole-day stay", () => {
    const result = accrual();
    assert.equal(result.elapsedDays, 5);
    assert.equal(result.chargeableDays, 5);
    assert.equal(result.billableUnits, 5);
    assert.equal(result.amount, 750);
  });

  it("counts a started day as a day — a vehicle collected after 25 hours occupied two", () => {
    const result = accrual({ periodEnd: "2026-06-02T09:00:00.000Z" });
    assert.equal(result.elapsedDays, 2);
    assert.equal(result.amount, 300);
  });

  it("treats any occupancy as at least one day", () => {
    const result = accrual({ periodEnd: "2026-06-01T08:30:00.000Z" });
    assert.equal(result.elapsedDays, 1);
    assert.equal(result.amount, 150);
  });

  it("charges nothing when the vehicle never stayed", () => {
    const result = accrual({ periodEnd: IN });
    assert.equal(result.elapsedDays, 0);
    assert.equal(result.chargeableDays, 0);
    assert.equal(result.amount, 0);
  });

  it("counts calendar days by date boundary, not by elapsed hours", () => {
    // 08:00 on the 1st to 09:00 on the 2nd is two CALENDAR days but only 25 hours.
    const calendar = accrual({
      periodEnd: "2026-06-02T09:00:00.000Z",
      rateBasis: "per_calendar_day",
    });
    assert.equal(calendar.elapsedDays, 2);

    // Same date in and out is still one calendar day.
    const sameDay = accrual({
      periodEnd: "2026-06-01T23:00:00.000Z",
      rateBasis: "per_calendar_day",
    });
    assert.equal(sameDay.elapsedDays, 1);
  });

  it("bills weeks and months in started units", () => {
    const week = accrual({ periodEnd: "2026-06-10T08:00:00.000Z", rateBasis: "per_week", rateAmount: 700 });
    assert.equal(week.chargeableDays, 9);
    assert.equal(week.billableUnits, 2);
    assert.equal(week.amount, 1400);

    const month = accrual({ periodEnd: "2026-08-15T08:00:00.000Z", rateBasis: "per_month", rateAmount: 2000 });
    assert.equal(month.chargeableDays, 75);
    assert.equal(month.billableUnits, 3);
    assert.equal(month.amount, 6000);
  });

  it("charges a flat fee once, however long the stay", () => {
    const short = accrual({ periodEnd: "2026-06-02T08:00:00.000Z", rateBasis: "flat", rateAmount: 500 });
    const long = accrual({ periodEnd: "2026-09-02T08:00:00.000Z", rateBasis: "flat", rateAmount: 500 });
    assert.equal(short.billableUnits, 1);
    assert.equal(long.billableUnits, 1);
    assert.equal(short.amount, 500);
    assert.equal(long.amount, 500);
  });
});

describe("Phase 4 — the contractual grace period", () => {
  it("does not charge for free days", () => {
    const result = accrual({ freeDays: 2 });
    assert.equal(result.elapsedDays, 5);
    assert.equal(result.freeDaysApplied, 2);
    assert.equal(result.chargeableDays, 3);
    assert.equal(result.amount, 450);
  });

  it("never applies more free days than were actually used", () => {
    const result = accrual({ periodEnd: "2026-06-02T08:00:00.000Z", freeDays: 10 });
    assert.equal(result.elapsedDays, 1);
    assert.equal(result.freeDaysApplied, 1);
    assert.equal(result.chargeableDays, 0);
    assert.equal(result.amount, 0);
  });

  it("never produces a negative charge", () => {
    for (const freeDays of [0, 1, 5, 50]) {
      const result = accrual({ freeDays });
      assert.ok(result.chargeableDays >= 0);
      assert.ok((result.amount ?? 0) >= 0);
    }
  });
});

describe("Phase 4 — the calculator fails safe, never inventive", () => {
  it("returns a NULL amount when no rate is configured — unpriced is not free", () => {
    const result = accrual({ rateAmount: null });
    assert.equal(result.chargeableDays, 5);
    assert.equal(result.amount, null);
  });

  it("returns zero days rather than a guess for an unparseable period", () => {
    const result = accrual({ periodEnd: "not a timestamp" });
    assert.equal(result.elapsedDays, 0);
    assert.equal(result.chargeableDays, 0);
  });

  it("never charges for time before check-in", () => {
    const result = accrual({ periodEnd: "2026-05-01T08:00:00.000Z" });
    assert.equal(result.elapsedDays, 0);
    assert.equal(result.amount, 0);
  });

  it("treats a negative rate as zero rather than a credit", () => {
    const result = accrual({ rateAmount: -100 });
    assert.equal(result.rateAmount, 0);
    assert.equal(result.amount, 0);
  });

  it("never charges more days than elapsed — the database CHECK depends on it", () => {
    const cases = [
      accrual(),
      accrual({ freeDays: 3 }),
      accrual({ periodEnd: "2026-06-01T08:00:01.000Z" }),
      accrual({ periodEnd: "not a timestamp" }),
    ];
    for (const result of cases) {
      assert.ok(result.chargeableDays <= result.elapsedDays);
    }
  });
});

describe("Phase 4 — the calculator is deterministic and versioned", () => {
  it("reads no clock of its own", () => {
    const source = calculateStorageAccrual.toString();
    assert.equal(/Date\.now\(\)/.test(source), false);
    assert.equal(/new Date\(\s*\)/.test(source), false);
  });

  it("gives byte-identical results for identical inputs", () => {
    assert.deepEqual(accrual({ freeDays: 1 }), accrual({ freeDays: 1 }));
    assert.equal(JSON.stringify(accrual()), JSON.stringify(accrual()));
  });

  it("stamps the calculator version onto every result", () => {
    for (const rateBasis of RR_STORAGE_RATE_BASES) {
      assert.equal(accrual({ rateBasis }).calculatorVersion, RR_STORAGE_CALCULATOR_VERSION);
    }
  });

  it("carries the rate basis onto the result, so a sealed row explains itself", () => {
    for (const rateBasis of RR_STORAGE_RATE_BASES) {
      assert.equal(accrual({ rateBasis }).rateBasis, rateBasis);
    }
  });

  it("formats a duration for a human", () => {
    assert.equal(formatStorageDuration(0), "less than a day");
    assert.equal(formatStorageDuration(1), "1 day");
    assert.equal(formatStorageDuration(9), "9 days");
  });
});

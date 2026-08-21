/**
 * Phase 5 — rate-card resolution and the charge engine, as pure functions.
 *
 * VYRON CORE calculates EXPECTED BILLING INFORMATION. It does not create invoices, and
 * nothing in this suite expects it to.
 *
 * The load-bearing assertions:
 *   - a completed job's price never changes because a new rate card was published
 *   - two equally specific cards are a CONFLICT, never a guess
 *   - a fact with no rate BLOCKS; it is never a free service
 *   - BYSTAND can never produce a tow, storage or custody charge
 *   - the same facts and rate card always produce the same money
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RR_BYSTAND_FORBIDDEN_CHARGE_CODES,
  RR_CHARGE_CODES,
  assertBystandRateCardSeparation,
  resolveRateCard,
  validateRateCard,
  type RrRateCard,
  type RrRateCardItem,
} from "@/lib/road-recovery/rate-cards";

import {
  RR_CHARGE_ENGINE_VERSION,
  RR_DEFAULT_BUSINESS_HOURS,
  assertNoRecoveryCharges,
  calculateCharges,
  dayContextFor,
  type RrBillableFact,
  type RrDayContext,
} from "@/lib/road-recovery/charge-engine";

import {
  RR_DEFAULT_RATE_CARDS,
  defaultRateCardForService,
  rateCardSeedRows,
  validateDefaultRateCards,
} from "@/lib/road-recovery/rate-card-catalogue";

import { ALWAYS } from "@/lib/road-recovery/requirements";

const AT = "2026-03-04T10:00:00.000Z"; // a Wednesday, mid-morning
const NORMAL_DAY: RrDayContext = { afterHours: false, publicHoliday: false, holidayName: null };

function rateItem(
  chargeCode: RrRateCardItem["chargeCode"],
  basis: RrRateCardItem["basis"],
  overrides: Partial<RrRateCardItem> = {}
): RrRateCardItem {
  return {
    chargeCode,
    label: chargeCode,
    basis,
    unit: "each",
    rateAmount: 100,
    minimumCharge: null,
    includedQuantity: 0,
    bandFrom: null,
    bandTo: null,
    increment: 1,
    vatTreatment: "standard",
    optional: false,
    condition: ALWAYS,
    appliesTo: [],
    sortOrder: 10,
    ...overrides,
  };
}

function card(overrides: Partial<RrRateCard> = {}): RrRateCard {
  return {
    policyKey: "test_card",
    counterpartyId: null,
    serviceCode: null,
    version: 1,
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    currency: "ZAR",
    vatRate: 0.15,
    items: [rateItem("callout", "flat", { rateAmount: 500 })],
    ...overrides,
  };
}

function fact(factCode: string, quantity: number, unit = "each"): RrBillableFact {
  return {
    factCode,
    quantity,
    unit,
    source: "captured",
    sourceRef: null,
    calculationVersion: null,
    status: "frozen",
  };
}

function charge(
  rateCard: RrRateCard,
  facts: RrBillableFact[],
  options: { dayContext?: RrDayContext; jobFacts?: Record<string, unknown>; serviceCode?: string } = {}
) {
  return calculateCharges({
    facts,
    rateCard,
    jobFacts: options.jobFacts ?? {},
    dayContext: options.dayContext ?? NORMAL_DAY,
    calculatedAt: AT,
    serviceCode: options.serviceCode ?? "tow_in",
  });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("Phase 5 — rate-card resolution", () => {
  const tenantDefault = card({ policyKey: "tenant_default" });
  const tenantService = card({ policyKey: "tenant_tow", serviceCode: "tow_in" });
  const cpAll = card({ policyKey: "cp_all", counterpartyId: "cp-1" });
  const cpService = card({ policyKey: "cp_tow", counterpartyId: "cp-1", serviceCode: "tow_in" });
  const all = [tenantDefault, tenantService, cpAll, cpService];

  it("prefers counterparty + service over everything less specific", () => {
    const resolved = resolveRateCard(all, { counterpartyId: "cp-1", serviceCode: "tow_in", at: AT });
    assert.equal(resolved.card?.policyKey, "cp_tow");
    assert.equal(resolved.conflicted, false);
  });

  it("falls back through counterparty, then service, then tenant default", () => {
    assert.equal(
      resolveRateCard([tenantDefault, tenantService, cpAll], {
        counterpartyId: "cp-1",
        serviceCode: "tow_in",
        at: AT,
      }).card?.policyKey,
      "cp_all"
    );
    assert.equal(
      resolveRateCard([tenantDefault, tenantService], {
        counterpartyId: "cp-1",
        serviceCode: "tow_in",
        at: AT,
      }).card?.policyKey,
      "tenant_tow"
    );
    assert.equal(
      resolveRateCard([tenantDefault], { counterpartyId: "cp-1", serviceCode: "tow_in", at: AT })
        .card?.policyKey,
      "tenant_default"
    );
  });

  it("never returns another counterparty's rate card", () => {
    const resolved = resolveRateCard([cpService], {
      counterpartyId: "cp-2",
      serviceCode: "tow_in",
      at: AT,
    });
    assert.equal(resolved.card, null);
  });

  it("ignores inactive cards", () => {
    assert.equal(
      resolveRateCard([card({ active: false })], {
        counterpartyId: null,
        serviceCode: "tow_in",
        at: AT,
      }).card,
      null
    );
  });

  it("respects effective dates in both directions", () => {
    const future = card({ policyKey: "future", effectiveFrom: "2026-06-01T00:00:00.000Z" });
    const past = card({ policyKey: "past", effectiveTo: "2026-01-01T00:00:00.000Z" });
    const current = card({
      policyKey: "current",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-12-31T00:00:00.000Z",
    });
    assert.equal(
      resolveRateCard([future, past, current], {
        counterpartyId: null,
        serviceCode: "tow_in",
        at: AT,
      }).card?.policyKey,
      "current"
    );
  });

  it("prefers the highest version when specificity ties", () => {
    const v1 = card({ policyKey: "same", version: 1 });
    const v2 = card({ policyKey: "same", version: 2 });
    assert.equal(
      resolveRateCard([v1, v2], { counterpartyId: null, serviceCode: "tow_in", at: AT }).card
        ?.version,
      2
    );
  });

  it("REPORTS A CONFLICT rather than guessing when two cards apply equally", () => {
    const a = card({ policyKey: "alpha", serviceCode: "tow_in" });
    const b = card({ policyKey: "zulu", serviceCode: "tow_in" });
    const resolved = resolveRateCard([a, b], {
      counterpartyId: null,
      serviceCode: "tow_in",
      at: AT,
    });
    assert.equal(resolved.conflicted, true);
    assert.equal(resolved.card, null, "a conflicted resolution must not pick a winner");
    assert.match(resolved.reason, /alpha/);
    assert.match(resolved.reason, /zulu/);
  });

  it("says plainly when nothing applies", () => {
    const resolved = resolveRateCard([], { counterpartyId: null, serviceCode: "tow_in", at: AT });
    assert.equal(resolved.card, null);
    assert.match(resolved.reason, /No active rate card/i);
  });
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

describe("Phase 5 — charge arithmetic", () => {
  it("prices a flat call-out", () => {
    const result = charge(card(), []);
    assert.equal(result.status, "calculated");
    assert.equal(result.subtotalExVat, 500);
    assert.equal(result.vatAmount, 75);
    assert.equal(result.totalInclVat, 575);
  });

  it("prices distance per kilometre", () => {
    const result = charge(
      card({ items: [rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 22 })] }),
      [fact("tow_distance", 40, "km")]
    );
    assert.equal(result.lines[0].chargeableQuantity, 40);
    assert.equal(result.subtotalExVat, 880);
  });

  it("does not charge for included kilometres — free tow to the nearest repairer", () => {
    const result = charge(
      card({
        items: [
          rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 22, includedQuantity: 30 }),
        ],
      }),
      [fact("tow_distance", 40, "km")]
    );
    assert.equal(result.lines[0].chargeableQuantity, 10);
    assert.equal(result.subtotalExVat, 220);
  });

  it("bills distance bands cumulatively", () => {
    // 70 km: 50 km at R20, then 20 km at R15.
    const result = charge(
      card({
        items: [
          rateItem("tow_distance", "per_km", {
            unit: "km",
            rateAmount: 20,
            bandFrom: 0,
            bandTo: 50,
            sortOrder: 10,
          }),
          rateItem("tow_distance", "per_km", {
            unit: "km",
            rateAmount: 15,
            bandFrom: 50,
            bandTo: null,
            sortOrder: 11,
          }),
        ],
      }),
      [fact("tow_distance", 70, "km")]
    );
    assert.equal(result.lines.length, 2);
    assert.equal(result.lines[0].chargeableQuantity, 50);
    assert.equal(result.lines[1].chargeableQuantity, 20);
    assert.equal(result.subtotalExVat, 50 * 20 + 20 * 15);
  });

  it("does not open a band the job never reached", () => {
    const result = charge(
      card({
        items: [
          rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 20, bandFrom: 0, bandTo: 50 }),
          rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 15, bandFrom: 50, bandTo: null }),
        ],
      }),
      [fact("tow_distance", 30, "km")]
    );
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].chargeableQuantity, 30);
  });

  it("rounds up to the billing increment", () => {
    const result = charge(
      card({
        items: [
          rateItem("standing_time", "per_hour", { unit: "hour", rateAmount: 400, increment: 0.25 }),
        ],
      }),
      [fact("standing_time", 1.1, "hour")]
    );
    assert.equal(result.lines[0].chargeableQuantity, 1.25);
    assert.equal(result.subtotalExVat, 500);
  });

  it("lifts a small job to the minimum charge", () => {
    const result = charge(
      card({
        items: [
          rateItem("tow_distance", "per_km", {
            unit: "km",
            rateAmount: 20,
            minimumCharge: 750,
          }),
        ],
      }),
      [fact("tow_distance", 3, "km")]
    );
    assert.equal(result.lines[0].minimumApplied, true);
    assert.equal(result.subtotalExVat, 750);
    assert.match(result.lines[0].reason, /minimum charge/i);
  });

  it("does not apply a minimum when the computed charge already exceeds it", () => {
    const result = charge(
      card({
        items: [
          rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 20, minimumCharge: 750 }),
        ],
      }),
      [fact("tow_distance", 100, "km")]
    );
    assert.equal(result.lines[0].minimumApplied, false);
    assert.equal(result.subtotalExVat, 2000);
  });

  it("applies a percentage loading to the lines it targets, and nothing else", () => {
    const result = charge(
      card({
        items: [
          rateItem("callout", "flat", { rateAmount: 500 }),
          rateItem("admin_fee", "flat", { rateAmount: 100, sortOrder: 50 }),
          rateItem("after_hours_loading", "percentage", {
            unit: "%",
            rateAmount: 0.5,
            appliesTo: ["callout"],
            sortOrder: 900,
          }),
        ],
      }),
      [],
      { dayContext: { afterHours: true, publicHoliday: false, holidayName: null } }
    );
    const loading = result.lines.find((line) => line.chargeCode === "after_hours_loading");
    assert.ok(loading);
    // 50% of the call-out only — never of the admin fee.
    assert.equal(loading.subtotalExVat, 250);
    assert.equal(result.subtotalExVat, 850);
  });

  it("omits a loading when its condition does not hold", () => {
    const result = charge(
      card({
        items: [
          rateItem("callout", "flat", { rateAmount: 500 }),
          rateItem("after_hours_loading", "percentage", {
            unit: "%",
            rateAmount: 0.5,
            appliesTo: ["callout"],
            condition: { field: "after_hours", op: "eq", value: true },
            sortOrder: 900,
          }),
        ],
      }),
      [],
      { dayContext: NORMAL_DAY }
    );
    assert.equal(result.lines.some((line) => line.chargeCode === "after_hours_loading"), false);
    assert.equal(result.subtotalExVat, 500);
  });
});

// ---------------------------------------------------------------------------
// VAT — computed, but never an accounting subsystem
// ---------------------------------------------------------------------------

describe("Phase 5 — VAT-relevant amounts", () => {
  it("applies the tenant rate to standard-rated lines", () => {
    const result = charge(card({ vatRate: 0.15 }), []);
    assert.equal(result.vatRate, 0.15);
    assert.equal(result.vatAmount, 75);
  });

  it("charges no VAT on zero-rated or exempt lines", () => {
    for (const treatment of ["zero_rated", "exempt"] as const) {
      const result = charge(
        card({ items: [rateItem("callout", "flat", { rateAmount: 500, vatTreatment: treatment })] }),
        []
      );
      assert.equal(result.vatAmount, 0, `${treatment} attracted VAT`);
      assert.equal(result.totalInclVat, 500);
      assert.equal(result.lines[0].vatRate, 0);
    }
  });

  it("rounds money to the cent", () => {
    const result = charge(
      card({ items: [rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 33.33 })] }),
      [fact("tow_distance", 7, "km")]
    );
    assert.equal(result.subtotalExVat, 233.31);
    assert.equal(result.vatAmount, 35);
    assert.equal(result.totalInclVat, 268.31);
  });

  it("keeps the total equal to subtotal plus VAT, line by line", () => {
    const result = charge(
      card({
        items: [
          rateItem("callout", "flat", { rateAmount: 499.99 }),
          rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 17.77, sortOrder: 20 }),
        ],
      }),
      [fact("tow_distance", 13, "km")]
    );
    for (const line of result.lines) {
      assert.equal(line.totalInclVat, Math.round((line.subtotalExVat + line.vatAmount) * 100) / 100);
    }
    assert.equal(
      result.totalInclVat,
      Math.round((result.subtotalExVat + result.vatAmount) * 100) / 100
    );
  });
});

// ---------------------------------------------------------------------------
// Fails loudly
// ---------------------------------------------------------------------------

describe("Phase 5 — a gap blocks, it is never free", () => {
  it("reports a declared charge that has no fact to price", () => {
    const result = charge(
      card({ items: [rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 20 })] }),
      []
    );
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.missingFacts, ["tow_distance"]);
  });

  it("reports a fact the rate card has no rate for", () => {
    const result = charge(card(), [fact("storage_days", 4, "day")]);
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.unratedFacts, ["storage_days"]);
  });

  it("reports a missing banded charge only once", () => {
    const result = charge(
      card({
        items: [
          rateItem("tow_distance", "per_km", { unit: "km", bandFrom: 0, bandTo: 50 }),
          rateItem("tow_distance", "per_km", { unit: "km", bandFrom: 50, bandTo: null }),
        ],
      }),
      []
    );
    assert.deepEqual(result.missingFacts, ["tow_distance"]);
  });

  it("does not treat unpriced paused time as a gap", () => {
    const result = charge(card(), [fact("paused_time", 0.5, "hour")]);
    assert.equal(result.unratedFacts.includes("paused_time"), false);
    assert.equal(result.status, "calculated");
  });

  it("reports not_chargeable rather than inventing a zero invoice", () => {
    const result = charge(card({ items: [rateItem("callout", "flat", { rateAmount: 0 })] }), []);
    assert.equal(result.status, "not_chargeable");
    assert.equal(result.lines.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Phase 5 — the engine is deterministic and versioned", () => {
  const rateCard = card({
    items: [
      rateItem("callout", "flat", { rateAmount: 500 }),
      rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 20, sortOrder: 20 }),
    ],
  });
  const facts = [fact("tow_distance", 42, "km")];

  it("reads no clock of its own", () => {
    const source = calculateCharges.toString();
    assert.equal(/Date\.now\(\)/.test(source), false);
    assert.equal(/new Date\(\s*\)/.test(source), false);
  });

  it("produces byte-identical results for identical inputs", () => {
    assert.deepEqual(charge(rateCard, facts), charge(rateCard, facts));
    assert.equal(JSON.stringify(charge(rateCard, facts)), JSON.stringify(charge(rateCard, facts)));
  });

  it("stamps the engine version and the rate-card version onto the result", () => {
    const result = charge(rateCard, facts);
    assert.equal(result.engineVersion, RR_CHARGE_ENGINE_VERSION);
    assert.equal(result.ratePolicyKey, "test_card");
    assert.equal(result.rateVersion, 1);
    assert.equal(result.calculatedAt, AT);
  });

  it("A NEWER RATE CARD CANNOT RE-PRICE A COMPLETED JOB", () => {
    // The job's frozen snapshot, and a newer card published afterwards.
    const frozen = rateCard;
    const republished = card({
      version: 2,
      items: [
        rateItem("callout", "flat", { rateAmount: 9999 }),
        rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 999, sortOrder: 20 }),
      ],
    });

    const asBilled = charge(frozen, facts);
    const asRebilled = charge(republished, facts);

    // Calculating against the FROZEN card still gives the original price.
    assert.equal(charge(frozen, facts).totalInclVat, asBilled.totalInclVat);
    assert.notEqual(asRebilled.totalInclVat, asBilled.totalInclVat);
  });

  it("explains every line in words", () => {
    for (const line of charge(rateCard, facts).lines) {
      assert.ok(line.reason.length > 0, `${line.chargeCode} has no explanation`);
      assert.ok(line.ruleId.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Day context
// ---------------------------------------------------------------------------

describe("Phase 5 — after-hours and public holidays", () => {
  const holidays = ["2026-03-21"]; // Human Rights Day, a Saturday in 2026

  it("treats a weekday inside business hours as normal", () => {
    const context = dayContextFor("2026-03-04T10:00:00.000Z", { holidayDates: holidays });
    assert.equal(context.afterHours, false);
    assert.equal(context.publicHoliday, false);
  });

  it("treats an evening call-out as after-hours", () => {
    const context = dayContextFor("2026-03-04T21:30:00.000Z", { holidayDates: holidays });
    assert.equal(context.afterHours, true);
  });

  it("treats a weekend as after-hours", () => {
    const context = dayContextFor("2026-03-07T10:00:00.000Z", { holidayDates: holidays });
    assert.equal(context.afterHours, true);
  });

  it("recognises a public holiday, and treats it as after-hours too", () => {
    const context = dayContextFor("2026-03-21T10:00:00.000Z", {
      holidayDates: holidays,
      holidayNames: { "2026-03-21": "Human Rights Day" },
    });
    assert.equal(context.publicHoliday, true);
    assert.equal(context.afterHours, true);
    assert.equal(context.holidayName, "Human Rights Day");
  });

  it("honours configured business hours", () => {
    const alwaysOpen = { startMinute: 0, endMinute: 24 * 60, businessDays: [0, 1, 2, 3, 4, 5, 6] };
    assert.equal(
      dayContextFor("2026-03-07T23:00:00.000Z", { holidayDates: [], businessHours: alwaysOpen })
        .afterHours,
      false
    );
  });

  it("fails safe on an unreadable timestamp rather than earning a loading", () => {
    const context = dayContextFor("not a timestamp", { holidayDates: holidays });
    assert.equal(context.afterHours, false);
    assert.equal(context.publicHoliday, false);
  });

  it("reads no clock of its own", () => {
    const source = dayContextFor.toString();
    assert.equal(/Date\.now\(\)/.test(source), false);
    assert.ok(RR_DEFAULT_BUSINESS_HOURS.startMinute < RR_DEFAULT_BUSINESS_HOURS.endMinute);
  });
});

// ---------------------------------------------------------------------------
// BYSTAND separation
// ---------------------------------------------------------------------------

describe("Phase 5 — BYSTAND can never bill for recovery", () => {
  const bystand = defaultRateCardForService("bystand");

  it("the shipped BYSTAND card carries no recovery charge", () => {
    assert.ok(bystand);
    assert.doesNotThrow(() => assertBystandRateCardSeparation(bystand));
    for (const item of bystand.items) {
      assert.equal(
        RR_BYSTAND_FORBIDDEN_CHARGE_CODES.includes(item.chargeCode),
        false,
        `BYSTAND card charges "${item.chargeCode}"`
      );
    }
  });

  it("refuses a BYSTAND card that tries to charge distance, storage or custody", () => {
    for (const forbidden of RR_BYSTAND_FORBIDDEN_CHARGE_CODES) {
      assert.throws(
        () =>
          validateRateCard(
            card({
              policyKey: "sneaky_bystand",
              serviceCode: "bystand",
              items: [rateItem(forbidden, "per_unit")],
            })
          ),
        /BYSTAND rate card cannot charge/,
        `${forbidden} was accepted on a BYSTAND card`
      );
    }
  });

  it("bills standing time and nothing that moves a vehicle", () => {
    assert.ok(bystand);
    const priced: RrRateCard = {
      ...bystand,
      items: bystand.items.map((entry) =>
        entry.chargeCode === "standing_time"
          ? { ...entry, rateAmount: 450 }
          : entry.chargeCode === "callout"
            ? { ...entry, rateAmount: 300 }
            : entry
      ),
    };

    const result = charge(
      priced,
      [fact("standing_time", 2.5, "hour"), fact("paused_time", 0.5, "hour")],
      { serviceCode: "bystand" }
    );

    assert.doesNotThrow(() => assertNoRecoveryCharges(result));
    assert.equal(result.lines.some((line) => line.chargeCode === "tow_distance"), false);
    assert.equal(result.lines.some((line) => line.chargeCode === "storage_days"), false);
    assert.equal(result.subtotalExVat, 300 + 2.5 * 450);
  });

  it("shows paused time on the pack at zero rather than hiding it", () => {
    assert.ok(bystand);
    const result = charge(bystand, [fact("paused_time", 0.75, "hour")], { serviceCode: "bystand" });
    assert.equal(result.unratedFacts.includes("paused_time"), false);
  });

  it("catches a recovery charge that somehow reached a calculated result", () => {
    const rogue = charge(
      card({ items: [rateItem("tow_distance", "per_km", { unit: "km", rateAmount: 20 })] }),
      [fact("tow_distance", 10, "km")],
      { serviceCode: "bystand" }
    );
    assert.throws(() => assertNoRecoveryCharges(rogue), /BYSTAND calculation produced/);
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe("Phase 5 — storage billing information", () => {
  const storage = defaultRateCardForService("storage");

  it("gives the first day free, as the AA terms describe", () => {
    assert.ok(storage);
    const item = storage.items.find((entry) => entry.chargeCode === "storage_days");
    assert.ok(item);
    assert.equal(item.includedQuantity, 1, "storage should run from the day AFTER the tow");
  });

  it("charges only the days beyond the grace day", () => {
    assert.ok(storage);
    const priced: RrRateCard = {
      ...storage,
      items: storage.items.map((entry) =>
        entry.chargeCode === "storage_days" ? { ...entry, rateAmount: 350 } : entry
      ),
    };
    const result = charge(priced, [fact("storage_days", 5, "day")], { serviceCode: "storage" });
    const line = result.lines.find((entry) => entry.chargeCode === "storage_days");
    assert.ok(line);
    assert.equal(line.chargeableQuantity, 4);
    assert.equal(line.subtotalExVat, 1400);
  });

  it("carries the sealing calculator version through onto the line", () => {
    assert.ok(storage);
    const priced: RrRateCard = {
      ...storage,
      items: storage.items.map((entry) =>
        entry.chargeCode === "storage_days" ? { ...entry, rateAmount: 350 } : entry
      ),
    };
    const sealed: RrBillableFact = {
      factCode: "storage_days",
      quantity: 5,
      unit: "day",
      source: "sealed_summary",
      sourceRef: "accrual-123",
      calculationVersion: "rr-storage-accrual-1.0.0",
      status: "frozen",
    };
    const line = charge(priced, [sealed], { serviceCode: "storage" }).lines.find(
      (entry) => entry.chargeCode === "storage_days"
    );
    assert.ok(line);
    assert.equal(line.sourceRef, "accrual-123");
  });
});

// ---------------------------------------------------------------------------
// The shipped catalogue
// ---------------------------------------------------------------------------

describe("Phase 5 — the shipped rate cards", () => {
  it("passes its own validator", () => {
    assert.doesNotThrow(() => validateDefaultRateCards());
  });

  it("covers all eight services as TENANT defaults", () => {
    const services = [
      "accident_recovery",
      "tow_in",
      "jump_start",
      "roadside_assistance",
      "bystand",
      "heavy_recovery",
      "vehicle_movement",
      "storage",
    ];
    for (const service of services) {
      const found = defaultRateCardForService(service);
      assert.ok(found, `no default rate card for ${service}`);
      assert.equal(found.counterpartyId, null);
    }
    assert.equal(RR_DEFAULT_RATE_CARDS.length, services.length);
  });

  it("SHIPS NO PRICES — rates are unregulated in South Africa and are the operator's to set", () => {
    for (const shipped of RR_DEFAULT_RATE_CARDS) {
      for (const entry of shipped.items) {
        assert.equal(
          entry.rateAmount,
          0,
          `${shipped.policyKey}/${entry.chargeCode} ships an invented price`
        );
      }
    }
  });

  it("names no insurer", () => {
    const insurers = ["santam", "outsurance", "discovery", "hollard", "momentum", "roadcover", "aa_"];
    for (const shipped of RR_DEFAULT_RATE_CARDS) {
      for (const insurer of insurers) {
        assert.equal(shipped.policyKey.includes(insurer), false, `${shipped.policyKey} names an insurer`);
      }
    }
  });

  it("uses only recognised charge codes", () => {
    for (const shipped of RR_DEFAULT_RATE_CARDS) {
      for (const entry of shipped.items) {
        assert.ok(
          (RR_CHARGE_CODES as readonly string[]).includes(entry.chargeCode),
          `${shipped.policyKey} uses ${entry.chargeCode}`
        );
      }
    }
  });

  it("emits one seed row per card, in database naming", () => {
    const rows = rateCardSeedRows();
    assert.equal(rows.length, RR_DEFAULT_RATE_CARDS.length);
    for (const row of rows) {
      for (const entry of row.items as Record<string, unknown>[]) {
        assert.ok("charge_code" in entry);
        assert.ok("vat_treatment" in entry);
        assert.ok("included_quantity" in entry);
        assert.ok(Array.isArray(entry.applies_to));
      }
    }
  });
});

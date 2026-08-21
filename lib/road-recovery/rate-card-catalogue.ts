/**
 * VYRON CORE — default Road & Recovery rate cards (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * THESE ARE STRUCTURES, NOT PRICES
 * ---------------------------------------------------------------------------
 *
 * South African towing rates are NOT regulated. There is no national tariff, no published
 * association schedule, and no insurer rate card in the public domain. The Automobile
 * Association, SATRA and Arrive Alive all give the same advice to consumers: agree the
 * rate up front, in writing, including per-kilometre and storage.
 *
 * So what ships here is the SHAPE of a South African tow tariff with rates set to ZERO.
 * An operator must enter their own numbers before a job can be priced — and a zero rate
 * deliberately produces a "missing rate" billing exception rather than a free tow.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE STRUCTURE COMES FROM
 * ---------------------------------------------------------------------------
 *
 *   call-out + included first hour, hourly thereafter
 *       — OUTsurance Help@OUT and Hollard assist wording both cover "the call-out fee and
 *         the first hour of labour", with further labour for the customer's account.
 *
 *   free distance to the nearest approved repairer, per kilometre beyond
 *       — RoadCover charges per km only "to destinations other than the nearest repairer".
 *         Modelled as an included-kilometre allowance plus a distance band.
 *
 *   daily storage from the day AFTER the tow
 *       — AA Towing Terms & Conditions: storage is charged daily "from the day after the
 *         vehicle is towed ... until the vehicle is removed". Modelled as one included day.
 *
 *   release, admin and security fees
 *       — repeatedly reported as separate charges levied on collection, and a frequent
 *         source of consumer dispute. Present as codes so they are visible and auditable
 *         rather than buried in a tow total.
 *
 *   BYSTAND standing time
 *       — NOT published anywhere by any insurer, association or operator. It is a
 *         negotiated panel-agreement term. That is precisely why minimum attendance,
 *         billing increment and whether paused time bills are all configurable, and why
 *         the shipped default asserts nothing about them beyond a safe structure.
 *
 * Every card here is a TENANT DEFAULT: counterpartyId is always null, and no card is
 * named after an insurer. A counterparty-specific card outranks these and is authored by
 * the operator.
 */

import {
  assertBystandRateCardSeparation,
  validateRateCard,
  type RrChargeCode,
  type RrRateCard,
  type RrRateCardItem,
  type RrVatTreatment,
} from "@/lib/road-recovery/rate-cards";
import { ALWAYS, type RrCondition } from "@/lib/road-recovery/requirements";

/** The standard South African VAT rate. Tenant-editable; CORE never owns tax policy. */
export const RR_DEFAULT_VAT_RATE = 0.15;

type ItemOptions = {
  unit?: string;
  rateAmount?: number;
  minimumCharge?: number | null;
  includedQuantity?: number;
  bandFrom?: number | null;
  bandTo?: number | null;
  increment?: number;
  vatTreatment?: RrVatTreatment;
  condition?: RrCondition;
  appliesTo?: readonly RrChargeCode[];
  sortOrder?: number;
  optional?: boolean;
};

function item(
  chargeCode: RrChargeCode,
  label: string,
  basis: RrRateCardItem["basis"],
  options: ItemOptions = {}
): RrRateCardItem {
  return {
    chargeCode,
    label,
    basis,
    unit: options.unit ?? "each",
    // ZERO by design. An operator must set their own rates; see the header.
    rateAmount: options.rateAmount ?? 0,
    minimumCharge: options.minimumCharge ?? null,
    includedQuantity: options.includedQuantity ?? 0,
    bandFrom: options.bandFrom ?? null,
    bandTo: options.bandTo ?? null,
    increment: options.increment ?? 1,
    vatTreatment: options.vatTreatment ?? "standard",
    optional: options.optional === true,
    condition: options.condition ?? ALWAYS,
    appliesTo: options.appliesTo ?? [],
    sortOrder: options.sortOrder ?? 100,
  };
}

/** Loadings every service shares. Percentage of the work actually done. */
function loadings(appliesTo: readonly RrChargeCode[]): RrRateCardItem[] {
  return [
    item("after_hours_loading", "After-hours loading", "percentage", {
      unit: "%",
      appliesTo,
      condition: { field: "after_hours", op: "eq", value: true },
      sortOrder: 900,
    }),
    item("public_holiday_loading", "Public holiday loading", "percentage", {
      unit: "%",
      appliesTo,
      condition: { field: "public_holiday", op: "eq", value: true },
      sortOrder: 910,
    }),
  ];
}

const CANCELLATION: RrRateCardItem[] = [
  item("cancellation", "Cancellation charge", "flat", {
    condition: { field: "cancelled", op: "eq", value: true },
    sortOrder: 800,
  }),
  item("no_show", "No-show charge", "flat", {
    condition: { field: "no_show", op: "eq", value: true },
    sortOrder: 810,
  }),
];

/**
 * A tow-shaped card: call-out, banded distance with a free allowance, loading and
 * delivery, then the fees levied on collection.
 */
function towCard(policyKey: string, serviceCode: string): RrRateCard {
  const chargeable: RrChargeCode[] = ["callout", "tow_distance", "loading", "unloading", "delivery"];
  return {
    policyKey,
    counterpartyId: null,
    serviceCode,
    version: 1,
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    currency: "ZAR",
    vatRate: RR_DEFAULT_VAT_RATE,
    items: [
      item("callout", "Call-out fee", "flat", { sortOrder: 10 }),
      // Free distance to the nearest approved repairer, then per kilometre beyond.
      item("tow_distance", "Towing distance (included)", "per_km", {
        unit: "km",
        includedQuantity: 0,
        bandFrom: 0,
        bandTo: 50,
        increment: 1,
        sortOrder: 20,
      }),
      item("tow_distance", "Towing distance (long haul)", "per_km", {
        unit: "km",
        bandFrom: 50,
        bandTo: null,
        increment: 1,
        sortOrder: 21,
      }),
      item("loading", "Loading", "per_unit", { optional: true, sortOrder: 30 }),
      item("unloading", "Unloading", "per_unit", { optional: true, sortOrder: 40 }),
      item("delivery", "Delivery / handover", "per_unit", {
        optional: true,
        condition: { field: "has_destination", op: "eq", value: true },
        sortOrder: 50,
      }),
      item("equipment", "Specialised equipment", "per_unit", { optional: true, sortOrder: 60 }),
      item("additional_service", "Additional service", "per_unit", { optional: true, sortOrder: 70 }),
      item("admin_fee", "Administration fee", "flat", { sortOrder: 700 }),
      ...CANCELLATION,
      ...loadings(chargeable),
    ],
  };
}

/** Roadside: call-out plus an included first hour, hourly thereafter. */
function roadsideCard(policyKey: string, serviceCode: string): RrRateCard {
  const chargeable: RrChargeCode[] = ["callout", "travel_time"];
  return {
    policyKey,
    counterpartyId: null,
    serviceCode,
    version: 1,
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    currency: "ZAR",
    vatRate: RR_DEFAULT_VAT_RATE,
    items: [
      item("callout", "Call-out fee", "flat", { sortOrder: 10 }),
      // The included first hour that both OUTsurance and Hollard describe.
      item("travel_time", "Labour on scene", "per_hour", {
        unit: "hour",
        includedQuantity: 1,
        increment: 0.25,
        sortOrder: 20,
      }),
      item("equipment", "Specialised equipment", "per_unit", { optional: true, sortOrder: 60 }),
      item("additional_service", "Additional service", "per_unit", { optional: true, sortOrder: 70 }),
      ...CANCELLATION,
      ...loadings(chargeable),
    ],
  };
}

/**
 * BYSTAND: standing time and nothing that moves a vehicle.
 *
 * Deliberately narrow. assertBystandRateCardSeparation() is run over it below, and
 * sql/078 enforces the same rule as a CHECK constraint.
 */
const BYSTAND_CARD: RrRateCard = {
  policyKey: "default_rate_bystand",
  counterpartyId: null,
  serviceCode: "bystand",
  version: 1,
  active: true,
  effectiveFrom: null,
  effectiveTo: null,
  currency: "ZAR",
  vatRate: RR_DEFAULT_VAT_RATE,
  items: [
    item("callout", "Attendance call-out", "flat", { sortOrder: 10 }),
    // Minimum attendance and increment are the two terms every panel agreement
    // negotiates separately. Shipped as a safe structure with no opinion on the numbers.
    item("standing_time", "Standing time on scene", "per_hour", {
      unit: "hour",
      increment: 0.25,
      minimumCharge: null,
      sortOrder: 20,
    }),
    // Recorded at a zero rate so paused time is VISIBLE on the billing pack rather than
    // silently omitted. An operator whose agreement bills paused time sets a rate here.
    item("paused_time", "Paused time (not billed)", "per_hour", {
      unit: "hour",
      vatTreatment: "zero_rated",
      increment: 0.25,
      sortOrder: 30,
    }),
    ...CANCELLATION,
    ...loadings(["callout", "standing_time"]),
  ],
};

/** Storage: daily, from the day after the tow — hence one included day. */
const STORAGE_CARD: RrRateCard = {
  policyKey: "default_rate_storage",
  counterpartyId: null,
  serviceCode: "storage",
  version: 1,
  active: true,
  effectiveFrom: null,
  effectiveTo: null,
  currency: "ZAR",
  vatRate: RR_DEFAULT_VAT_RATE,
  items: [
    item("storage_days", "Storage", "per_day", {
      unit: "day",
      // AA Towing T&Cs: storage runs "from the day after the vehicle is towed".
      includedQuantity: 1,
      increment: 1,
      sortOrder: 10,
    }),
    item("release_fee", "Release fee", "flat", { optional: true, sortOrder: 20 }),
    item("security_fee", "Security fee", "per_day", { unit: "day", optional: true, sortOrder: 30 }),
    item("admin_fee", "Administration fee", "flat", { sortOrder: 40 }),
    ...loadings(["storage_days"]),
  ],
};

/** Heavy recovery: call-out plus recovery hours plus equipment. */
const HEAVY_CARD: RrRateCard = {
  policyKey: "default_rate_heavy_recovery",
  counterpartyId: null,
  serviceCode: "heavy_recovery",
  version: 1,
  active: true,
  effectiveFrom: null,
  effectiveTo: null,
  currency: "ZAR",
  vatRate: RR_DEFAULT_VAT_RATE,
  items: [
    item("callout", "Call-out fee", "flat", { sortOrder: 10 }),
    item("recovery_hours", "Recovery hours", "per_hour", {
      unit: "hour",
      increment: 0.5,
      sortOrder: 20,
    }),
    item("tow_distance", "Towing distance", "per_km", { unit: "km", increment: 1, sortOrder: 30 }),
    item("equipment", "Specialised equipment", "per_unit", { optional: true, sortOrder: 40 }),
    item("additional_service", "Additional service", "per_unit", { optional: true, sortOrder: 50 }),
    ...CANCELLATION,
    ...loadings(["callout", "recovery_hours", "tow_distance", "equipment"]),
  ],
};

/** Vehicle movement: per kilometre, no call-out. */
const MOVEMENT_CARD: RrRateCard = {
  policyKey: "default_rate_vehicle_movement",
  counterpartyId: null,
  serviceCode: "vehicle_movement",
  version: 1,
  active: true,
  effectiveFrom: null,
  effectiveTo: null,
  currency: "ZAR",
  vatRate: RR_DEFAULT_VAT_RATE,
  items: [
    item("tow_distance", "Movement distance", "per_km", { unit: "km", increment: 1, sortOrder: 10 }),
    item("delivery", "Delivery / handover", "per_unit", { optional: true, sortOrder: 20 }),
    item("additional_service", "Additional service", "per_unit", { optional: true, sortOrder: 30 }),
    ...CANCELLATION,
    ...loadings(["tow_distance", "delivery"]),
  ],
};

export const RR_DEFAULT_RATE_CARDS: readonly RrRateCard[] = [
  towCard("default_rate_accident_recovery", "accident_recovery"),
  towCard("default_rate_tow_in", "tow_in"),
  roadsideCard("default_rate_jump_start", "jump_start"),
  roadsideCard("default_rate_roadside_assistance", "roadside_assistance"),
  BYSTAND_CARD,
  HEAVY_CARD,
  MOVEMENT_CARD,
  STORAGE_CARD,
];

export function defaultRateCardForService(serviceCode: string): RrRateCard | null {
  return RR_DEFAULT_RATE_CARDS.find((card) => card.serviceCode === serviceCode) ?? null;
}

/** Every shipped card passes the same validator a hand-authored one does. */
export function validateDefaultRateCards(): void {
  for (const card of RR_DEFAULT_RATE_CARDS) {
    validateRateCard(card);
    if (card.counterpartyId !== null) {
      throw new Error(`Shipped rate card "${card.policyKey}" is bound to a counterparty.`);
    }
    if (card.items.every((entry) => entry.rateAmount === 0) === false) {
      // Not an error, but shipped defaults must not carry invented prices.
      throw new Error(`Shipped rate card "${card.policyKey}" carries a non-zero rate.`);
    }
  }
  assertBystandRateCardSeparation(BYSTAND_CARD);
}

/** Seed rows in the shape sql/078 writes. Used by the parity test. */
export type RrRateCardSeedRow = {
  policy_key: string;
  service_code: string | null;
  version: number;
  currency: string;
  vat_rate: number;
  items: unknown;
};

export function rateCardSeedRows(): RrRateCardSeedRow[] {
  return RR_DEFAULT_RATE_CARDS.map((card) => ({
    policy_key: card.policyKey,
    service_code: card.serviceCode,
    version: card.version,
    currency: card.currency,
    vat_rate: card.vatRate,
    items: card.items.map((entry) => ({
      charge_code: entry.chargeCode,
      label: entry.label,
      basis: entry.basis,
      unit: entry.unit,
      rate_amount: entry.rateAmount,
      minimum_charge: entry.minimumCharge,
      included_quantity: entry.includedQuantity,
      band_from: entry.bandFrom,
      band_to: entry.bandTo,
      increment: entry.increment,
      vat_treatment: entry.vatTreatment,
      optional: entry.optional,
      condition: entry.condition,
      applies_to: [...entry.appliesTo],
      sort_order: entry.sortOrder,
    })),
  }));
}

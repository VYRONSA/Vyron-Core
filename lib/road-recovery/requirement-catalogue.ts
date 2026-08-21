/**
 * VYRON CORE — default Road & Recovery requirement policies (Phase 3).
 *
 * PURE DATA. The single source of truth for the seeded tenant-default policies; sql/073
 * seeds exactly these, and tests/road-recovery-requirement-parity.test.ts fails if the
 * two ever diverge.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 * ---------------------------------------------------------------------------
 *
 * These are the RESEARCHED South African defaults, not invented ones. Sources:
 *
 *   Santam Motor Vehicle Accident Claim Form — SAPS accident report number; driver
 *     licence number/expiry/class; registration, VIN and ENGINE number; damage
 *     description and point of impact; towing service details; current vehicle location
 *     and storage contact; third party details; witness details; signed declaration.
 *   Europ Assistance SA product wording — services require ADVANCE AUTHORISATION; the
 *     provider must document authorisation confirmations, distance towed, repair
 *     attempts and outcomes, and storage duration. Services arranged without proper
 *     authorisation, and claims lacking supporting documentation, are EXCLUDED — i.e.
 *     the operator is not paid.
 *   National Road Traffic Act 93 of 1996 s61 — accidents involving injury or death are
 *     reported to SAPS within 24 hours; an AR number is issued.
 *   AA of South Africa, Know Your Towing Rights — photograph the vehicle with the tow
 *     truck before it leaves; record operator and tow vehicle identity.
 *
 * Every tenant may override all of it: these are DEFAULTS, seeded as a tenant-level
 * policy that a counterparty-specific policy outranks. Nothing here is hardcoded into
 * application logic.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EIGHT SERVICES DIFFER
 * ---------------------------------------------------------------------------
 *
 * A jump start takes no custody and has no destination; a BYSTAND attendance moves
 * nothing at all. Applying one flat checklist would demand delivery evidence from
 * services that deliver nothing. BYSTAND in particular requires arrival, periodic
 * presence, an observation report and a stand-down record — and is deliberately given
 * NO loading, destination, delivery or custody requirement.
 */

import {
  ALWAYS,
  type RrCondition,
  type RrRequirementDefinition,
  type RrRequirementPolicy,
  validatePolicy,
} from "@/lib/road-recovery/requirements";

/** Job facts referenced by conditional requirements. Resolved from the job row. */
export const RR_JOB_FACT_KEYS = [
  "service_code",
  "counterparty_present",
  "third_party_involved",
  "casualty_flag",
  "police_involved",
  "has_destination",
  "resolved_on_scene",
  "converted_to_recovery",
  "went_to_storage",
] as const;

const whenTrue = (field: string): RrCondition => ({ field, op: "eq", value: true });

function req(
  requirementCode: string,
  label: string,
  evidenceKind: RrRequirementDefinition["evidenceKind"],
  options: Partial<Omit<RrRequirementDefinition, "requirementCode" | "label" | "evidenceKind">> = {}
): RrRequirementDefinition {
  return {
    requirementCode,
    label,
    evidenceKind,
    mandatory: options.mandatory ?? true,
    condition: options.condition ?? ALWAYS,
    minCount: options.minCount ?? 1,
    // A mandatory requirement blocks invoicing by default: the commercial reality found
    // in the research is that undocumented work is simply not paid.
    blockingScopes: options.blockingScopes ?? (options.mandatory === false ? [] : ["invoice"]),
    guidance: options.guidance,
    sortOrder: options.sortOrder ?? 100,
  };
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** Everything a counterparty-funded job needs before it can be billed. */
const COMMERCIAL_CORE: RrRequirementDefinition[] = [
  req("authorisation_record", "Authorisation to proceed", "authorisation", {
    sortOrder: 10,
    condition: whenTrue("counterparty_present"),
    guidance:
      "Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.",
  }),
  req("claim_reference", "Claim or policy reference", "reference", {
    sortOrder: 20,
    condition: whenTrue("counterparty_present"),
    guidance: "The reference the counterparty will use to match this job to their claim.",
  }),
];

/** Identity of the casualty vehicle, as a motor claim form demands it. */
const VEHICLE_IDENTITY: RrRequirementDefinition[] = [
  req("registration_photo", "Photograph of the registration plate", "photo", {
    sortOrder: 30,
    guidance: "A legible plate photograph ties every other item of evidence to this vehicle.",
  }),
  req("vin_photo", "Photograph of the VIN", "photo", {
    sortOrder: 40,
    guidance: "Insurers require the VIN on the claim form; a photograph prevents transcription disputes.",
  }),
  req("engine_number", "Engine number recorded", "field", {
    sortOrder: 50,
    guidance: "Required on the motor claim form alongside the VIN.",
  }),
];

const GPS_ARRIVAL = req("gps_arrival", "GPS-verified arrival on scene", "gps", {
  sortOrder: 60,
  guidance: "Recorded automatically when the driver reports arrival within the scene radius.",
});

const SCENE_PHOTOS = req("scene_photos", "Scene photographs", "photo", {
  sortOrder: 70,
  minCount: 2,
  guidance: "Wide shots showing the vehicle in its surroundings before anything is moved.",
});

const PRE_SERVICE_CONDITION = req(
  "pre_service_condition",
  "Pre-service condition photographs",
  "photo",
  {
    sortOrder: 80,
    minCount: 4,
    guidance:
      "Four corners before the vehicle is touched. This is the operator's primary defence against a later claim of pre-existing damage.",
  }
);

const DAMAGE_RECORD = req("damage_description", "Damage description and point of impact", "field", {
  sortOrder: 90,
  guidance: "Structured description matching the claim form's damage and point-of-impact fields.",
});

const LOADING_SECURED = req("loading_secured", "Vehicle loaded and secured", "photo", {
  sortOrder: 100,
  guidance: "Shows the casualty vehicle correctly secured before transit.",
});

const DELIVERY_PROOF = req("delivery_proof", "Delivery at destination", "photo", {
  sortOrder: 110,
  condition: whenTrue("has_destination"),
  guidance: "The vehicle at the destination, showing where it was left.",
});

const HANDOVER_RECORD = req("handover_record", "Handover to receiving party", "handover", {
  sortOrder: 120,
  condition: whenTrue("has_destination"),
  guidance:
    "Who received the vehicle, when and where. Phase 4 extends this into a full chain of custody.",
});

const CUSTOMER_ACK = req("customer_acknowledgement", "Customer acknowledgement", "signature", {
  sortOrder: 130,
  guidance:
    "Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.",
});

const SAPS_AR = req("saps_ar_number", "SAPS accident report (AR) number", "reference", {
  sortOrder: 25,
  condition: {
    any: [whenTrue("police_involved"), whenTrue("casualty_flag")],
  },
  guidance:
    "The National Road Traffic Act requires accidents involving injury or death to be reported to SAPS within 24 hours. Insurers ask for the AR number on third-party claims.",
});

const THIRD_PARTY = req("third_party_details", "Third party details", "field", {
  sortOrder: 140,
  condition: whenTrue("third_party_involved"),
  guidance: "Driver, vehicle and insurer of the other party, as the claim form requires.",
});

const WITNESS = req("witness_details", "Witness details", "field", {
  sortOrder: 150,
  mandatory: false,
  guidance: "Optional but valuable: witness names and contacts strengthen a disputed claim.",
});

const CUSTOMER_LICENCE = req("customer_licence", "Customer driving licence", "document", {
  sortOrder: 160,
  condition: whenTrue("counterparty_present"),
  guidance: "Licence number, expiry and class — required on the motor claim form.",
});

// ---------------------------------------------------------------------------
// Per-service requirement sets
// ---------------------------------------------------------------------------

const ACCIDENT_RECOVERY: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  SAPS_AR,
  ...VEHICLE_IDENTITY,
  GPS_ARRIVAL,
  SCENE_PHOTOS,
  PRE_SERVICE_CONDITION,
  DAMAGE_RECORD,
  LOADING_SECURED,
  DELIVERY_PROOF,
  HANDOVER_RECORD,
  CUSTOMER_ACK,
  THIRD_PARTY,
  WITNESS,
  CUSTOMER_LICENCE,
];

const TOW_IN: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  ...VEHICLE_IDENTITY,
  GPS_ARRIVAL,
  PRE_SERVICE_CONDITION,
  DAMAGE_RECORD,
  LOADING_SECURED,
  DELIVERY_PROOF,
  HANDOVER_RECORD,
  CUSTOMER_ACK,
  CUSTOMER_LICENCE,
  req("tow_distance", "Distance towed", "field", {
    sortOrder: 115,
    guidance: "Origin to destination distance — assistance providers rate and cap on it.",
  }),
];

/** Roadside services take no custody and deliver nothing. */
const ROADSIDE_SET: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  req("registration_photo", "Photograph of the registration plate", "photo", { sortOrder: 30 }),
  GPS_ARRIVAL,
  req("diagnosis_outcome", "Diagnosis and outcome", "field", {
    sortOrder: 90,
    guidance:
      "What was wrong, what was done, and whether it was resolved on scene. Assistance providers require the repair attempt and outcome.",
  }),
  req("service_photo", "Photograph of the service performed", "photo", {
    sortOrder: 100,
    mandatory: false,
  }),
  CUSTOMER_ACK,
];

/**
 * BYSTAND — deliberately DISJOINT from towing.
 *
 * No loading, no destination, no delivery, no custody, no handover. Its evidence is
 * about being present: arrival, periodic presence while standing by, what was observed,
 * and how the attendance ended.
 */
const BYSTAND: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  req("bystand_reason", "Reason for attendance", "field", {
    sortOrder: 25,
    guidance: "The configured attendance reason, plus detail where the reason requires it.",
  }),
  GPS_ARRIVAL,
  req("bystand_scene_photo", "Scene photograph on arrival", "photo", {
    sortOrder: 70,
    guidance: "Establishes what the crew found on arrival.",
  }),
  req("bystand_periodic_presence", "Periodic presence records", "gps", {
    sortOrder: 75,
    minCount: 2,
    guidance:
      "Periodic presence captured while standing by. Captured while the driver app is open — VYRON does not claim unattended background tracking.",
  }),
  req("bystand_observation_report", "Observation report", "document", {
    sortOrder: 90,
    guidance: "What happened on scene, who attended, and how the attendance ended.",
  }),
  req("bystand_stand_down_record", "Stand-down record", "field", {
    sortOrder: 120,
    guidance: "Who released the crew, when and by what channel.",
  }),
  req("bystand_conversion_reason", "Conversion reason", "field", {
    sortOrder: 125,
    condition: whenTrue("converted_to_recovery"),
    guidance:
      "Why a separate recovery job was raised. The attendance still bills its own standing time.",
  }),
];

const HEAVY_RECOVERY: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  SAPS_AR,
  ...VEHICLE_IDENTITY,
  GPS_ARRIVAL,
  SCENE_PHOTOS,
  PRE_SERVICE_CONDITION,
  DAMAGE_RECORD,
  req("recovery_plan", "Recovery plan and approval", "document", {
    sortOrder: 85,
    guidance: "The agreed recovery method and its authorised cost ceiling, before rigging begins.",
  }),
  req("rigging_photos", "Rigging and recovery photographs", "photo", {
    sortOrder: 95,
    minCount: 2,
  }),
  req("scene_cleared", "Scene cleared", "photo", {
    sortOrder: 105,
    guidance: "Evidence the carriageway was left clear.",
  }),
  LOADING_SECURED,
  DELIVERY_PROOF,
  HANDOVER_RECORD,
  CUSTOMER_ACK,
  THIRD_PARTY,
];

const VEHICLE_MOVEMENT: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  ...VEHICLE_IDENTITY,
  GPS_ARRIVAL,
  req("pre_move_condition", "Pre-move condition photographs", "photo", {
    sortOrder: 80,
    minCount: 4,
    guidance: "Four corners before collection.",
  }),
  req("post_move_condition", "Post-move condition photographs", "photo", {
    sortOrder: 108,
    minCount: 4,
    guidance: "Four corners after delivery. The delta is the dispute record.",
  }),
  DELIVERY_PROOF,
  HANDOVER_RECORD,
  CUSTOMER_ACK,
];

const STORAGE: RrRequirementDefinition[] = [
  ...COMMERCIAL_CORE,
  ...VEHICLE_IDENTITY,
  req("storage_checkin_photo", "Condition at check-in", "photo", {
    sortOrder: 80,
    minCount: 4,
    guidance: "Condition on arrival at the yard, before storage begins.",
  }),
  req("storage_location", "Storage location recorded", "field", {
    sortOrder: 110,
    guidance:
      "The motor claim form asks where the vehicle is now, and for the storage facility's contact details.",
  }),
  req("keys_documents_record", "Keys and documents recorded", "field", {
    sortOrder: 115,
    guidance:
      "The industry salvage code requires keys and documents to be held under restricted, auditable access. Phase 4 extends this into full custody control.",
  }),
  req("release_authorisation", "Release authorisation", "authorisation", {
    sortOrder: 200,
    blockingScopes: ["release"],
    guidance: "Who authorised release of the vehicle. Blocks release, not invoicing.",
  }),
];

// ---------------------------------------------------------------------------
// The seeded tenant-default policies
// ---------------------------------------------------------------------------

const BY_SERVICE: Record<string, RrRequirementDefinition[]> = {
  accident_recovery: ACCIDENT_RECOVERY,
  tow_in: TOW_IN,
  jump_start: ROADSIDE_SET,
  roadside_assistance: ROADSIDE_SET,
  bystand: BYSTAND,
  heavy_recovery: HEAVY_RECOVERY,
  vehicle_movement: VEHICLE_MOVEMENT,
  storage: STORAGE,
};

/** One tenant-default policy per service code. Counterparty policies outrank these. */
export const RR_DEFAULT_REQUIREMENT_POLICIES: readonly RrRequirementPolicy[] = Object.entries(
  BY_SERVICE
).map(([serviceCode, requirements]) => ({
  policyKey: `default_${serviceCode}`,
  counterpartyId: null,
  serviceCode,
  version: 1,
  active: true,
  effectiveFrom: null,
  effectiveTo: null,
  requirements,
}));

export function defaultPolicyForService(serviceCode: string): RrRequirementPolicy | null {
  return (
    RR_DEFAULT_REQUIREMENT_POLICIES.find((policy) => policy.serviceCode === serviceCode) ?? null
  );
}

/** Structural checks over every seeded policy. */
export function validateDefaultPolicies(): void {
  for (const policy of RR_DEFAULT_REQUIREMENT_POLICIES) {
    validatePolicy(policy);
  }
}

/**
 * BYSTAND must never acquire towing evidence requirements.
 *
 * The catalogue half of the separation that Phase 0 enforces in the state machine and
 * Phase 2 enforces in the schema.
 */
export function assertBystandRequirementSeparation(): void {
  const bystand = defaultPolicyForService("bystand");
  if (!bystand) throw new Error("BYSTAND has no default requirement policy.");

  const codes = new Set(bystand.requirements.map((entry) => entry.requirementCode));
  const towOnly = [
    "loading_secured",
    "delivery_proof",
    "handover_record",
    "pre_service_condition",
    "tow_distance",
    "storage_location",
    "keys_documents_record",
    "release_authorisation",
    "post_move_condition",
    "recovery_plan",
  ];
  for (const forbidden of towOnly) {
    if (codes.has(forbidden)) {
      throw new Error(`BYSTAND invariant: bystand must not require "${forbidden}".`);
    }
  }

  for (const kind of ["handover"] as const) {
    const offender = bystand.requirements.find((entry) => entry.evidenceKind === kind);
    if (offender) {
      throw new Error(
        `BYSTAND invariant: bystand must not require ${kind} evidence ("${offender.requirementCode}").`
      );
    }
  }

  for (const required of [
    "bystand_periodic_presence",
    "bystand_observation_report",
    "bystand_stand_down_record",
    "gps_arrival",
  ]) {
    if (!codes.has(required)) {
      throw new Error(`BYSTAND invariant: bystand must require "${required}".`);
    }
  }
}

/** Seed rows in the shape sql/073 writes. Used by the parity test. */
export type RrPolicySeedRow = {
  policy_key: string;
  service_code: string | null;
  version: number;
  requirements: unknown;
};

export function policySeedRows(): RrPolicySeedRow[] {
  return RR_DEFAULT_REQUIREMENT_POLICIES.map((policy) => ({
    policy_key: policy.policyKey,
    service_code: policy.serviceCode,
    version: policy.version,
    requirements: policy.requirements.map((entry) => ({
      requirement_code: entry.requirementCode,
      label: entry.label,
      evidence_kind: entry.evidenceKind,
      mandatory: entry.mandatory,
      condition: entry.condition,
      min_count: entry.minCount,
      blocking_scopes: [...entry.blockingScopes],
      guidance: entry.guidance ?? null,
      sort_order: entry.sortOrder,
    })),
  }));
}

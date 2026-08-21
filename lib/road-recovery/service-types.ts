/**
 * VYRON CORE — Road & Recovery service taxonomy (Phase 0).
 *
 * WHY THIS FILE EXISTS
 *
 * Road & Recovery is not one service with variants. Accident recovery, a tow-in, a jump
 * start and a BYSTAND attendance are different products: they are dispatched
 * differently, timed differently, evidenced differently, billed differently and
 * measured differently. Modelling them as one "job type" column with branching code is
 * what produces an unmaintainable dispatch engine.
 *
 * So the taxonomy is data:
 *
 *   service type  --declares-->  workflow key  --selects-->  state machine
 *                 --declares-->  billing basis
 *                 --declares-->  operational requirements (destination/custody/storage)
 *                 --declares-->  KPI set
 *
 * This module is the single source of truth for that catalogue. sql/070 seeds the same
 * values into public.rr_service_types / public.rr_workflow_definitions, and
 * tests/road-recovery-seed-parity.test.ts fails if the two ever diverge.
 *
 * BYSTAND
 *
 * BYSTAND is a peer service type, never a tow subtype. There is deliberately no
 * `tow_subtype` column, enum member or config key anywhere in this vertical. The
 * separation is structural and enforced in three independent places:
 *
 *   1. here             - its own service code AND its own workflow key, asserted by
 *                         assertBystandIndependence()
 *   2. state-machine.ts - its own state set; it shares no state graph with towing
 *   3. sql/070          - CHECK constraints that make a bystand row carrying tow
 *                         destination/custody data unrepresentable
 *
 * Pure module: no I/O, no Supabase, no environment access. Safe to unit test directly.
 */

/** Workflow keys. BYSTAND holds one entirely to itself. */
export const RR_WORKFLOW_KEYS = [
  "tow_recovery",
  "heavy_recovery",
  "roadside_assist",
  "bystand",
  "vehicle_movement",
  "storage",
] as const;

export type RrWorkflowKey = (typeof RR_WORKFLOW_KEYS)[number];

/** The eight Phase 0 service codes. */
export const RR_SERVICE_CODES = [
  "accident_recovery",
  "tow_in",
  "jump_start",
  "roadside_assistance",
  "bystand",
  "heavy_recovery",
  "vehicle_movement",
  "storage",
] as const;

export type RrServiceCode = (typeof RR_SERVICE_CODES)[number];

/**
 * How the service is charged. This is the *basis*, not a rate - rate cards are Phase 6.
 * BYSTAND's basis is standing time, which is why it cannot borrow tow billing.
 */
export const RR_BILLING_BASES = [
  "callout_plus_distance",
  "callout_plus_recovery_hours",
  "callout_only",
  "per_hour_standing",
  "per_km",
  "per_day_storage",
] as const;

export type RrBillingBasis = (typeof RR_BILLING_BASES)[number];

/**
 * KPI set keys. Each service type reports against its own set; nothing is averaged
 * across sets. BYSTAND has its own so its standing hours never dilute tow KPIs.
 */
export const RR_KPI_SET_KEYS = [
  "recovery",
  "heavy_recovery",
  "roadside",
  "bystand",
  "movement",
  "storage",
] as const;

export type RrKpiSetKey = (typeof RR_KPI_SET_KEYS)[number];

export type RrServiceTypeDefinition = {
  serviceCode: RrServiceCode;
  name: string;
  description: string;
  workflowKey: RrWorkflowKey;
  billingBasis: RrBillingBasis;
  kpiSetKey: RrKpiSetKey;
  /** Requires a counterparty authorisation before dispatch (Phase 1 wires the record). */
  requiresAuthorisation: boolean;
  /** Carries a delivery destination. False for BYSTAND and roadside assistance. */
  requiresDestination: boolean;
  /** Takes legal custody of a vehicle. False for BYSTAND and roadside assistance. */
  requiresCustody: boolean;
  /** May route into the storage sub-workflow. */
  requiresStorage: boolean;
  /** May spawn a separate linked recovery job (BYSTAND conversion, roadside escalation). */
  canSpawnRecoveryJob: boolean;
  /** Billable clock accrues while standing by rather than while moving. */
  billsStandingTime: boolean;
  sortOrder: number;
};

/**
 * The canonical catalogue.
 *
 * accident_recovery and tow_in share `tow_recovery` because their operational state
 * graph genuinely is the same; they differ in authorisation, evidence and rating, all of
 * which are per-service-type and per-counterparty concerns, not workflow concerns.
 */
export const RR_SERVICE_CATALOGUE: readonly RrServiceTypeDefinition[] = [
  {
    serviceCode: "accident_recovery",
    name: "Accident Recovery",
    description:
      "Recovery of an accident-damaged vehicle from a scene, including insurer evidence and chain of custody.",
    workflowKey: "tow_recovery",
    billingBasis: "callout_plus_distance",
    kpiSetKey: "recovery",
    requiresAuthorisation: true,
    requiresDestination: true,
    requiresCustody: true,
    requiresStorage: true,
    canSpawnRecoveryJob: false,
    billsStandingTime: false,
    sortOrder: 10,
  },
  {
    serviceCode: "tow_in",
    name: "Tow-In",
    description:
      "Planned or breakdown tow of a vehicle to a nominated destination such as a dealership or repairer.",
    workflowKey: "tow_recovery",
    billingBasis: "callout_plus_distance",
    kpiSetKey: "recovery",
    requiresAuthorisation: true,
    requiresDestination: true,
    requiresCustody: true,
    requiresStorage: true,
    canSpawnRecoveryJob: false,
    billsStandingTime: false,
    sortOrder: 20,
  },
  {
    serviceCode: "jump_start",
    name: "Jump Start",
    description:
      "Roadside battery assistance resolved on scene. No custody is taken and no destination applies.",
    workflowKey: "roadside_assist",
    billingBasis: "callout_only",
    kpiSetKey: "roadside",
    requiresAuthorisation: false,
    requiresDestination: false,
    requiresCustody: false,
    requiresStorage: false,
    canSpawnRecoveryJob: true,
    billsStandingTime: false,
    sortOrder: 30,
  },
  {
    serviceCode: "roadside_assistance",
    name: "Roadside Assistance",
    description:
      "General roadside attendance (tyre, fuel, lockout, minor mechanical) resolved on scene where possible.",
    workflowKey: "roadside_assist",
    billingBasis: "callout_only",
    kpiSetKey: "roadside",
    requiresAuthorisation: false,
    requiresDestination: false,
    requiresCustody: false,
    requiresStorage: false,
    canSpawnRecoveryJob: true,
    billsStandingTime: false,
    sortOrder: 40,
  },
  {
    /**
     * BYSTAND - a distinct service, not a tow.
     *
     * The operator attends and remains on scene under instruction (scene safety, traffic
     * management, awaiting authority release). The billable unit is time spent standing
     * by. It takes no custody, has no destination, and never enters storage. If a
     * recovery is subsequently required, a SEPARATE linked recovery job is created and
     * the bystand job bills and closes on its own terms.
     */
    serviceCode: "bystand",
    name: "BYSTAND",
    description:
      "Attend and remain on scene under instruction. Billed on standing time. Takes no custody and has no destination. Any recovery that follows is a separate linked job.",
    workflowKey: "bystand",
    billingBasis: "per_hour_standing",
    kpiSetKey: "bystand",
    requiresAuthorisation: true,
    requiresDestination: false,
    requiresCustody: false,
    requiresStorage: false,
    canSpawnRecoveryJob: true,
    billsStandingTime: true,
    sortOrder: 50,
  },
  {
    serviceCode: "heavy_recovery",
    name: "Heavy Recovery",
    description:
      "Commercial vehicle and specialised recovery requiring a recovery plan, rigging and scene clearance.",
    workflowKey: "heavy_recovery",
    billingBasis: "callout_plus_recovery_hours",
    kpiSetKey: "heavy_recovery",
    requiresAuthorisation: true,
    requiresDestination: true,
    requiresCustody: true,
    requiresStorage: true,
    canSpawnRecoveryJob: false,
    billsStandingTime: false,
    sortOrder: 60,
  },
  {
    serviceCode: "vehicle_movement",
    name: "Vehicle Movement",
    description:
      "Non-incident movement of a vehicle between sites, with pre-move and post-move condition inspections.",
    workflowKey: "vehicle_movement",
    billingBasis: "per_km",
    kpiSetKey: "movement",
    requiresAuthorisation: false,
    requiresDestination: true,
    requiresCustody: true,
    requiresStorage: false,
    canSpawnRecoveryJob: false,
    billsStandingTime: false,
    sortOrder: 70,
  },
  {
    serviceCode: "storage",
    name: "Storage",
    description:
      "Custodial storage of a vehicle in a yard, accruing daily and released only on authorisation.",
    workflowKey: "storage",
    billingBasis: "per_day_storage",
    kpiSetKey: "storage",
    requiresAuthorisation: true,
    requiresDestination: false,
    requiresCustody: true,
    requiresStorage: true,
    canSpawnRecoveryJob: false,
    billsStandingTime: false,
    sortOrder: 80,
  },
];

const BY_CODE = new Map<RrServiceCode, RrServiceTypeDefinition>(
  RR_SERVICE_CATALOGUE.map((entry) => [entry.serviceCode, entry])
);

/**
 * Where a job may be delivered.
 *
 * Lives here, with the rest of the pure vocabulary, because both the server guard in
 * createServiceJob() and the controller intake form need it, and the form cannot import
 * job-service.ts — that module reaches for node:crypto and Supabase. job-service.ts
 * re-exports this so existing importers are unaffected.
 */
export const RR_DESTINATION_TYPES: readonly string[] = [
  "repairer",
  "dealership",
  "storage_yard",
  "residential",
  "auction",
  "salvage",
  "police_pound",
  "other",
];

export function isRrServiceCode(value: unknown): value is RrServiceCode {
  return RR_SERVICE_CODES.includes(String(value ?? "") as RrServiceCode);
}

export function isRrWorkflowKey(value: unknown): value is RrWorkflowKey {
  return RR_WORKFLOW_KEYS.includes(String(value ?? "") as RrWorkflowKey);
}

export function findServiceType(code: unknown): RrServiceTypeDefinition | null {
  if (!isRrServiceCode(code)) return null;
  return BY_CODE.get(code) ?? null;
}

/** Throws for an unknown code. Use where a missing service type is a programming error. */
export function requireServiceType(code: unknown): RrServiceTypeDefinition {
  const found = findServiceType(code);
  if (!found) {
    throw new Error(`Unknown Road & Recovery service code: ${JSON.stringify(code)}`);
  }
  return found;
}

export function serviceTypesForWorkflow(workflowKey: RrWorkflowKey): RrServiceTypeDefinition[] {
  return RR_SERVICE_CATALOGUE.filter((entry) => entry.workflowKey === workflowKey);
}

export function serviceTypeLabel(code: unknown): string {
  return findServiceType(code)?.name ?? String(code ?? "");
}

/**
 * The invariant that keeps BYSTAND a service in its own right.
 *
 * Called by the test suite and by the seed-parity check. It is cheap and deterministic.
 * Throws with a specific message per violation so a regression names itself.
 */
export function assertBystandIndependence(
  catalogue: readonly RrServiceTypeDefinition[] = RR_SERVICE_CATALOGUE
): void {
  const bystand = catalogue.find((entry) => entry.serviceCode === "bystand");
  if (!bystand) {
    throw new Error("BYSTAND invariant: bystand is missing from the service catalogue.");
  }

  if (bystand.workflowKey !== "bystand") {
    throw new Error(
      `BYSTAND invariant: bystand must own workflow key "bystand", found "${bystand.workflowKey}".`
    );
  }

  const squatters = catalogue.filter(
    (entry) => entry.workflowKey === "bystand" && entry.serviceCode !== "bystand"
  );
  if (squatters.length > 0) {
    throw new Error(
      `BYSTAND invariant: the bystand workflow is exclusive, but ${squatters
        .map((entry) => entry.serviceCode)
        .join(", ")} also claims it.`
    );
  }

  if (bystand.requiresDestination) {
    throw new Error("BYSTAND invariant: bystand must not require a destination.");
  }
  if (bystand.requiresCustody) {
    throw new Error("BYSTAND invariant: bystand must not take custody of a vehicle.");
  }
  if (bystand.requiresStorage) {
    throw new Error("BYSTAND invariant: bystand must not enter storage.");
  }
  if (bystand.billingBasis !== "per_hour_standing") {
    throw new Error(
      `BYSTAND invariant: bystand bills standing time, found basis "${bystand.billingBasis}".`
    );
  }
  if (!bystand.billsStandingTime) {
    throw new Error("BYSTAND invariant: bystand must bill standing time.");
  }
  if (!bystand.canSpawnRecoveryJob) {
    throw new Error(
      "BYSTAND invariant: bystand must be able to spawn a separate linked recovery job."
    );
  }
  if (bystand.kpiSetKey !== "bystand") {
    throw new Error(
      `BYSTAND invariant: bystand needs its own KPI set, found "${bystand.kpiSetKey}".`
    );
  }

  const kpiSharers = catalogue.filter(
    (entry) => entry.kpiSetKey === "bystand" && entry.serviceCode !== "bystand"
  );
  if (kpiSharers.length > 0) {
    throw new Error(
      `BYSTAND invariant: the bystand KPI set is exclusive, but ${kpiSharers
        .map((entry) => entry.serviceCode)
        .join(", ")} also reports into it.`
    );
  }
}

/** Guards against a `tow_subtype`-style construct reappearing in the catalogue. */
export function assertNoTowSubtypeConcept(
  catalogue: readonly RrServiceTypeDefinition[] = RR_SERVICE_CATALOGUE
): void {
  const forbidden = /tow[_\s-]?subtype|subtype[_\s-]?of[_\s-]?tow/i;
  for (const entry of catalogue) {
    for (const [key, value] of Object.entries(entry)) {
      if (forbidden.test(key)) {
        throw new Error(
          `Tow-subtype invariant: service "${entry.serviceCode}" declares a forbidden field "${key}".`
        );
      }
      if (typeof value === "string" && forbidden.test(value)) {
        throw new Error(
          `Tow-subtype invariant: service "${entry.serviceCode}" field "${key}" references a tow subtype.`
        );
      }
    }
  }
}

/** Structural checks over the whole catalogue. Cheap, deterministic, no I/O. */
export function validateServiceCatalogue(
  catalogue: readonly RrServiceTypeDefinition[] = RR_SERVICE_CATALOGUE
): void {
  const seenCodes = new Set<string>();
  for (const entry of catalogue) {
    if (seenCodes.has(entry.serviceCode)) {
      throw new Error(`Duplicate service code in catalogue: ${entry.serviceCode}`);
    }
    seenCodes.add(entry.serviceCode);

    if (!isRrWorkflowKey(entry.workflowKey)) {
      throw new Error(
        `Service "${entry.serviceCode}" references unknown workflow key "${entry.workflowKey}".`
      );
    }
    if (!RR_BILLING_BASES.includes(entry.billingBasis)) {
      throw new Error(
        `Service "${entry.serviceCode}" references unknown billing basis "${entry.billingBasis}".`
      );
    }
    if (!RR_KPI_SET_KEYS.includes(entry.kpiSetKey)) {
      throw new Error(
        `Service "${entry.serviceCode}" references unknown KPI set "${entry.kpiSetKey}".`
      );
    }
    // Custody without a destination is only coherent for storage, which is custodial by
    // nature and has no onward delivery leg.
    if (entry.requiresCustody && !entry.requiresDestination && entry.serviceCode !== "storage") {
      throw new Error(`Service "${entry.serviceCode}" takes custody but declares no destination.`);
    }
    if (entry.requiresStorage && !entry.requiresCustody) {
      throw new Error(`Service "${entry.serviceCode}" may enter storage but does not take custody.`);
    }
    if (entry.billsStandingTime !== (entry.billingBasis === "per_hour_standing")) {
      throw new Error(
        `Service "${entry.serviceCode}" has an inconsistent standing-time billing declaration.`
      );
    }
  }

  for (const code of RR_SERVICE_CODES) {
    if (!seenCodes.has(code)) {
      throw new Error(`Service catalogue is missing required code: ${code}`);
    }
  }

  assertNoTowSubtypeConcept(catalogue);
  assertBystandIndependence(catalogue);
}

// ---------------------------------------------------------------------------
// Seed serialisation
// ---------------------------------------------------------------------------

export type RrServiceTypeSeedRow = {
  service_code: string;
  name: string;
  description: string;
  workflow_key: string;
  billing_basis: string;
  kpi_set_key: string;
  requires_authorisation: boolean;
  requires_destination: boolean;
  requires_custody: boolean;
  requires_storage: boolean;
  can_spawn_recovery_job: boolean;
  bills_standing_time: boolean;
  sort_order: number;
};

/**
 * The catalogue in the exact column shape sql/070 seeds into public.rr_service_types.
 *
 * This exists so the migration and this module cannot drift: the migration's VALUES list
 * was generated from this function, and tests/road-recovery-seed-parity.test.ts parses
 * the migration back and compares it against this output on every run. Key order is
 * fixed and every field is always emitted, so the comparison is stable.
 */
export function serviceTypeSeedRows(
  catalogue: readonly RrServiceTypeDefinition[] = RR_SERVICE_CATALOGUE
): RrServiceTypeSeedRow[] {
  return catalogue.map((entry) => ({
    service_code: entry.serviceCode,
    name: entry.name,
    description: entry.description,
    workflow_key: entry.workflowKey,
    billing_basis: entry.billingBasis,
    kpi_set_key: entry.kpiSetKey,
    requires_authorisation: entry.requiresAuthorisation,
    requires_destination: entry.requiresDestination,
    requires_custody: entry.requiresCustody,
    requires_storage: entry.requiresStorage,
    can_spawn_recovery_job: entry.canSpawnRecoveryJob,
    bills_standing_time: entry.billsStandingTime,
    sort_order: entry.sortOrder,
  }));
}

/**
 * VYRON CORE — Road & Recovery deterministic dispatch engine (Phase 1).
 *
 * PURE MODULE. No Supabase, no fetch, no environment, no clock reads. Every input is
 * supplied by the caller (lib/road-recovery/dispatch-data.ts does the I/O), which is
 * what makes the eligibility decision reproducible, auditable and unit-testable.
 *
 * ---------------------------------------------------------------------------
 * THE ENGINE IS THE AUTHORITY ON ELIGIBILITY
 * ---------------------------------------------------------------------------
 *
 * Eligibility is decided by HARD GATES. A candidate that fails a gate is ineligible —
 * it is never "scored down" until it loses, because a low score can still win a thin
 * candidate pool and would silently dispatch an uncertified driver or an incapable
 * truck. Scoring only ever ORDERS candidates that already passed every gate.
 *
 * AI must not override this. A later advisory layer may re-rank or annotate eligible
 * candidates; it may never make an ineligible candidate eligible.
 *
 * ---------------------------------------------------------------------------
 * EXPLAINABILITY
 * ---------------------------------------------------------------------------
 *
 * Every candidate carries its full reasoning whether it won, lost, or was excluded:
 * eligibility result, every failure, distance, capability result, certification result,
 * availability, conflicting assignment, score components, final score and — for the
 * recommendation — a human-readable reason. That is persisted to
 * public.rr_dispatch_candidates so a dispatch decision can be defended later.
 */

import { haversineDistanceMeters } from "@/lib/mobile-workforce-gps";

/** Bumped when scoring or gating changes, and stamped onto every persisted candidate. */
export const RR_DISPATCH_ENGINE_VERSION = "rr-dispatch-1.0.0";

export const RR_TOW_CLASSES = [
  "light_duty",
  "flatbed",
  "underlift",
  "wrecker",
  "rotator",
  "lowbed",
] as const;

export type RrTowClass = (typeof RR_TOW_CLASSES)[number];

export const RR_TRUCK_AVAILABILITY = [
  "available",
  "on_job",
  "off_shift",
  "maintenance",
  "out_of_service",
] as const;

export type RrTruckAvailability = (typeof RR_TRUCK_AVAILABILITY)[number];

export type RrOperationalStatus = "operational" | "limited" | "grounded";

/** Every way a candidate can be disqualified. Stable codes — they are persisted. */
export const RR_ELIGIBILITY_FAILURES = [
  "tenant_mismatch",
  "truck_unavailable",
  "truck_not_operational",
  "tow_class_not_permitted",
  "insufficient_payload",
  "vehicle_too_long",
  "winch_required",
  "boom_required",
  "equipment_missing",
  "driver_inactive",
  "certification_missing",
  "certification_expired",
  "certification_not_active",
  "driver_has_conflicting_assignment",
  "truck_has_conflicting_assignment",
  "outside_operating_radius",
  "scene_location_unknown",
  "candidate_location_unknown",
  /**
   * This driver already declined THIS job.
   *
   * Job-specific by construction: it is recorded against the job's own declined
   * assignments, never against the driver, so they remain a normal candidate for
   * every other job. A controller who wants them anyway can re-include them
   * deliberately (see `includeDeclined`) rather than the system forgetting.
   */
  "previously_declined",
] as const;

export type RrEligibilityFailureCode = (typeof RR_ELIGIBILITY_FAILURES)[number];

export type RrEligibilityFailure = {
  code: RrEligibilityFailureCode;
  detail: string;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** What the job needs. Derived from the service type + the job's own facts. */
export type RrServiceRequirement = {
  serviceCode: string;
  /** Tow classes able to perform this service. Empty means "no class restriction". */
  permittedTowClasses: readonly RrTowClass[];
  /** Casualty vehicle mass, if known. */
  vehicleMassKg?: number | null;
  vehicleLengthM?: number | null;
  requiresWinch?: boolean;
  requiresBoom?: boolean;
  /** Equipment keys that must appear in the truck's equipment list. */
  requiredEquipment?: readonly string[];
  /** Certifications a driver must hold, valid, to perform this service. */
  requiredCertifications?: readonly string[];
  /** Hard cap on dispatch distance. Null/undefined means no cap. */
  maxDispatchRadiusKm?: number | null;
};

export type RrSceneLocation = {
  latitude: number | null;
  longitude: number | null;
};

export type RrCertificationSnapshot = {
  certificationType: string;
  status: string;
  /** ISO date (yyyy-mm-dd) or null for "never expires". */
  expiresAt: string | null;
  blocksDispatch: boolean;
};

export type RrTruckSnapshot = {
  towTruckProfileId: string;
  fieldVehicleId: string;
  companyId: string;
  registration: string | null;
  towClass: RrTowClass;
  payloadCapacityKg: number | null;
  maxVehicleLengthM: number | null;
  hasWinch: boolean;
  hasBoom: boolean;
  equipment: readonly string[];
  availabilityStatus: RrTruckAvailability;
  operationalStatus: RrOperationalStatus;
  latitude: number | null;
  longitude: number | null;
};

export type RrDriverSnapshot = {
  employeeId: string;
  companyId: string;
  displayName: string;
  active: boolean;
  certifications: readonly RrCertificationSnapshot[];
  /** Id of a live assignment on another job, if any. */
  conflictingAssignmentId: string | null;
};

/** A driver paired with the truck they would take. */
export type RrCandidateInput = {
  driver: RrDriverSnapshot;
  truck: RrTruckSnapshot | null;
};

export type RrDispatchEvaluationInput = {
  companyId: string;
  serviceJobId: string;
  scene: RrSceneLocation;
  requirement: RrServiceRequirement;
  candidates: readonly RrCandidateInput[];
  /** ISO timestamp the evaluation is made at — supplied, never read from the clock. */
  evaluatedAt: string;
  /**
   * Drivers who already declined THIS job, with the reason they gave.
   *
   * Offering a job back to the person who just refused it wastes the one thing
   * a control room does not have at a scene: time. Keyed by employee id and
   * scoped to this job only.
   */
  declined?: readonly RrDeclinedCandidate[];
  /**
   * Deliberately re-include drivers who declined this job.
   *
   * The controller's override. They are still marked `previouslyDeclined` and
   * their reason is still shown, so the decision is made with the refusal in
   * view rather than by the system quietly forgetting it.
   */
  includeDeclined?: boolean;
};

/** One driver's refusal of one job. */
export type RrDeclinedCandidate = {
  employeeId: string;
  reason: string | null;
  declinedAt: string | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type RrCapabilityResult = {
  passed: boolean;
  towClassPermitted: boolean;
  payloadOk: boolean;
  lengthOk: boolean;
  winchOk: boolean;
  boomOk: boolean;
  missingEquipment: string[];
};

export type RrCertificationResult = {
  passed: boolean;
  required: string[];
  valid: string[];
  missing: string[];
  expired: string[];
  notActive: string[];
};

export type RrScoreComponents = {
  /** 0-60. Closer is better. */
  proximity: number;
  /** 0-20. An idle truck beats one finishing a job. */
  availability: number;
  /** 0-15. A tighter class match beats over-capable equipment. */
  capabilityFit: number;
  /** 0-5. An unencumbered driver beats one with a queued assignment. */
  workload: number;
};

export type RrEvaluatedCandidate = {
  employeeId: string;
  driverName: string;
  fieldVehicleId: string | null;
  towTruckProfileId: string | null;
  registration: string | null;
  eligible: boolean;
  eligibilityFailures: RrEligibilityFailure[];
  /** True when this driver already declined THIS job. */
  previouslyDeclined: boolean;
  /** What they said when they declined, so the controller can judge. */
  declineReason: string | null;
  distanceKm: number | null;
  capabilityResult: RrCapabilityResult;
  certificationResult: RrCertificationResult;
  availabilityStatus: RrTruckAvailability | null;
  conflictingAssignmentId: string | null;
  scoreComponents: RrScoreComponents;
  finalScore: number;
  rank: number | null;
  recommended: boolean;
  recommendationReason: string | null;
};

export type RrDispatchEvaluation = {
  companyId: string;
  serviceJobId: string;
  evaluatedAt: string;
  engineVersion: string;
  candidates: RrEvaluatedCandidate[];
  eligible: RrEvaluatedCandidate[];
  recommended: RrEvaluatedCandidate | null;
  /** Set when nothing is eligible, explaining the most common blocker. */
  noCandidateReason: string | null;
};

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

const ZERO_CAPABILITY: RrCapabilityResult = {
  passed: false,
  towClassPermitted: false,
  payloadOk: false,
  lengthOk: false,
  winchOk: false,
  boomOk: false,
  missingEquipment: [],
};

export function evaluateCapability(
  truck: RrTruckSnapshot | null,
  requirement: RrServiceRequirement
): RrCapabilityResult {
  if (!truck) return { ...ZERO_CAPABILITY, missingEquipment: [] };

  const permitted = requirement.permittedTowClasses ?? [];
  const towClassPermitted = permitted.length === 0 || permitted.includes(truck.towClass);

  // An unknown capacity is not treated as a failure: it is unknown, not insufficient.
  // The dispatcher sees the capability result and can still decide.
  const payloadOk =
    requirement.vehicleMassKg == null ||
    truck.payloadCapacityKg == null ||
    truck.payloadCapacityKg >= requirement.vehicleMassKg;

  const lengthOk =
    requirement.vehicleLengthM == null ||
    truck.maxVehicleLengthM == null ||
    truck.maxVehicleLengthM >= requirement.vehicleLengthM;

  const winchOk = !requirement.requiresWinch || truck.hasWinch;
  const boomOk = !requirement.requiresBoom || truck.hasBoom;

  const equipmentSet = new Set((truck.equipment ?? []).map((item) => String(item).toLowerCase()));
  const missingEquipment = (requirement.requiredEquipment ?? [])
    .map((item) => String(item).toLowerCase())
    .filter((item) => !equipmentSet.has(item));

  return {
    passed:
      towClassPermitted &&
      payloadOk &&
      lengthOk &&
      winchOk &&
      boomOk &&
      missingEquipment.length === 0,
    towClassPermitted,
    payloadOk,
    lengthOk,
    winchOk,
    boomOk,
    missingEquipment,
  };
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

/**
 * A certification is valid when it is active and not expired ON the evaluation date.
 *
 * Expiry is inclusive of the expiry date itself: a licence expiring today is still
 * valid today. A null expiry never expires. Comparison is on the ISO date prefix, so it
 * is timezone-stable and free of clock reads.
 */
export function isCertificationValid(
  certification: RrCertificationSnapshot,
  onDateIso: string
): boolean {
  if (String(certification.status || "").toLowerCase() !== "active") return false;
  if (!certification.expiresAt) return true;
  return certification.expiresAt.slice(0, 10) >= onDateIso.slice(0, 10);
}

export function evaluateCertifications(
  driver: RrDriverSnapshot,
  requirement: RrServiceRequirement,
  evaluatedAt: string
): RrCertificationResult {
  const required = [...(requirement.requiredCertifications ?? [])];
  const valid: string[] = [];
  const missing: string[] = [];
  const expired: string[] = [];
  const notActive: string[] = [];

  const byType = new Map(
    (driver.certifications ?? []).map((entry) => [entry.certificationType, entry])
  );

  for (const type of required) {
    const held = byType.get(type);
    if (!held) {
      missing.push(type);
      continue;
    }
    if (String(held.status || "").toLowerCase() !== "active") {
      notActive.push(type);
      continue;
    }
    if (!isCertificationValid(held, evaluatedAt)) {
      expired.push(type);
      continue;
    }
    valid.push(type);
  }

  // A blocks_dispatch certification the driver actually holds must be valid even when
  // this particular service did not ask for it — an expired PrDP grounds the driver.
  for (const held of driver.certifications ?? []) {
    if (!held.blocksDispatch) continue;
    if (required.includes(held.certificationType)) continue;
    if (isCertificationValid(held, evaluatedAt)) continue;
    if (String(held.status || "").toLowerCase() !== "active") {
      notActive.push(held.certificationType);
    } else {
      expired.push(held.certificationType);
    }
  }

  return {
    passed: missing.length === 0 && expired.length === 0 && notActive.length === 0,
    required,
    valid,
    missing: [...new Set(missing)],
    expired: [...new Set(expired)],
    notActive: [...new Set(notActive)],
  };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

export function distanceKmBetween(
  scene: RrSceneLocation,
  truck: RrTruckSnapshot | null
): number | null {
  if (scene.latitude == null || scene.longitude == null) return null;
  if (!truck || truck.latitude == null || truck.longitude == null) return null;
  const metres = haversineDistanceMeters(
    scene.latitude,
    scene.longitude,
    truck.latitude,
    truck.longitude
  );
  return Math.round((metres / 1000) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Eligibility gates
// ---------------------------------------------------------------------------

function gate(
  candidate: RrCandidateInput,
  input: RrDispatchEvaluationInput,
  capability: RrCapabilityResult,
  certifications: RrCertificationResult,
  distanceKm: number | null
): RrEligibilityFailure[] {
  const failures: RrEligibilityFailure[] = [];
  const { driver, truck } = candidate;
  const { requirement } = input;

  if (driver.companyId !== input.companyId) {
    failures.push({
      code: "tenant_mismatch",
      detail: `Driver belongs to another workspace.`,
    });
  }
  if (truck && truck.companyId !== input.companyId) {
    failures.push({ code: "tenant_mismatch", detail: `Truck belongs to another workspace.` });
  }

  if (!driver.active) {
    failures.push({ code: "driver_inactive", detail: `${driver.displayName} is not active.` });
  }

  if (!truck) {
    failures.push({
      code: "truck_unavailable",
      detail: "No tow truck is paired with this driver.",
    });
  } else {
    if (truck.availabilityStatus !== "available") {
      failures.push({
        code: "truck_unavailable",
        detail: `Truck ${truck.registration ?? truck.fieldVehicleId} is ${truck.availabilityStatus.replace(/_/g, " ")}.`,
      });
    }
    if (truck.operationalStatus !== "operational") {
      failures.push({
        code: "truck_not_operational",
        detail: `Truck ${truck.registration ?? truck.fieldVehicleId} is ${truck.operationalStatus}.`,
      });
    }
    if (!capability.towClassPermitted) {
      failures.push({
        code: "tow_class_not_permitted",
        detail: `${truck.towClass.replace(/_/g, " ")} cannot perform ${requirement.serviceCode.replace(/_/g, " ")}.`,
      });
    }
    if (!capability.payloadOk) {
      failures.push({
        code: "insufficient_payload",
        detail: `Payload ${truck.payloadCapacityKg}kg is below the ${requirement.vehicleMassKg}kg casualty vehicle.`,
      });
    }
    if (!capability.lengthOk) {
      failures.push({
        code: "vehicle_too_long",
        detail: `Deck ${truck.maxVehicleLengthM}m is shorter than the ${requirement.vehicleLengthM}m casualty vehicle.`,
      });
    }
    if (!capability.winchOk) {
      failures.push({ code: "winch_required", detail: "This service requires a winch." });
    }
    if (!capability.boomOk) {
      failures.push({ code: "boom_required", detail: "This service requires a boom." });
    }
    if (capability.missingEquipment.length > 0) {
      failures.push({
        code: "equipment_missing",
        detail: `Missing equipment: ${capability.missingEquipment.join(", ")}.`,
      });
    }
  }

  if (!certifications.passed) {
    for (const type of certifications.missing) {
      failures.push({
        code: "certification_missing",
        detail: `${driver.displayName} holds no ${type.replace(/_/g, " ")}.`,
      });
    }
    for (const type of certifications.expired) {
      failures.push({
        code: "certification_expired",
        detail: `${driver.displayName}'s ${type.replace(/_/g, " ")} has expired.`,
      });
    }
    for (const type of certifications.notActive) {
      failures.push({
        code: "certification_not_active",
        detail: `${driver.displayName}'s ${type.replace(/_/g, " ")} is not active.`,
      });
    }
  }

  if (driver.conflictingAssignmentId) {
    failures.push({
      code: "driver_has_conflicting_assignment",
      detail: `${driver.displayName} is already committed to another job.`,
    });
  }

  /**
   * Already refused THIS job.
   *
   * Not a blacklist: the check is against this job's own declined assignments,
   * so the driver stays a normal candidate everywhere else. A controller who
   * wants them anyway passes `includeDeclined`, which keeps them eligible while
   * still showing the refusal.
   */
  const declined = (input.declined || []).find(
    (row) => row.employeeId === driver.employeeId
  );
  if (declined && !input.includeDeclined) {
    failures.push({
      code: "previously_declined",
      detail: declined.reason
        ? `${driver.displayName} declined this job: ${declined.reason}`
        : `${driver.displayName} already declined this job.`,
    });
  }

  const maxRadius = requirement.maxDispatchRadiusKm;
  if (maxRadius != null && distanceKm != null && distanceKm > maxRadius) {
    failures.push({
      code: "outside_operating_radius",
      detail: `${distanceKm.toFixed(1)}km exceeds the ${maxRadius}km dispatch radius.`,
    });
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Scoring — only ever applied to candidates that already passed every gate
// ---------------------------------------------------------------------------

/** Tow classes ordered light → heavy, for measuring over-capability. */
const TOW_CLASS_WEIGHT: Record<RrTowClass, number> = {
  light_duty: 1,
  flatbed: 2,
  underlift: 3,
  wrecker: 4,
  lowbed: 5,
  rotator: 6,
};

const NO_SCORE: RrScoreComponents = {
  proximity: 0,
  availability: 0,
  capabilityFit: 0,
  workload: 0,
};

export function scoreCandidate(
  candidate: RrCandidateInput,
  requirement: RrServiceRequirement,
  distanceKm: number | null
): RrScoreComponents {
  const { truck, driver } = candidate;
  if (!truck) return { ...NO_SCORE };

  // Proximity: full marks on scene, decaying to zero at 100km. Unknown distance scores
  // mid-band rather than zero, so a truck with no GPS fix is not silently buried.
  let proximity = 30;
  if (distanceKm != null) {
    proximity = Math.max(0, 60 - (distanceKm / 100) * 60);
  }

  const availability = truck.availabilityStatus === "available" ? 20 : 0;

  // Capability fit: prefer the lightest truck that still does the job, so a rotator is
  // not sent to a hatchback while a flatbed sits idle.
  const permitted = requirement.permittedTowClasses ?? [];
  let capabilityFit = 15;
  if (permitted.length > 0) {
    const lightestPermitted = Math.min(...permitted.map((cls) => TOW_CLASS_WEIGHT[cls]));
    const overCapability = TOW_CLASS_WEIGHT[truck.towClass] - lightestPermitted;
    capabilityFit = Math.max(0, 15 - overCapability * 3);
  }

  const workload = driver.conflictingAssignmentId ? 0 : 5;

  return {
    proximity: Math.round(proximity * 1000) / 1000,
    availability,
    capabilityFit,
    workload,
  };
}

export function totalScore(components: RrScoreComponents): number {
  const sum =
    components.proximity + components.availability + components.capabilityFit + components.workload;
  return Math.round(sum * 1000) / 1000;
}

function buildRecommendationReason(candidate: RrEvaluatedCandidate): string {
  const parts: string[] = [];
  if (candidate.distanceKm != null) parts.push(`${candidate.distanceKm.toFixed(1)} km away`);
  else parts.push("distance unknown");
  if (candidate.availabilityStatus === "available") parts.push("available");
  if (candidate.certificationResult.passed) parts.push("qualified");
  if (candidate.capabilityResult.passed) parts.push("correct truck capability");
  if (!candidate.conflictingAssignmentId) parts.push("no conflicting assignment");
  return parts.join(", ");
}

/** The most common blocker across an all-ineligible pool, for the controller's benefit. */
function summariseNoCandidateReason(candidates: RrEvaluatedCandidate[]): string | null {
  if (candidates.length === 0) return "No drivers or trucks are configured for dispatch.";
  // Counted per CANDIDATE, not per failure. One driver can carry the same code twice —
  // no licence AND no PRDP are both `certification_missing` — so tallying raw failures
  // produced counts larger than the pool ("5 of 4"), which reads as a bug to a
  // controller and gives them nothing to act on.
  const tally = new Map<RrEligibilityFailureCode, number>();
  for (const candidate of candidates) {
    for (const code of new Set(candidate.eligibilityFailures.map((failure) => failure.code))) {
      tally.set(code, (tally.get(code) ?? 0) + 1);
    }
  }
  if (tally.size === 0) return null;
  const [topCode, count] = [...tally.entries()].sort((a, b) =>
    b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]
  )[0];
  return `No eligible candidate. Most common blocker: ${topCode.replace(/_/g, " ")} (${count} of ${candidates.length}).`;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Evaluates every candidate, gates them, scores the survivors and ranks the result.
 *
 * Deterministic: identical input always yields identical output, including tie-breaks,
 * which fall back to employeeId so the ordering is stable rather than incidental.
 */
export function evaluateDispatchCandidates(
  input: RrDispatchEvaluationInput
): RrDispatchEvaluation {
  const evaluated: RrEvaluatedCandidate[] = input.candidates.map((candidate) => {
    const { driver, truck } = candidate;
    const capabilityResult = evaluateCapability(truck, input.requirement);
    const certificationResult = evaluateCertifications(driver, input.requirement, input.evaluatedAt);
    const distanceKm = distanceKmBetween(input.scene, truck);
    const declinedRow = (input.declined || []).find(
      (row) => row.employeeId === driver.employeeId
    );
    const eligibilityFailures = gate(
      candidate,
      input,
      capabilityResult,
      certificationResult,
      distanceKm
    );
    const eligible = eligibilityFailures.length === 0;
    const scoreComponents = eligible
      ? scoreCandidate(candidate, input.requirement, distanceKm)
      : { ...NO_SCORE };

    return {
      employeeId: driver.employeeId,
      driverName: driver.displayName,
      fieldVehicleId: truck?.fieldVehicleId ?? null,
      towTruckProfileId: truck?.towTruckProfileId ?? null,
      registration: truck?.registration ?? null,
      eligible,
      eligibilityFailures,
      previouslyDeclined: Boolean(declinedRow),
      declineReason: declinedRow?.reason ?? null,
      distanceKm,
      capabilityResult,
      certificationResult,
      availabilityStatus: truck?.availabilityStatus ?? null,
      conflictingAssignmentId: driver.conflictingAssignmentId,
      scoreComponents,
      finalScore: eligible ? totalScore(scoreComponents) : 0,
      rank: null,
      recommended: false,
      recommendationReason: null,
    };
  });

  const eligible = evaluated
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => {
      /**
       * A driver who already refused this job never outranks one who has not,
       * even when the controller re-includes them. They remain selectable; they
       * are simply not the recommendation.
       */
      if (a.previouslyDeclined !== b.previouslyDeclined) {
        return a.previouslyDeclined ? 1 : -1;
      }
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      // Stable, reproducible tie-break rather than input order.
      return a.employeeId.localeCompare(b.employeeId);
    });

  eligible.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  const recommended = eligible[0] ?? null;
  if (recommended) {
    recommended.recommended = true;
    recommended.recommendationReason = buildRecommendationReason(recommended);
  }

  return {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    evaluatedAt: input.evaluatedAt,
    engineVersion: RR_DISPATCH_ENGINE_VERSION,
    candidates: evaluated,
    eligible,
    recommended,
    noCandidateReason: recommended ? null : summariseNoCandidateReason(evaluated),
  };
}

// ---------------------------------------------------------------------------
// Service requirements
// ---------------------------------------------------------------------------

/**
 * Phase 1 default requirements per service code.
 *
 * Deliberately data, not branching logic, so Phase 6's configurable requirements engine
 * can replace this map without touching the engine itself.
 */
export const RR_DEFAULT_SERVICE_REQUIREMENTS: Record<
  string,
  Omit<RrServiceRequirement, "serviceCode">
> = {
  tow_in: {
    permittedTowClasses: ["flatbed", "underlift", "wrecker", "lowbed", "rotator"],
    requiredCertifications: ["drivers_licence", "prdp"],
  },
  accident_recovery: {
    permittedTowClasses: ["flatbed", "underlift", "wrecker", "rotator"],
    requiresWinch: true,
    requiredCertifications: ["drivers_licence", "prdp"],
  },
  heavy_recovery: {
    permittedTowClasses: ["wrecker", "rotator", "lowbed"],
    requiresWinch: true,
    requiresBoom: true,
    requiredCertifications: ["drivers_licence", "prdp", "recovery_competency"],
  },
  /**
   * BYSTAND attends a scene; it moves nothing. So there is deliberately NO tow class
   * restriction — any roadworthy vehicle with a qualified operator can stand by, and
   * requiring a tow truck would strand attendances that need none. A PrDP is still
   * required because the operator is driving a company vehicle to a live incident.
   */
  bystand: {
    permittedTowClasses: [],
    requiredCertifications: ["drivers_licence", "prdp"],
  },
  jump_start: {
    permittedTowClasses: [],
    requiredCertifications: ["drivers_licence"],
  },
  roadside_assistance: {
    permittedTowClasses: [],
    requiredCertifications: ["drivers_licence"],
  },
  vehicle_movement: {
    permittedTowClasses: ["flatbed", "underlift", "lowbed"],
    requiredCertifications: ["drivers_licence", "prdp"],
  },
};

export function requirementForService(
  serviceCode: string,
  overrides: Partial<RrServiceRequirement> = {}
): RrServiceRequirement {
  const base = RR_DEFAULT_SERVICE_REQUIREMENTS[serviceCode] ?? {
    permittedTowClasses: [],
    requiredCertifications: ["drivers_licence"],
  };
  return {
    serviceCode,
    permittedTowClasses: base.permittedTowClasses ?? [],
    requiresWinch: base.requiresWinch ?? false,
    requiresBoom: base.requiresBoom ?? false,
    requiredEquipment: base.requiredEquipment ?? [],
    requiredCertifications: base.requiredCertifications ?? [],
    maxDispatchRadiusKm: base.maxDispatchRadiusKm ?? null,
    ...overrides,
  };
}

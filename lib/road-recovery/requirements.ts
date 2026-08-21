/**
 * VYRON CORE — Road & Recovery requirements & compliance engine (Phase 3).
 *
 * PURE MODULE. No Supabase, no fetch, no environment, no clock reads — "now" is supplied
 * by the caller. A compliance verdict may be shown to an insurer in a dispute, so it must
 * be reproducible from data: the same inputs always yield the same result.
 *
 * ---------------------------------------------------------------------------
 * WHY REQUIREMENTS ARE DATA, NOT CODE
 * ---------------------------------------------------------------------------
 *
 * Research for Phase 3 found no South African insurer publishing its tow-provider
 * evidence checklist: those obligations live in commercial contracts and differ per
 * counterparty. What IS public is the claim-side artefact list (SAPS AR number, VIN and
 * engine number, licence, damage, tow details, storage address) and the assistance-
 * provider payment conditions (pre-authorisation, documented service). So requirements
 * are configured per counterparty and per service type, versioned with effective dates —
 * never hardcoded.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ENGINE IS DETERMINISTIC
 * ---------------------------------------------------------------------------
 *
 * AI may later EXPLAIN a verdict. It must never produce one. `evidence_complete` gates
 * invoicing, so it is computed here from counted evidence, recorded waivers and declared
 * conditions, and nowhere else.
 */

/** Bumped whenever evaluation semantics change; stamped on every persisted evaluation. */
export const RR_COMPLIANCE_ENGINE_VERSION = "rr-compliance-1.0.0";

/** How a requirement is satisfied. */
export const RR_EVIDENCE_KINDS = [
  "photo",
  "document",
  "field",
  "signature",
  "gps",
  "authorisation",
  "reference",
  "handover",
] as const;

export type RrEvidenceKind = (typeof RR_EVIDENCE_KINDS)[number];

/**
 * What an unmet requirement blocks.
 *
 * `invoice` is the one Phase 0 already wired: the `evidence_complete` guard on
 * `ready_to_invoice`. `release` and `pack` are declared now so Phases 4 and 5 add data
 * rather than schema.
 */
export const RR_BLOCKING_SCOPES = ["transition", "invoice", "release", "pack"] as const;

export type RrBlockingScope = (typeof RR_BLOCKING_SCOPES)[number];

/**
 * A declarative condition. Deliberately NOT arbitrary code: a requirement policy is
 * tenant-editable data, so it must never be able to execute anything.
 */
export type RrCondition =
  | { always: true }
  | { field: string; op: "eq" | "neq" | "present" | "absent" | "gt" | "lt" | "in"; value?: unknown }
  | { all: RrCondition[] }
  | { any: RrCondition[] }
  | { not: RrCondition };

export const ALWAYS: RrCondition = { always: true };

export type RrRequirementDefinition = {
  requirementCode: string;
  label: string;
  evidenceKind: RrEvidenceKind;
  /** Conditional requirements only apply when their condition holds. */
  mandatory: boolean;
  condition: RrCondition;
  minCount: number;
  blockingScopes: readonly RrBlockingScope[];
  guidance?: string;
  sortOrder: number;
};

export type RrRequirementPolicy = {
  policyKey: string;
  /** Null = applies to every counterparty (tenant default). */
  counterpartyId: string | null;
  /** Null = applies to every service type. */
  serviceCode: string | null;
  version: number;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  requirements: readonly RrRequirementDefinition[];
};

/** Facts about the job that conditional requirements are evaluated against. */
export type RrJobFacts = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "present":
      return actual !== null && actual !== undefined && actual !== "";
    case "absent":
      return actual === null || actual === undefined || actual === "";
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as never);
    default:
      return false;
  }
}

/**
 * Does this condition hold for these job facts?
 *
 * Unknown shapes evaluate to FALSE, which makes the requirement not-applicable rather
 * than silently mandatory. A malformed policy therefore under-demands rather than
 * blocking every job in the tenant.
 */
export function evaluateCondition(condition: RrCondition | null | undefined, facts: RrJobFacts): boolean {
  if (!condition) return true;
  if ("always" in condition) return condition.always === true;
  if ("all" in condition) return condition.all.every((entry) => evaluateCondition(entry, facts));
  if ("any" in condition) return condition.any.some((entry) => evaluateCondition(entry, facts));
  if ("not" in condition) return !evaluateCondition(condition.not, facts);
  if ("field" in condition) return compare(facts[condition.field], condition.op, condition.value);
  return false;
}

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

/**
 * Specificity, most specific first:
 *   1. this counterparty + this service type
 *   2. this counterparty, any service type
 *   3. any counterparty + this service type
 *   4. tenant default
 */
function specificity(policy: RrRequirementPolicy): number {
  if (policy.counterpartyId && policy.serviceCode) return 4;
  if (policy.counterpartyId) return 3;
  if (policy.serviceCode) return 2;
  return 1;
}

function withinEffectiveWindow(policy: RrRequirementPolicy, at: string): boolean {
  const when = new Date(at).getTime();
  if (!Number.isFinite(when)) return false;
  if (policy.effectiveFrom) {
    const from = new Date(policy.effectiveFrom).getTime();
    if (Number.isFinite(from) && when < from) return false;
  }
  if (policy.effectiveTo) {
    const to = new Date(policy.effectiveTo).getTime();
    if (Number.isFinite(to) && when > to) return false;
  }
  return true;
}

export type RrPolicyResolution = {
  policy: RrRequirementPolicy | null;
  /** Every policy that matched, most specific first — for diagnostics and the UI. */
  considered: RrRequirementPolicy[];
  reason: string;
};

/**
 * Picks the policy that governs a job.
 *
 * Deterministic tie-breaks: specificity, then highest version, then policyKey. A job
 * resolves this ONCE at creation and keeps an immutable snapshot, so later edits to a
 * policy can never retroactively change what an existing job was required to produce.
 */
export function resolveRequirementPolicy(
  policies: readonly RrRequirementPolicy[],
  input: { counterpartyId: string | null; serviceCode: string; at: string }
): RrPolicyResolution {
  const candidates = policies
    .filter((policy) => policy.active)
    .filter((policy) => withinEffectiveWindow(policy, input.at))
    .filter(
      (policy) => policy.counterpartyId === null || policy.counterpartyId === input.counterpartyId
    )
    .filter((policy) => policy.serviceCode === null || policy.serviceCode === input.serviceCode)
    .sort((a, b) => {
      const bySpecificity = specificity(b) - specificity(a);
      if (bySpecificity !== 0) return bySpecificity;
      if (b.version !== a.version) return b.version - a.version;
      return a.policyKey.localeCompare(b.policyKey);
    });

  if (candidates.length === 0) {
    return {
      policy: null,
      considered: [],
      reason: "No active requirement policy applies to this counterparty and service type.",
    };
  }

  const chosen = candidates[0];
  return {
    policy: chosen,
    considered: candidates,
    reason:
      chosen.counterpartyId && chosen.serviceCode
        ? `Counterparty policy for ${chosen.serviceCode}`
        : chosen.counterpartyId
          ? "Counterparty policy for all services"
          : chosen.serviceCode
            ? `Tenant policy for ${chosen.serviceCode}`
            : "Tenant default policy",
  };
}

/** The requirements that actually apply to a job, given its facts. */
export function applicableRequirements(
  requirements: readonly RrRequirementDefinition[],
  facts: RrJobFacts
): RrRequirementDefinition[] {
  return requirements
    .filter((requirement) => evaluateCondition(requirement.condition, facts))
    .slice()
    .sort((a, b) =>
      a.sortOrder === b.sortOrder
        ? a.requirementCode.localeCompare(b.requirementCode)
        : a.sortOrder - b.sortOrder
    );
}

// ---------------------------------------------------------------------------
// Compliance evaluation
// ---------------------------------------------------------------------------

export type RrWaiverRecord = {
  requirementCode: string;
  reasonCode: string;
  reasonDetail?: string | null;
  waivedBy: string;
  approvedAt: string;
};

export type RrRequirementResult = {
  requirementCode: string;
  label: string;
  evidenceKind: RrEvidenceKind;
  mandatory: boolean;
  applicable: boolean;
  minCount: number;
  capturedCount: number;
  satisfied: boolean;
  /** Satisfied because it was waived, NOT because evidence exists. */
  waived: boolean;
  waiver: RrWaiverRecord | null;
  blockingScopes: RrBlockingScope[];
  /** True when unmet AND blocking for the scope this evaluation was run against. */
  blocking: boolean;
};

export const RR_COMPLIANCE_STATUSES = [
  "compliant",
  "waived_compliant",
  "incomplete",
  "non_compliant",
] as const;

export type RrComplianceStatus = (typeof RR_COMPLIANCE_STATUSES)[number];

export type RrComplianceResult = {
  status: RrComplianceStatus;
  /** The answer to the Phase 0 `evidence_complete` guard. */
  evidenceComplete: boolean;
  results: RrRequirementResult[];
  missing: string[];
  waived: string[];
  blocking: string[];
  satisfiedCount: number;
  applicableCount: number;
  completenessPercent: number;
  scope: RrBlockingScope;
  policyKey: string | null;
  policyVersion: number | null;
  engineVersion: string;
  evaluatedAt: string;
};

export type EvaluateComplianceInput = {
  requirements: readonly RrRequirementDefinition[];
  /** requirementCode -> number of linked, verified evidence items. */
  evidenceCounts: Readonly<Record<string, number>>;
  waivers: readonly RrWaiverRecord[];
  facts: RrJobFacts;
  /** Which blocking scope this evaluation is for. Invoicing uses "invoice". */
  scope?: RrBlockingScope;
  evaluatedAt: string;
  policyKey?: string | null;
  policyVersion?: number | null;
};

/**
 * The deterministic verdict.
 *
 * A WAIVER SATISFIES BUT NEVER HIDES. A waived requirement is marked satisfied so the
 * job can proceed, and simultaneously reported in `waived` with its reason, so it is
 * visible in the compliance panel and in any claim pack. `compliant` and
 * `waived_compliant` are therefore distinct statuses: an insurer can tell at a glance
 * whether a job was fully evidenced or partly excused.
 */
export function evaluateCompliance(input: EvaluateComplianceInput): RrComplianceResult {
  const scope: RrBlockingScope = input.scope ?? "invoice";
  const waiverByCode = new Map(input.waivers.map((waiver) => [waiver.requirementCode, waiver]));

  const results: RrRequirementResult[] = input.requirements
    .slice()
    .sort((a, b) =>
      a.sortOrder === b.sortOrder
        ? a.requirementCode.localeCompare(b.requirementCode)
        : a.sortOrder - b.sortOrder
    )
    .map((requirement) => {
      const applicable = evaluateCondition(requirement.condition, input.facts);
      const capturedCount = Math.max(0, Number(input.evidenceCounts[requirement.requirementCode] ?? 0));
      const waiver = waiverByCode.get(requirement.requirementCode) ?? null;

      const satisfiedByEvidence = capturedCount >= Math.max(1, requirement.minCount);
      const waived = applicable && !satisfiedByEvidence && waiver !== null;
      const satisfied = !applicable || satisfiedByEvidence || waived;

      const blocking =
        applicable &&
        requirement.mandatory &&
        !satisfied &&
        requirement.blockingScopes.includes(scope);

      return {
        requirementCode: requirement.requirementCode,
        label: requirement.label,
        evidenceKind: requirement.evidenceKind,
        mandatory: requirement.mandatory,
        applicable,
        minCount: Math.max(1, requirement.minCount),
        capturedCount,
        satisfied,
        waived,
        waiver: waived ? waiver : null,
        blockingScopes: [...requirement.blockingScopes],
        blocking,
      };
    });

  const applicableResults = results.filter((entry) => entry.applicable);
  const mandatoryApplicable = applicableResults.filter((entry) => entry.mandatory);

  const missing = mandatoryApplicable.filter((entry) => !entry.satisfied).map((entry) => entry.requirementCode);
  const waived = applicableResults.filter((entry) => entry.waived).map((entry) => entry.requirementCode);
  const blocking = results.filter((entry) => entry.blocking).map((entry) => entry.requirementCode);

  const satisfiedCount = applicableResults.filter((entry) => entry.satisfied).length;
  const applicableCount = applicableResults.length;
  const completenessPercent =
    applicableCount === 0 ? 100 : Math.round((satisfiedCount / applicableCount) * 1000) / 10;

  let status: RrComplianceStatus;
  if (blocking.length > 0) status = "non_compliant";
  else if (missing.length > 0) status = "incomplete";
  else if (waived.length > 0) status = "waived_compliant";
  else status = "compliant";

  return {
    status,
    // The guard: nothing mandatory and invoice-blocking is outstanding.
    evidenceComplete: blocking.length === 0,
    results,
    missing,
    waived,
    blocking,
    satisfiedCount,
    applicableCount,
    completenessPercent,
    scope,
    policyKey: input.policyKey ?? null,
    policyVersion: input.policyVersion ?? null,
    engineVersion: RR_COMPLIANCE_ENGINE_VERSION,
    evaluatedAt: input.evaluatedAt,
  };
}

// ---------------------------------------------------------------------------
// Exception taxonomy
// ---------------------------------------------------------------------------

export const RR_EXCEPTION_CODES = [
  "missing_photograph",
  "gps_unavailable",
  "expired_certification",
  "missing_authorisation",
  "expired_authorisation",
  "destination_changed",
  "customer_refused_signature",
  "vehicle_damage_disputed",
  "police_custody",
  "vehicle_inaccessible",
  "cancelled_job",
  "no_show",
  "wrong_vehicle",
  "wrong_destination",
  "storage_overrun",
  "third_party_uncooperative",
] as const;

export type RrExceptionCode = (typeof RR_EXCEPTION_CODES)[number];

export const RR_EXCEPTION_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type RrExceptionSeverity = (typeof RR_EXCEPTION_SEVERITIES)[number];

/**
 * Exceptions that legitimately justify waiving evidence.
 *
 * These are the operational realities the research surfaced: police may take a vehicle,
 * a customer may refuse to sign, a basement has no GPS. Recording the exception AND the
 * waiver keeps both honest — the alternative is staff entering false data to clear a
 * checklist, which is far worse than an explicit, attributed excuse.
 */
export const RR_WAIVER_JUSTIFYING_EXCEPTIONS: readonly RrExceptionCode[] = [
  "gps_unavailable",
  "customer_refused_signature",
  "police_custody",
  "vehicle_inaccessible",
  "third_party_uncooperative",
];

export function exceptionJustifiesWaiver(code: unknown): boolean {
  return RR_WAIVER_JUSTIFYING_EXCEPTIONS.includes(String(code ?? "") as RrExceptionCode);
}

export const RR_WAIVER_REASON_CODES = [
  "police_took_custody",
  "customer_refused",
  "gps_unavailable",
  "vehicle_inaccessible",
  "third_party_uncooperative",
  "not_applicable_on_scene",
  "counterparty_agreed",
  "other",
] as const;

export type RrWaiverReasonCode = (typeof RR_WAIVER_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRequirementDefinition(requirement: RrRequirementDefinition): void {
  if (!/^[a-z0-9_]+$/.test(requirement.requirementCode)) {
    throw new Error(`Invalid requirement code: ${requirement.requirementCode}`);
  }
  if (!RR_EVIDENCE_KINDS.includes(requirement.evidenceKind)) {
    throw new Error(
      `Requirement "${requirement.requirementCode}" has unknown evidence kind "${requirement.evidenceKind}".`
    );
  }
  if (requirement.minCount < 1) {
    throw new Error(`Requirement "${requirement.requirementCode}" must require at least one item.`);
  }
  for (const scope of requirement.blockingScopes) {
    if (!RR_BLOCKING_SCOPES.includes(scope)) {
      throw new Error(
        `Requirement "${requirement.requirementCode}" names unknown blocking scope "${scope}".`
      );
    }
  }
  // A non-mandatory requirement that blocks is a contradiction.
  if (!requirement.mandatory && requirement.blockingScopes.length > 0) {
    throw new Error(
      `Requirement "${requirement.requirementCode}" is optional but declares blocking scopes.`
    );
  }
}

export function validatePolicy(policy: RrRequirementPolicy): void {
  const seen = new Set<string>();
  for (const requirement of policy.requirements) {
    if (seen.has(requirement.requirementCode)) {
      throw new Error(
        `Policy "${policy.policyKey}" declares duplicate requirement "${requirement.requirementCode}".`
      );
    }
    seen.add(requirement.requirementCode);
    validateRequirementDefinition(requirement);
  }
  if (policy.effectiveFrom && policy.effectiveTo) {
    if (new Date(policy.effectiveTo).getTime() < new Date(policy.effectiveFrom).getTime()) {
      throw new Error(`Policy "${policy.policyKey}" ends before it begins.`);
    }
  }
}

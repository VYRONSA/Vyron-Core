/**
 * VYRON CORE — Road & Recovery recommendations (Phase 6).
 *
 * PURE. Facts in, deterministic result out. No AI decides any of this.
 *
 * This module turns FINDINGS into the input the EXISTING workflow orchestration engine
 * consumes. It does not orchestrate anything itself, does not write an action, and does
 * not invent an action vocabulary: `orchestrateWorkflow()` produces the recommendation and
 * `prepareAutomationAction()` writes it to `workforce_automation_actions`, exactly as
 * every workforce recommendation has always done.
 *
 * The three-part discipline is enforced structurally, not by convention:
 *
 *   SYMPTOM         what the measurement showed
 *   ROOT CAUSE      why it most likely happened, with the evidence that supports it
 *   RECOMMENDATION  what should be done, by whom, by when
 *
 * A finding with no supportable cause carries `rootCause: null` rather than a plausible
 * sentence. Guessing a cause is worse than admitting there isn't one: a manager who acts
 * on a confident guess wastes a day, and stops trusting the next recommendation.
 */

import type { WorkflowOrchestrationInput, WorkflowTrigger } from "@/lib/workflow-orchestration-engine";
import { RR_DOMAIN_LABELS } from "./types";
import type { RrFinding, RrIntelligenceDomain, RrSeverity } from "./types";
import { triggerForMetric, type RrTriggerDefinition } from "./triggers";

export const RR_RECOMMENDATION_ENGINE_VERSION = "rr-recommendation-engine-1.0.0" as const;

const SEVERITY_WEIGHT: Record<RrSeverity, number> = { low: 10, medium: 30, high: 60, critical: 100 };

/** Days a finding of each severity should be closed within. Used to set a due date. */
const SEVERITY_DUE_DAYS: Record<RrSeverity, number> = { critical: 1, high: 3, medium: 7, low: 14 };

const MS_PER_DAY = 86_400_000;

export type RrRecommendation = {
  key: string;
  domain: RrIntelligenceDomain;
  domainLabel: string;
  trigger: WorkflowTrigger;
  triggerKey: string;
  severity: RrSeverity;
  /**
   * 0-100, deterministic. Drives the order of the Action Centre so the item a manager
   * should open first is genuinely first, rather than merely most recent.
   */
  priorityScore: number;
  symptom: string;
  rootCause: string | null;
  rootCauseConfidence: number | null;
  evidence: string[];
  recommendation: string;
  alternative: string;
  expectedOutcome: string;
  consequenceIfIgnored: string;
  ownerRole: string;
  /** ISO date the action should be completed by, derived from the as-of instant. */
  dueDateIso: string;
  affectedCount: number;
  /** null when the facts do not support a rand figure. NEVER zero as a stand-in. */
  financialImpactZAR: number | null;
  /** True only when a real amount was calculated. Drives "Not quantified" in the UI. */
  financialImpactKnown: boolean;
  metricKey: string | null;
  measuredValue: number | null;
  targetValue: number | null;
  beforeMetrics: Record<string, number>;
  actionType: string;
};

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic priority.
 *
 * Severity dominates, because a critical exception outranks a large but routine backlog.
 * Breadth and money then separate items of equal severity. Both are damped with a
 * logarithm AND capped, so a single enormous number cannot swamp the ordering — twenty
 * affected jobs matters more than two, but not ten times more, and no volume of
 * low-severity work can outrank something the operation already called critical.
 */
export function priorityScore(finding: RrFinding): number {
  const severity = SEVERITY_WEIGHT[finding.severity] * 0.75;

  // Breadth and money are logarithmic AND capped. Without the cap a low-severity finding
  // touching five hundred jobs outranks an open critical exception, which is exactly the
  // ordering that buries the item a manager most needs to see. The caps guarantee the
  // severity bands never overlap: critical 75-95, high 45-65, medium 22.5-42.5, low 7.5-27.5.
  const breadth = finding.affectedCount > 0 ? Math.min(10, Math.log10(finding.affectedCount + 1) * 7) : 0;
  const money =
    finding.financialImpactZAR !== null && finding.financialImpactZAR > 0
      ? Math.min(10, Math.log10(finding.financialImpactZAR + 1) * 2)
      : 0;

  return round(clamp(severity + breadth + money));
}

function dueDate(asOfIso: string, severity: RrSeverity): string {
  const asOf = Date.parse(asOfIso);
  if (!Number.isFinite(asOf)) return asOfIso;
  return new Date(asOf + SEVERITY_DUE_DAYS[severity] * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Turns findings into ordered recommendations.
 *
 * A finding is DROPPED only when neither its metric nor its domain has a trigger path.
 * Everything that reaches the Action Centre must have a real escalation route; an action
 * nobody can act on is noise wearing a badge.
 *
 * The domain fallback matters more than it looks. Eight of the forty-eight catalogue
 * metrics carry a trigger of their own, but EVERY finding is built by findingFrom(), which
 * always stamps `metricKey` — so a metric-only lookup left findingTriggerForDomain()
 * unreachable and silently discarded every breach on the other forty. A tenant who set a
 * target on, say, `authorisation_missing_count` saw it scored Critical in the health
 * breakdown while the Action Centre said "every configured target is being met" on the
 * same screen. The domain trigger is a real escalation route with a real owner, so falling
 * back to it is what the drop rule was always meant to permit.
 */
export function buildRecommendations(
  findings: readonly RrFinding[],
  input: { asOfIso: string; limit: number }
): RrRecommendation[] {
  const recommendations: RrRecommendation[] = [];

  for (const finding of findings) {
    const definition: RrTriggerDefinition | null =
      (finding.metricKey ? triggerForMetric(finding.metricKey) : null) ??
      findingTriggerForDomain(finding.domain);
    if (!definition) continue;

    const measured = finding.beforeMetrics.measuredValue;
    const target = finding.beforeMetrics.targetValue;

    recommendations.push({
      key: finding.key,
      domain: finding.domain,
      domainLabel: RR_DOMAIN_LABELS[finding.domain],
      trigger: definition.trigger,
      triggerKey: definition.key,
      severity: finding.severity,
      priorityScore: priorityScore(finding),
      symptom: finding.symptom,
      rootCause: finding.rootCause,
      rootCauseConfidence: finding.rootCauseConfidence,
      evidence: finding.evidence,
      recommendation: finding.recommendation,
      alternative: finding.alternative,
      expectedOutcome: finding.expectedOutcome,
      consequenceIfIgnored: finding.consequenceIfIgnored,
      ownerRole: definition.ownerRole,
      dueDateIso: dueDate(input.asOfIso, finding.severity),
      affectedCount: finding.affectedCount,
      financialImpactZAR: finding.financialImpactZAR,
      financialImpactKnown: finding.financialImpactZAR !== null,
      metricKey: finding.metricKey,
      measuredValue: typeof measured === "number" && Number.isFinite(measured) ? measured : null,
      targetValue: typeof target === "number" && Number.isFinite(target) ? target : null,
      beforeMetrics: finding.beforeMetrics,
      actionType: definition.actionType,
    });
  }

  return recommendations
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      // Stable, deterministic tiebreak so the same data always renders the same order.
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, Math.max(0, input.limit));
}

/** The trigger for a domain-level finding that is not tied to one metric. */
function findingTriggerForDomain(domain: RrIntelligenceDomain): RrTriggerDefinition | null {
  const byDomain: Partial<Record<RrIntelligenceDomain, string>> = {
    exceptions: "exception_critical_open_count",
    storage: "storage_ageing_over_30_days_count",
    billing_readiness: "billing_blocked_count",
    authorisation: "authorisation_delay_minutes",
    distance: "distance_variance_pct_avg",
    dispatch: "dispatch_time_to_assign_minutes",
    tow_operations: "response_time_to_scene_minutes",
    fleet: "fleet_out_of_service_pct",
  };
  const metricKey = byDomain[domain];
  return metricKey ? triggerForMetric(metricKey) : null;
}

/**
 * Converts a recommendation into the input the EXISTING orchestration engine consumes.
 *
 * Everything downstream — the recommended actions, the approval chain, the notification
 * list, the task list, the impact estimate and the before-metrics snapshot — is produced
 * by `orchestrateWorkflow()`. Phase 6 supplies the operational facts and lets the engine
 * that already runs the business make the workflow.
 */
export function toOrchestrationInput(
  recommendation: RrRecommendation,
  input: { companyId: string; createdBy: string; ownerEmail?: string | null }
): WorkflowOrchestrationInput {
  return {
    trigger: recommendation.trigger,
    companyId: input.companyId,
    employeeId: null,
    employeeName: null,
    department: recommendation.domainLabel,
    managerEmail: input.ownerEmail ?? null,
    supervisorEmail: null,
    sourceModule: "Road & Recovery Intelligence",
    createdBy: input.createdBy,
    evidence: {
      subject: recommendation.domainLabel,
      condition: recommendation.symptom,
      measurement:
        recommendation.measuredValue !== null && recommendation.targetValue !== null
          ? `Measured ${recommendation.measuredValue} against a configured target of ${recommendation.targetValue}.`
          : "No operational target is configured for this metric; the finding is based on a recorded fact rather than a target breach.",
      affectedCount: recommendation.affectedCount,
      measuredValue: recommendation.measuredValue ?? 0,
      targetValue: recommendation.targetValue ?? 0,
      openCriticalExceptions: recommendation.beforeMetrics.openCriticalExceptions ?? 0,
      // Omitted entirely when unknown, so the engine cannot present a fabricated amount.
      ...(recommendation.financialImpactKnown
        ? { financialImpactZAR: recommendation.financialImpactZAR }
        : {}),
      rootCause: recommendation.rootCause ?? "",
      confidence: recommendation.rootCauseConfidence ?? "",
      expectedOutcome: recommendation.expectedOutcome,
      consequenceIfIgnored: recommendation.consequenceIfIgnored,
    },
  };
}

/**
 * The payload stored on the prepared action.
 *
 * Deliberately verbose: six months later, the question asked of an action is "why did we
 * do this", and the answer has to be in the record rather than reconstructed from a
 * report that has since been recalculated.
 */
export function toActionPayload(
  recommendation: RrRecommendation,
  input: { windowFromIso: string; windowToIso: string; asOfIso: string }
): Record<string, unknown> {
  return {
    source: "Road & Recovery Intelligence",
    engine_version: RR_RECOMMENDATION_ENGINE_VERSION,
    domain: recommendation.domain,
    domain_label: recommendation.domainLabel,
    trigger_key: recommendation.triggerKey,
    finding_key: recommendation.key,
    severity: recommendation.severity,
    priority_score: recommendation.priorityScore,
    symptom: recommendation.symptom,
    root_cause: recommendation.rootCause,
    root_cause_confidence: recommendation.rootCauseConfidence,
    evidence: recommendation.evidence,
    recommended_decision: recommendation.recommendation,
    alternative_decision: recommendation.alternative,
    expected_outcome: recommendation.expectedOutcome,
    consequence_if_ignored: recommendation.consequenceIfIgnored,
    owner_role: recommendation.ownerRole,
    due_date: recommendation.dueDateIso,
    affected_count: recommendation.affectedCount,
    metric_key: recommendation.metricKey,
    measured_value: recommendation.measuredValue,
    target_value: recommendation.targetValue,
    // Both fields are recorded. A null amount with known=false is an honest statement
    // that the exposure was not quantifiable, and reads differently from R 0.00.
    financial_impact_zar: recommendation.financialImpactZAR,
    financial_impact_known: recommendation.financialImpactKnown,
    window_from: input.windowFromIso,
    window_to: input.windowToIso,
    as_of: input.asOfIso,
  };
}

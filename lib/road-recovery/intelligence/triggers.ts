/**
 * VYRON CORE — Road & Recovery workflow triggers (Phase 6).
 *
 * PURE. This is the bridge between Road & Recovery intelligence and the EXISTING VYRON
 * workflow orchestration engine. It does not create a second action system: every trigger
 * here is added to the existing `WORKFLOW_TRIGGERS` vocabulary, and every recommendation
 * ends up in `workforce_automation_actions` through the automation engine that already
 * prepares, approves, executes and measures workforce actions.
 *
 * Every trigger declares four things, and a trigger that cannot declare all four does not
 * belong here:
 *
 *   FACT        — the column(s) that produce it. No trigger fires on a guess.
 *   CONDITION   — the deterministic test, stated in words a manager can check.
 *   SEVERITY    — how hard it escalates, which drives priority ordering.
 *   PATH        — what should happen next, and who owns it.
 *
 * Speculative triggers are deliberately absent. There is no "driver fatigue" trigger,
 * because nothing in Road & Recovery records hours of service; inventing one would produce
 * confident recommendations built on data that does not exist.
 */

import type { WorkflowTrigger } from "@/lib/workflow-orchestration-engine";
import type { RrIntelligenceDomain, RrSeverity } from "./types";

/** The stable internal key for each Road & Recovery trigger. */
export const RR_TRIGGER_KEYS = [
  "rr_dispatch_delay",
  "rr_arrival_delay",
  "rr_storage_ageing",
  "rr_billing_blocked",
  "rr_distance_dispute",
  "rr_authorisation_delay",
  "rr_exception_critical",
  "rr_fleet_capacity_risk",
] as const;

export type RrTriggerKey = (typeof RR_TRIGGER_KEYS)[number];

export type RrTriggerDefinition = {
  key: RrTriggerKey;
  /**
   * The label stored in workforce_automation_actions.trigger_type.
   *
   * Title Case, matching the vocabulary the existing triggers already use ("Late Arrival",
   * "Payroll Blocked"). The `rr_` key stays internal so the operator-facing pipeline reads
   * as one list of operational triggers rather than two naming conventions.
   */
  trigger: WorkflowTrigger;
  domain: RrIntelligenceDomain;
  /** The metric whose breach raises this trigger, when there is one. */
  metricKey: string | null;
  /** WHERE THE FACT COMES FROM. */
  fact: string;
  /** THE DETERMINISTIC TEST. */
  condition: string;
  /** Baseline severity. A measured critical band escalates it. */
  severity: RrSeverity;
  /** WHAT SHOULD HAPPEN NEXT. */
  recommendationPath: string;
  /** Who owns the outcome. */
  ownerRole: string;
  /** The executable action type prepared in workforce_automation_actions. */
  actionType: string;
};

export const RR_TRIGGER_CATALOGUE: readonly RrTriggerDefinition[] = [
  {
    key: "rr_dispatch_delay",
    trigger: "Dispatch Delay",
    domain: "dispatch",
    metricKey: "dispatch_time_to_assign_minutes",
    fact: "rr_service_state_events (entry to the dispatch_pool state) and rr_dispatch_assignments.offered_at",
    condition:
      "Average time from a job becoming dispatchable to the first offer breaches the configured target for the service code. Fires only when a target is configured.",
    severity: "high",
    recommendationPath:
      "Escalate the affected jobs to the controller on duty, re-offer to the next ranked candidate, and review whether the dispatch pool had eligible capacity at the time.",
    ownerRole: "Dispatch Controller",
    actionType: "Escalate Dispatch",
  },
  {
    key: "rr_arrival_delay",
    trigger: "Arrival Delay",
    domain: "tow_operations",
    metricKey: "response_time_to_scene_minutes",
    fact: "rr_service_state_events: the travel-role state entry through to the arrival-role state entry",
    condition:
      "Average response time to scene breaches the configured target. Measured only on jobs that actually arrived; jobs still travelling are excluded rather than counted as late.",
    severity: "high",
    recommendationPath:
      "Review the affected jobs for distance, truck class and acceptance delay, brief the drivers concerned, and check whether the depot covering that area has capacity at that time of day.",
    ownerRole: "Operations Manager",
    actionType: "Escalate Dispatch",
  },
  {
    key: "rr_storage_ageing",
    trigger: "Storage Ageing",
    domain: "storage",
    metricKey: "storage_ageing_over_30_days_count",
    fact: "rr_storage_bookings.checked_in_at for occupancies still open, aged against the as-of instant",
    condition:
      "Vehicles have occupied a bay beyond the configured ageing target without being released or disposed of.",
    severity: "medium",
    recommendationPath:
      "Chase release or disposal authority for each aged vehicle, confirm the storage charge is accruing against a live rate, and escalate vehicles that already hold verified authority but have not been collected.",
    ownerRole: "Yard Manager",
    actionType: "Schedule Vehicle Release",
  },
  {
    key: "rr_billing_blocked",
    trigger: "Billing Blocked",
    domain: "billing_readiness",
    metricKey: "billing_blocked_count",
    fact: "rr_billing_exceptions with resolution_status open, and rr_charge_calculations.status",
    condition:
      "Finished jobs cannot be handed to VYRON FINANCE because evidence, a rate or an authorisation is missing.",
    severity: "high",
    recommendationPath:
      "Work the open billing exceptions per job: capture the missing evidence, resolve the rate conflict, or obtain the authorisation. VYRON CORE prepares the information; VYRON FINANCE issues the invoice.",
    ownerRole: "Billing Administrator",
    actionType: "Request Billing Information",
  },
  {
    key: "rr_distance_dispute",
    trigger: "Distance Dispute",
    domain: "distance",
    metricKey: "distance_variance_pct_avg",
    fact: "rr_billable_facts.source_detail odometer readings compared with rr_dispatch_candidates.distance_km, plus rr_billing_disputes of type distance",
    condition:
      "Captured distance diverges from the dispatch estimate beyond the configured variance target, or a counterparty has formally disputed a distance.",
    severity: "medium",
    recommendationPath:
      "Review the odometer capture and GPS trail for the affected jobs. The original driver reading is never overwritten; if it is wrong, a replacement fact is recorded and the original is retired with a reason.",
    ownerRole: "Billing Administrator",
    actionType: "Review Distance Capture",
  },
  {
    key: "rr_authorisation_delay",
    trigger: "Authorisation Delay",
    domain: "authorisation",
    metricKey: "authorisation_delay_minutes",
    fact: "rr_service_jobs.created_at compared with rr_authorisations.authorised_at, and jobs requiring authorisation with no active authority",
    condition:
      "Authorisation is taking longer than the configured target, or jobs that require authorisation are running without one.",
    severity: "high",
    recommendationPath:
      "Chase the counterparty for the outstanding authorisation numbers, confirm the after-hours contact is current, and flag any job already worked without authority so the commercial exposure is visible before it becomes a dispute.",
    ownerRole: "Operations Manager",
    actionType: "Request Authorisation",
  },
  {
    key: "rr_exception_critical",
    trigger: "Critical Exception",
    domain: "exceptions",
    metricKey: "exception_critical_open_count",
    fact: "rr_job_exceptions and rr_billing_exceptions with severity critical and resolution_status open",
    condition:
      "One or more critical exceptions are open. This trigger fires on the FACT of a critical exception and does not require a configured target, because a critical exception is already a judgement the operation recorded.",
    severity: "critical",
    recommendationPath:
      "Assign an owner to each open critical exception, set a due date, and escalate through the existing exception escalation path. Exceptions already carrying an automation action are not re-raised.",
    ownerRole: "Operations Manager",
    actionType: "Escalate Exception",
  },
  {
    key: "rr_fleet_capacity_risk",
    trigger: "Fleet Capacity Risk",
    domain: "fleet",
    metricKey: "fleet_out_of_service_pct",
    fact: "rr_tow_truck_profiles.operational_status and availability_status, plus rr_driver_certifications that block dispatch",
    condition:
      "Trucks out of service, or drivers blocked from dispatch, have pushed available capacity past the configured target.",
    severity: "high",
    recommendationPath:
      "Confirm the return-to-service date for each truck out of commission, renew the certifications blocking drivers, and check whether the remaining classes can still cover the work the area normally takes.",
    ownerRole: "Fleet Manager",
    actionType: "Review Fleet Capacity",
  },
] as const;

const BY_KEY = new Map(RR_TRIGGER_CATALOGUE.map((entry) => [entry.key, entry]));
const BY_METRIC = new Map(
  RR_TRIGGER_CATALOGUE.filter((entry) => entry.metricKey !== null).map((entry) => [
    entry.metricKey as string,
    entry,
  ])
);

export function triggerDefinition(key: RrTriggerKey): RrTriggerDefinition | null {
  return BY_KEY.get(key) ?? null;
}

/** The trigger a breached metric raises, or null when the metric has no trigger path. */
export function triggerForMetric(metricKey: string): RrTriggerDefinition | null {
  return BY_METRIC.get(metricKey) ?? null;
}

/** The trigger labels Phase 6 adds to the shared WORKFLOW_TRIGGERS vocabulary. */
export const RR_TRIGGER_LABELS: readonly string[] = RR_TRIGGER_CATALOGUE.map((entry) => entry.trigger);

/** The action types Phase 6 adds to the shared AUTOMATION_ACTION_TYPES vocabulary. */
export const RR_ACTION_TYPES: readonly string[] = [
  "Escalate Dispatch",
  "Schedule Vehicle Release",
  "Request Authorisation",
  "Request Billing Information",
  "Review Distance Capture",
  "Review Fleet Capacity",
] as const;

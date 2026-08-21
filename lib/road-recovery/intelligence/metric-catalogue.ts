/**
 * VYRON CORE — Road & Recovery metric catalogue (Phase 6).
 *
 * The closed vocabulary of every metric Road & Recovery intelligence can measure, and the
 * weight each one carries in the vertical health score.
 *
 * This file is DATA, following the same separation the requirement catalogue and the rate
 * card catalogue already use. It is the single source of truth for the metric_key CHECK
 * constraint in sql/081 — a static test parses the migration back and compares, so the
 * database vocabulary and the engine vocabulary cannot drift apart.
 *
 * Every metric here is backed by a column that actually exists. Nothing is aspirational.
 */

import type { RrIntelligenceDomain, RrMetricDirection } from "./types";

export type RrMetricDefinition = {
  key: string;
  label: string;
  domain: RrIntelligenceDomain;
  unit: string;
  direction: RrMetricDirection;
  /**
   * Weight in the Road & Recovery health score. Zero means the metric is reported but
   * never scored: volume and revenue are business facts, not performance defects.
   */
  healthWeight: number;
  /** Which real columns produce it. Documentation that survives refactoring. */
  source: string;
  /** Whether a tenant may configure a target per service code / per counterparty. */
  scopes: { serviceCode: boolean; counterparty: boolean };
};

function m(
  key: string,
  label: string,
  domain: RrIntelligenceDomain,
  unit: string,
  direction: RrMetricDirection,
  healthWeight: number,
  source: string,
  scopes: { serviceCode?: boolean; counterparty?: boolean } = {}
): RrMetricDefinition {
  return {
    key,
    label,
    domain,
    unit,
    direction,
    healthWeight,
    source,
    scopes: { serviceCode: scopes.serviceCode ?? false, counterparty: scopes.counterparty ?? false },
  };
}

export const RR_METRIC_CATALOGUE: readonly RrMetricDefinition[] = [
  // ---------------------------------------------------------------- Dispatch
  m("dispatch_time_to_assign_minutes", "Time to first offer", "dispatch", "minutes", "lower_is_better", 8,
    "rr_service_state_events (dispatch_pool entry) -> rr_dispatch_assignments.offered_at",
    { serviceCode: true, counterparty: true }),
  m("dispatch_time_to_accept_minutes", "Time to accept", "dispatch", "minutes", "lower_is_better", 6,
    "rr_dispatch_assignments.offered_at -> responded_at where assignment_status = accepted",
    { serviceCode: true }),
  m("dispatch_acceptance_rate_pct", "First-offer acceptance rate", "dispatch", "%", "higher_is_better", 6,
    "rr_dispatch_assignments.assignment_status accepted vs declined"),
  m("dispatch_reassignment_rate_pct", "Reassignment rate", "dispatch", "%", "lower_is_better", 5,
    "rr_dispatch_assignments.sequence_number > 1 per service_job_id"),

  // --------------------------------------------------------- Tow operations
  m("response_time_to_scene_minutes", "Response time to scene", "tow_operations", "minutes", "lower_is_better", 10,
    "rr_service_state_events: travel role entry -> arrival role entry",
    { serviceCode: true, counterparty: true }),
  m("time_on_scene_minutes", "Time on scene", "tow_operations", "minutes", "lower_is_better", 5,
    "rr_service_state_events.seconds_in_previous_state for the arrival-role state",
    { serviceCode: true }),
  m("job_cycle_time_hours", "Job cycle time", "tow_operations", "hours", "lower_is_better", 5,
    "rr_service_jobs.created_at -> terminal rr_service_state_events.occurred_at",
    { serviceCode: true }),
  m("job_completion_rate_pct", "Completion rate", "tow_operations", "%", "higher_is_better", 6,
    "rr_service_state_events terminal state kind: completed vs cancelled",
    { serviceCode: true }),

  // ----------------------------------------------------------------- BYSTAND
  // BYSTAND is structurally separate. These metrics read the SEALED standby summary and
  // the BYSTAND detail row only; no BYSTAND job is ever counted as a tow.
  m("bystand_time_to_scene_minutes", "BYSTAND time to scene", "bystand", "minutes", "lower_is_better", 5,
    "rr_standby_summary.time_to_scene_seconds (sealed)"),
  m("bystand_stand_down_response_minutes", "Stand-down response time", "bystand", "minutes", "lower_is_better", 4,
    "rr_standby_summary.stand_down_response_seconds (sealed)"),
  m("bystand_standing_hours_avg", "Average standing time", "bystand", "hours", "informational", 0,
    "rr_standby_summary.total_billable_seconds (sealed)"),
  m("bystand_paused_ratio_pct", "Paused share of attendance", "bystand", "%", "lower_is_better", 3,
    "rr_standby_summary.total_paused_seconds vs total_billable_seconds (sealed)"),

  // ----------------------------------------------------------------- Storage
  m("storage_ageing_over_30_days_count", "Vehicles held over 30 days", "storage", "vehicles", "lower_is_better", 6,
    "rr_storage_bookings.checked_in_at where status is open"),
  m("storage_release_delay_days_avg", "Release delay after authority", "storage", "days", "lower_is_better", 5,
    "rr_release_authorisations.issued_at -> rr_storage_bookings.checked_out_at"),
  m("storage_occupancy_days_avg", "Average occupancy", "storage", "days", "informational", 0,
    "rr_storage_accrual.elapsed_days (sealed)"),
  m("storage_free_day_leakage_days", "Free days applied", "storage", "days", "informational", 0,
    "rr_storage_accrual.free_days_applied (sealed)"),

  // ------------------------------------------------------------------- Fleet
  m("fleet_utilisation_pct", "Fleet utilisation", "fleet", "%", "higher_is_better", 6,
    "rr_tow_truck_profiles vs rr_dispatch_assignments in window"),
  m("fleet_out_of_service_pct", "Out of service", "fleet", "%", "lower_is_better", 5,
    "rr_tow_truck_profiles.operational_status"),
  m("fleet_available_capacity_pct", "Available capacity", "fleet", "%", "higher_is_better", 4,
    "rr_tow_truck_profiles.availability_status"),
  m("fleet_jobs_per_truck", "Jobs per truck", "fleet", "jobs", "informational", 0,
    "rr_dispatch_assignments grouped by field_vehicle_id"),

  // ------------------------------------------------------------------ Driver
  m("driver_acceptance_rate_pct", "Driver acceptance rate", "driver", "%", "higher_is_better", 4,
    "rr_dispatch_assignments grouped by employee_id"),
  m("driver_certification_expiry_30d_count", "Certifications expiring in 30 days", "driver", "drivers", "lower_is_better", 5,
    "rr_driver_certifications.expires_at"),
  m("driver_dispatch_blocked_count", "Drivers blocked from dispatch", "driver", "drivers", "lower_is_better", 6,
    "rr_driver_certifications where blocks_dispatch and status is not valid"),
  m("driver_jobs_per_driver", "Jobs per driver", "driver", "jobs", "informational", 0,
    "rr_dispatch_assignments grouped by employee_id"),

  // ------------------------------------------------------------ Counterparty
  m("counterparty_authorisation_rate_pct", "Authorisation rate", "counterparty", "%", "higher_is_better", 5,
    "rr_authorisations vs rr_service_jobs requiring authorisation", { counterparty: true }),
  m("counterparty_dispute_rate_pct", "Dispute rate", "counterparty", "%", "lower_is_better", 5,
    "rr_billing_disputes grouped by counterparty", { counterparty: true }),
  m("counterparty_billing_block_rate_pct", "Billing block rate", "counterparty", "%", "lower_is_better", 4,
    "rr_billing_exceptions open, grouped by counterparty", { counterparty: true }),
  m("counterparty_job_volume", "Job volume", "counterparty", "jobs", "informational", 0,
    "rr_authorisations grouped by counterparty_id", { counterparty: true }),

  // ----------------------------------------------------------- Authorisation
  m("authorisation_delay_minutes", "Authorisation delay", "authorisation", "minutes", "lower_is_better", 5,
    "rr_service_jobs.created_at -> rr_authorisations.authorised_at", { counterparty: true }),
  m("authorisation_missing_count", "Jobs missing authorisation", "authorisation", "jobs", "lower_is_better", 7,
    "rr_service_jobs requiring authorisation with no active rr_authorisations row"),
  m("authorisation_expired_count", "Expired authorisations", "authorisation", "jobs", "lower_is_better", 5,
    "rr_authorisations.expires_at against the as-of instant"),
  m("authorisation_exceeded_count", "Authorised amount exceeded", "authorisation", "jobs", "lower_is_better", 6,
    "rr_charge_calculations.total_incl_vat vs rr_authorisations.authorised_amount"),

  // ------------------------------------------------------- Billing readiness
  m("billing_ready_rate_pct", "Billing-ready rate", "billing_readiness", "%", "higher_is_better", 8,
    "rr_charge_calculations.status vs completed jobs", { counterparty: true }),
  m("billing_blocked_count", "Jobs blocked from billing", "billing_readiness", "jobs", "lower_is_better", 7,
    "rr_billing_exceptions with resolution_status open"),
  m("billing_days_to_ready_avg", "Days to billing ready", "billing_readiness", "days", "lower_is_better", 5,
    "job terminal event -> rr_charge_calculations.calculated_at"),
  m("billing_unrated_fact_count", "Unrated billable facts", "billing_readiness", "facts", "lower_is_better", 4,
    "rr_charge_calculations.unrated_facts"),

  // ---------------------------------------------------------------- Distance
  m("distance_variance_pct_avg", "Odometer vs estimate variance", "distance", "%", "lower_is_better", 5,
    "rr_billable_facts.source_detail odometer readings vs rr_dispatch_candidates.distance_km"),
  m("distance_dispute_count", "Distance disputes", "distance", "disputes", "lower_is_better", 5,
    "rr_billing_disputes.dispute_type"),
  m("distance_missing_capture_count", "Missing distance capture", "distance", "jobs", "lower_is_better", 5,
    "tow jobs with no tow_distance rr_billable_facts row"),
  m("distance_gps_unavailable_count", "GPS unavailable", "distance", "jobs", "lower_is_better", 3,
    "rr_job_exceptions.exception_code = gps_unavailable"),

  // -------------------------------------------------------------- Exceptions
  m("exception_open_count", "Open exceptions", "exceptions", "exceptions", "lower_is_better", 5,
    "rr_job_exceptions + rr_billing_exceptions with resolution_status open"),
  m("exception_critical_open_count", "Open critical exceptions", "exceptions", "exceptions", "lower_is_better", 9,
    "rr_job_exceptions + rr_billing_exceptions severity critical, open"),
  m("exception_avg_resolution_hours", "Average time to resolve", "exceptions", "hours", "lower_is_better", 4,
    "created_at -> resolved_at on both exception tables"),
  m("exception_recurrence_rate_pct", "Recurring exception rate", "exceptions", "%", "lower_is_better", 4,
    "exception_code seen on more than one job in the window"),

  // ----------------------------------------------------------- Profitability
  m("profitability_margin_pct_avg", "Average job margin", "profitability", "%", "higher_is_better", 7,
    "rr_job_margin view: expected charge vs field_job_costs. NULL when cost is absent."),
  m("profitability_negative_margin_count", "Jobs below cost", "profitability", "jobs", "lower_is_better", 6,
    "rr_job_margin view where margin is negative"),
  m("profitability_cost_coverage_pct", "Cost data coverage", "profitability", "%", "higher_is_better", 4,
    "jobs with a field_job_costs row vs all completed jobs"),
  m("profitability_expected_revenue_zar", "Expected revenue", "profitability", "ZAR", "informational", 0,
    "rr_charge_calculations.total_incl_vat (expected, never an invoice)"),
] as const;

export const RR_METRIC_KEYS: readonly string[] = RR_METRIC_CATALOGUE.map((entry) => entry.key);

const BY_KEY = new Map(RR_METRIC_CATALOGUE.map((entry) => [entry.key, entry]));

export function metricDefinition(key: string): RrMetricDefinition | null {
  return BY_KEY.get(key) ?? null;
}

export function metricsForDomain(domain: RrIntelligenceDomain): RrMetricDefinition[] {
  return RR_METRIC_CATALOGUE.filter((entry) => entry.domain === domain);
}

/** Metrics that carry health weight. Informational metrics are deliberately excluded. */
export function scoredMetrics(): RrMetricDefinition[] {
  return RR_METRIC_CATALOGUE.filter((entry) => entry.healthWeight > 0);
}

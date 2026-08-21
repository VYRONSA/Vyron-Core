-- 081-road-recovery-intelligence.sql
-- VYRON CORE — Road & Recovery Phase 6: Executive & Operations Intelligence.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
--
-- It creates NO fact tables. Every one of the fifteen Road & Recovery intelligence
-- domains is computed from facts Phases 0-5 already record: state transitions, dispatch
-- offers, sealed standby summaries, sealed storage accruals, sealed charge calculations,
-- exceptions and disputes. Copying those into an intelligence schema would create a second
-- version of the truth that drifts the first time a backfill is run.
--
-- It creates NO action table, NO outcome table and NO root-cause table. Road & Recovery is
-- a VERTICAL: its recommendations enter public.workforce_automation_actions through the
-- orchestration and automation engines that already exist, and are measured by the
-- outcome columns sql/048 already added.
--
-- It creates NO finance object. No invoice, no payment, no debtor, no ledger. Those belong
-- to VYRON FINANCE.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DOES CREATE
-- ---------------------------------------------------------------------------
--
--   1. public.rr_intelligence_thresholds — the ONE new table. Tenant-configurable
--      operational targets, versioned so a historical result can be replayed against the
--      target that was in force when it was measured.
--
--   2. Three read-only aggregate views, so a dashboard does not pull thousands of raw
--      rows into the application to count them.
--
--   3. A correctness fix to public.rr_job_margin (see section 5).
--
-- ---------------------------------------------------------------------------
-- NO SLA CONFIGURED
-- ---------------------------------------------------------------------------
--
-- This is NOT a generic SLA platform. It is Road & Recovery operational target
-- configuration, and its most important property is what happens when it is EMPTY: the
-- intelligence engines report NO SLA CONFIGURED and exclude the metric from scoring. They
-- do not fall back to an industry default or to a target inferred from the tenant's own
-- history. An invented target produces invented breaches, and a manager who acts on an
-- invented breach is being misled by their own system.
--
-- ---------------------------------------------------------------------------
-- SECURITY_INVOKER IS NOT OPTIONAL
-- ---------------------------------------------------------------------------
--
-- A PostgreSQL view runs with its OWNER's privileges by default, so row level security on
-- the underlying tables is evaluated as the owner and every tenant reads every other
-- tenant's rows. Phase 5 runtime validation caught exactly that on rr_job_margin. Every
-- view here is created WITH (security_invoker = true) and is verified both statically and
-- against a live cluster with two tenants.
--
-- Idempotent and safe to re-run. Requires sql/030, sql/070, sql/071, sql/072, sql/077,
-- sql/079 and sql/080.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/081.';
  END IF;
  IF to_regclass('public.rr_service_state_events') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_state_events. Run sql/070 before sql/081.';
  END IF;
  IF to_regclass('public.rr_dispatch_assignments') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_dispatch_assignments. Run sql/071 before sql/081.';
  END IF;
  IF to_regclass('public.rr_storage_bookings') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_storage_bookings. Run sql/077 before sql/081.';
  END IF;
  IF to_regclass('public.rr_job_margin') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_job_margin. Run sql/080 before sql/081.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_intelligence_thresholds
-- ---------------------------------------------------------------------------
--
-- One row is one VERSION of one target. Versions are never edited: retiring a target sets
-- effective_to and active, and a new target is a new row with a higher version. That is
-- what makes a March result reproducible in December — replaying it resolves March's
-- version even though April replaced it.
--
-- A target may be narrowed to a service code, to a counterparty, or to both. Specificity
-- beats recency at resolution time: a deliberate target for "accident recovery for
-- Insurer A" is not overridden by a newer company-wide default.
CREATE TABLE IF NOT EXISTS public.rr_intelligence_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  metric_key text NOT NULL,

  -- NULL means "applies to every service code / every counterparty". A wildcard, not a
  -- missing value, which is what lets a default and a narrow override coexist.
  service_code text,
  counterparty_id uuid,

  target_value numeric(14, 4) NOT NULL,
  warning_value numeric(14, 4),
  critical_value numeric(14, 4),
  unit text NOT NULL,

  severity text NOT NULL DEFAULT 'medium',

  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,

  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_by text,
  retired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Cross-tenant defence beyond RLS: a counterparty from another company cannot be
  -- referenced even if a policy were somehow bypassed.
  CONSTRAINT rr_intelligence_thresholds_counterparty_fk
    FOREIGN KEY (company_id, counterparty_id)
    REFERENCES public.rr_counterparties (company_id, id)
    ON DELETE CASCADE,

  -- The metric vocabulary is closed and generated from
  -- lib/road-recovery/intelligence/metric-catalogue.ts. A static test parses this list
  -- back out and compares it to the catalogue, so the database and the engine cannot
  -- drift apart and a target can never be configured for a metric nothing measures.
  CONSTRAINT rr_intelligence_thresholds_metric_key_check CHECK (
    metric_key IN (
      'dispatch_time_to_assign_minutes',
      'dispatch_time_to_accept_minutes',
      'dispatch_acceptance_rate_pct',
      'dispatch_reassignment_rate_pct',
      'response_time_to_scene_minutes',
      'time_on_scene_minutes',
      'job_cycle_time_hours',
      'job_completion_rate_pct',
      'bystand_time_to_scene_minutes',
      'bystand_stand_down_response_minutes',
      'bystand_standing_hours_avg',
      'bystand_paused_ratio_pct',
      'storage_ageing_over_30_days_count',
      'storage_release_delay_days_avg',
      'storage_occupancy_days_avg',
      'storage_free_day_leakage_days',
      'fleet_utilisation_pct',
      'fleet_out_of_service_pct',
      'fleet_available_capacity_pct',
      'fleet_jobs_per_truck',
      'driver_acceptance_rate_pct',
      'driver_certification_expiry_30d_count',
      'driver_dispatch_blocked_count',
      'driver_jobs_per_driver',
      'counterparty_authorisation_rate_pct',
      'counterparty_dispute_rate_pct',
      'counterparty_billing_block_rate_pct',
      'counterparty_job_volume',
      'authorisation_delay_minutes',
      'authorisation_missing_count',
      'authorisation_expired_count',
      'authorisation_exceeded_count',
      'billing_ready_rate_pct',
      'billing_blocked_count',
      'billing_days_to_ready_avg',
      'billing_unrated_fact_count',
      'distance_variance_pct_avg',
      'distance_dispute_count',
      'distance_missing_capture_count',
      'distance_gps_unavailable_count',
      'exception_open_count',
      'exception_critical_open_count',
      'exception_avg_resolution_hours',
      'exception_recurrence_rate_pct',
      'profitability_margin_pct_avg',
      'profitability_negative_margin_count',
      'profitability_cost_coverage_pct',
      'profitability_expected_revenue_zar'
    )
  ),

  CONSTRAINT rr_intelligence_thresholds_severity_check CHECK (
    severity IN ('low', 'medium', 'high', 'critical')
  ),

  CONSTRAINT rr_intelligence_thresholds_version_check CHECK (version >= 1),

  CONSTRAINT rr_intelligence_thresholds_window_check CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),

  -- A retired version must say who retired it and when, so "why did this target change"
  -- has an answer.
  CONSTRAINT rr_intelligence_thresholds_retirement_recorded CHECK (
    active = true OR (retired_at IS NOT NULL AND retired_by IS NOT NULL)
  ),

  -- Warning and critical rails must sit on the correct side of each other. Which side
  -- depends on the metric direction, which the engine owns, so this only enforces that
  -- the two rails are not equal when both are supplied — a degenerate configuration that
  -- would make banding meaningless.
  CONSTRAINT rr_intelligence_thresholds_rails_distinct CHECK (
    warning_value IS NULL OR critical_value IS NULL OR warning_value <> critical_value
  )
);

-- Only ONE active version of a given target scope at a time. Retire before you replace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_thresholds_active_scope
  ON public.rr_intelligence_thresholds (
    company_id,
    metric_key,
    COALESCE(service_code, ''),
    COALESCE(counterparty_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_thresholds_version
  ON public.rr_intelligence_thresholds (
    company_id,
    metric_key,
    COALESCE(service_code, ''),
    COALESCE(counterparty_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );

CREATE INDEX IF NOT EXISTS idx_rr_thresholds_lookup
  ON public.rr_intelligence_thresholds (company_id, metric_key, effective_from DESC);

COMMENT ON TABLE public.rr_intelligence_thresholds IS
  'Road & Recovery operational target configuration. Versioned so historical results replay against the target in force when they were measured. Empty means NO SLA CONFIGURED: no target is ever invented. Not a generic SLA platform.';

-- ---------------------------------------------------------------------------
-- 2. Threshold immutability
-- ---------------------------------------------------------------------------
--
-- A published target is the basis of every breach measured against it. Editing one would
-- silently rewrite history: last month's "critical" would become "on target" with no
-- record that the goalposts moved. Only RETIREMENT is permitted, and the trigger is bound
-- to the TABLE rather than granted per role, so it binds service_role too.
CREATE OR REPLACE FUNCTION public.rr_intelligence_thresholds_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'rr_intelligence_thresholds is not deletable. A target is retired (active = false, effective_to, retired_by, retired_at), never destroyed, so a historical measurement can always be replayed against the target it was judged by.';
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.metric_key IS DISTINCT FROM OLD.metric_key
     OR NEW.service_code IS DISTINCT FROM OLD.service_code
     OR NEW.counterparty_id IS DISTINCT FROM OLD.counterparty_id
     OR NEW.target_value IS DISTINCT FROM OLD.target_value
     OR NEW.warning_value IS DISTINCT FROM OLD.warning_value
     OR NEW.critical_value IS DISTINCT FROM OLD.critical_value
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION
      'rr_intelligence_thresholds version % of % is immutable. Retire it and publish a new version instead of editing the target a past measurement was judged against.',
      OLD.version, OLD.metric_key;
  END IF;

  -- A retired target stays retired. Re-activating one would resurrect a target that
  -- measurements have already been recorded against under a successor.
  IF OLD.active = false AND NEW.active = true THEN
    RAISE EXCEPTION
      'rr_intelligence_thresholds version % of % has been retired and cannot be reactivated. Publish a new version.',
      OLD.version, OLD.metric_key;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS rr_intelligence_thresholds_guard ON public.rr_intelligence_thresholds;
CREATE TRIGGER rr_intelligence_thresholds_guard
  BEFORE UPDATE OR DELETE ON public.rr_intelligence_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.rr_intelligence_thresholds_guard();

-- ---------------------------------------------------------------------------
-- 3. rr_job_timing — per-job operational clock
-- ---------------------------------------------------------------------------
--
-- One row per service job with the instants that matter, resolved from the append-only
-- transition log. Aggregating in the database means a month of jobs does not have to be
-- shipped into the application to be counted.
--
-- Note what is NOT here: no duration is stored. The instants are exposed and the pure
-- engines derive durations from them, so there is exactly one implementation of "how long
-- did this take" and it is the one covered by unit tests.
CREATE OR REPLACE VIEW public.rr_job_timing
WITH (security_invoker = true) AS
SELECT
  j.company_id,
  j.id AS service_job_id,
  j.workflow_key,
  j.workflow_version,
  j.service_state,
  j.counterparty_id,
  t.service_code,
  j.created_at,
  j.incident_at,

  -- Role-resolved milestones. The role names live in the workflow definition, so this
  -- reads the definition rather than hardcoding state names that differ per service.
  (SELECT MIN(e.occurred_at) FROM public.rr_service_state_events e
    WHERE e.company_id = j.company_id AND e.service_job_id = j.id
      AND e.to_state = w.travel_state) AS travel_started_at,
  (SELECT MIN(e.occurred_at) FROM public.rr_service_state_events e
    WHERE e.company_id = j.company_id AND e.service_job_id = j.id
      AND e.to_state = w.arrival_state) AS arrived_at,
  (SELECT MIN(e.occurred_at) FROM public.rr_service_state_events e
    WHERE e.company_id = j.company_id AND e.service_job_id = j.id
      AND e.to_state = w.pool_state) AS dispatchable_at,

  -- Seconds on scene, read from what the transition RECORDED rather than recomputed.
  (SELECT e.seconds_in_previous_state FROM public.rr_service_state_events e
    WHERE e.company_id = j.company_id AND e.service_job_id = j.id
      AND e.from_state = w.arrival_state
    ORDER BY e.occurred_at ASC LIMIT 1) AS seconds_on_scene,

  (SELECT MIN(a.offered_at) FROM public.rr_dispatch_assignments a
    WHERE a.company_id = j.company_id AND a.service_job_id = j.id) AS first_offered_at,
  (SELECT MIN(a.responded_at) FROM public.rr_dispatch_assignments a
    WHERE a.company_id = j.company_id AND a.service_job_id = j.id
      AND a.assignment_status IN ('accepted', 'completed')) AS accepted_at,
  (SELECT COUNT(*) FROM public.rr_dispatch_assignments a
    WHERE a.company_id = j.company_id AND a.service_job_id = j.id) AS offer_count,
  (SELECT MAX(a.sequence_number) FROM public.rr_dispatch_assignments a
    WHERE a.company_id = j.company_id AND a.service_job_id = j.id) AS max_offer_sequence,

  -- Terminal state and when it was reached. NULL for a job still running, which is what
  -- keeps an in-flight job out of every completed-work average.
  te.to_state AS terminal_state,
  te.occurred_at AS finished_at,

  -- BYSTAND is flagged, never filtered away here. Callers separate the two populations
  -- explicitly, and the intelligence layer asserts that they did.
  (j.workflow_key = 'bystand') AS is_bystand
FROM public.rr_service_jobs j
LEFT JOIN public.rr_service_types t
  ON t.id = j.service_type_id AND t.company_id = j.company_id
LEFT JOIN LATERAL (
  SELECT
    (SELECT s.value ->> 'state'
       FROM public.rr_workflow_definitions d,
            LATERAL jsonb_array_elements(d.definition -> 'states') s
      WHERE d.company_id = j.company_id
        AND d.workflow_key = j.workflow_key
        AND d.version = j.workflow_version
        AND s.value -> 'roles' ? 'travel'
      LIMIT 1) AS travel_state,
    (SELECT s.value ->> 'state'
       FROM public.rr_workflow_definitions d,
            LATERAL jsonb_array_elements(d.definition -> 'states') s
      WHERE d.company_id = j.company_id
        AND d.workflow_key = j.workflow_key
        AND d.version = j.workflow_version
        AND s.value -> 'roles' ? 'arrival'
      LIMIT 1) AS arrival_state,
    (SELECT s.value ->> 'state'
       FROM public.rr_workflow_definitions d,
            LATERAL jsonb_array_elements(d.definition -> 'states') s
      WHERE d.company_id = j.company_id
        AND d.workflow_key = j.workflow_key
        AND d.version = j.workflow_version
        AND s.value -> 'roles' ? 'dispatch_pool'
      LIMIT 1) AS pool_state
) w ON true
LEFT JOIN LATERAL (
  SELECT e.to_state, e.occurred_at
    FROM public.rr_service_state_events e
    JOIN public.rr_workflow_definitions d
      ON d.company_id = e.company_id
     AND d.workflow_key = e.workflow_key
     AND d.version = e.workflow_version
   WHERE e.company_id = j.company_id
     AND e.service_job_id = j.id
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(d.definition -> 'states') s
        WHERE s.value ->> 'state' = e.to_state
          AND s.value ->> 'kind' = 'terminal'
     )
   ORDER BY e.occurred_at ASC
   LIMIT 1
) te ON true
WHERE j.record_status = 'active';

COMMENT ON VIEW public.rr_job_timing IS
  'Per-job operational milestones resolved from the append-only transition log via workflow state ROLES. Exposes instants, not durations: the pure timing engine owns the arithmetic so there is one implementation of it.';

-- ---------------------------------------------------------------------------
-- 4. rr_dispatch_performance and rr_storage_position
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.rr_dispatch_performance
WITH (security_invoker = true) AS
SELECT
  a.company_id,
  a.service_job_id,
  a.id AS assignment_id,
  a.employee_id,
  a.field_vehicle_id,
  a.assignment_status,
  a.sequence_number,
  a.offered_at,
  a.responded_at,
  a.decline_reason,
  j.workflow_key,
  t.service_code,
  j.counterparty_id,
  (j.workflow_key = 'bystand') AS is_bystand
FROM public.rr_dispatch_assignments a
JOIN public.rr_service_jobs j
  ON j.id = a.service_job_id AND j.company_id = a.company_id
LEFT JOIN public.rr_service_types t
  ON t.id = j.service_type_id AND t.company_id = j.company_id
WHERE j.record_status = 'active';

COMMENT ON VIEW public.rr_dispatch_performance IS
  'Dispatch offers joined to their job context (service code, counterparty, BYSTAND flag) so dispatch intelligence reads one bounded result set instead of three.';

-- Occupancy joined to its SEALED accrual. The accrual is read, never recomputed: the
-- storage clock was settled once under a recorded calculator version and a customer has
-- already been quoted against it.
CREATE OR REPLACE VIEW public.rr_storage_position
WITH (security_invoker = true) AS
SELECT
  b.company_id,
  b.id AS booking_id,
  b.service_job_id,
  b.yard_id,
  y.name AS yard_name,
  b.status,
  b.checked_in_at,
  b.checked_out_at,
  b.free_days,
  b.rate_amount,
  b.currency,
  j.vehicle_registration,
  acc.sealed_elapsed_days,
  acc.sealed_chargeable_days,
  acc.sealed_free_days_applied,
  acc.sealed_amount,
  acc.calculator_version,
  (SELECT MIN(r.issued_at) FROM public.rr_release_authorisations r
    WHERE r.company_id = b.company_id
      AND r.service_job_id = b.service_job_id
      AND r.authority_type = 'release'
      AND r.status = 'active') AS release_authority_issued_at,
  (SELECT MIN(r.verified_at) FROM public.rr_release_authorisations r
    WHERE r.company_id = b.company_id
      AND r.service_job_id = b.service_job_id
      AND r.authority_type = 'release'
      AND r.status = 'active') AS release_authority_verified_at
FROM public.rr_storage_bookings b
JOIN public.rr_service_jobs j
  ON j.id = b.service_job_id AND j.company_id = b.company_id
LEFT JOIN public.rr_custody_yards y
  ON y.id = b.yard_id AND y.company_id = b.company_id
LEFT JOIN LATERAL (
  SELECT
    s.elapsed_days AS sealed_elapsed_days,
    s.chargeable_days AS sealed_chargeable_days,
    s.free_days_applied AS sealed_free_days_applied,
    s.amount AS sealed_amount,
    s.calculator_version
  FROM public.rr_storage_accrual s
  WHERE s.company_id = b.company_id AND s.booking_id = b.id
  ORDER BY s.sealed_at DESC
  LIMIT 1
) acc ON true;

COMMENT ON VIEW public.rr_storage_position IS
  'Storage occupancy with its latest SEALED accrual and release authority instants. Sealed values are read, never recomputed: the storage clock was settled once and quoted against.';

-- ---------------------------------------------------------------------------
-- 5. rr_job_margin — correctness fix
-- ---------------------------------------------------------------------------
--
-- DEFECT FOUND IN PHASE 5, FIXED HERE.
--
-- The Phase 5 view coalesced a missing cost to zero:
--
--     COALESCE(jc.total_cost, 0) AS direct_cost
--     COALESCE(lc.subtotal_ex_vat, 0) - COALESCE(jc.total_cost, 0) AS gross_margin
--
-- A job with NO cost record therefore reported R0.00 of cost, a gross margin equal to the
-- full revenue, and a margin_pct of 100. The migration's own comment stated the intended
-- behaviour correctly — "margin simply reads as unknown rather than as pure profit" — but
-- the SQL did the opposite. The billing REPORT layer worked around it by treating
-- direct_cost > 0 as the test for cost data; the Billing Pack did not, and passed a
-- fabricated 100% margin into the information handed to VYRON FINANCE.
--
-- Missing cost is UNKNOWN, not zero. Cost columns are now NULL when nothing was captured,
-- margin is NULL when cost is NULL, and has_cost_data states plainly which it is. A branch
-- that has not captured costs now reads as "not measurable" instead of as the most
-- profitable branch in the business.
--
-- CREATE OR REPLACE VIEW keeps the existing columns, names, types and order and appends
-- has_cost_data at the end, which is the only shape change PostgreSQL permits in place.
DO $margin$
DECLARE
  cost_source text;
BEGIN
  IF to_regclass('public.field_job_costs') IS NULL THEN
    RAISE NOTICE
      'public.field_job_costs is absent (Field Cost Intelligence not installed). rr_job_margin reports revenue with cost and margin NULL, never zero.';
    cost_source := '
      SELECT NULL::uuid AS company_id, NULL::uuid AS job_id,
             NULL::numeric AS total_cost, NULL::numeric AS labour_cost, NULL::numeric AS travel_cost
      WHERE false';
  ELSE
    cost_source := '
      SELECT fc.company_id, fc.job_id,
             SUM(fc.total_cost) AS total_cost,
             SUM(fc.labour_cost) AS labour_cost,
             SUM(fc.travel_cost) AS travel_cost
        FROM public.field_job_costs fc
       GROUP BY fc.company_id, fc.job_id';
  END IF;

  EXECUTE replace($view$
CREATE OR REPLACE VIEW public.rr_job_margin
WITH (security_invoker = true) AS
WITH latest_calculation AS (
  SELECT DISTINCT ON (c.company_id, c.service_job_id)
    c.company_id,
    c.service_job_id,
    c.id AS calculation_id,
    c.status,
    c.subtotal_ex_vat,
    c.total_incl_vat,
    c.currency,
    c.rate_policy_key,
    c.rate_version,
    c.calculated_at
  FROM public.rr_charge_calculations c
  ORDER BY c.company_id, c.service_job_id, c.calculated_at DESC
),
job_cost AS (__COST_SOURCE__)
SELECT
  j.company_id,
  j.id AS service_job_id,
  j.field_job_id,
  j.workflow_key,
  j.counterparty_id,
  j.service_state,
  t.service_code,
  lc.calculation_id,
  lc.status AS calculation_status,
  COALESCE(lc.subtotal_ex_vat, 0) AS expected_revenue_ex_vat,
  COALESCE(lc.total_incl_vat, 0) AS expected_revenue_incl_vat,
  lc.currency,
  lc.rate_policy_key,
  lc.rate_version,
  lc.calculated_at,
  -- NULL, not zero. A job with no captured cost has an UNKNOWN cost.
  jc.total_cost AS direct_cost,
  jc.labour_cost AS labour_cost,
  jc.travel_cost AS travel_cost,
  -- Margin is only meaningful when cost is known. Revenue minus an unknown is unknown.
  CASE
    WHEN jc.total_cost IS NULL THEN NULL
    ELSE COALESCE(lc.subtotal_ex_vat, 0) - jc.total_cost
  END AS gross_margin,
  CASE
    WHEN jc.total_cost IS NULL THEN NULL
    WHEN COALESCE(lc.subtotal_ex_vat, 0) > 0
      THEN ROUND(((COALESCE(lc.subtotal_ex_vat, 0) - jc.total_cost) / lc.subtotal_ex_vat) * 100, 2)
    ELSE NULL
  END AS margin_pct,
  -- Operational unit economics. NULL rather than zero when the divisor is unknown, so a
  -- missing fact never reads as "we earned nothing per kilometre".
  (SELECT f.quantity FROM public.rr_billable_facts f
    WHERE f.company_id = j.company_id AND f.service_job_id = j.id
      AND f.fact_code = 'tow_distance' AND f.status <> 'superseded'
    ORDER BY f.recorded_at DESC LIMIT 1) AS billable_distance_km,
  (SELECT f.quantity FROM public.rr_billable_facts f
    WHERE f.company_id = j.company_id AND f.service_job_id = j.id
      AND f.fact_code = 'standing_time' AND f.status <> 'superseded'
    ORDER BY f.recorded_at DESC LIMIT 1) AS billable_standing_hours,
  (SELECT f.quantity FROM public.rr_billable_facts f
    WHERE f.company_id = j.company_id AND f.service_job_id = j.id
      AND f.fact_code = 'storage_days' AND f.status <> 'superseded'
    ORDER BY f.recorded_at DESC LIMIT 1) AS billable_storage_days,
  -- Appended in sql/081. States plainly whether margin could be measured at all, so no
  -- consumer has to infer it from "cost is greater than zero" ever again.
  (jc.total_cost IS NOT NULL) AS has_cost_data
FROM public.rr_service_jobs j
LEFT JOIN public.rr_service_types t
  ON t.id = j.service_type_id AND t.company_id = j.company_id
LEFT JOIN latest_calculation lc
  ON lc.company_id = j.company_id AND lc.service_job_id = j.id
LEFT JOIN job_cost jc
  ON jc.company_id = j.company_id AND jc.job_id = j.field_job_id
WHERE j.record_status = 'active'
  $view$, '__COST_SOURCE__', cost_source);
END
$margin$;

COMMENT ON VIEW public.rr_job_margin IS
  'Operations intelligence: expected Road & Recovery revenue from the latest sealed charge calculation, against direct cost from the EXISTING field cost intelligence. Cost and margin are NULL when no cost was captured, never zero. A view, so it can never drift from its sources. Not a ledger, not accounting.';

-- ---------------------------------------------------------------------------
-- 6. Shared vocabulary extensions (workforce_automation_actions)
-- ---------------------------------------------------------------------------
--
-- Road & Recovery recommendations enter the EXISTING action pipeline, which means the
-- EXISTING CHECK constraints have to recognise them. Without these extensions every
-- prepared Road & Recovery action would be rejected by the database, so this is the
-- minimum change that makes the "no second action system" decision actually work.
--
-- Purely ADDITIVE. Every existing value is preserved; nothing is removed or renamed, so
-- no workforce action written before this migration becomes invalid.
--
-- Three vocabularies are extended:
--
--   action_type    — six Road & Recovery action types with no existing equivalent.
--                    Critical exceptions reuse the existing "Escalate Exception".
--
--   trigger_type   — the eight Road & Recovery operational triggers.
--
--   pipeline_stage — "Triggered" and "Completed". These are NOT new: both have always
--                    been in WORKFLOW_PIPELINE_STAGES, and orchestrateWorkflow() returns
--                    "Triggered" for a freshly prepared action. The sql/048 CHECK omitted
--                    them, so preparing an action as a DRAFT rather than submitting it
--                    straight to the queue would have failed on a constraint violation.
--                    Found while wiring Phase 6 into the pipeline; fixed here.
DO $vocabulary$
BEGIN
  IF to_regclass('public.workforce_automation_actions') IS NULL THEN
    RAISE NOTICE
      'public.workforce_automation_actions is absent (sql/022 not run). Road & Recovery recommendations cannot be prepared as actions until it exists.';
    RETURN;
  END IF;

  -- TWO constraints have historically restricted action_type, under two different names:
  -- sql/022 created workforce_automation_actions_type_check, and sql/048 added
  -- workforce_automation_actions_action_type_check WITHOUT dropping the first. Both are
  -- still enforced, so extending only the newer name leaves the older one silently
  -- rejecting every new action type. Runtime validation caught exactly that. Both names
  -- are dropped here and replaced by ONE constraint, so there is a single answer to
  -- "which action types are allowed".
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_type_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      DROP CONSTRAINT workforce_automation_actions_type_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_action_type_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      DROP CONSTRAINT workforce_automation_actions_action_type_check;
  END IF;

  ALTER TABLE public.workforce_automation_actions
    ADD CONSTRAINT workforce_automation_actions_action_type_check
    CHECK (
      action_type IN (
        -- Workforce (sql/022, sql/048) — unchanged.
        'Create Warning',
        'Create HR Case',
        'Approve Leave',
        'Reject Leave',
        'Assign Employee',
        'Move Employee',
        'Create Roster Change',
        'Create Field Job',
        'Escalate Exception',
        'Mark Payroll Item For Review',
        -- Road & Recovery (sql/081).
        'Escalate Dispatch',
        'Schedule Vehicle Release',
        'Request Authorisation',
        'Request Billing Information',
        'Review Distance Capture',
        'Review Fleet Capacity'
      )
    );

  -- trigger_type and pipeline_stage were added by sql/048. A project that ran sql/022 but
  -- not sql/048 has the table without those columns, and constraining a column that does
  -- not exist is an error rather than a no-op. Each vocabulary is therefore guarded by the
  -- presence of its own column.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workforce_automation_actions'
      AND column_name = 'trigger_type'
  ) THEN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_trigger_type_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      DROP CONSTRAINT workforce_automation_actions_trigger_type_check;
  END IF;

  ALTER TABLE public.workforce_automation_actions
    ADD CONSTRAINT workforce_automation_actions_trigger_type_check
    CHECK (
      trigger_type IS NULL OR trigger_type IN (
        -- Workforce (sql/048) — unchanged.
        'Late Arrival',
        'Absence Alert',
        'Overtime Spike',
        'Leave Conflict',
        'Compliance Failure',
        'Payroll Blocked',
        'Roster Changed',
        'Clocking Breach',
        'Task Overdue',
        'Exception Escalated',
        'Warning Issued',
        'HR Case Created',
        'Leave Approved',
        'Leave Rejected',
        'Employee Updated',
        'Employee Transferred',
        'Workforce Intelligence Alert',
        -- Road & Recovery (sql/081). Each is backed by a recorded fact and a
        -- deterministic condition declared in lib/road-recovery/intelligence/triggers.ts.
        'Dispatch Delay',
        'Arrival Delay',
        'Storage Ageing',
        'Billing Blocked',
        'Distance Dispute',
        'Authorisation Delay',
        'Critical Exception',
        'Fleet Capacity Risk'
      )
    )
    NOT VALID;
  ELSE
    RAISE NOTICE
      'public.workforce_automation_actions has no trigger_type column (sql/048 not run). Road & Recovery triggers cannot be recorded on an action until it is.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workforce_automation_actions'
      AND column_name = 'pipeline_stage'
  ) THEN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_pipeline_stage_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      DROP CONSTRAINT workforce_automation_actions_pipeline_stage_check;
  END IF;

  ALTER TABLE public.workforce_automation_actions
    ADD CONSTRAINT workforce_automation_actions_pipeline_stage_check
    CHECK (
      pipeline_stage IS NULL OR pipeline_stage IN (
        'Detected',
        'Triggered',
        'Prepared',
        'Assigned',
        'Awaiting Approval',
        'Approved',
        'In Progress',
        'Completed',
        'Verified',
        'Closed',
        'Cancelled'
      )
    )
    NOT VALID;
  ELSE
    RAISE NOTICE
      'public.workforce_automation_actions has no pipeline_stage column (sql/048 not run).';
  END IF;
END
$vocabulary$;

-- ---------------------------------------------------------------------------
-- 7. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_intelligence_thresholds ENABLE ROW LEVEL SECURITY;

DO $tenant$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). rr_intelligence_thresholds has RLS enabled with NO policy, which denies all access until sql/030 and then sql/081 are run.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS rr_intelligence_thresholds_tenant_isolation
    ON public.rr_intelligence_thresholds;
  CREATE POLICY rr_intelligence_thresholds_tenant_isolation
    ON public.rr_intelligence_thresholds
    FOR ALL TO authenticated
    USING (
      public.vyron_is_platform_operator()
      OR EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() as c(company_id)
        WHERE c.company_id::text = public.rr_intelligence_thresholds.company_id::text
      )
    )
    WITH CHECK (
      public.vyron_is_platform_operator()
      OR EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() as c(company_id)
        WHERE c.company_id::text = public.rr_intelligence_thresholds.company_id::text
      )
    );
END
$tenant$;

REVOKE ALL ON public.rr_intelligence_thresholds FROM anon;
REVOKE ALL ON public.rr_job_timing FROM anon;
REVOKE ALL ON public.rr_dispatch_performance FROM anon;
REVOKE ALL ON public.rr_storage_position FROM anon;

-- NON-DELETABLE. UPDATE is granted ONLY so a target can be retired; the trigger above
-- refuses any change to what the target actually says. Grants, RLS and the trigger all
-- express the same intent, and sql/049 registers this table in the matching branch so a
-- later run cannot widen it back.
GRANT SELECT, INSERT, UPDATE ON public.rr_intelligence_thresholds TO authenticated;
REVOKE DELETE, TRUNCATE ON public.rr_intelligence_thresholds FROM authenticated;

-- All three views are security_invoker, so the tenant policies on their underlying tables
-- apply to whoever queries them. Without that option these GRANTs would expose every
-- tenant's operational history.
GRANT SELECT ON public.rr_job_timing TO authenticated;
GRANT SELECT ON public.rr_dispatch_performance TO authenticated;
GRANT SELECT ON public.rr_storage_position TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

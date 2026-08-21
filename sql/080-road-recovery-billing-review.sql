-- 080-road-recovery-billing-review.sql
-- VYRON CORE — Road & Recovery Phase 5, step 3: billing exceptions, disputes and margin.
--
-- ---------------------------------------------------------------------------
-- PRODUCT BOUNDARY
-- ---------------------------------------------------------------------------
--
-- These are OPERATIONAL review records, not accounting ones. A billing exception is a
-- reason a job is not ready to be invoiced. A billing dispute is a record that someone
-- challenged a quantity or a rate. Neither is a credit note, and resolving a dispute here
-- never issues one — that belongs to VYRON FINANCE.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE EXCEPTION TABLE
-- ---------------------------------------------------------------------------
--
-- public.rr_job_exceptions (sql/073) carries a CHECK-constrained vocabulary of sixteen
-- OPERATIONAL codes and no billing concepts. Widening that CHECK would modify approved
-- Phase 3 architecture, so billing gets its own table with its own vocabulary. Escalation
-- routes into the EXISTING workforce_automation_actions / approvals pipeline exactly as
-- Phases 3 and 4 do — there is no second action engine.
--
-- ---------------------------------------------------------------------------
-- DISPUTES NEVER OVERWRITE
-- ---------------------------------------------------------------------------
--
-- A dispute records the original value, the disputed value, who said so and why. The
-- original fact and the original sealed calculation both survive untouched. A resolution
-- that changes a quantity does so by superseding the FACT, which re-seals a NEW
-- calculation — the old one stays readable next to the information it justified.
--
-- Idempotent and safe to re-run. Requires sql/070, sql/078 and sql/079.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_billable_facts') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_billable_facts. Run sql/079 before sql/080.';
  END IF;
  IF to_regclass('public.rr_charge_calculations') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_charge_calculations. Run sql/079 before sql/080.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_billing_exceptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_billing_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  exception_code text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  detail text,

  /** What the exception is about, when it is about one specific thing. */
  fact_code text,
  charge_code text,

  detected_by text NOT NULL DEFAULT 'system',
  detected_by_actor text,
  detected_at timestamptz NOT NULL DEFAULT now(),

  resolution_status text NOT NULL DEFAULT 'open',
  resolution_action text,
  resolution_notes text,
  resolved_by text,
  resolved_at timestamptz,

  /** Set when this exception was routed into the EXISTING automation pipeline. */
  automation_action_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_billing_exceptions_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_billing_exceptions_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_billing_exceptions_code_check CHECK (
    exception_code IN (
      'missing_rate','expired_rate','conflicting_rate','missing_distance','disputed_distance',
      'missing_authorisation','expired_authorisation','authorisation_exceeded',
      'missing_evidence','storage_overrun','unapproved_additional_service',
      'missing_cancellation_reason','missing_counterparty','duplicate_charge',
      'incomplete_billing_information'
    )
  ),
  CONSTRAINT rr_billing_exceptions_severity_check CHECK (
    severity IN ('low','medium','high','critical')
  ),
  CONSTRAINT rr_billing_exceptions_detected_by_check CHECK (
    detected_by IN ('system','controller','billing_admin','counterparty')
  ),
  CONSTRAINT rr_billing_exceptions_resolution_check CHECK (
    resolution_status IN ('open','acknowledged','resolved','waived','cancelled')
  ),
  CONSTRAINT rr_billing_exceptions_resolution_recorded CHECK (
    resolution_status NOT IN ('resolved','waived')
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_billing_exceptions_job
  ON public.rr_billing_exceptions (company_id, service_job_id, resolution_status);

CREATE INDEX IF NOT EXISTS idx_rr_billing_exceptions_open
  ON public.rr_billing_exceptions (company_id, severity, detected_at DESC)
  WHERE resolution_status IN ('open','acknowledged');

COMMENT ON TABLE public.rr_billing_exceptions IS
  'Operational reasons a Road & Recovery job is not ready to be invoiced. Separate from rr_job_exceptions (sql/073), whose vocabulary is operational and CHECK-constrained. Escalation reuses workforce_automation_actions; there is no second action engine.';

-- ---------------------------------------------------------------------------
-- 2. rr_billing_disputes — APPEND-ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_billing_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  dispute_type text NOT NULL,
  /** The fact or line being challenged. Both survive the dispute untouched. */
  fact_id uuid,
  charge_line_id uuid,

  -- --- What was recorded, and what is claimed instead ------------------------
  original_quantity numeric(14, 3),
  disputed_quantity numeric(14, 3),
  original_amount numeric(14, 2),
  disputed_amount numeric(14, 2),
  unit text,

  raised_by text NOT NULL,
  raised_by_party text NOT NULL DEFAULT 'controller',
  reason text NOT NULL,
  evidence_id uuid REFERENCES public.mobile_workforce_evidence (id) ON DELETE SET NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),

  -- --- Review outcome --------------------------------------------------------
  --
  -- A review NEVER edits the original. If a corrected quantity is accepted, the service
  -- layer records a NEW fact that supersedes the original and re-seals the calculation.
  status text NOT NULL DEFAULT 'open',
  decision text,
  reviewed_quantity numeric(14, 3),
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  /** The replacement fact, when the review produced one. */
  replacement_fact_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_billing_disputes_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_billing_disputes_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_billing_disputes_fact_fk
    FOREIGN KEY (company_id, fact_id)
    REFERENCES public.rr_billable_facts (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_billing_disputes_line_fk
    FOREIGN KEY (company_id, charge_line_id)
    REFERENCES public.rr_charge_lines (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_billing_disputes_replacement_fk
    FOREIGN KEY (company_id, replacement_fact_id)
    REFERENCES public.rr_billable_facts (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_billing_disputes_type_check CHECK (
    dispute_type IN (
      'distance','waiting_time','standing_time','storage_days','additional_service',
      'rate','authorisation','evidence','cancellation'
    )
  ),
  CONSTRAINT rr_billing_disputes_party_check CHECK (
    raised_by_party IN ('controller','billing_admin','counterparty','customer','driver')
  ),
  CONSTRAINT rr_billing_disputes_status_check CHECK (
    status IN ('open','under_review','upheld','rejected','withdrawn')
  ),
  CONSTRAINT rr_billing_disputes_decision_check CHECK (
    decision IS NULL OR decision IN ('original_stands','reviewed_value_accepted','split','referred')
  ),
  -- A concluded dispute must name who concluded it and when.
  CONSTRAINT rr_billing_disputes_review_recorded CHECK (
    status NOT IN ('upheld','rejected')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND decision IS NOT NULL)
  ),
  -- A dispute must be about something.
  CONSTRAINT rr_billing_disputes_target_present CHECK (
    fact_id IS NOT NULL OR charge_line_id IS NOT NULL
  ),
  CONSTRAINT rr_billing_disputes_reason_present CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_rr_billing_disputes_job
  ON public.rr_billing_disputes (company_id, service_job_id, status);

COMMENT ON TABLE public.rr_billing_disputes IS
  'APPEND-ONLY record that a quantity or rate was challenged. The original fact and the original sealed calculation are never overwritten: an accepted correction supersedes the FACT and re-seals a NEW calculation, so the driver''s original reading and the information already shown both survive.';

CREATE OR REPLACE FUNCTION public.rr_billing_disputes_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'public.rr_billing_disputes is append-only: DELETE is not permitted.';
  END IF;

  -- Only the REVIEW outcome may be written. What was originally claimed is frozen.
  IF NEW.dispute_type IS DISTINCT FROM OLD.dispute_type
     OR NEW.fact_id IS DISTINCT FROM OLD.fact_id
     OR NEW.charge_line_id IS DISTINCT FROM OLD.charge_line_id
     OR NEW.original_quantity IS DISTINCT FROM OLD.original_quantity
     OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
     OR NEW.disputed_quantity IS DISTINCT FROM OLD.disputed_quantity
     OR NEW.disputed_amount IS DISTINCT FROM OLD.disputed_amount
     OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
     OR NEW.raised_by_party IS DISTINCT FROM OLD.raised_by_party
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.raised_at IS DISTINCT FROM OLD.raised_at
     OR NEW.service_job_id IS DISTINCT FROM OLD.service_job_id THEN
    RAISE EXCEPTION
      'public.rr_billing_disputes is append-only: what was originally claimed cannot be altered. Only the review outcome may be recorded.';
  END IF;

  RETURN NEW;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_billing_disputes_append_only ON public.rr_billing_disputes;

CREATE TRIGGER rr_billing_disputes_append_only
  BEFORE UPDATE OR DELETE ON public.rr_billing_disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_billing_disputes_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. rr_job_margin — a DERIVED VIEW, never a stored table
-- ---------------------------------------------------------------------------
--
-- Operations intelligence, not accounting. Expected revenue comes from the LATEST sealed
-- calculation; direct cost comes from the EXISTING field cost intelligence
-- (public.field_job_costs, sql/033). No cost data is invented and no ledger is created.
--
-- A view rather than a table on purpose: it can never drift from its sources.
--
-- SECURITY_INVOKER IS NOT OPTIONAL. A PostgreSQL view runs with its OWNER's privileges by
-- default, so row level security on the underlying tables would be evaluated as the owner
-- and every tenant would read every other tenant's margin. Runtime validation caught
-- exactly that. With security_invoker the view is evaluated as the querying user and the
-- tenant policies apply normally.
DO $margin$
DECLARE
  cost_source text;
BEGIN
  -- public.field_job_costs belongs to Field Cost Intelligence (sql/018) and is an
  -- OPTIONAL dependency. Without it the view still exists with the same columns and
  -- reports no cost, so revenue and unit economics keep working and margin simply reads
  -- as unknown rather than as pure profit.
  IF to_regclass('public.field_job_costs') IS NULL THEN
    RAISE NOTICE
      'public.field_job_costs is absent (Field Cost Intelligence not installed). rr_job_margin will report revenue with no cost.';
    cost_source := '
      SELECT NULL::uuid AS company_id, NULL::uuid AS job_id,
             0::numeric AS total_cost, 0::numeric AS labour_cost, 0::numeric AS travel_cost
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
  COALESCE(jc.total_cost, 0) AS direct_cost,
  COALESCE(jc.labour_cost, 0) AS labour_cost,
  COALESCE(jc.travel_cost, 0) AS travel_cost,
  COALESCE(lc.subtotal_ex_vat, 0) - COALESCE(jc.total_cost, 0) AS gross_margin,
  CASE
    WHEN COALESCE(lc.subtotal_ex_vat, 0) > 0
      THEN ROUND(
        ((COALESCE(lc.subtotal_ex_vat, 0) - COALESCE(jc.total_cost, 0))
          / lc.subtotal_ex_vat) * 100, 2)
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
    ORDER BY f.recorded_at DESC LIMIT 1) AS billable_storage_days
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
  'Operations intelligence: expected Road & Recovery revenue from the latest sealed charge calculation, against direct cost from the EXISTING field cost intelligence. A view, so it can never drift from its sources. Not a ledger, not accounting.';

-- ---------------------------------------------------------------------------
-- 4. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_billing_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_billing_disputes ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 5 review tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/080 are run.';
    RETURN;
  END IF;

  FOR tbl IN SELECT unnest(ARRAY['rr_billing_exceptions', 'rr_billing_disputes'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       )',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END
$tenant$;

REVOKE ALL ON public.rr_billing_exceptions FROM anon;
REVOKE ALL ON public.rr_billing_disputes FROM anon;
REVOKE ALL ON public.rr_job_margin FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_billing_exceptions TO authenticated;

-- Append-only with a narrow update for the review outcome. See the trigger above.
GRANT SELECT, INSERT, UPDATE ON public.rr_billing_disputes TO authenticated;
REVOKE DELETE, TRUNCATE ON public.rr_billing_disputes FROM authenticated;

-- The view is security_invoker, so the tenant policies on its underlying tables apply to
-- whoever queries it. Without that option this GRANT would expose every tenant's margin.
GRANT SELECT ON public.rr_job_margin TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

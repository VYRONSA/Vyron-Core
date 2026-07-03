-- 025-payroll-intelligence.sql
-- VYRON CORE Phase 7 — Payroll Intelligence & Payroll Readiness
-- Run after field ops, cost, risk migrations

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- payroll_pay_periods
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_pay_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_payroll_pay_periods_company
  ON public.payroll_pay_periods (company_id, period_start DESC);

-- ---------------------------------------------------------------------------
-- payroll_readiness_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_readiness_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  pay_period_id uuid REFERENCES public.payroll_pay_periods (id) ON DELETE SET NULL,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  readiness_score integer NOT NULL DEFAULT 0,
  readiness_band text NOT NULL DEFAULT 'blocked',
  blocker_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, score_date),
  CONSTRAINT payroll_readiness_scores_score_check CHECK (
    readiness_score >= 0 AND readiness_score <= 100
  ),
  CONSTRAINT payroll_readiness_scores_band_check CHECK (
    readiness_band IN ('ready', 'caution', 'blocked')
  )
);

CREATE INDEX IF NOT EXISTS idx_payroll_readiness_scores_company
  ON public.payroll_readiness_scores (company_id, score_date DESC);

-- ---------------------------------------------------------------------------
-- payroll_readiness_checks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_readiness_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  pay_period_id uuid REFERENCES public.payroll_pay_periods (id) ON DELETE SET NULL,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  check_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  employee_id text,
  entity_ref text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_readiness_checks_type_check CHECK (
    check_type IN (
      'missing_clock_out',
      'missing_clock_in',
      'unapproved_leave',
      'roster_mismatch',
      'unresolved_exception',
      'open_field_job',
      'missing_end_day'
    )
  ),
  CONSTRAINT payroll_readiness_checks_severity_check CHECK (
    severity IN ('info', 'warning', 'blocker')
  )
);

CREATE INDEX IF NOT EXISTS idx_payroll_readiness_checks_company_date
  ON public.payroll_readiness_checks (company_id, score_date DESC, check_type);

-- ---------------------------------------------------------------------------
-- payroll_leakage_events (payroll intelligence layer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_leakage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  pay_period_id uuid REFERENCES public.payroll_pay_periods (id) ON DELETE SET NULL,
  leakage_date date NOT NULL DEFAULT CURRENT_DATE,
  leakage_type text NOT NULL,
  employee_id text,
  amount_zar numeric(12, 2) NOT NULL DEFAULT 0,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_leakage_events_type_check CHECK (
    leakage_type IN (
      'paid_not_worked',
      'worked_not_approved',
      'duplicate_hours',
      'overtime_without_approval',
      'travel_without_jobs'
    )
  ),
  CONSTRAINT payroll_leakage_events_severity_check CHECK (
    severity IN ('warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_payroll_leakage_events_company
  ON public.payroll_leakage_events (company_id, leakage_date DESC);

-- ---------------------------------------------------------------------------
-- payroll_forecasts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  pay_period_id uuid REFERENCES public.payroll_pay_periods (id) ON DELETE SET NULL,
  forecast_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_payroll numeric(12, 2),
  variance_pct numeric(6, 2),
  cost_drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  forecast_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_payroll_forecasts_company
  ON public.payroll_forecasts (company_id, forecast_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_pay_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_readiness_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_readiness_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_leakage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_pay_periods_all ON public.payroll_pay_periods;
DROP POLICY IF EXISTS payroll_readiness_scores_all ON public.payroll_readiness_scores;
DROP POLICY IF EXISTS payroll_readiness_checks_all ON public.payroll_readiness_checks;
DROP POLICY IF EXISTS payroll_leakage_events_all ON public.payroll_leakage_events;
DROP POLICY IF EXISTS payroll_forecasts_all ON public.payroll_forecasts;

CREATE POLICY payroll_pay_periods_all ON public.payroll_pay_periods
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY payroll_readiness_scores_all ON public.payroll_readiness_scores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY payroll_readiness_checks_all ON public.payroll_readiness_checks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY payroll_leakage_events_all ON public.payroll_leakage_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY payroll_forecasts_all ON public.payroll_forecasts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

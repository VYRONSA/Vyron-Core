-- 018-field-cost-intelligence.sql
-- VYRON CORE Phase 4C — Workforce Cost Intelligence
-- Run after sql/014-field-operations.sql and sql/017-field-travel-intelligence.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optional billing columns on field jobs (non-breaking)
ALTER TABLE public.field_jobs
  ADD COLUMN IF NOT EXISTS billable_value numeric(12, 2);

ALTER TABLE public.field_jobs
  ADD COLUMN IF NOT EXISTS estimated_labour_minutes integer;

-- ---------------------------------------------------------------------------
-- field_cost_rates — labour / travel / overtime rates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  labour_rate_per_hour numeric(12, 2) NOT NULL DEFAULT 185,
  travel_rate_per_km numeric(12, 2) NOT NULL DEFAULT 4.5,
  travel_rate_per_hour numeric(12, 2) NOT NULL DEFAULT 0,
  overtime_multiplier numeric(5, 2) NOT NULL DEFAULT 1.5,
  standard_hours_per_day numeric(5, 2) NOT NULL DEFAULT 8,
  idle_cost_factor numeric(5, 2) NOT NULL DEFAULT 1,
  currency text NOT NULL DEFAULT 'ZAR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_cost_rates_company
  ON public.field_cost_rates (company_id, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_cost_rates_company_default
  ON public.field_cost_rates (company_id, effective_from)
  WHERE employee_id IS NULL;

-- ---------------------------------------------------------------------------
-- field_job_costs — per job cost breakdown
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_job_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.field_jobs (id) ON DELETE CASCADE,
  employee_id uuid,
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  labour_seconds integer NOT NULL DEFAULT 0,
  travel_seconds integer NOT NULL DEFAULT 0,
  idle_seconds integer NOT NULL DEFAULT 0,
  overtime_seconds integer NOT NULL DEFAULT 0,
  labour_cost numeric(12, 2) NOT NULL DEFAULT 0,
  travel_cost numeric(12, 2) NOT NULL DEFAULT 0,
  idle_cost numeric(12, 2) NOT NULL DEFAULT 0,
  overtime_cost numeric(12, 2) NOT NULL DEFAULT 0,
  total_cost numeric(12, 2) NOT NULL DEFAULT 0,
  billable_value numeric(12, 2) NOT NULL DEFAULT 0,
  estimated_margin numeric(12, 2) NOT NULL DEFAULT 0,
  estimated_labour_seconds integer NOT NULL DEFAULT 0,
  site_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, job_id, cost_date, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_field_job_costs_company_date
  ON public.field_job_costs (company_id, cost_date DESC);

CREATE INDEX IF NOT EXISTS idx_field_job_costs_site
  ON public.field_job_costs (company_id, site_key, cost_date DESC);

-- ---------------------------------------------------------------------------
-- field_employee_day_costs — daily employee rollup
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_employee_day_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  labour_cost numeric(12, 2) NOT NULL DEFAULT 0,
  travel_cost numeric(12, 2) NOT NULL DEFAULT 0,
  idle_cost numeric(12, 2) NOT NULL DEFAULT 0,
  overtime_cost numeric(12, 2) NOT NULL DEFAULT 0,
  total_cost numeric(12, 2) NOT NULL DEFAULT 0,
  jobs_touched integer NOT NULL DEFAULT 0,
  billable_value numeric(12, 2) NOT NULL DEFAULT 0,
  leakage_value numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, cost_date)
);

CREATE INDEX IF NOT EXISTS idx_field_employee_day_costs_company
  ON public.field_employee_day_costs (company_id, cost_date DESC);

-- ---------------------------------------------------------------------------
-- field_leakage_events — payroll leakage incidents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_leakage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  leakage_type text NOT NULL,
  leakage_value numeric(12, 2) NOT NULL DEFAULT 0,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_leakage_events_severity_check CHECK (severity IN ('warning', 'critical')),
  CONSTRAINT field_leakage_events_type_check CHECK (
    leakage_type IN (
      'idle_leakage',
      'travel_leakage',
      'overtime_unlinked',
      'labour_overrun',
      'cost_exceeds_value',
      'low_margin'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_field_leakage_events_company_date
  ON public.field_leakage_events (company_id, cost_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_job_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_employee_day_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_leakage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_cost_rates_all ON public.field_cost_rates;
DROP POLICY IF EXISTS field_job_costs_all ON public.field_job_costs;
DROP POLICY IF EXISTS field_employee_day_costs_all ON public.field_employee_day_costs;
DROP POLICY IF EXISTS field_leakage_events_all ON public.field_leakage_events;

CREATE POLICY field_cost_rates_all ON public.field_cost_rates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_job_costs_all ON public.field_job_costs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_employee_day_costs_all ON public.field_employee_day_costs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_leakage_events_all ON public.field_leakage_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 024-workforce-digital-twin.sql
-- VYRON CORE Phase 6 — Workforce Digital Twin foundation
-- Run after field ops, cost, risk, and automation migrations

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- workforce_digital_twin_snapshots — daily operational model snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_digital_twin_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  workforce_health_pct numeric(5, 2),
  labour_cost_today numeric(12, 2),
  productivity_pct numeric(5, 2),
  risk_level text,
  predicted_leakage numeric(12, 2),
  active_employees integer NOT NULL DEFAULT 0,
  active_field_jobs integer NOT NULL DEFAULT 0,
  high_risk_employees integer NOT NULL DEFAULT 0,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  heatmap_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_workforce_digital_twin_snapshots_company
  ON public.workforce_digital_twin_snapshots (company_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- workforce_health_scores — per entity health (store, department, employee)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_label text NOT NULL DEFAULT '',
  region text,
  overall_health integer NOT NULL DEFAULT 0,
  labour_cost numeric(12, 2),
  productivity_pct numeric(5, 2),
  attendance_risk integer NOT NULL DEFAULT 0,
  overtime_risk integer NOT NULL DEFAULT 0,
  field_risk integer NOT NULL DEFAULT 0,
  employee_count integer NOT NULL DEFAULT 0,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, score_date, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_workforce_health_scores_company_date
  ON public.workforce_health_scores (company_id, score_date DESC, overall_health);

-- ---------------------------------------------------------------------------
-- workforce_forecasts — 7-day staffing / payroll / field pressure
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  forecast_date date NOT NULL DEFAULT CURRENT_DATE,
  horizon_days integer NOT NULL DEFAULT 7,
  staffing_risk_score integer,
  payroll_pressure_score integer,
  field_ops_pressure_score integer,
  predicted_shortages jsonb NOT NULL DEFAULT '[]'::jsonb,
  predicted_overstaffing jsonb NOT NULL DEFAULT '[]'::jsonb,
  forecast_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  needs_more_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, forecast_date, horizon_days)
);

-- ---------------------------------------------------------------------------
-- workforce_simulations — what-if scenario runs (non-destructive)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  simulation_date date NOT NULL DEFAULT CURRENT_DATE,
  scenario_type text NOT NULL,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_saving numeric(12, 2),
  expected_risk_change integer,
  staffing_impact text,
  confidence_level text NOT NULL DEFAULT 'medium',
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_simulations_confidence_check CHECK (
    confidence_level IN ('low', 'medium', 'high')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_simulations_company
  ON public.workforce_simulations (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- workforce_twin_insights — structured insights from existing modules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_twin_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  insight_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  detail text NOT NULL,
  source_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_twin_insights_severity_check CHECK (
    severity IN ('info', 'warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_twin_insights_company_date
  ON public.workforce_twin_insights (company_id, insight_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.workforce_digital_twin_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_twin_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_digital_twin_snapshots_all ON public.workforce_digital_twin_snapshots;
DROP POLICY IF EXISTS workforce_health_scores_all ON public.workforce_health_scores;
DROP POLICY IF EXISTS workforce_forecasts_all ON public.workforce_forecasts;
DROP POLICY IF EXISTS workforce_simulations_all ON public.workforce_simulations;
DROP POLICY IF EXISTS workforce_twin_insights_all ON public.workforce_twin_insights;

CREATE POLICY workforce_digital_twin_snapshots_all ON public.workforce_digital_twin_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_health_scores_all ON public.workforce_health_scores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_forecasts_all ON public.workforce_forecasts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_simulations_all ON public.workforce_simulations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_twin_insights_all ON public.workforce_twin_insights
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

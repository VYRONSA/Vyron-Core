-- 028-workforce-operating-system.sql
-- VYRON CORE Batch 9 — Workforce Operating System foundation
-- Note: requested filename 023 is taken by whatsapp-workforce-command.sql
-- Note: workforce_health_scores (entity-level) already exists in 024-workforce-digital-twin.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- workforce_operating_snapshots — daily executive + operational rollup
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_operating_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  executive_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  operational_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  dashboard_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_workforce_operating_snapshots_company
  ON public.workforce_operating_snapshots (company_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- workforce_operating_health_scores — company-level WOS health (0–100)
-- Entity-level scores remain in workforce_health_scores (024)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_operating_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  overall_score integer,
  health_band text,
  attendance_score integer,
  productivity_score integer,
  leave_score integer,
  risk_score integer,
  overtime_score integer,
  field_ops_score integer,
  payroll_readiness_score integer,
  category_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  needs_more_data boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, score_date),
  CONSTRAINT workforce_operating_health_scores_overall_check CHECK (
    overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)
  ),
  CONSTRAINT workforce_operating_health_scores_band_check CHECK (
    health_band IS NULL OR health_band IN ('red', 'amber', 'green')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_operating_health_scores_company
  ON public.workforce_operating_health_scores (company_id, score_date DESC);

-- ---------------------------------------------------------------------------
-- workforce_operating_insights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_operating_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  insight_date date NOT NULL DEFAULT CURRENT_DATE,
  insight_type text NOT NULL DEFAULT 'recommendation',
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  detail text NOT NULL,
  source_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_operating_insights_severity_check CHECK (
    severity IN ('info', 'warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_operating_insights_company
  ON public.workforce_operating_insights (company_id, insight_date DESC);

-- ---------------------------------------------------------------------------
-- workforce_automation_templates — library only (no auto-execution)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_automation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_name text NOT NULL,
  trigger_description text NOT NULL,
  required_approval boolean NOT NULL DEFAULT true,
  action_type text NOT NULL,
  risk_level text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'library',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, template_key),
  CONSTRAINT workforce_automation_templates_risk_check CHECK (
    risk_level IN ('low', 'medium', 'high')
  ),
  CONSTRAINT workforce_automation_templates_status_check CHECK (
    status IN ('library', 'enabled', 'disabled')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_automation_templates_company
  ON public.workforce_automation_templates (company_id, status);

-- ---------------------------------------------------------------------------
-- workforce_operating_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_operating_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_email text,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_operating_audit_log_company
  ON public.workforce_operating_audit_log (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.workforce_operating_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_operating_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_operating_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_automation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_operating_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_operating_snapshots_all ON public.workforce_operating_snapshots;
DROP POLICY IF EXISTS workforce_operating_health_scores_all ON public.workforce_operating_health_scores;
DROP POLICY IF EXISTS workforce_operating_insights_all ON public.workforce_operating_insights;
DROP POLICY IF EXISTS workforce_automation_templates_all ON public.workforce_automation_templates;
DROP POLICY IF EXISTS workforce_operating_audit_log_all ON public.workforce_operating_audit_log;

CREATE POLICY workforce_operating_snapshots_all ON public.workforce_operating_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_operating_health_scores_all ON public.workforce_operating_health_scores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_operating_insights_all ON public.workforce_operating_insights
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_automation_templates_all ON public.workforce_automation_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_operating_audit_log_all ON public.workforce_operating_audit_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

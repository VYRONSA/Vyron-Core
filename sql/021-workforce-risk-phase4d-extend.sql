-- 021-workforce-risk-phase4d-extend.sql
-- Phase 4D extensions — Field Operations Risk + recommendations table
-- Run after sql/019-workforce-risk-intelligence.sql

BEGIN;

ALTER TABLE public.workforce_risk_scores
  ADD COLUMN IF NOT EXISTS field_operations_risk integer NOT NULL DEFAULT 0;

ALTER TABLE public.workforce_risk_rules
  DROP CONSTRAINT IF EXISTS workforce_risk_rules_category_check;

ALTER TABLE public.workforce_risk_rules
  ADD CONSTRAINT workforce_risk_rules_category_check CHECK (
    category IN (
      'Attendance Risk',
      'Overtime Risk',
      'Payroll Leakage Risk',
      'Burnout Risk',
      'Resignation Risk',
      'Manager Risk',
      'Store Risk',
      'Field Operations Risk'
    )
  );

CREATE TABLE IF NOT EXISTS public.workforce_risk_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  entity_type text,
  entity_id text,
  entity_label text,
  title text NOT NULL,
  detail text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  risk_band text NOT NULL DEFAULT 'amber',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_risk_recommendations_band_check CHECK (
    risk_band IN ('green', 'amber', 'red')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_risk_recommendations_company_date
  ON public.workforce_risk_recommendations (company_id, score_date DESC);

ALTER TABLE public.workforce_risk_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_risk_recommendations_all ON public.workforce_risk_recommendations;
CREATE POLICY workforce_risk_recommendations_all ON public.workforce_risk_recommendations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.workforce_risk_rules (company_id, rule_key, category, weight, threshold_green, threshold_amber, threshold_red, config)
SELECT c.id, v.rule_key, v.category, v.weight, 39, 69, 100, '{}'::jsonb
FROM public.companies c
CROSS JOIN (
  VALUES
    ('attendance_late', 'Attendance Risk', 1.2),
    ('overtime_abuse', 'Overtime Risk', 1.0),
    ('payroll_leakage', 'Payroll Leakage Risk', 1.15),
    ('burnout_hours', 'Burnout Risk', 1.1),
    ('resignation_signals', 'Resignation Risk', 1.25),
    ('manager_team_risk', 'Manager Risk', 1.0),
    ('store_coverage', 'Store Risk', 1.0),
    ('field_ops_gps', 'Field Operations Risk', 1.1)
) AS v(rule_key, category, weight)
ON CONFLICT (company_id, rule_key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

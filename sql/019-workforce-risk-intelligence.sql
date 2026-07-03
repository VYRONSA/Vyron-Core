-- 019-workforce-risk-intelligence.sql
-- VYRON CORE Phase 4D — Workforce Risk Intelligence
-- Run after sql/014, sql/017, sql/018

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- workforce_risk_rules — weighted scoring thresholds per category
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_risk_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  category text NOT NULL,
  weight numeric(5, 2) NOT NULL DEFAULT 1,
  threshold_green integer NOT NULL DEFAULT 39,
  threshold_amber integer NOT NULL DEFAULT 69,
  threshold_red integer NOT NULL DEFAULT 100,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, rule_key),
  CONSTRAINT workforce_risk_rules_category_check CHECK (
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
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_risk_rules_company
  ON public.workforce_risk_rules (company_id, category);

-- ---------------------------------------------------------------------------
-- workforce_risk_scores — daily entity risk profile (0–100)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_label text NOT NULL DEFAULT '',
  attendance_risk integer NOT NULL DEFAULT 0,
  overtime_risk integer NOT NULL DEFAULT 0,
  payroll_leakage_risk integer NOT NULL DEFAULT 0,
  burnout_risk integer NOT NULL DEFAULT 0,
  resignation_risk integer NOT NULL DEFAULT 0,
  manager_risk integer NOT NULL DEFAULT 0,
  store_risk integer NOT NULL DEFAULT 0,
  field_operations_risk integer NOT NULL DEFAULT 0,
  overall_score integer NOT NULL DEFAULT 0,
  risk_band text NOT NULL DEFAULT 'green',
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, score_date, entity_type, entity_id),
  CONSTRAINT workforce_risk_scores_entity_type_check CHECK (
    entity_type IN ('employee', 'store', 'manager', 'company')
  ),
  CONSTRAINT workforce_risk_scores_band_check CHECK (
    risk_band IN ('green', 'amber', 'red')
  ),
  CONSTRAINT workforce_risk_scores_score_check CHECK (
    overall_score >= 0 AND overall_score <= 100
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_risk_scores_company_date
  ON public.workforce_risk_scores (company_id, score_date DESC, overall_score DESC);

CREATE INDEX IF NOT EXISTS idx_workforce_risk_scores_entity
  ON public.workforce_risk_scores (company_id, entity_type, score_date DESC);

-- ---------------------------------------------------------------------------
-- workforce_risk_events — individual risk signals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'amber',
  score integer NOT NULL DEFAULT 0,
  message text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_risk_events_severity_check CHECK (
    severity IN ('green', 'amber', 'red')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_risk_events_company_date
  ON public.workforce_risk_events (company_id, score_date DESC);

-- ---------------------------------------------------------------------------
-- workforce_risk_recommendations — AI-style action items
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.workforce_risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_risk_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_risk_rules_all ON public.workforce_risk_rules;
DROP POLICY IF EXISTS workforce_risk_scores_all ON public.workforce_risk_scores;
DROP POLICY IF EXISTS workforce_risk_events_all ON public.workforce_risk_events;
DROP POLICY IF EXISTS workforce_risk_recommendations_all ON public.workforce_risk_recommendations;

CREATE POLICY workforce_risk_rules_all ON public.workforce_risk_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_risk_scores_all ON public.workforce_risk_scores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_risk_events_all ON public.workforce_risk_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
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

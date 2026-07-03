-- 027-recruitment-intelligence.sql
-- VYRON CORE Phase 8 — Recruitment Intelligence
-- Note: requested filename 022 is taken by workforce-automation-engine.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- skills_registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skills_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  skill_key text NOT NULL,
  skill_name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, skill_key)
);

CREATE INDEX IF NOT EXISTS idx_skills_registry_company
  ON public.skills_registry (company_id, category);

-- ---------------------------------------------------------------------------
-- employee_skills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  skill_id uuid NOT NULL REFERENCES public.skills_registry (id) ON DELETE CASCADE,
  proficiency integer NOT NULL DEFAULT 50,
  certified boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, skill_id),
  CONSTRAINT employee_skills_proficiency_check CHECK (
    proficiency >= 0 AND proficiency <= 100
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_skills_company_employee
  ON public.employee_skills (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- recruitment_vacancies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruitment_vacancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  vacancy_ref text NOT NULL,
  title text NOT NULL,
  store_id uuid,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  required_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  headcount integer NOT NULL DEFAULT 1,
  salary_min numeric(12, 2),
  salary_max numeric(12, 2),
  location_label text,
  target_hire_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, vacancy_ref),
  CONSTRAINT recruitment_vacancies_status_check CHECK (
    status IN ('open', 'paused', 'filled', 'cancelled')
  ),
  CONSTRAINT recruitment_vacancies_priority_check CHECK (
    priority IN ('low', 'normal', 'high', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_recruitment_vacancies_company_status
  ON public.recruitment_vacancies (company_id, status);

-- ---------------------------------------------------------------------------
-- recruitment_applicants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruitment_applicants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.recruitment_vacancies (id) ON DELETE SET NULL,
  applicant_ref text NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  years_experience numeric(4, 1) NOT NULL DEFAULT 0,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_store_id uuid,
  expected_salary numeric(12, 2),
  status text NOT NULL DEFAULT 'applied',
  source text NOT NULL DEFAULT 'direct',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, applicant_ref),
  CONSTRAINT recruitment_applicants_status_check CHECK (
    status IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')
  )
);

CREATE INDEX IF NOT EXISTS idx_recruitment_applicants_company_vacancy
  ON public.recruitment_applicants (company_id, vacancy_id, status);

-- ---------------------------------------------------------------------------
-- recruitment_interviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruitment_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.recruitment_applicants (id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.recruitment_vacancies (id) ON DELETE SET NULL,
  interview_type text NOT NULL DEFAULT 'phone',
  scheduled_at timestamptz,
  interviewer_email text,
  status text NOT NULL DEFAULT 'scheduled',
  notes text,
  outcome text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruitment_interviews_type_check CHECK (
    interview_type IN ('phone', 'video', 'onsite', 'panel')
  ),
  CONSTRAINT recruitment_interviews_status_check CHECK (
    status IN ('scheduled', 'completed', 'cancelled', 'no_show')
  )
);

CREATE INDEX IF NOT EXISTS idx_recruitment_interviews_company
  ON public.recruitment_interviews (company_id, scheduled_at DESC);

-- ---------------------------------------------------------------------------
-- recruitment_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruitment_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.recruitment_applicants (id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.recruitment_vacancies (id) ON DELETE SET NULL,
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  experience_score integer NOT NULL DEFAULT 0,
  skills_match_score integer NOT NULL DEFAULT 0,
  location_match_score integer NOT NULL DEFAULT 0,
  salary_fit_score integer NOT NULL DEFAULT 0,
  overall_score integer NOT NULL DEFAULT 0,
  score_band text NOT NULL DEFAULT 'review',
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, applicant_id, score_date),
  CONSTRAINT recruitment_scores_overall_check CHECK (
    overall_score >= 0 AND overall_score <= 100
  ),
  CONSTRAINT recruitment_scores_band_check CHECK (
    score_band IN ('strong', 'good', 'review', 'weak')
  )
);

CREATE INDEX IF NOT EXISTS idx_recruitment_scores_company
  ON public.recruitment_scores (company_id, overall_score DESC);

-- ---------------------------------------------------------------------------
-- succession_candidates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.succession_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  target_role text NOT NULL,
  succession_type text NOT NULL,
  readiness_score integer NOT NULL DEFAULT 0,
  readiness_band text NOT NULL DEFAULT 'developing',
  vacancy_id uuid REFERENCES public.recruitment_vacancies (id) ON DELETE SET NULL,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, succession_type, analysis_date),
  CONSTRAINT succession_candidates_type_check CHECK (
    succession_type IN ('supervisor', 'manager', 'successor')
  ),
  CONSTRAINT succession_candidates_band_check CHECK (
    readiness_band IN ('ready', 'near_ready', 'developing', 'not_ready')
  )
);

CREATE INDEX IF NOT EXISTS idx_succession_candidates_company
  ON public.succession_candidates (company_id, succession_type, readiness_score DESC);

-- ---------------------------------------------------------------------------
-- workforce_gap_analysis
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_gap_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  store_id uuid,
  skill_id uuid REFERENCES public.skills_registry (id) ON DELETE SET NULL,
  gap_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  headcount_gap integer NOT NULL DEFAULT 0,
  skill_gap_count integer NOT NULL DEFAULT 0,
  message text NOT NULL,
  forecast_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_gap_analysis_type_check CHECK (
    gap_type IN ('staffing_shortage', 'missing_skill', 'high_risk_role', 'future_hire')
  ),
  CONSTRAINT workforce_gap_analysis_severity_check CHECK (
    severity IN ('info', 'warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_gap_analysis_company
  ON public.workforce_gap_analysis (company_id, analysis_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.skills_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.succession_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_gap_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skills_registry_all ON public.skills_registry;
DROP POLICY IF EXISTS employee_skills_all ON public.employee_skills;
DROP POLICY IF EXISTS recruitment_vacancies_all ON public.recruitment_vacancies;
DROP POLICY IF EXISTS recruitment_applicants_all ON public.recruitment_applicants;
DROP POLICY IF EXISTS recruitment_interviews_all ON public.recruitment_interviews;
DROP POLICY IF EXISTS recruitment_scores_all ON public.recruitment_scores;
DROP POLICY IF EXISTS succession_candidates_all ON public.succession_candidates;
DROP POLICY IF EXISTS workforce_gap_analysis_all ON public.workforce_gap_analysis;

CREATE POLICY skills_registry_all ON public.skills_registry
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY employee_skills_all ON public.employee_skills
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY recruitment_vacancies_all ON public.recruitment_vacancies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY recruitment_applicants_all ON public.recruitment_applicants
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY recruitment_interviews_all ON public.recruitment_interviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY recruitment_scores_all ON public.recruitment_scores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY succession_candidates_all ON public.succession_candidates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_gap_analysis_all ON public.workforce_gap_analysis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

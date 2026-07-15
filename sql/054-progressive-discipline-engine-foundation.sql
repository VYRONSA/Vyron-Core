-- 054-progressive-discipline-engine-foundation.sql
-- Batch 4: Progressive Discipline Intelligence Engine foundation.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.discipline_progressions') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.discipline_progressions. Run 051 first.';
  END IF;

  IF to_regclass('public.employees') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.employees.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.discipline_policy_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  config_key text NOT NULL DEFAULT 'default',
  config_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, config_key, config_version)
);

CREATE TABLE IF NOT EXISTS public.discipline_progression_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  progression_id uuid REFERENCES public.discipline_progressions (id) ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'manual_evaluation',
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_stage text,
  recommended_stage text NOT NULL,
  requires_hearing boolean NOT NULL DEFAULT false,
  requires_hr_review boolean NOT NULL DEFAULT false,
  dismissal_recommended boolean NOT NULL DEFAULT false,
  risk_level text NOT NULL DEFAULT 'low',
  confidence_score numeric(5,2) NOT NULL DEFAULT 0,
  reasoning text NOT NULL DEFAULT '',
  recommendation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discipline_policy_configs_company_id_idx
  ON public.discipline_policy_configs (company_id);
CREATE INDEX IF NOT EXISTS discipline_policy_configs_active_idx
  ON public.discipline_policy_configs (company_id, active, config_version DESC);
CREATE INDEX IF NOT EXISTS discipline_progression_decisions_company_id_idx
  ON public.discipline_progression_decisions (company_id);
CREATE INDEX IF NOT EXISTS discipline_progression_decisions_employee_id_idx
  ON public.discipline_progression_decisions (employee_id);
CREATE INDEX IF NOT EXISTS discipline_progression_decisions_created_at_idx
  ON public.discipline_progression_decisions (created_at DESC);

ALTER TABLE public.discipline_progressions ADD COLUMN IF NOT EXISTS last_evaluated_at timestamptz;
ALTER TABLE public.discipline_progressions ADD COLUMN IF NOT EXISTS last_recommendation_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.discipline_policy_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_progression_decisions ENABLE ROW LEVEL SECURITY;

DO $tenant$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE 'Tenant helper functions missing. Skipping policy creation for 054.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS discipline_policy_configs_tenant_isolation ON public.discipline_policy_configs;
  CREATE POLICY discipline_policy_configs_tenant_isolation
  ON public.discipline_policy_configs
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR EXISTS (
      SELECT 1
      FROM public.vyron_user_company_ids() as c(company_id)
      WHERE c.company_id::text = public.discipline_policy_configs.company_id::text
    )
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR EXISTS (
      SELECT 1
      FROM public.vyron_user_company_ids() as c(company_id)
      WHERE c.company_id::text = public.discipline_policy_configs.company_id::text
    )
  );

  DROP POLICY IF EXISTS discipline_progression_decisions_tenant_isolation ON public.discipline_progression_decisions;
  CREATE POLICY discipline_progression_decisions_tenant_isolation
  ON public.discipline_progression_decisions
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR EXISTS (
      SELECT 1
      FROM public.vyron_user_company_ids() as c(company_id)
      WHERE c.company_id::text = public.discipline_progression_decisions.company_id::text
    )
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR EXISTS (
      SELECT 1
      FROM public.vyron_user_company_ids() as c(company_id)
      WHERE c.company_id::text = public.discipline_progression_decisions.company_id::text
    )
  );

  REVOKE ALL ON public.discipline_policy_configs FROM anon;
  REVOKE ALL ON public.discipline_progression_decisions FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_policy_configs TO authenticated;
  GRANT SELECT, INSERT ON public.discipline_progression_decisions TO authenticated;
END
$tenant$;

COMMIT;

NOTIFY pgrst, 'reload schema';

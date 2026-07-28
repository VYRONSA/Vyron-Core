-- 062-platform-console-foundation.sql
-- Platform Console foundation: extended customer profile/licence/billing columns on
-- companies, configurable subscription_plans, solution_templates (industry presets),
-- and RLS for both new tables. Idempotent. Run after sql/061-session-security-hardening.sql.
--
-- NOTE: the platform-operator claim set here (via public.vyron_is_platform_operator(),
-- defined in sql/060) must stay in sync with lib/server/platform-operator.ts.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.companies. Run sql/001-create-companies-tables.sql first.';
  END IF;
  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run sql/050 and sql/060 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. subscription_plans — configurable tiers (no hard-coded pricing in app code)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  monthly_price numeric NOT NULL DEFAULT 0,
  annual_price numeric NOT NULL DEFAULT 0,
  trial_period_days integer NOT NULL DEFAULT 14,
  employee_limit integer,
  storage_limit_gb integer,
  ai_credit_limit integer,
  api_request_limit integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. solution_templates — industry presets (default plan + additive modules)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solution_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  default_plan_id uuid REFERENCES public.subscription_plans (id) ON DELETE SET NULL,
  default_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. companies — extended customer profile / licence / billing columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS company_size text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS time_zone text DEFAULT 'Africa/Johannesburg',
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_region text,
  ADD COLUMN IF NOT EXISTS address_postal_code text,
  ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS solution_template_id uuid,
  ADD COLUMN IF NOT EXISTS employee_limit integer,
  ADD COLUMN IF NOT EXISTS user_limit integer,
  ADD COLUMN IF NOT EXISTS storage_limit_gb integer,
  ADD COLUMN IF NOT EXISTS ai_credit_limit integer,
  ADD COLUMN IF NOT EXISTS api_request_limit integer,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS licence_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_frequency text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS renewal_date date,
  ADD COLUMN IF NOT EXISTS invoice_reference text,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS customer_status text NOT NULL DEFAULT 'trial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_customer_status_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_customer_status_check
      CHECK (customer_status IN ('trial', 'active', 'suspended', 'cancelled', 'expired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_billing_frequency_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_billing_frequency_check
      CHECK (billing_frequency IN ('monthly', 'annual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_payment_status_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_payment_status_check
      CHECK (payment_status IN ('current', 'overdue', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_plan_id_fkey'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.subscription_plans (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_solution_template_id_fkey'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_solution_template_id_fkey
      FOREIGN KEY (solution_template_id) REFERENCES public.solution_templates (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_customer_status ON public.companies (customer_status);
CREATE INDEX IF NOT EXISTS idx_companies_plan_id ON public.companies (plan_id);

-- Backfill: existing rows predate customer_status — align with their legacy status/
-- subscription_status so nobody already active gets accidentally treated as 'trial'.
UPDATE public.companies
SET customer_status = 'active'
WHERE customer_status = 'trial'
  AND (
    lower(coalesce(status, '')) IN ('active')
    OR lower(coalesce(subscription_status, '')) IN ('active')
  );

-- ---------------------------------------------------------------------------
-- 4. RLS — subscription_plans / solution_templates
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solution_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plans_read ON public.subscription_plans;
CREATE POLICY subscription_plans_read ON public.subscription_plans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS subscription_plans_write ON public.subscription_plans;
CREATE POLICY subscription_plans_write ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.vyron_is_platform_operator())
  WITH CHECK (public.vyron_is_platform_operator());

DROP POLICY IF EXISTS solution_templates_read ON public.solution_templates;
CREATE POLICY solution_templates_read ON public.solution_templates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS solution_templates_write ON public.solution_templates;
CREATE POLICY solution_templates_write ON public.solution_templates
  FOR ALL TO authenticated
  USING (public.vyron_is_platform_operator())
  WITH CHECK (public.vyron_is_platform_operator());

GRANT ALL ON public.subscription_plans TO authenticated;
GRANT ALL ON public.solution_templates TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seed: subscription_plans (Starter / Professional / Enterprise)
-- ---------------------------------------------------------------------------
INSERT INTO public.subscription_plans (
  code, name, description, modules, monthly_price, annual_price, trial_period_days,
  employee_limit, storage_limit_gb, ai_credit_limit, api_request_limit, sort_order
)
VALUES
  (
    'starter', 'Starter', 'Core essentials for small businesses.',
    '["dashboard","employees","leave","clocking"]'::jsonb,
    1499, 14990, 14, 50, 10, 0, 0, 1
  ),
  (
    'professional', 'Professional', 'Starter plus performance, discipline, and document intelligence.',
    '["dashboard","employees","leave","clocking","performance","discipline","hearings","contracts","ai_copilot","documents","reports"]'::jsonb,
    4999, 49990, 14, 250, 50, 500, 5000, 2
  ),
  (
    'enterprise', 'Enterprise', 'Full workforce, payroll, and route intelligence suite.',
    '["dashboard","employees","leave","clocking","performance","discipline","hearings","contracts","ai_copilot","documents","reports","workforce_intelligence","ai_intelligence","recruitment","payroll_intelligence","profitability_intelligence","digital_twin","route_intelligence","vehicle_intelligence","mobile_workforce","client_portal","api_access"]'::jsonb,
    0, 0, 14, NULL, 200, 5000, 100000, 3
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  modules = EXCLUDED.modules,
  monthly_price = EXCLUDED.monthly_price,
  annual_price = EXCLUDED.annual_price,
  trial_period_days = EXCLUDED.trial_period_days,
  employee_limit = EXCLUDED.employee_limit,
  storage_limit_gb = EXCLUDED.storage_limit_gb,
  ai_credit_limit = EXCLUDED.ai_credit_limit,
  api_request_limit = EXCLUDED.api_request_limit,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 6. Seed: solution_templates (10 industries)
-- ---------------------------------------------------------------------------
INSERT INTO public.solution_templates (code, name, description, default_plan_id, default_modules)
SELECT v.code, v.name, v.description,
       (SELECT id FROM public.subscription_plans WHERE code = v.plan_code),
       v.default_modules::jsonb
FROM (
  VALUES
    ('manufacturing', 'Manufacturing', 'Shift-based production workforce with compliance tracking.', 'professional', '[]'),
    ('construction', 'Construction', 'Site-based crews with contracts and field operations.', 'professional', '["route_intelligence"]'),
    ('hospitality', 'Hospitality', 'Roster-heavy, high-turnover front-of-house teams.', 'professional', '[]'),
    ('retail', 'Retail', 'Multi-site staff scheduling and performance tracking.', 'professional', '[]'),
    ('agriculture', 'Agriculture', 'Seasonal labour with mobile field operations.', 'professional', '["mobile_workforce"]'),
    ('transport_logistics', 'Transport & Logistics', 'Fleet-based operations with route and vehicle intelligence.', 'enterprise', '["route_intelligence","vehicle_intelligence","mobile_workforce"]'),
    ('security', 'Security', 'Guarding and patrol operations with route verification.', 'enterprise', '["route_intelligence","mobile_workforce"]'),
    ('healthcare', 'Healthcare', 'Shift-based clinical staff with strict compliance needs.', 'professional', '[]'),
    ('education', 'Education', 'Term-based staffing for schools and training providers.', 'professional', '[]'),
    ('towing_recovery', 'Towing & Recovery', 'Dispatch-driven mobile recovery fleet operations.', 'enterprise', '["route_intelligence","vehicle_intelligence","mobile_workforce"]')
) AS v(code, name, description, plan_code, default_modules)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  default_plan_id = EXCLUDED.default_plan_id,
  default_modules = EXCLUDED.default_modules;

COMMIT;

NOTIFY pgrst, 'reload schema';

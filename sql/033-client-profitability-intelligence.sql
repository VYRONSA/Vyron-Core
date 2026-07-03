-- 033-client-profitability-intelligence.sql
-- VYRON CORE Batch 14 — Client Billing & Job Profitability Intelligence
-- Note: user spec referenced 025 (taken). Run after sql/032-vehicle-asset-intelligence.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- client_billing_profiles — Client Register (tenant service clients)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_name text NOT NULL,
  industry text,
  billing_model text NOT NULL DEFAULT 'hourly',
  hourly_rate numeric(12, 2) DEFAULT 185,
  callout_rate numeric(12, 2) DEFAULT 450,
  travel_rate numeric(12, 2) DEFAULT 4.5,
  contract_value numeric(12, 2),
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, client_name),
  CONSTRAINT client_billing_profiles_status_check CHECK (
    status IN ('active', 'suspended', 'inactive')
  ),
  CONSTRAINT client_billing_profiles_model_check CHECK (
    billing_model IN (
      'fixed_fee', 'hourly', 'contract',
      'callout_labour', 'callout_labour_travel'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_client_billing_profiles_company
  ON public.client_billing_profiles (company_id, status);

-- Link field jobs to billing clients
ALTER TABLE public.field_jobs
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.client_billing_profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_field_jobs_client ON public.field_jobs (company_id, client_id);

-- ---------------------------------------------------------------------------
-- job_revenue — per job revenue capture
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.field_jobs (id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.client_billing_profiles (id) ON DELETE SET NULL,
  revenue_model text NOT NULL DEFAULT 'fixed_fee',
  fixed_fee numeric(12, 2),
  hourly_rate numeric(12, 2),
  callout_rate numeric(12, 2),
  labour_hours numeric(8, 2),
  travel_amount numeric(12, 2),
  contract_share numeric(12, 2),
  computed_revenue numeric(12, 2) NOT NULL DEFAULT 0,
  revenue_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, job_id, revenue_date),
  CONSTRAINT job_revenue_model_check CHECK (
    revenue_model IN (
      'fixed_fee', 'hourly', 'contract',
      'callout_labour', 'callout_labour_travel'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_job_revenue_company_date
  ON public.job_revenue (company_id, revenue_date DESC);

-- ---------------------------------------------------------------------------
-- job_profitability — per job profit snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_profitability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.field_jobs (id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.client_billing_profiles (id) ON DELETE SET NULL,
  employee_id uuid,
  site_key text,
  profit_date date NOT NULL DEFAULT CURRENT_DATE,
  revenue numeric(12, 2) NOT NULL DEFAULT 0,
  labour_cost numeric(12, 2) NOT NULL DEFAULT 0,
  travel_cost numeric(12, 2) NOT NULL DEFAULT 0,
  vehicle_cost numeric(12, 2) NOT NULL DEFAULT 0,
  asset_cost numeric(12, 2) NOT NULL DEFAULT 0,
  overtime_cost numeric(12, 2) NOT NULL DEFAULT 0,
  total_cost numeric(12, 2) NOT NULL DEFAULT 0,
  profit numeric(12, 2) NOT NULL DEFAULT 0,
  margin_pct numeric(8, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, job_id, profit_date)
);

CREATE INDEX IF NOT EXISTS idx_job_profitability_company_date
  ON public.job_profitability (company_id, profit_date DESC);

-- ---------------------------------------------------------------------------
-- client_profitability — client rollup
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_profitability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.client_billing_profiles (id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  jobs_completed integer NOT NULL DEFAULT 0,
  revenue numeric(12, 2) NOT NULL DEFAULT 0,
  labour_cost numeric(12, 2) NOT NULL DEFAULT 0,
  travel_cost numeric(12, 2) NOT NULL DEFAULT 0,
  vehicle_cost numeric(12, 2) NOT NULL DEFAULT 0,
  asset_cost numeric(12, 2) NOT NULL DEFAULT 0,
  profit numeric(12, 2) NOT NULL DEFAULT 0,
  margin_pct numeric(8, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, client_id, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- technician_profitability
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.technician_profitability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  revenue_generated numeric(12, 2) NOT NULL DEFAULT 0,
  labour_cost numeric(12, 2) NOT NULL DEFAULT 0,
  travel_cost numeric(12, 2) NOT NULL DEFAULT 0,
  profit_contribution numeric(12, 2) NOT NULL DEFAULT 0,
  productivity_pct numeric(8, 2) NOT NULL DEFAULT 0,
  jobs_completed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- site_profitability
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_profitability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  site_key text NOT NULL,
  site_label text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  revenue numeric(12, 2) NOT NULL DEFAULT 0,
  total_cost numeric(12, 2) NOT NULL DEFAULT 0,
  margin_pct numeric(8, 2) NOT NULL DEFAULT 0,
  jobs_count integer NOT NULL DEFAULT 0,
  travel_seconds integer NOT NULL DEFAULT 0,
  labour_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, site_key, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- profitability_alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profitability_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  client_id uuid REFERENCES public.client_billing_profiles (id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  employee_id uuid,
  message text NOT NULL,
  amount_zar numeric(12, 2),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT profitability_alerts_type_check CHECK (
    alert_type IN (
      'low_margin_job', 'negative_margin_job', 'client_below_margin_target',
      'excessive_travel_cost', 'vehicle_cost_too_high', 'labour_cost_exceeds_revenue'
    )
  ),
  CONSTRAINT profitability_alerts_severity_check CHECK (
    severity IN ('info', 'warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_profitability_alerts_company
  ON public.profitability_alerts (company_id, detected_at DESC);

-- RLS
ALTER TABLE public.client_billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_profitability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_profitability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_profitability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_profitability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profitability_alerts ENABLE ROW LEVEL SECURITY;

DO $policy$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'client_billing_profiles',
    'job_revenue',
    'job_profitability',
    'client_profitability',
    'technician_profitability',
    'site_profitability',
    'profitability_alerts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR company_id IN (SELECT public.vyron_user_company_ids())
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR company_id IN (SELECT public.vyron_user_company_ids())
       )',
      tbl,
      tbl
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', tbl);
  END LOOP;
END
$policy$;

COMMIT;

NOTIFY pgrst, 'reload schema';

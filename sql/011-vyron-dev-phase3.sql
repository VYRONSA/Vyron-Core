-- 011-vyron-dev-phase3.sql
-- VYRON DEV Phase 3 — platform persistence tables (clients, products, workspaces, packages, sessions, integrations, deployments)
-- Idempotent: safe to re-run. Run in Supabase SQL Editor after prior CORE scripts.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. vyron_clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ref text UNIQUE NOT NULL,
  company_name text NOT NULL,
  trading_name text,
  industry text,
  primary_contact text,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active',
  subscription_status text NOT NULL DEFAULT 'active',
  active_user_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_clients_status_check CHECK (
    status IN ('active', 'trial', 'suspended', 'archived')
  )
);

CREATE INDEX IF NOT EXISTS idx_vyron_clients_status ON public.vyron_clients (status);

-- ---------------------------------------------------------------------------
-- 2. vyron_client_products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_client_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.vyron_clients (id) ON DELETE CASCADE,
  product_code text NOT NULL,
  status text NOT NULL DEFAULT 'disabled',
  package_id text,
  package_name text,
  monthly_value numeric(12, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, product_code),
  CONSTRAINT vyron_client_products_product_code_check CHECK (
    product_code IN ('CORE', 'COST', 'PAY', 'FARM', 'MAINT', 'REACH', 'FINANCE', 'BUILD')
  ),
  CONSTRAINT vyron_client_products_status_check CHECK (
    status IN ('enabled', 'disabled', 'trial', 'suspended')
  )
);

CREATE INDEX IF NOT EXISTS idx_vyron_client_products_client_id ON public.vyron_client_products (client_id);

-- ---------------------------------------------------------------------------
-- 3. vyron_product_workspaces
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_product_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text UNIQUE NOT NULL,
  client_id uuid NOT NULL REFERENCES public.vyron_clients (id) ON DELETE CASCADE,
  product_code text NOT NULL,
  status text NOT NULL DEFAULT 'disabled',
  workspace_status text NOT NULL DEFAULT 'active',
  package_id text,
  package_name text,
  monthly_value numeric(12, 2),
  last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, product_code),
  CONSTRAINT vyron_product_workspaces_product_code_check CHECK (
    product_code IN ('CORE', 'COST', 'PAY', 'FARM', 'MAINT', 'REACH', 'FINANCE', 'BUILD')
  ),
  CONSTRAINT vyron_product_workspaces_status_check CHECK (
    status IN ('enabled', 'disabled', 'trial', 'suspended')
  ),
  CONSTRAINT vyron_product_workspaces_workspace_status_check CHECK (
    workspace_status IN ('active', 'trial', 'suspended', 'provisioning', 'rebuilding')
  )
);

CREATE INDEX IF NOT EXISTS idx_vyron_product_workspaces_client_id ON public.vyron_product_workspaces (client_id);

-- ---------------------------------------------------------------------------
-- 4. vyron_product_packages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_product_packages (
  id text PRIMARY KEY,
  product_code text NOT NULL,
  package_name text NOT NULL,
  user_limit integer,
  company_limit integer,
  storage_limit_gb integer,
  monthly_value numeric(12, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_product_packages_product_code_check CHECK (
    product_code IN ('CORE', 'COST', 'PAY', 'FARM', 'MAINT', 'REACH', 'FINANCE', 'BUILD')
  ),
  CONSTRAINT vyron_product_packages_status_check CHECK (
    status IN ('active', 'deprecated', 'draft')
  )
);

-- ---------------------------------------------------------------------------
-- 5. vyron_support_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL,
  operator_email text NOT NULL,
  client_id uuid REFERENCES public.vyron_clients (id) ON DELETE SET NULL,
  client_name text NOT NULL,
  product_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_support_sessions_status_check CHECK (
    status IN ('active', 'ended')
  ),
  CONSTRAINT vyron_support_sessions_product_code_check CHECK (
    product_code IN ('CORE', 'COST', 'PAY', 'FARM', 'MAINT', 'REACH', 'FINANCE', 'BUILD')
  )
);

CREATE INDEX IF NOT EXISTS idx_vyron_support_sessions_status ON public.vyron_support_sessions (status);

-- ---------------------------------------------------------------------------
-- 6. vyron_client_integrations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_client_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.vyron_clients (id) ON DELETE CASCADE,
  product_code text NOT NULL,
  xero_readiness text NOT NULL DEFAULT 'planned',
  accounting_readiness text NOT NULL DEFAULT 'planned',
  payroll_readiness text NOT NULL DEFAULT 'planned',
  property_readiness text NOT NULL DEFAULT 'planned',
  last_sync_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, product_code),
  CONSTRAINT vyron_client_integrations_product_code_check CHECK (
    product_code IN ('CORE', 'COST', 'PAY', 'FARM', 'MAINT', 'REACH', 'FINANCE', 'BUILD')
  ),
  CONSTRAINT vyron_client_integrations_readiness_check CHECK (
    xero_readiness IN ('ready', 'in_progress', 'planned')
    AND accounting_readiness IN ('ready', 'in_progress', 'planned')
    AND payroll_readiness IN ('ready', 'in_progress', 'planned')
    AND property_readiness IN ('ready', 'in_progress', 'planned')
  )
);

CREATE INDEX IF NOT EXISTS idx_vyron_client_integrations_client_id ON public.vyron_client_integrations (client_id);

-- ---------------------------------------------------------------------------
-- 7. vyron_product_deployments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_product_deployments (
  product_code text PRIMARY KEY,
  version text NOT NULL,
  deployment_status text NOT NULL,
  db_status text NOT NULL,
  last_deployment timestamptz,
  environment text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_product_deployments_product_code_check CHECK (
    product_code IN ('CORE', 'COST', 'PAY', 'FARM', 'MAINT', 'REACH', 'FINANCE', 'BUILD')
  ),
  CONSTRAINT vyron_product_deployments_status_check CHECK (
    deployment_status IN ('healthy', 'needs_review', 'not_deployed', 'maintenance')
  )
);

-- ---------------------------------------------------------------------------
-- RLS — DEV foundation policies (authenticated operators)
-- ---------------------------------------------------------------------------
ALTER TABLE public.vyron_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_client_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_product_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_product_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_client_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_product_deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vyron_dev_phase3_clients_select ON public.vyron_clients;
DROP POLICY IF EXISTS vyron_dev_phase3_clients_insert ON public.vyron_clients;
DROP POLICY IF EXISTS vyron_dev_phase3_clients_update ON public.vyron_clients;
DROP POLICY IF EXISTS vyron_dev_phase3_clients_delete ON public.vyron_clients;
CREATE POLICY vyron_dev_phase3_clients_select ON public.vyron_clients FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_clients_insert ON public.vyron_clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_clients_update ON public.vyron_clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_clients_delete ON public.vyron_clients FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vyron_dev_phase3_client_products_select ON public.vyron_client_products;
DROP POLICY IF EXISTS vyron_dev_phase3_client_products_insert ON public.vyron_client_products;
DROP POLICY IF EXISTS vyron_dev_phase3_client_products_update ON public.vyron_client_products;
DROP POLICY IF EXISTS vyron_dev_phase3_client_products_delete ON public.vyron_client_products;
CREATE POLICY vyron_dev_phase3_client_products_select ON public.vyron_client_products FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_client_products_insert ON public.vyron_client_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_client_products_update ON public.vyron_client_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_client_products_delete ON public.vyron_client_products FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vyron_dev_phase3_workspaces_select ON public.vyron_product_workspaces;
DROP POLICY IF EXISTS vyron_dev_phase3_workspaces_insert ON public.vyron_product_workspaces;
DROP POLICY IF EXISTS vyron_dev_phase3_workspaces_update ON public.vyron_product_workspaces;
DROP POLICY IF EXISTS vyron_dev_phase3_workspaces_delete ON public.vyron_product_workspaces;
CREATE POLICY vyron_dev_phase3_workspaces_select ON public.vyron_product_workspaces FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_workspaces_insert ON public.vyron_product_workspaces FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_workspaces_update ON public.vyron_product_workspaces FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_workspaces_delete ON public.vyron_product_workspaces FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vyron_dev_phase3_packages_select ON public.vyron_product_packages;
DROP POLICY IF EXISTS vyron_dev_phase3_packages_insert ON public.vyron_product_packages;
DROP POLICY IF EXISTS vyron_dev_phase3_packages_update ON public.vyron_product_packages;
DROP POLICY IF EXISTS vyron_dev_phase3_packages_delete ON public.vyron_product_packages;
CREATE POLICY vyron_dev_phase3_packages_select ON public.vyron_product_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_packages_insert ON public.vyron_product_packages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_packages_update ON public.vyron_product_packages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_packages_delete ON public.vyron_product_packages FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vyron_dev_phase3_sessions_select ON public.vyron_support_sessions;
DROP POLICY IF EXISTS vyron_dev_phase3_sessions_insert ON public.vyron_support_sessions;
DROP POLICY IF EXISTS vyron_dev_phase3_sessions_update ON public.vyron_support_sessions;
DROP POLICY IF EXISTS vyron_dev_phase3_sessions_delete ON public.vyron_support_sessions;
CREATE POLICY vyron_dev_phase3_sessions_select ON public.vyron_support_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_sessions_insert ON public.vyron_support_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_sessions_update ON public.vyron_support_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_sessions_delete ON public.vyron_support_sessions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vyron_dev_phase3_integrations_select ON public.vyron_client_integrations;
DROP POLICY IF EXISTS vyron_dev_phase3_integrations_insert ON public.vyron_client_integrations;
DROP POLICY IF EXISTS vyron_dev_phase3_integrations_update ON public.vyron_client_integrations;
DROP POLICY IF EXISTS vyron_dev_phase3_integrations_delete ON public.vyron_client_integrations;
CREATE POLICY vyron_dev_phase3_integrations_select ON public.vyron_client_integrations FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_integrations_insert ON public.vyron_client_integrations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_integrations_update ON public.vyron_client_integrations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_integrations_delete ON public.vyron_client_integrations FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vyron_dev_phase3_deployments_select ON public.vyron_product_deployments;
DROP POLICY IF EXISTS vyron_dev_phase3_deployments_insert ON public.vyron_product_deployments;
DROP POLICY IF EXISTS vyron_dev_phase3_deployments_update ON public.vyron_product_deployments;
DROP POLICY IF EXISTS vyron_dev_phase3_deployments_delete ON public.vyron_product_deployments;
CREATE POLICY vyron_dev_phase3_deployments_select ON public.vyron_product_deployments FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_phase3_deployments_insert ON public.vyron_product_deployments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_deployments_update ON public.vyron_product_deployments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_dev_phase3_deployments_delete ON public.vyron_product_deployments FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Seed: default packages (from VYRON_DEV_DEFAULT_PACKAGES)
-- ---------------------------------------------------------------------------
INSERT INTO public.vyron_product_packages (id, product_code, package_name, user_limit, company_limit, storage_limit_gb, monthly_value, status)
VALUES
  ('pkg-core-starter', 'CORE', 'CORE Starter', 2, 1, 10, 499, 'active'),
  ('pkg-core-professional', 'CORE', 'CORE Professional', 10, 1, 50, 14999, 'active'),
  ('pkg-core-enterprise', 'CORE', 'CORE Enterprise', NULL, 5, 200, 49999, 'active'),
  ('pkg-cost-starter', 'COST', 'COST Starter', 2, 1, 10, 499, 'active'),
  ('pkg-cost-growth', 'COST', 'COST Growth', 5, 3, 25, 1499, 'active'),
  ('pkg-cost-enterprise', 'COST', 'COST Enterprise', NULL, 10, 100, 24999, 'active'),
  ('pkg-pay-starter', 'PAY', 'PAY Starter', 2, 1, 5, 499, 'active'),
  ('pkg-pay-professional', 'PAY', 'PAY Professional', 10, 2, 25, 4999, 'active'),
  ('pkg-pay-enterprise', 'PAY', 'PAY Enterprise', NULL, 5, 80, 19999, 'active'),
  ('pkg-farm-starter', 'FARM', 'FARM Starter', 3, 1, 10, 799, 'active'),
  ('pkg-farm-professional', 'FARM', 'FARM Professional', 10, 5, 30, 2999, 'active'),
  ('pkg-farm-enterprise', 'FARM', 'FARM Enterprise', NULL, 10, 100, 14999, 'active'),
  ('pkg-maint-starter', 'MAINT', 'MAINT Starter', 3, 1, 10, 799, 'active'),
  ('pkg-maint-professional', 'MAINT', 'MAINT Professional', 8, 3, 30, 2499, 'active'),
  ('pkg-maint-enterprise', 'MAINT', 'MAINT Enterprise', NULL, 8, 80, 12999, 'active'),
  ('pkg-reach-starter', 'REACH', 'REACH Starter', 2, 1, 10, 599, 'active'),
  ('pkg-reach-growth', 'REACH', 'REACH Growth', 5, 2, 15, 1499, 'active'),
  ('pkg-reach-enterprise', 'REACH', 'REACH Enterprise', NULL, 5, 60, 9999, 'active'),
  ('pkg-finance-starter', 'FINANCE', 'FINANCE Starter', 2, 1, 10, 999, 'active'),
  ('pkg-finance-professional', 'FINANCE', 'FINANCE Professional', 8, 3, 40, 7999, 'active'),
  ('pkg-finance-enterprise', 'FINANCE', 'FINANCE Enterprise', NULL, 5, 80, 19999, 'active'),
  ('pkg-build-starter', 'BUILD', 'BUILD Starter', 2, 1, 5, 399, 'active'),
  ('pkg-build-professional', 'BUILD', 'BUILD Professional', 6, 2, 20, 1999, 'active'),
  ('pkg-build-enterprise', 'BUILD', 'BUILD Enterprise', NULL, 5, 50, 9999, 'active')
ON CONFLICT (id) DO UPDATE SET
  product_code = EXCLUDED.product_code,
  package_name = EXCLUDED.package_name,
  user_limit = EXCLUDED.user_limit,
  company_limit = EXCLUDED.company_limit,
  storage_limit_gb = EXCLUDED.storage_limit_gb,
  monthly_value = EXCLUDED.monthly_value,
  status = EXCLUDED.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Seed: default deployments (from VYRON_PRODUCT_DEPLOYMENTS)
-- ---------------------------------------------------------------------------
INSERT INTO public.vyron_product_deployments (product_code, version, deployment_status, db_status, last_deployment, environment, url)
VALUES
  ('CORE', '2.4.1', 'healthy', 'Connected', '2026-06-01T08:00:00.000Z'::timestamptz, 'production', 'https://core.vyron.app'),
  ('COST', '1.2.0', 'healthy', 'Connected', '2026-05-28T14:30:00.000Z'::timestamptz, 'production', 'https://cost.vyron.app'),
  ('PAY', '1.1.3', 'needs_review', 'Connected', '2026-05-20T10:00:00.000Z'::timestamptz, 'production', 'https://pay.vyron.app'),
  ('FARM', '0.9.2', 'healthy', 'Connected', '2026-05-15T09:00:00.000Z'::timestamptz, 'production', 'https://farm.vyron.app'),
  ('MAINT', '0.8.1', 'maintenance', 'Read-only', '2026-05-10T11:00:00.000Z'::timestamptz, 'production', 'https://maint.vyron.app'),
  ('REACH', '0.7.0', 'not_deployed', 'Not provisioned', NULL, 'staging', 'https://reach-staging.vyron.app'),
  ('FINANCE', '0.6.5', 'needs_review', 'Connected', '2026-05-01T16:00:00.000Z'::timestamptz, 'production', 'https://finance.vyron.app'),
  ('BUILD', '0.5.0', 'not_deployed', 'Not provisioned', NULL, 'staging', 'https://build-staging.vyron.app')
ON CONFLICT (product_code) DO UPDATE SET
  version = EXCLUDED.version,
  deployment_status = EXCLUDED.deployment_status,
  db_status = EXCLUDED.db_status,
  last_deployment = EXCLUDED.last_deployment,
  environment = EXCLUDED.environment,
  url = EXCLUDED.url,
  updated_at = now();

COMMIT;

NOTIFY pgrst, 'reload schema';

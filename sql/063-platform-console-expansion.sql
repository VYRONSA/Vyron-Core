-- 063-platform-console-expansion.sql
-- Platform Console expansion: soft delete, subscription-engine fields, Marketplace
-- template metadata, data-driven module registry, feature flags, platform settings,
-- announcements, release notes, support notes, impersonation sessions, job-queue
-- monitoring. Idempotent. Run after sql/062-platform-console-foundation.sql.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.companies. Run sql/001 first.';
  END IF;
  IF to_regclass('public.subscription_plans') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.subscription_plans. Run sql/062 first.';
  END IF;
  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run sql/050/060 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. companies — soft delete + subscription-engine fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_contact text,
  ADD COLUMN IF NOT EXISTS purchase_order text,
  ADD COLUMN IF NOT EXISTS automatic_billing_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;

-- customer_status gains 'grace_period' (subscription engine) — replace check constraint.
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_customer_status_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_customer_status_check
  CHECK (customer_status IN ('trial', 'active', 'grace_period', 'suspended', 'cancelled', 'expired'));

CREATE INDEX IF NOT EXISTS idx_companies_deleted_at ON public.companies (deleted_at);

-- ---------------------------------------------------------------------------
-- 2. solution_templates — Marketplace metadata (permissions/workflows/widgets/AI)
-- ---------------------------------------------------------------------------
ALTER TABLE public.solution_templates
  ADD COLUMN IF NOT EXISTS default_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_workflows jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dashboard_widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_ai_assistants jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. platform_modules — data-driven module registry (Module Management)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_modules (
  module_code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'enabled',
  requires_enterprise boolean NOT NULL DEFAULT false,
  requires_ai_credits boolean NOT NULL DEFAULT false,
  employee_limit integer,
  user_limit integer,
  version text NOT NULL DEFAULT '1.0.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_modules_status_check
    CHECK (status IN ('enabled', 'hidden', 'preview', 'beta', 'deprecated'))
);

-- ---------------------------------------------------------------------------
-- 4. platform_feature_flags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_feature_flags (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_enabled boolean NOT NULL DEFAULT false,
  rollout_scope text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. platform_settings — key/value (maintenance mode, terms, privacy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (key, value)
VALUES
  ('maintenance_mode', '{"enabled": false, "message": ""}'::jsonb),
  ('terms_content', '{"body": ""}'::jsonb),
  ('privacy_content', '{"body": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. platform_announcements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. platform_release_notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_release_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  title text NOT NULL,
  body text,
  released_at date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 8. platform_support_notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_support_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  operator_email text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_support_notes_company ON public.platform_support_notes (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 9. platform_impersonation_sessions — scoped operator "view as customer" sessions
-- (the operator's own already-privileged session is scoped to one company; this is
-- NOT identity assumption / token minting — see lib/platform/impersonation.ts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text UNIQUE NOT NULL,
  operator_email text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_impersonation_sessions_status_check CHECK (status IN ('active', 'ended'))
);

CREATE INDEX IF NOT EXISTS idx_platform_impersonation_status ON public.platform_impersonation_sessions (status);

-- ---------------------------------------------------------------------------
-- 10. platform_job_queue — monitoring/tracking scaffold (not an async worker engine)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT platform_job_queue_queue_name_check CHECK (queue_name IN ('email', 'notification', 'storage', 'ai')),
  CONSTRAINT platform_job_queue_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_platform_job_queue_queue_status ON public.platform_job_queue (queue_name, status);

-- ---------------------------------------------------------------------------
-- RLS — all platform_* tables are platform-operator-only (defense in depth; the
-- app/api/platform/* routes already gate on auth.platformOperator via service role).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'platform_modules', 'platform_feature_flags', 'platform_settings',
    'platform_announcements', 'platform_release_notes', 'platform_support_notes',
    'platform_impersonation_sessions', 'platform_job_queue'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_operator_all ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_operator_all ON public.%I FOR ALL TO authenticated USING (public.vyron_is_platform_operator()) WITH CHECK (public.vyron_is_platform_operator())',
      tbl, tbl
    );
    EXECUTE format('GRANT ALL ON public.%I TO authenticated', tbl);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: platform_modules (canonical module registry — lib/platform/module-catalog.ts mirrors this)
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_modules (module_code, name, requires_enterprise, requires_ai_credits)
VALUES
  ('dashboard', 'Dashboard', false, false),
  ('employees', 'Employees', false, false),
  ('leave', 'Leave', false, false),
  ('clocking', 'Clocking', false, false),
  ('discipline', 'Discipline', false, false),
  ('hearings', 'Hearings', false, false),
  ('contracts', 'Contracts', false, false),
  ('recruitment', 'Recruitment', true, false),
  ('performance', 'Performance', false, false),
  ('documents', 'Documents', false, false),
  ('reports', 'Reports', false, false),
  ('ai_copilot', 'AI Copilot', false, true),
  ('ai_intelligence', 'AI Intelligence', true, true),
  ('payroll_intelligence', 'Payroll Intelligence', true, false),
  ('workforce_intelligence', 'Workforce Intelligence', true, false),
  ('profitability_intelligence', 'Profitability Intelligence', true, false),
  ('digital_twin', 'Digital Twin', true, true),
  ('route_intelligence', 'Route Intelligence', true, false),
  ('route_history', 'Route History', false, false),
  ('vehicle_intelligence', 'Vehicle Intelligence', true, false),
  ('mobile_workforce', 'Mobile Workforce', false, false),
  ('client_portal', 'Client Portal', true, false),
  ('whatsapp', 'WhatsApp', false, false),
  ('api_access', 'API Access', true, false)
ON CONFLICT (module_code) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

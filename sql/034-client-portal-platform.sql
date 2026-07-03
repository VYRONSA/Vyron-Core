-- 034-client-portal-platform.sql
-- VYRON CORE Batch 15 — Client Portal & Customer Experience Platform
-- Run after sql/033-client-profitability-intelligence.sql. Idempotent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- client_portal_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.client_billing_profiles (id) ON DELETE CASCADE,
  email text NOT NULL,
  contact_name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'viewer',
  status text NOT NULL DEFAULT 'active',
  auth_user_id uuid,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email),
  CONSTRAINT client_portal_users_status_check CHECK (
    status IN ('active', 'suspended', 'inactive')
  ),
  CONSTRAINT client_portal_users_role_check CHECK (
    role IN ('viewer', 'manager', 'billing')
  )
);

CREATE INDEX IF NOT EXISTS idx_client_portal_users_client
  ON public.client_portal_users (company_id, client_id);

-- ---------------------------------------------------------------------------
-- client_requests — service requests from portal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.client_billing_profiles (id) ON DELETE CASCADE,
  portal_user_id uuid REFERENCES public.client_portal_users (id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  request_type text NOT NULL DEFAULT 'service',
  subject text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_requests_type_check CHECK (
    request_type IN ('service', 'maintenance', 'quote', 'complaint', 'other')
  ),
  CONSTRAINT client_requests_status_check CHECK (
    status IN ('open', 'in_progress', 'resolved', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_client_requests_client
  ON public.client_requests (company_id, client_id, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- client_ratings — satisfaction / CSAT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.client_billing_profiles (id) ON DELETE CASCADE,
  portal_user_id uuid REFERENCES public.client_portal_users (id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  rating integer NOT NULL,
  feedback text,
  rated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_ratings_value_check CHECK (rating >= 1 AND rating <= 5)
);

CREATE INDEX IF NOT EXISTS idx_client_ratings_client
  ON public.client_ratings (company_id, client_id, rated_at DESC);

-- ---------------------------------------------------------------------------
-- client_assets — client-visible asset register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.client_billing_profiles (id) ON DELETE CASCADE,
  field_asset_id uuid REFERENCES public.field_assets (id) ON DELETE SET NULL,
  asset_name text NOT NULL,
  asset_number text,
  site_label text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_assets_client
  ON public.client_assets (company_id, client_id);

-- ---------------------------------------------------------------------------
-- client_documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.client_billing_profiles (id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'report',
  file_url text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_documents_type_check CHECK (
    document_type IN ('report', 'invoice', 'certificate', 'photo', 'contract', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_client_documents_client
  ON public.client_documents (company_id, client_id, uploaded_at DESC);

-- ---------------------------------------------------------------------------
-- client_portal_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_portal_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.client_billing_profiles (id) ON DELETE SET NULL,
  portal_user_id uuid REFERENCES public.client_portal_users (id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_portal_audit_company
  ON public.client_portal_audit_log (company_id, created_at DESC);

-- RLS
ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_audit_log ENABLE ROW LEVEL SECURITY;

DO $policy$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'client_portal_users',
    'client_requests',
    'client_ratings',
    'client_assets',
    'client_documents',
    'client_portal_audit_log'
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

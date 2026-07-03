-- 030-multi-tenant-security.sql
-- VYRON CORE Batch 11 — audit log, sessions, record lifecycle, tenant RLS.
-- Idempotent. Run after sql/029-v2-production-readiness.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies (id) ON DELETE SET NULL,
  user_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vyron_audit_log_company_created
  ON public.vyron_audit_log (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vyron_audit_log_user_created
  ON public.vyron_audit_log (user_email, created_at DESC);

-- ---------------------------------------------------------------------------
-- User sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  company_id uuid REFERENCES public.companies (id) ON DELETE SET NULL,
  session_token text NOT NULL UNIQUE,
  user_agent text,
  ip_address text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vyron_user_sessions_company
  ON public.vyron_user_sessions (company_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_vyron_user_sessions_email
  ON public.vyron_user_sessions (lower(user_email), last_seen_at DESC);

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- ---------------------------------------------------------------------------
-- Record lifecycle (soft delete) — Active / Archived / Deleted
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'field_jobs'
  ) THEN
    ALTER TABLE public.field_jobs
      ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_record_status_check'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_record_status_check
      CHECK (record_status IN ('active', 'archived', 'deleted'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_record_status_check'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_record_status_check
      CHECK (record_status IN ('active', 'archived', 'deleted'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'field_jobs'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'field_jobs_record_status_check'
  ) THEN
    ALTER TABLE public.field_jobs
      ADD CONSTRAINT field_jobs_record_status_check
      CHECK (record_status IN ('active', 'archived', 'deleted'));
  END IF;
END $$;

-- Align legacy archive flags
UPDATE public.employees SET record_status = 'archived' WHERE active = false AND record_status = 'active';
UPDATE public.stores SET record_status = 'archived' WHERE lower(coalesce(status, '')) = 'archived' AND record_status = 'active';

-- ---------------------------------------------------------------------------
-- Tenant isolation helper (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cu.company_id
  FROM public.company_users cu
  WHERE lower(cu.user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND cu.status = 'active'
    AND cu.company_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.vyron_is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) = 'info@vyronsoft.co.za';
$$;

REVOKE ALL ON FUNCTION public.vyron_user_company_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_user_company_ids() TO authenticated, anon;

REVOKE ALL ON FUNCTION public.vyron_is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_is_platform_operator() TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Production tenant RLS (core tables)
-- ---------------------------------------------------------------------------
ALTER TABLE public.vyron_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vyron_user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vyron_audit_log_tenant ON public.vyron_audit_log;
CREATE POLICY vyron_audit_log_tenant ON public.vyron_audit_log
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IS NULL
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IS NULL
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

DROP POLICY IF EXISTS vyron_user_sessions_tenant ON public.vyron_user_sessions;
CREATE POLICY vyron_user_sessions_tenant ON public.vyron_user_sessions
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

GRANT SELECT, INSERT ON public.vyron_audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vyron_user_sessions TO authenticated;

-- Core tenant tables — replace permissive DEV policies where present (skip missing tables)
DO $policy$
DECLARE
  tbl text;
  candidate_tables text[] := ARRAY[
    'employees',
    'stores',
    'leave_requests',
    'hr_warnings',
    'hr_cases',
    'hr_documents',
    'hr_notes',
    'field_jobs',
    'field_job_events',
    'field_job_assignments',
    'clock_events',
    'roster_shifts',
    'time_exceptions',
    'payroll_batches',
    'payroll_hours',
    'company_users'
  ];
BEGIN
  FOREACH tbl IN ARRAY candidate_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Skipping RLS for missing table public.%', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR company_id IN (SELECT public.vyron_user_company_ids())
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR company_id IN (SELECT public.vyron_user_company_ids())
       )',
      tbl,
      tbl
    );
  END LOOP;
END
$policy$;

COMMIT;

NOTIFY pgrst, 'reload schema';

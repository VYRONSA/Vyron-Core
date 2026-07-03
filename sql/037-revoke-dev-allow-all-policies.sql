-- 037-revoke-dev-allow-all-policies.sql
-- Removes permissive DEV / open RLS policies after sql/030 tenant policies exist.
-- Safe to re-run (idempotent drops only).

BEGIN;

DO $drop_dev$
DECLARE
  pol record;
  core_tables text[] := ARRAY[
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
    'company_users',
    'companies',
    'company_users'
  ];
BEGIN
  -- 1) Legacy "DEV allow all …" policies (any table)
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE policyname ILIKE 'DEV allow all%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    RAISE NOTICE 'Dropped DEV policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;

  -- 2) Open *_all policies on core tenant tables (e.g. field_jobs_all, roster_shifts from early migrations)
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (core_tables)
      AND policyname ILIKE '%\_all' ESCAPE '\'
      AND policyname NOT ILIKE '%\_tenant\_isolation' ESCAPE '\'
      AND policyname NOT ILIKE '%\_tenant' ESCAPE '\'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    RAISE NOTICE 'Dropped permissive _all policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END
$drop_dev$;

COMMIT;

NOTIFY pgrst, 'reload schema';

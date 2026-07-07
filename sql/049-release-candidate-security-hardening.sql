-- 049-release-candidate-security-hardening.sql
-- VYRON CORE v1.0 RC: enforce tenant isolation for all company-scoped tables.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_user_company_ids(). Run 030-multi-tenant-security.sql before 049-release-candidate-security-hardening.sql.';
  END IF;

  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run 030-multi-tenant-security.sql before 049-release-candidate-security-hardening.sql.';
  END IF;
END $$;

DO $hardening$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('vyron_user_sessions')
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    FOR pol IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = tbl
        AND (
          p.policyname ILIKE 'DEV allow all%%'
          OR p.policyname ILIKE '%\_all' ESCAPE '\'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       )',
      tbl,
      tbl,
      tbl,
      tbl
    );

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
  END LOOP;
END
$hardening$;

COMMIT;

NOTIFY pgrst, 'reload schema';

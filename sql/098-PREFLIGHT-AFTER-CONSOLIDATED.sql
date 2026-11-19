-- 098-PREFLIGHT-AFTER-CONSOLIDATED.sql
-- =========================================================================
-- PRODUCTION PRE-FLIGHT — ALL "AFTER" GATES IN **ONE** RESULT SET
--
-- READ ONLY. One statement. Every branch is a SELECT. Nothing is created,
-- altered, written or dropped.
--
-- WHY THIS FILE EXISTS
--   sql/098-PREFLIGHT-AFTER.sql is 11 separate SELECT statements. psql prints
--   every result set; the Supabase SQL Editor prints only the LAST one, so
--   running it there showed a single row and silently discarded the other ten
--   gates. This returns everything as one table.
--
-- HOW TO RUN
--   Supabase Dashboard -> project gpiqkwebizuqajgaoxhm -> SQL Editor ->
--   New query -> paste this whole file -> Run. Copy the whole grid back.
--
-- PRECONDITION
--   098 must already be applied, because row 21 reads
--   public.vyron_company_master_admins. If that table does not exist the
--   statement errors with 42P01 - which is itself the answer: 098 is not
--   applied.
-- =========================================================================

WITH
spine AS (
  SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure)) AS h
),
spine_dep AS (
  SELECT count(*) AS policies, count(DISTINCT tablename) AS tables
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual ILIKE '%vyron_user_company_ids%'
          OR with_check ILIKE '%vyron_user_company_ids%')
),
co_pol AS (
  SELECT count(*) AS n,
         coalesce(string_agg(DISTINCT cmd, ','), '(none)') AS cmds,
         coalesce(bool_and(cmd = 'SELECT'), false) AS all_select
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'companies'
),
saf_pol AS (
  SELECT count(*) AS policies, count(DISTINCT tablename) AS tables
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'safety\_%'
),
saf_tab AS (
  SELECT count(*) AS n FROM pg_tables
   WHERE schemaname = 'public' AND tablename LIKE 'safety\_%'
),
saf_fp AS (
  SELECT md5(
    coalesce((SELECT string_agg(
                tablename || '.' || policyname || '.' || cmd || '.' ||
                coalesce(qual,'') || '|' || coalesce(with_check,''),
                E'\n' ORDER BY tablename, policyname)
                FROM pg_policies
               WHERE schemaname='public' AND tablename LIKE 'safety\_%'), '')
    || E'\n---FUNCTIONS---\n' ||
    coalesce((SELECT string_agg(pg_get_functiondef(p.oid), E'\n' ORDER BY p.proname)
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname='public' AND p.proname LIKE 'safety\_%'), '')
  ) AS fp
),
cm_fn AS (
  SELECT p.proname,
         p.prosecdef,
         (p.proconfig IS NOT NULL
          AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')) AS pinned,
         pg_get_functiondef(p.oid) ILIKE '%vyron_user_company_ids%' AS refs_spine,
         has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                       'vyron_can_manage_company_master_admins',
                       'vyron_grant_company_master_admin',
                       'vyron_revoke_company_master_admin',
                       'vyron_list_company_master_admins',
                       'vyron_get_company','vyron_update_company')
),
grant_tbl AS (
  SELECT
    (SELECT relrowsecurity FROM pg_class
      WHERE oid = to_regclass('public.vyron_company_master_admins')) AS rls,
    (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='vyron_company_master_admins') AS pols,
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='vyron_company_master_admins'
        AND grantee IN ('anon','authenticated')) AS privs
),
id_cols AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='companies'
     AND column_name IN ('vat_number','email','website','postal_address',
                         'address_line1','address_line2','address_city',
                         'address_region','address_postal_code','industry',
                         'logo_bucket','logo_path')
),
brand AS (
  SELECT (SELECT public FROM storage.buckets WHERE id='company-branding') AS is_public,
         (SELECT count(*) FROM storage.buckets WHERE id='company-branding') AS exists_n,
         (SELECT count(*) FROM pg_policies
           WHERE schemaname='storage' AND policyname LIKE 'company\_branding%') AS pols
),
hse AS (
  SELECT count(*) AS n
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
   WHERE c.name ILIKE '%HSE Insight%'
)
SELECT * FROM (
  SELECT 1 AS seq, 'GATE 1   vyron_user_company_ids md5' AS gate,
         (SELECT h FROM spine) AS value,
         'a4ca0efca3674ec4889de649f999c3c0' AS expected,
         CASE WHEN (SELECT h FROM spine) = 'a4ca0efca3674ec4889de649f999c3c0'
              THEN 'PASS' ELSE '*** STOP - SPINE CHANGED ***' END AS verdict
  UNION ALL SELECT 2, 'GATE 2   spine dependency footprint',
         (SELECT policies||' policies / '||tables||' tables' FROM spine_dep),
         '82 policies / 75 tables', 'compare with BEFORE'
  UNION ALL SELECT 3, 'GATE 3   companies policy count',
         (SELECT n::text||' ('||cmds||')' FROM co_pol), '1 (SELECT)',
         CASE WHEN (SELECT n=1 AND all_select FROM co_pol)
              THEN 'PASS' ELSE '*** STOP - WRITE POLICY ON companies ***' END

  UNION ALL SELECT 10, 'GATE 10a SAFETY policy count',
         (SELECT policies::text FROM saf_pol), 'must equal BEFORE', 'compare with BEFORE'
  UNION ALL SELECT 11, 'GATE 10b SAFETY table count (with policies)',
         (SELECT tables::text FROM saf_pol), 'must equal BEFORE', 'compare with BEFORE'
  UNION ALL SELECT 12, 'GATE 10c SAFETY tables in schema',
         (SELECT n::text FROM saf_tab), 'must equal BEFORE', 'compare with BEFORE'
  UNION ALL SELECT 13, 'GATE 10d SAFETY RLS FINGERPRINT',
         (SELECT fp FROM saf_fp), 'must equal BEFORE', '*** COMPARE WITH BEFORE ***'

  UNION ALL SELECT 20, 'NEW  Company Master functions',
         (SELECT count(*)::text FROM cm_fn), '8',
         CASE WHEN (SELECT count(*) FROM cm_fn) = 8 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 21, 'NEW  ... all SECURITY DEFINER',
         (SELECT count(*) FILTER (WHERE prosecdef)::text FROM cm_fn), '8',
         CASE WHEN (SELECT count(*) FILTER (WHERE prosecdef) FROM cm_fn) = 8
              THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 22, 'NEW  ... all pin search_path',
         (SELECT count(*) FILTER (WHERE pinned)::text FROM cm_fn), '8',
         CASE WHEN (SELECT count(*) FILTER (WHERE pinned) FROM cm_fn) = 8
              THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 23, 'NEW  ... none executable by PUBLIC',
         (SELECT count(*) FILTER (WHERE public_exec)::text FROM cm_fn), '0',
         CASE WHEN (SELECT count(*) FILTER (WHERE public_exec) FROM cm_fn) = 0
              THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 24, 'NEW  ISOLATION: functions referencing the spine',
         (SELECT count(*) FILTER (WHERE refs_spine)::text FROM cm_fn), '0',
         CASE WHEN (SELECT count(*) FILTER (WHERE refs_spine) FROM cm_fn) = 0
              THEN 'PASS' ELSE '*** STOP - NEW CODE READS THE SPINE ***' END
  UNION ALL SELECT 25, 'NEW  function names present',
         (SELECT coalesce(string_agg(proname, ', ' ORDER BY proname), '(none)') FROM cm_fn),
         '8 expected names', 'informational'

  UNION ALL SELECT 30, 'NEW  grant table: RLS enabled',
         (SELECT coalesce(rls::text,'(table absent)') FROM grant_tbl), 'true',
         CASE WHEN (SELECT rls FROM grant_tbl) THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 31, 'NEW  grant table: policy count',
         (SELECT pols::text FROM grant_tbl), '0 (deny-by-default)',
         CASE WHEN (SELECT pols FROM grant_tbl) = 0 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 32, 'NEW  grant table: client privileges',
         (SELECT privs::text FROM grant_tbl), '0',
         CASE WHEN (SELECT privs FROM grant_tbl) = 0 THEN 'PASS' ELSE 'FAIL' END

  UNION ALL SELECT 40, 'NEW  identity columns on companies',
         (SELECT n::text FROM id_cols), '12',
         CASE WHEN (SELECT n FROM id_cols) = 12 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 41, 'NEW  company-branding bucket exists',
         (SELECT exists_n::text FROM brand), '1',
         CASE WHEN (SELECT exists_n FROM brand) = 1 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 42, 'NEW  company-branding is PRIVATE',
         (SELECT coalesce(is_public::text,'(absent)') FROM brand), 'false',
         CASE WHEN (SELECT is_public IS FALSE FROM brand)
              THEN 'PASS' ELSE '*** STOP - BUCKET IS PUBLIC ***' END
  UNION ALL SELECT 43, 'NEW  branding storage policies',
         (SELECT pols::text FROM brand), '4',
         CASE WHEN (SELECT pols FROM brand) = 4 THEN 'PASS' ELSE 'FAIL' END

  UNION ALL SELECT 50, 'GATE 6   HSE Insight company_users',
         (SELECT n::text FROM hse), '0',
         CASE WHEN (SELECT n FROM hse) = 0
              THEN 'PASS' ELSE '*** STOP - CORE MEMBERSHIP CREATED ***' END
  UNION ALL SELECT 51, 'NEW  grants seeded by the migration',
         (SELECT count(*)::text FROM public.vyron_company_master_admins), '0',
         CASE WHEN (SELECT count(*) FROM public.vyron_company_master_admins) = 0
              THEN 'PASS' ELSE 'review - a grant already exists' END
) r
ORDER BY seq;

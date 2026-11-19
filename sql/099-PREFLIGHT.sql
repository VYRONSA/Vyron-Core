-- 099-PREFLIGHT.sql
-- =========================================================================
-- PRODUCTION PRE-FLIGHT FOR sql/099 — ONE RESULT SET
--
-- READ ONLY. One statement. Every branch is a SELECT. Nothing is created,
-- altered, written or dropped.
--
-- Run it BEFORE applying sql/099 and again AFTER. The same query both times,
-- so the two grids compare line for line. Everything except the two rows that
-- count the new functions must be IDENTICAL.
--
-- The measurements reuse the definitions from sql/098-PREFLIGHT-AFTER-
-- CONSOLIDATED.sql unchanged, so the numbers are also comparable with the
-- figures recorded when 098 went live.
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
-- Everything sql/098 created, fingerprinted together. 099 adds to 098 and
-- must not alter one byte of it.
cm098_fp AS (
  SELECT md5(coalesce(string_agg(pg_get_functiondef(p.oid), E'\n' ORDER BY p.proname), '')) AS fp,
         count(*) AS n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                       'vyron_can_manage_company_master_admins',
                       'vyron_grant_company_master_admin',
                       'vyron_revoke_company_master_admin',
                       'vyron_list_company_master_admins',
                       'vyron_get_company','vyron_update_company')
),
-- The two objects sql/099 adds, and the properties that make them safe.
cm099 AS (
  SELECT count(*) AS n,
         coalesce(bool_and(p.prosecdef), false) AS all_secdef,
         coalesce(bool_and(p.proconfig IS NOT NULL AND EXISTS (
           SELECT 1 FROM unnest(p.proconfig) c
            WHERE c LIKE 'search_path=%pg_catalog%')), false) AS all_pinned,
         coalesce(bool_or(has_function_privilege('public', p.oid, 'EXECUTE')), false) AS any_public_exec,
         coalesce(bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')), false) AS all_auth_exec,
         coalesce(bool_or(pg_get_functiondef(p.oid) ILIKE '%vyron_user_company_ids%'), false) AS refs_spine
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('vyron_list_company_master_candidates',
                       'vyron_grant_company_master_admin_by_email')
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
         (SELECT count(*) FROM pg_policies
           WHERE schemaname='storage' AND policyname LIKE 'company\_branding%') AS pols
),
hse AS (
  SELECT (SELECT count(*) FROM public.company_users cu
            JOIN public.companies c ON c.id = cu.company_id
           WHERE c.name ILIKE '%HSE Insight%') AS members,
         (SELECT count(*) FROM public.vyron_company_master_admins a
            JOIN public.companies c ON c.id = a.company_id
           WHERE c.name ILIKE '%HSE Insight%' AND a.status = 'active') AS active_grants,
         (SELECT count(*) FROM public.company_users) AS cu_total,
         (SELECT count(*) FROM public.vyron_company_master_admins) AS grants_total,
         (SELECT count(*) FROM public.vyron_audit_log
           WHERE action LIKE 'company_master%') AS audit_rows
)
SELECT * FROM (
  SELECT 1 AS seq, 'A1  vyron_user_company_ids md5' AS gate,
         (SELECT h FROM spine) AS value,
         'a4ca0efca3674ec4889de649f999c3c0' AS expected,
         CASE WHEN (SELECT h FROM spine) = 'a4ca0efca3674ec4889de649f999c3c0'
              THEN 'PASS' ELSE '*** STOP - SPINE CHANGED ***' END AS verdict

  UNION ALL SELECT 2, 'A2  spine dependency footprint',
         (SELECT policies||' policies / '||tables||' tables' FROM spine_dep),
         '82 policies / 75 tables',
         CASE WHEN (SELECT policies=82 AND tables=75 FROM spine_dep)
              THEN 'PASS' ELSE '*** REVIEW ***' END

  UNION ALL SELECT 3, 'A3  companies policy count',
         (SELECT n::text||' ('||cmds||')' FROM co_pol), '1 (SELECT)',
         CASE WHEN (SELECT n=1 AND all_select FROM co_pol)
              THEN 'PASS' ELSE '*** STOP - WRITE POLICY ON companies ***' END

  UNION ALL SELECT 4, 'B1  SAFETY policy count',
         (SELECT policies::text FROM saf_pol), '60',
         CASE WHEN (SELECT policies=60 FROM saf_pol) THEN 'PASS' ELSE '*** STOP ***' END
  UNION ALL SELECT 5, 'B2  SAFETY tables carrying policies',
         (SELECT tables::text FROM saf_pol), '51',
         CASE WHEN (SELECT tables=51 FROM saf_pol) THEN 'PASS' ELSE '*** STOP ***' END
  UNION ALL SELECT 6, 'B3  SAFETY tables in schema',
         (SELECT n::text FROM saf_tab), 'must equal BEFORE', 'compare BEFORE/AFTER'
  UNION ALL SELECT 7, 'B4  SAFETY RLS fingerprint',
         (SELECT fp FROM saf_fp), '9685f46af7858c119dee575af2ca71f1',
         CASE WHEN (SELECT fp FROM saf_fp) = '9685f46af7858c119dee575af2ca71f1'
              THEN 'PASS' ELSE '*** STOP - SAFETY RLS CHANGED ***' END

  UNION ALL SELECT 8, 'C1  sql/098 function count',
         (SELECT n::text FROM cm098_fp), '8',
         CASE WHEN (SELECT n=8 FROM cm098_fp) THEN 'PASS' ELSE '*** STOP ***' END
  UNION ALL SELECT 9, 'C2  sql/098 function fingerprint',
         (SELECT fp FROM cm098_fp), 'must equal BEFORE', 'compare BEFORE/AFTER'

  UNION ALL SELECT 10, 'D1  sql/099 function count',
         (SELECT n::text FROM cm099), 'BEFORE 0 / AFTER 2', 'the only row expected to change'
  UNION ALL SELECT 11, 'D2  sql/099 SECURITY DEFINER',
         (SELECT all_secdef::text FROM cm099), 'AFTER true', 'AFTER only'
  UNION ALL SELECT 12, 'D3  sql/099 search_path pinned',
         (SELECT all_pinned::text FROM cm099), 'AFTER true', 'AFTER only'
  UNION ALL SELECT 13, 'D4  sql/099 EXECUTE granted to PUBLIC',
         (SELECT any_public_exec::text FROM cm099), 'false',
         CASE WHEN (SELECT any_public_exec FROM cm099)
              THEN '*** STOP - PUBLIC MAY EXECUTE ***' ELSE 'PASS' END
  UNION ALL SELECT 14, 'D5  sql/099 EXECUTE granted to authenticated',
         (SELECT all_auth_exec::text FROM cm099), 'AFTER true', 'AFTER only'
  UNION ALL SELECT 15, 'D6  sql/099 references the tenancy spine',
         (SELECT refs_spine::text FROM cm099), 'false',
         CASE WHEN (SELECT refs_spine FROM cm099)
              THEN '*** STOP - 099 TOUCHES THE SPINE ***' ELSE 'PASS' END

  UNION ALL SELECT 16, 'E1  grant table RLS enabled',
         (SELECT rls::text FROM grant_tbl), 'true',
         CASE WHEN (SELECT rls FROM grant_tbl) THEN 'PASS' ELSE '*** STOP ***' END
  UNION ALL SELECT 17, 'E2  grant table policy count',
         (SELECT pols::text FROM grant_tbl), '0 (deny by default)',
         CASE WHEN (SELECT pols=0 FROM grant_tbl) THEN 'PASS' ELSE '*** STOP ***' END
  UNION ALL SELECT 18, 'E3  grant table privs held by anon/authenticated',
         (SELECT privs::text FROM grant_tbl), '0',
         CASE WHEN (SELECT privs=0 FROM grant_tbl) THEN 'PASS' ELSE '*** STOP ***' END

  UNION ALL SELECT 19, 'F1  companies identity columns',
         (SELECT n::text FROM id_cols), '12',
         CASE WHEN (SELECT n=12 FROM id_cols) THEN 'PASS' ELSE '*** REVIEW ***' END
  UNION ALL SELECT 20, 'F2  company-branding bucket public?',
         (SELECT coalesce(is_public::text,'(missing)') FROM brand), 'false',
         CASE WHEN (SELECT is_public IS FALSE FROM brand) THEN 'PASS' ELSE '*** STOP ***' END
  UNION ALL SELECT 21, 'F3  company-branding storage policies',
         (SELECT pols::text FROM brand), '4',
         CASE WHEN (SELECT pols=4 FROM brand) THEN 'PASS' ELSE '*** REVIEW ***' END

  UNION ALL SELECT 22, 'G1  HSE Insight company_users rows',
         (SELECT members::text FROM hse), '0',
         CASE WHEN (SELECT members=0 FROM hse) THEN 'PASS' ELSE '*** STOP - MEMBERSHIP CREATED ***' END
  UNION ALL SELECT 23, 'G2  HSE Insight ACTIVE Company Master grants',
         (SELECT active_grants::text FROM hse), '1',
         CASE WHEN (SELECT active_grants=1 FROM hse) THEN 'PASS' ELSE '*** STOP - DEMO GRANT CHANGED ***' END
  UNION ALL SELECT 24, 'G3  company_users rows (whole platform)',
         (SELECT cu_total::text FROM hse), 'must equal BEFORE', 'compare BEFORE/AFTER'
  UNION ALL SELECT 25, 'G4  vyron_company_master_admins rows (all)',
         (SELECT grants_total::text FROM hse), 'must equal BEFORE', 'compare BEFORE/AFTER'
  UNION ALL SELECT 26, 'G5  company_master audit rows',
         (SELECT audit_rows::text FROM hse), 'must equal BEFORE', 'compare BEFORE/AFTER'
) g
ORDER BY seq;

-- 098-PREFLIGHT-AFTER.sql
-- =========================================================================
-- PRODUCTION PRE-FLIGHT — VERIFY **IMMEDIATELY AFTER** APPLYING 098
--
-- READ ONLY. Every statement is a SELECT.
--
-- Run this the moment sql/098-vyron-company-master.sql has been applied, in
-- the same session or a new one, in the SQL Editor.
--
-- THE TWO VALUES THAT DECIDE EVERYTHING
--   1. GATE 1 must still be a4ca0efca3674ec4889de649f999c3c0
--   2. The SAFETY FINGERPRINT must equal the one captured BEFORE
--
-- If either differs, STOP. Do not deploy CORE or Safety. Section 10a/10b of
-- the BEFORE script gives per-policy hashes so the changed policy can be
-- named exactly.
-- =========================================================================

-- ---- 1. THE tenancy spine. Must be unchanged. ---------------------------
SELECT
  'GATE 1  vyron_user_company_ids md5' AS gate,
  md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure)) AS value,
  'a4ca0efca3674ec4889de649f999c3c0' AS expected,
  CASE WHEN md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure))
            = 'a4ca0efca3674ec4889de649f999c3c0'
       THEN 'PASS' ELSE '*** STOP - SPINE CHANGED ***' END AS verdict;

-- ---- 2. Footprint must be unchanged (82 / 75 as recorded live) ----------
SELECT
  'GATE 2  spine dependency footprint' AS gate,
  count(*)::text || ' policies / ' || count(DISTINCT tablename)::text || ' tables' AS value
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ILIKE '%vyron_user_company_ids%'
       OR with_check ILIKE '%vyron_user_company_ids%');

-- ---- 3. companies must STILL have exactly one SELECT-only policy --------
SELECT
  'GATE 3  companies policies' AS gate,
  count(*) AS policy_count,
  coalesce(string_agg(DISTINCT cmd, ','), '(none)') AS commands,
  CASE WHEN count(*) = 1 AND bool_and(cmd = 'SELECT')
       THEN 'PASS' ELSE '*** STOP - A WRITE POLICY WAS ADDED ***' END AS verdict
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'companies';

-- =========================================================================
-- GATE 10 — SAFETY RLS FINGERPRINT (AFTER)
-- Must equal the BEFORE value, character for character.
-- =========================================================================
SELECT
  'SAFETY FINGERPRINT (AFTER)'                                    AS label,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename LIKE 'safety\_%')      AS policy_count,
  (SELECT count(DISTINCT tablename) FROM pg_policies
    WHERE schemaname='public' AND tablename LIKE 'safety\_%')      AS table_count,
  (SELECT count(*) FROM pg_tables
    WHERE schemaname='public' AND tablename LIKE 'safety\_%')      AS safety_tables,
  md5(
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
  )                                                                AS fingerprint;

-- =========================================================================
-- WHAT 098 SHOULD HAVE CREATED
-- =========================================================================

-- 8 functions, all SECURITY DEFINER, all pinning search_path.
SELECT
  'NEW  functions' AS check,
  p.proname,
  p.prosecdef AS security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '*** NO search_path ***') AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                    'vyron_can_manage_company_master_admins',
                    'vyron_grant_company_master_admin',
                    'vyron_revoke_company_master_admin',
                    'vyron_list_company_master_admins',
                    'vyron_get_company','vyron_update_company')
ORDER BY p.proname;   -- expect 8 rows, security_definer = true, search_path set

-- None of them may reference the HR/payroll tenancy spine.
SELECT
  'NEW  isolation from the spine' AS check,
  p.proname,
  pg_get_functiondef(p.oid) ILIKE '%vyron_user_company_ids%' AS references_spine
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                    'vyron_can_manage_company_master_admins',
                    'vyron_grant_company_master_admin',
                    'vyron_revoke_company_master_admin',
                    'vyron_list_company_master_admins',
                    'vyron_get_company','vyron_update_company')
ORDER BY p.proname;   -- every references_spine must be false

-- The grant table: RLS on, NO policy, NO client privilege. Both locks turned.
SELECT
  'NEW  grant table closed' AS check,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.vyron_company_master_admins'::regclass)     AS rls_enabled,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='vyron_company_master_admins') AS policies,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='vyron_company_master_admins'
      AND grantee IN ('anon','authenticated'))                      AS client_privileges;
-- expect: true, 0, 0

-- 12 identity columns.
SELECT
  'NEW  identity columns' AS check,
  count(*) AS added,
  12 AS expected
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'companies'
  AND column_name IN ('vat_number','email','website','postal_address',
                      'address_line1','address_line2','address_city',
                      'address_region','address_postal_code','industry',
                      'logo_bucket','logo_path');

-- Private branding bucket and its four policies.
SELECT 'NEW  branding bucket' AS check, id, public FROM storage.buckets
WHERE id = 'company-branding';   -- public MUST be false

SELECT 'NEW  branding policies' AS check, policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND policyname LIKE 'company\_branding%'
ORDER BY policyname;   -- expect 4

-- HSE Insight must STILL have no CORE membership. 098 creates none.
SELECT
  'GATE 6  HSE Insight company_users' AS gate,
  count(*) AS value,
  0 AS expected
FROM public.company_users cu
JOIN public.companies c ON c.id = cu.company_id
WHERE c.name ILIKE '%HSE Insight%';

-- Nothing has been granted to anybody yet: 098 seeds no rows.
SELECT 'NEW  grants seeded by the migration' AS check, count(*) AS value, 0 AS expected
FROM public.vyron_company_master_admins;

-- =========================================================================
-- DECISION
--
--   GATE 1 verdict PASS
--   AND GATE 3 verdict PASS
--   AND SAFETY FINGERPRINT (AFTER) = SAFETY FINGERPRINT (BEFORE)
--   AND every references_spine = false
--   AND grant table: true / 0 / 0
--   AND HSE Insight company_users = 0
--
--   -> the database gate is closed. Report back before deploying anything.
--
-- Any other outcome: STOP, and report which check failed with its output.
-- =========================================================================

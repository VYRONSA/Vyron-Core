-- 098-PREFLIGHT-BEFORE.sql
-- =========================================================================
-- PRODUCTION PRE-FLIGHT — CAPTURE **BEFORE** APPLYING 098
--
-- READ ONLY. Every statement is a SELECT. Nothing is created, altered or
-- written. Safe to run on production at any time.
--
-- HOW TO RUN
--   Supabase Dashboard → project gpiqkwebizuqajgaoxhm → SQL Editor →
--   New query → paste this whole file → Run.
--
-- Then copy the ENTIRE result of the final query (one row, one column) and
-- keep it. After applying 098 you run sql/098-PREFLIGHT-AFTER.sql, which
-- produces the same shape, and the two must be identical.
--
-- WHY ONE AGGREGATE VALUE
--   A before/after comparison read by eye over dozens of policy rows is a
--   comparison nobody actually performs. This collapses the whole Safety RLS
--   surface into a single hash, so "unchanged" is a string equality anyone can
--   check in a second, and a single altered predicate changes it.
-- =========================================================================

-- ---- 1. The tenancy spine. MUST be a4ca0efca3674ec4889de649f999c3c0 ------
SELECT
  'GATE 1  vyron_user_company_ids md5' AS gate,
  md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure)) AS value,
  'a4ca0efca3674ec4889de649f999c3c0' AS expected;

-- ---- 2. Its dependency footprint (recorded live as 82 / 75) --------------
SELECT
  'GATE 2  spine dependency footprint' AS gate,
  count(*)::text || ' policies / ' || count(DISTINCT tablename)::text || ' tables' AS value
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ILIKE '%vyron_user_company_ids%'
       OR with_check ILIKE '%vyron_user_company_ids%');

-- ---- 3. companies RLS: expected one SELECT-only policy -------------------
SELECT 'GATE 3  companies policies' AS gate, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'companies'
ORDER BY policyname;

-- ---- 4. Identity columns: expected ABSENT before 098 ---------------------
SELECT
  'GATE 4  identity columns already present' AS gate,
  coalesce(string_agg(column_name, ', ' ORDER BY column_name), '(none - expected)') AS value
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'companies'
  AND column_name IN ('vat_number','email','website','postal_address',
                      'address_line1','address_line2','address_city',
                      'address_region','address_postal_code','industry',
                      'logo_bucket','logo_path');

-- ---- 5. Company Master objects: expected ABSENT before 098 ---------------
SELECT
  'GATE 5  Company Master objects already present' AS gate,
  coalesce(string_agg(proname, ', ' ORDER BY proname), '(none - expected)') AS value
FROM pg_proc
WHERE proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                  'vyron_can_manage_company_master_admins',
                  'vyron_grant_company_master_admin',
                  'vyron_revoke_company_master_admin',
                  'vyron_list_company_master_admins',
                  'vyron_get_company','vyron_update_company');

SELECT
  'GATE 5b grant table already present' AS gate,
  coalesce(to_regclass('public.vyron_company_master_admins')::text, '(absent - expected)') AS value;

-- ---- 6. HSE Insight must have no CORE membership ------------------------
SELECT
  'GATE 6  HSE Insight company_users' AS gate,
  count(*)::text AS value,
  '0' AS expected
FROM public.company_users cu
JOIN public.companies c ON c.id = cu.company_id
WHERE c.name ILIKE '%HSE Insight%';

-- ---- 7. Branding bucket: expected absent --------------------------------
SELECT
  'GATE 7  company-branding bucket' AS gate,
  coalesce((SELECT id || ' public=' || public::text
              FROM storage.buckets WHERE id = 'company-branding'),
           '(absent - expected)') AS value;

-- =========================================================================
-- GATE 10 — THE SAFETY RLS FINGERPRINT
--
-- This is the gate the controlled environment could not close, because the
-- local replica has no production Safety schema.
-- =========================================================================

-- 10a. Readable detail, for diagnosing a mismatch if one ever appears.
SELECT
  tablename,
  policyname,
  cmd,
  md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) AS policy_hash
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'safety\_%'
ORDER BY tablename, policyname;

-- 10b. Safety SECURITY DEFINER functions, which are part of the same surface.
SELECT
  p.proname,
  md5(pg_get_functiondef(p.oid)) AS function_hash
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'safety\_%'
ORDER BY p.proname;

-- 10c. THE ONE VALUE TO KEEP.
--      Copy this row. It is the whole Safety authorisation surface reduced to
--      counts plus a single hash.
SELECT
  'SAFETY FINGERPRINT (BEFORE)'                                   AS label,
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
-- STOP HERE.
--
-- Compare GATE 1 against a4ca0efca3674ec4889de649f999c3c0.
-- Keep the 10c row.
--
-- If GATE 1 does not match, DO NOT APPLY 098. Report the discrepancy.
-- If gates 4, 5, 5b or 7 show objects already present, DO NOT APPLY 098 -
-- some part of it has been run before, and that must be understood first.
-- =========================================================================

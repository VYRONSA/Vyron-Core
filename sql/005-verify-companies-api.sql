-- 005-verify-companies-api.sql
-- Run in Supabase SQL editor after setup (or when Client Setup provision fails).
-- Confirms Postgres objects exist; does not prove PostgREST exposure (see RUN_COMPANY_TABLES.md).

-- 1) Tables in public
SELECT 'table' AS kind, table_name AS name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'company_users')
ORDER BY table_name;

-- 2) RPCs (optional for app; provision uses REST when API sees companies)
SELECT 'rpc' AS kind,
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('vyron_get_company_access', 'vyron_provision_company')
ORDER BY p.proname;

-- 3) Row counts (sanity)
SELECT 'companies' AS table_name, count(*)::bigint AS row_count FROM public.companies
UNION ALL
SELECT 'company_users', count(*)::bigint FROM public.company_users;

-- 4) Optional: test insert as postgres (not used by the app — confirms DB side only)
-- Uncomment to verify INSERT works in Postgres regardless of PostgREST cache:
/*
INSERT INTO public.companies (name, subscription_status)
VALUES ('__verify_delete_me__', 'active')
RETURNING id, name;
-- DELETE FROM public.companies WHERE name = '__verify_delete_me__';
*/

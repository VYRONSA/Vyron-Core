-- 004-provision-rpc-only.sql
-- VYRON CORE — minimal paste: only vyron_provision_company (Client Setup RPC fallback).
-- Use when 000/002 failed partway, or you only need the provision RPC (tables already exist from 001).
-- Idempotent. Ends with NOTIFY pgrst reload + verification SELECT.

BEGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.vyron_provision_company(text, text);

CREATE OR REPLACE FUNCTION public.vyron_provision_company(
  p_name text,
  p_subscription_status text DEFAULT 'active'
)
RETURNS TABLE (
  id uuid,
  name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  RETURN QUERY
  INSERT INTO public.companies (name, subscription_status)
  VALUES (trim(p_name), coalesce(nullif(trim(p_subscription_status), ''), 'active'))
  RETURNING companies.id, companies.name;
END;
$$;

ALTER FUNCTION public.vyron_provision_company(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.vyron_provision_company(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.vyron_provision_company(text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.vyron_provision_company(text, text) IS
  'SECURITY DEFINER: insert into public.companies for Client Setup when PostgREST cannot see the table (PGRST205).';

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS function_parameters
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'vyron_provision_company';

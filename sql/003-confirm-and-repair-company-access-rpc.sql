-- 003-confirm-and-repair-company-access-rpc.sql
-- VYRON CORE — optional repair if RPC still wrong after 002 (re-applies same function body)

DROP FUNCTION IF EXISTS public.vyron_get_company_access();
DROP FUNCTION IF EXISTS public.vyron_get_company_access(json);
DROP FUNCTION IF EXISTS public.vyron_get_company_access(jsonb);
DROP FUNCTION IF EXISTS public.vyron_get_company_access(text);
DROP FUNCTION IF EXISTS public.vyron_get_company_access(uuid);

CREATE OR REPLACE FUNCTION public.vyron_get_company_access()
RETURNS TABLE (
  company_id uuid,
  company_name text,
  user_role text,
  user_status text,
  subscription_status text,
  subscription_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email text;
BEGIN
  current_email := lower(coalesce(auth.email(), ''));

  RETURN QUERY
  SELECT
    c.id::uuid AS company_id,
    c.name::text AS company_name,
    cu.role::text AS user_role,
    cu.status::text AS user_status,
    coalesce(c.subscription_status::text, 'active') AS subscription_status,
    CASE
      WHEN coalesce(c.subscription_status::text, 'active') = 'active' THEN false
      ELSE true
    END AS subscription_locked
  FROM public.company_users cu
  JOIN public.companies c
    ON c.id = cu.company_id
  WHERE lower(cu.user_email::text) = current_email
    AND lower(cu.status::text) = 'active'
  ORDER BY cu.created_at ASC
  LIMIT 1;
END;
$$;

ALTER FUNCTION public.vyron_get_company_access() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.vyron_get_company_access() FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.vyron_get_company_access() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.vyron_get_company_access() IS
  'SECURITY DEFINER: resolve active company for auth.email() when REST company_users is unavailable.';

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

NOTIFY pgrst, 'reload schema';

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS function_parameters
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('vyron_get_company_access', 'vyron_provision_company')
ORDER BY p.proname;

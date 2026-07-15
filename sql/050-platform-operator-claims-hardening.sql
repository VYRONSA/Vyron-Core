-- 050-platform-operator-claims-hardening.sql
-- Replace hardcoded platform-operator identity with JWT role/claims checks.
-- Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.vyron_is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_claims AS (
    SELECT lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) AS role
    UNION ALL
    SELECT lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '')) AS role
    UNION ALL
    SELECT lower(value)
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'roles') = 'array'
          THEN auth.jwt() -> 'app_metadata' -> 'roles'
        ELSE '[]'::jsonb
      END
    ) AS value
    UNION ALL
    SELECT lower(value)
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'roles') = 'array'
          THEN auth.jwt() -> 'user_metadata' -> 'roles'
        ELSE '[]'::jsonb
      END
    ) AS value
  )
  SELECT EXISTS (
    SELECT 1
    FROM role_claims
    WHERE role IN ('super_admin', 'platform_admin', 'platform_operator', 'supervisor tools')
  );
$$;

REVOKE ALL ON FUNCTION public.vyron_is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_is_platform_operator() TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

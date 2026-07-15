-- 060-privilege-escalation-hardening.sql
-- Phase 1 Production Certification: closes two verified privilege-escalation defects.
--
-- Defect 1: public.vyron_is_platform_operator() trusted auth.jwt() -> 'user_metadata',
-- which any authenticated user can self-edit via supabase.auth.updateUser({ data: {...} })
-- from the browser. Every table hardened by 049 (all company-scoped tables, including
-- company_users) grants full access when this function returns true, so any signed-in
-- user could set user_metadata.role = 'platform_operator' and read/write every tenant's
-- data. Fix: only trust auth.jwt() -> 'app_metadata', which is exclusively writable via
-- the Supabase Admin API (service role), never by the end user.
--
-- Defect 2: the generic company_id-scoped RLS policy (049) allows any active member of a
-- company to INSERT/UPDATE company_users rows for that company with no restriction on the
-- role/status columns, so an "employee" can grant themselves (or anyone) "owner" directly
-- via PostgREST. Fix: a trigger that requires the acting user to already be an active
-- owner/admin of the company before role/status/company_id/user_email can be set, blocks
-- self-service role/status changes outright, and reserves granting the "owner" role to
-- existing owners. Non-sensitive self-updates (e.g. last_login_at) are unaffected.
--
-- Safe to rerun.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run 030-multi-tenant-security.sql first.';
  END IF;

  IF to_regclass('public.company_users') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.company_users. Run 001-create-companies-tables.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Defect 1: platform-operator check must never trust user-editable claims.
-- ---------------------------------------------------------------------------

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
    SELECT lower(value)
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'roles') = 'array'
          THEN auth.jwt() -> 'app_metadata' -> 'roles'
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

-- ---------------------------------------------------------------------------
-- Defect 2: block self-service role/status escalation on company_users.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.vyron_guard_company_users_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  actor_role text;
  sensitive_change boolean;
BEGIN
  -- The service-role key (used by trusted server-side code such as
  -- lib/create-client-login-user.ts for provisioning new company owner/admin
  -- accounts) bypasses RLS policies via BYPASSRLS, but triggers still fire for
  -- it. Without this check, legitimate service-role writes to company_users
  -- would be rejected because auth.jwt() carries no end-user email/role claims
  -- for that connection. Only trusted server code has the service-role key, so
  -- this is not a privilege-escalation path.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.vyron_is_platform_operator() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    sensitive_change := true;
  ELSE
    sensitive_change := (
      NEW.role IS DISTINCT FROM OLD.role
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR lower(NEW.user_email) IS DISTINCT FROM lower(OLD.user_email)
    );
  END IF;

  IF NOT sensitive_change THEN
    RETURN NEW;
  END IF;

  SELECT cu.role INTO actor_role
  FROM public.company_users cu
  WHERE cu.company_id = NEW.company_id
    AND lower(cu.user_email) = actor_email
    AND cu.status = 'active'
  LIMIT 1;

  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an active owner or admin may modify company user role, status, or company assignment.';
  END IF;

  IF TG_OP = 'UPDATE' AND lower(OLD.user_email) = actor_email
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'You cannot change your own role or status.';
  END IF;

  IF NEW.role = 'owner' AND actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only an owner may grant the owner role.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vyron_company_users_role_guard ON public.company_users;
CREATE TRIGGER vyron_company_users_role_guard
  BEFORE INSERT OR UPDATE ON public.company_users
  FOR EACH ROW
  EXECUTE FUNCTION public.vyron_guard_company_users_role_change();

COMMIT;

NOTIFY pgrst, 'reload schema';

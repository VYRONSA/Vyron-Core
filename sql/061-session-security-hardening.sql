-- 061-session-security-hardening.sql
-- Phase 1C: session security hardening.
--
-- 1. Adds company-configurable session idle/absolute timeout columns (nullable —
--    application code falls back to safe defaults when unset). Bounded by CHECK
--    constraints so a bad value can't accidentally disable timeout enforcement.
-- 2. Adds a trigger restricting who may revoke another user's tracked session
--    (public.vyron_user_sessions.revoked_at): the session owner (self logout),
--    an active owner/admin of that session's company, or a platform operator.
--    Previously any active company member could revoke any other same-company
--    member's session row via the existing tenant-scoped RLS policy — harmless
--    while revoked_at was inert, but Force Logout now actually terminates the
--    session server-side, so who can set it needs the same role gate as the
--    company_users escalation guard in 060.
--
-- Safe to rerun.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.companies. Run 001-create-companies-tables.sql first.';
  END IF;

  IF to_regclass('public.vyron_user_sessions') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_user_sessions. Run 030-multi-tenant-security.sql first.';
  END IF;

  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run 060-privilege-escalation-hardening.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Company-configurable session timeouts (NULL = application default).
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes integer;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS session_absolute_timeout_minutes integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_session_idle_timeout_minutes_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_session_idle_timeout_minutes_check
      CHECK (session_idle_timeout_minutes IS NULL OR session_idle_timeout_minutes BETWEEN 5 AND 480);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_session_absolute_timeout_minutes_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_session_absolute_timeout_minutes_check
      CHECK (session_absolute_timeout_minutes IS NULL OR session_absolute_timeout_minutes BETWEEN 30 AND 20160);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Guard who can revoke a company member's session (force logout).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.vyron_guard_session_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  actor_role text;
  newly_revoked boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.vyron_is_platform_operator() THEN
    RETURN NEW;
  END IF;

  newly_revoked := TG_OP = 'UPDATE'
    AND NEW.revoked_at IS NOT NULL
    AND OLD.revoked_at IS NULL;

  IF NOT newly_revoked THEN
    RETURN NEW;
  END IF;

  -- Self logout / self-revocation of your own session is always allowed.
  IF lower(NEW.user_email) = actor_email THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'Only an active owner or admin may force logout another user.';
  END IF;

  SELECT cu.role INTO actor_role
  FROM public.company_users cu
  WHERE cu.company_id = NEW.company_id
    AND lower(cu.user_email) = actor_email
    AND cu.status = 'active'
  LIMIT 1;

  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an active owner or admin may force logout another user.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vyron_session_revocation_guard ON public.vyron_user_sessions;
CREATE TRIGGER vyron_session_revocation_guard
  BEFORE UPDATE ON public.vyron_user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.vyron_guard_session_revocation();

COMMIT;

NOTIFY pgrst, 'reload schema';

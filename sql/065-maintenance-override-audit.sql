-- 065-maintenance-override-audit.sql
-- Phase 3 hardening: the emergency maintenance-mode bypass (sql/064
-- vyron_validate_maintenance_override) was never audited — a valid or invalid
-- override code could be used with no trace. This adds a narrow SECURITY
-- DEFINER RPC that logs every attempt (success and failure) to
-- vyron_audit_log, callable by anon since the maintenance page is reachable
-- by unauthenticated/blocked visitors. Idempotent. Run after sql/064.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.vyron_audit_log') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_audit_log. Run sql/030 first.';
  END IF;
  IF to_regprocedure('public.vyron_validate_maintenance_override(text)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_validate_maintenance_override(text). Run sql/064 first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.vyron_log_maintenance_override_attempt(p_success boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.vyron_audit_log (company_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    coalesce(auth.jwt() ->> 'email', 'anonymous'),
    CASE WHEN p_success THEN 'maintenance_override_used' ELSE 'maintenance_override_failed' END,
    'maintenance_mode',
    NULL,
    jsonb_build_object('success', p_success)
  );
$$;

REVOKE ALL ON FUNCTION public.vyron_log_maintenance_override_attempt(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_log_maintenance_override_attempt(boolean) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 064-platform-console-production-polish.sql
-- Phase 3 production polish: maintenance-mode enforcement RPCs (safe to expose to
-- anon/authenticated since they only leak maintenance state, never table contents),
-- expanded platform_settings (dynamic defaults, support contact, notification
-- thresholds/preferences), and supporting indexes. Idempotent. Run after sql/063.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.platform_settings') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.platform_settings. Run sql/063 first.';
  END IF;
  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run sql/050/060 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Maintenance-mode read/override RPCs — SECURITY DEFINER, deliberately narrow:
--    these expose only {enabled, message, expected_return_at} or a boolean, never
--    the override code itself or any other settings row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_get_maintenance_mode()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'enabled', coalesce((value ->> 'enabled')::boolean, false),
    'message', coalesce(value ->> 'message', ''),
    'expected_return_at', value ->> 'expected_return_at'
  )
  FROM public.platform_settings
  WHERE key = 'maintenance_mode';
$$;

REVOKE ALL ON FUNCTION public.vyron_get_maintenance_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_get_maintenance_mode() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.vyron_validate_maintenance_override(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT value ->> 'override_code' FROM public.platform_settings WHERE key = 'maintenance_mode') = p_code
    AND p_code IS NOT NULL
    AND length(p_code) > 0,
    false
  );
$$;

REVOKE ALL ON FUNCTION public.vyron_validate_maintenance_override(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_validate_maintenance_override(text) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Expanded platform_settings — dynamic defaults (Priority 7), support
--    contact, notification thresholds/preferences. Existing rows untouched.
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES
  ('default_trial_days', '{"days": 14}'::jsonb),
  ('default_ai_credit_limit', '{"credits": 500}'::jsonb),
  ('default_storage_limit_gb', '{"gb": 25}'::jsonb),
  ('default_employee_limit', '{"limit": 50}'::jsonb),
  ('default_session_timeout_minutes', '{"idle": 30, "absolute": 480}'::jsonb),
  ('support_contact', '{"email": "support@vyron.app", "phone": ""}'::jsonb),
  ('platform_email', '{"email": "no-reply@vyron.app"}'::jsonb),
  ('notification_thresholds', '{"expiringSoonDays": 7, "inactiveDays": 30}'::jsonb),
  (
    'notification_preferences',
    '{"trial_expiring": {"email": false, "inApp": true}, "subscription_expiring": {"email": false, "inApp": true}, "customer_suspended": {"email": false, "inApp": true}, "customer_inactive": {"email": false, "inApp": true}, "failed_job": {"email": false, "inApp": true}}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- maintenance_mode may already exist from sql/063 without the newer fields — merge them in.
UPDATE public.platform_settings
SET value = value || '{"expected_return_at": null, "override_code": null}'::jsonb
WHERE key = 'maintenance_mode'
  AND NOT (value ? 'override_code');

-- ---------------------------------------------------------------------------
-- 3. Audit vocabulary — add 'cancel' as its own action (was folded into 'update').
-- ---------------------------------------------------------------------------
-- (No DB enum to alter — public.vyron_audit_log.action is free text; this is a
-- TypeScript-side addition in lib/audit-log.ts. Documented here for traceability.)

-- ---------------------------------------------------------------------------
-- 4. Supporting indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_companies_industry ON public.companies (industry);
CREATE INDEX IF NOT EXISTS idx_company_users_last_login ON public.company_users (last_login_at DESC);

COMMIT;

NOTIFY pgrst, 'reload schema';

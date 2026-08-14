-- 068-platform-admin-self-healing-bootstrap.sql
-- Replaces the one-time bootstrap latch with a self-healing invariant.
--
-- WHY
--
-- sql/066 made first-operator bootstrap a permanent one-shot: once
-- public.vyron_platform_bootstrap held a row, both the SQL function and
-- POST /api/platform/bootstrap refused forever.
--
-- That is unrecoverable in a situation that really happens: the promoted account gets
-- deleted (or the database is restored without it). The platform then has ZERO platform
-- operators and a bootstrap that will never run again, so the only way back in is
-- hand-editing auth.users — exactly what the bootstrap existed to avoid.
--
-- The guard is now an invariant instead of a one-shot:
--
--     bootstrap may run only while NO platform operator exists
--
-- That is strictly safer in the case that matters and self-healing in the case that
-- broke. It cannot be an escalation path: while any operator exists it refuses, and
-- further operators are promoted from the Platform Console by an existing operator.
-- When there are none, there is no privileged account left to escalate against.
--
-- The latch table is KEPT, but demoted from gate to history: it records the most recent
-- bootstrap for audit rather than blocking the next one.
--
-- Idempotent. Run after sql/067.
-- NOTE: the application's primary paths (boot-time reconciler and
-- POST /api/platform/bootstrap) do not depend on this file. It exists so the SQL path
-- cannot contradict the application's architecture.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.vyron_platform_bootstrap') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_platform_bootstrap. Run sql/066 first.';
  END IF;
END $$;

-- The single-row latch now records history, so repeated bootstraps must be able to
-- overwrite it rather than collide on the primary key.
COMMENT ON TABLE public.vyron_platform_bootstrap IS
  'History of the most recent Platform Administrator bootstrap. Retained for audit only — it no longer blocks re-bootstrap. The live guard is "no platform operator currently exists" (sql/068).';

CREATE OR REPLACE FUNCTION public.vyron_bootstrap_platform_operator(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
  v_meta jsonb;
  v_existing text;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'An email address is required.';
  END IF;

  -- Serialises concurrent callers; the zero-operator check below is the real guard.
  PERFORM pg_advisory_xact_lock(hashtext('vyron_platform_bootstrap'));

  -- The invariant that replaced the permanent latch. Note it deliberately ignores the
  -- target account itself, so re-running for the current administrator is a harmless
  -- no-op rather than an error.
  SELECT u.email INTO v_existing
  FROM auth.users u
  WHERE public.vyron_app_meta_has_operator_claim(coalesce(u.raw_app_meta_data, '{}'::jsonb))
    AND lower(u.email) <> v_email
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'A Platform Operator already exists (%). Promote further operators from /platform.', v_existing;
  END IF;

  SELECT u.id, coalesce(u.raw_app_meta_data, '{}'::jsonb)
  INTO v_user_id, v_meta
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  -- Unlike the application paths, SQL cannot safely create an auth user (password
  -- hashing is GoTrue's job), so this path still requires the account to exist.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'No auth user found for %. Create the account first (sign up, or use npm run bootstrap:admin which can create it), then re-run.', v_email;
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data =
        v_meta
        || jsonb_build_object('role', 'platform_operator')
        || jsonb_build_object(
             'roles',
             (
               SELECT to_jsonb(array_agg(DISTINCT claim))
               FROM (
                 SELECT jsonb_array_elements_text(
                          CASE
                            WHEN jsonb_typeof(v_meta -> 'roles') = 'array' THEN v_meta -> 'roles'
                            ELSE '[]'::jsonb
                          END
                        ) AS claim
                 UNION
                 SELECT 'platform_operator'
               ) merged
             )
           ),
      updated_at = now()
  WHERE id = v_user_id;

  -- Re-link memberships whose user_id went stale when the account was recreated.
  UPDATE public.company_users
  SET user_id = v_user_id
  WHERE lower(user_email) = v_email
    AND (user_id IS NULL OR user_id <> v_user_id);

  -- History, not a gate: overwrite the single row instead of colliding with it.
  INSERT INTO public.vyron_platform_bootstrap
    (id, promoted_user_id, promoted_email, method, performed_by)
  VALUES (true, v_user_id, v_email, 'sql', current_user)
  ON CONFLICT (id) DO UPDATE
  SET promoted_user_id = EXCLUDED.promoted_user_id,
      promoted_email   = EXCLUDED.promoted_email,
      method           = EXCLUDED.method,
      performed_by     = EXCLUDED.performed_by,
      completed_at     = now();

  INSERT INTO public.vyron_audit_log
    (company_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    v_email,
    'platform_admin_provisioned',
    'platform_operator',
    v_user_id::text,
    jsonb_build_object('method', 'sql', 'performed_by', current_user, 'reason', 'sql_recovery')
  );

  RETURN format(
    '%s is now a Platform Operator. Sign in and open /platform.',
    v_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vyron_bootstrap_platform_operator(text) FROM PUBLIC;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 066-platform-operator-bootstrap.sql
-- First-run bootstrap for the very first Platform Operator.
--
-- Problem: every Platform Console gate (middleware.ts, app/api/platform/_shared.ts,
-- public.vyron_is_platform_operator()) reads the operator claim from
-- auth.users.raw_app_meta_data, which can only be written by the service role. On a
-- fresh project that means nobody can reach /platform until somebody hand-edits
-- app_metadata in the Supabase dashboard — an unaudited, error-prone privileged edit.
--
-- This migration adds:
--   1. public.vyron_platform_bootstrap — a single-row latch. Once a row exists the
--      bootstrap path is permanently closed (both the SQL function below and
--      POST /api/platform/bootstrap refuse to run). Deny-all RLS; service role only.
--   2. public.vyron_app_meta_has_operator_claim(jsonb) — claim test reused by the
--      "does an operator already exist?" scan. Mirrors the claim set in
--      lib/server/platform-operator.ts and public.vyron_is_platform_operator().
--   3. public.vyron_bootstrap_platform_operator(text) — the SQL bootstrap path.
--      Promotes one existing auth.users row, latches the table, and writes
--      vyron_audit_log. NOT granted to anon/authenticated: only the SQL editor
--      (postgres) can execute it.
--
-- Idempotent. Run after sql/065.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.vyron_audit_log') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_audit_log. Run sql/030 first.';
  END IF;
  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run sql/060 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The one-time latch.
-- ---------------------------------------------------------------------------

-- id is a constant true with a PRIMARY KEY + CHECK: at most one row can ever
-- exist, and a second bootstrap attempt fails on the primary key (23505) rather
-- than racing. That unique violation IS the "permanently disabled" guarantee.
CREATE TABLE IF NOT EXISTS public.vyron_platform_bootstrap (
  id boolean PRIMARY KEY DEFAULT true,
  promoted_user_id uuid,
  promoted_email text NOT NULL,
  method text NOT NULL DEFAULT 'api',
  performed_by text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_platform_bootstrap_single_row CHECK (id),
  CONSTRAINT vyron_platform_bootstrap_method_check CHECK (method IN ('api', 'sql'))
);

COMMENT ON TABLE public.vyron_platform_bootstrap IS
  'One-time latch for first-Platform-Operator bootstrap. A row here permanently disables both bootstrap paths. Never delete this row.';

ALTER TABLE public.vyron_platform_bootstrap ENABLE ROW LEVEL SECURITY;

-- No policies are created on purpose: with RLS enabled and zero policies, anon
-- and authenticated can read/write nothing. The service role bypasses RLS, and
-- FORCE is deliberately not set so the SECURITY DEFINER function below can always
-- write the latch row.
REVOKE ALL ON public.vyron_platform_bootstrap FROM PUBLIC;
REVOKE ALL ON public.vyron_platform_bootstrap FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.vyron_platform_bootstrap TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Operator-claim test over a raw_app_meta_data document.
-- ---------------------------------------------------------------------------
-- Keep the role list in sync with PLATFORM_OPERATOR_ROLE_CLAIMS
-- (lib/server/platform-operator.ts) and public.vyron_is_platform_operator() (sql/060).
CREATE OR REPLACE FUNCTION public.vyron_app_meta_has_operator_claim(p_meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT lower(coalesce(p_meta ->> 'role', '')) AS claim
      UNION ALL
      SELECT lower(value)
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(p_meta -> 'roles') = 'array' THEN p_meta -> 'roles'
          ELSE '[]'::jsonb
        END
      ) AS value
    ) claims
    WHERE claims.claim IN ('super_admin', 'platform_admin', 'platform_operator', 'supervisor tools')
  );
$$;

REVOKE ALL ON FUNCTION public.vyron_app_meta_has_operator_claim(jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. SQL bootstrap path.
-- ---------------------------------------------------------------------------
-- Usage (Supabase SQL editor, as postgres):
--   SELECT public.vyron_bootstrap_platform_operator('you@yourdomain.com');
-- The account must already exist in auth.users (sign up through the app first).
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

  -- Latch check. Advisory lock serialises concurrent callers; the PK on the
  -- latch table is the real guarantee.
  PERFORM pg_advisory_xact_lock(hashtext('vyron_platform_bootstrap'));

  IF EXISTS (SELECT 1 FROM public.vyron_platform_bootstrap) THEN
    RAISE EXCEPTION
      'Platform Operator bootstrap has already been used and is permanently disabled. Promote further operators from /platform.';
  END IF;

  -- Refuse if an operator already exists (e.g. promoted by hand before this
  -- migration): bootstrap is strictly a zero-operator recovery path.
  SELECT u.email INTO v_existing
  FROM auth.users u
  WHERE public.vyron_app_meta_has_operator_claim(coalesce(u.raw_app_meta_data, '{}'::jsonb))
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'A Platform Operator already exists (%). Bootstrap is only available when there are none.', v_existing;
  END IF;

  SELECT u.id, coalesce(u.raw_app_meta_data, '{}'::jsonb)
  INTO v_user_id, v_meta
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'No auth user found for %. Create the account first (sign up in the app), then re-run this function.', v_email;
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

  INSERT INTO public.vyron_platform_bootstrap
    (id, promoted_user_id, promoted_email, method, performed_by)
  VALUES (true, v_user_id, v_email, 'sql', current_user);

  INSERT INTO public.vyron_audit_log
    (company_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    v_email,
    'platform_bootstrap',
    'platform_operator',
    v_user_id::text,
    jsonb_build_object(
      'method', 'sql',
      'performed_by', current_user,
      'promoted_email', v_email,
      'bootstrap_permanently_disabled', true
    )
  );

  RETURN format(
    '%s is now a Platform Operator. Sign out and sign in again to refresh the session claims, then open /platform. Bootstrap is now permanently disabled.',
    v_email
  );
END;
$$;

-- Executable only by the function owner (postgres / SQL editor). Deliberately
-- NOT granted to authenticated or anon, so it can never be reached over PostgREST.
REVOKE ALL ON FUNCTION public.vyron_bootstrap_platform_operator(text) FROM PUBLIC;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 099-company-master-directory-tests.sql
-- =========================================================================
-- Company Master ADMINISTRATOR SELECTION security suite.
--
-- RUN AFTER sql/098 and sql/099, ON A NON-PRODUCTION DATABASE.
--
-- Personas are bound by auth.uid(), which is what the functions actually
-- read, and each persona gate runs as the `authenticated` role - so the
-- EXECUTE grants are exercised too. Running the whole file as postgres would
-- prove nothing: postgres owns the SECURITY DEFINER functions and passes no
-- gate that is keyed on a user.
--
-- Where a gate has to count rows in a table that is deliberately CLOSED to
-- `authenticated` (vyron_company_master_admins, vyron_audit_log), the count
-- is taken in a separate postgres statement. That closure is itself part of
-- what sql/098 guarantees, so the suite must not quietly assume otherwise.
--
-- Set before running:
--   \set co_core   '...'  -- a company the CORE administrator holds
--   \set co_safety '...'  -- a company where the persona has Safety access ONLY
--   \set u_admin   '...'  -- CORE owner/admin of :co_core
--   \set u_safety  '...'  -- Safety-only user of :co_safety, no company_users
-- =========================================================================

\set ON_ERROR_STOP on
\set baseline 'a4ca0efca3674ec4889de649f999c3c0'

-- psql does not interpolate :'vars' inside dollar-quoted bodies, so the
-- parameters are moved into settings the DO blocks can read.
SELECT set_config('qa099.co_core',   :'co_core',   false),
       set_config('qa099.co_safety', :'co_safety', false),
       set_config('qa099.u_admin',   :'u_admin',   false),
       set_config('qa099.u_safety',  :'u_safety',  false),
       set_config('qa099.baseline',  :'baseline',  false);

-- =========================================================================
-- GATE 0 - THE TENANCY SPINE IS UNTOUCHED
-- The gate that must never go red. 099 reads no HR or payroll object.
-- =========================================================================
DO $g0$
DECLARE now_md5 text; n int;
BEGIN
  SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure))
    INTO now_md5;
  IF now_md5 <> current_setting('qa099.baseline') THEN
    RAISE EXCEPTION 'GATE 0 FAILED: vyron_user_company_ids() was modified (% vs %)',
      now_md5, current_setting('qa099.baseline');
  END IF;

  SELECT count(*) INTO n FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('vyron_list_company_master_candidates',
                       'vyron_grant_company_master_admin_by_email')
     AND pg_get_functiondef(p.oid) ILIKE '%vyron_user_company_ids%';
  IF n > 0 THEN
    RAISE EXCEPTION 'GATE 0 FAILED: a 099 function references the tenancy spine';
  END IF;

  RAISE NOTICE 'GATE 0 ok - spine byte-identical (%), unreferenced by 099', now_md5;
END;
$g0$;

-- =========================================================================
-- GATE 1 - NO SESSION, NO DIRECTORY
-- auth.uid() is NULL here. An unauthenticated caller must learn nothing.
-- =========================================================================
DO $g1$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vyron_list_company_master_candidates(
    current_setting('qa099.co_core')::uuid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: % candidates returned with no session', n;
  END IF;
  RAISE NOTICE 'GATE 1 ok - no session returns nothing';
END;
$g1$;

-- =========================================================================
-- GATE 2 - A SAFETY OWNER IS NOT A COMPANY MASTER ADMINISTRATOR
-- The persona holds Safety 'owner' on :co_safety and no company_users row.
-- Under 098 that is module authority only, so the lookup must refuse.
-- =========================================================================
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_safety'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g2$
DECLARE n int; can boolean;
BEGIN
  SELECT public.vyron_can_manage_company_master_admins(
    current_setting('qa099.co_safety')::uuid) INTO can;
  IF can THEN
    RAISE EXCEPTION 'GATE 2 FAILED: a Safety owner may manage Company Master administrators';
  END IF;

  SELECT count(*) INTO n FROM public.vyron_list_company_master_candidates(
    current_setting('qa099.co_safety')::uuid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: a Safety owner saw % candidates', n;
  END IF;
  RAISE NOTICE 'GATE 2 ok - Safety authority confers no Company Master authority';
END;
$g2$;
COMMIT;

-- =========================================================================
-- GATE 3 - AN UNAUTHORISED CALLER CANNOT GRANT BY EMAIL EITHER
-- Refused BEFORE the address is looked up, so it is not an existence oracle.
-- =========================================================================
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_safety'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g3$
DECLARE r jsonb;
BEGIN
  BEGIN
    SELECT public.vyron_grant_company_master_admin_by_email(
             current_setting('qa099.co_core')::uuid, 'qa-core-admin@vyron.local') INTO r;
    RAISE EXCEPTION 'GATE 3 FAILED: an unauthorised grant-by-email returned %', r;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'GATE 3 ok - refused with 42501 before any lookup';
  END;
END;
$g3$;
COMMIT;

-- =========================================================================
-- GATE 4 - A CORE ADMINISTRATOR SEES THEIR OWN COMPANY, AND ONLY IT
-- GATE 5 - and learns nothing about a company they do not hold
-- =========================================================================
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g4$
DECLARE n int; leaked int; co uuid := current_setting('qa099.co_core')::uuid;
BEGIN
  SELECT count(*) INTO n FROM public.vyron_list_company_master_candidates(co);
  IF n = 0 THEN
    RAISE EXCEPTION 'GATE 4 FAILED: a CORE administrator saw no candidates at all';
  END IF;

  -- Every returned identity resolves to a real account. Asserted through the
  -- email rather than by reading auth.users, because `authenticated` cannot
  -- read auth.users at all - see GATE 4b - and the email is only present
  -- because the function's JOIN onto auth.users matched.
  SELECT count(*) INTO leaked
    FROM public.vyron_list_company_master_candidates(co) c
   WHERE c.email IS NULL;
  IF leaked > 0 THEN
    RAISE EXCEPTION 'GATE 4 FAILED: % candidate(s) carry no account identity', leaked;
  END IF;

  -- And nobody whose only association is with a DIFFERENT company.
  SELECT count(*) INTO leaked
    FROM public.vyron_list_company_master_candidates(co) c
   WHERE c.auth_user_id = current_setting('qa099.u_safety')::uuid;
  IF leaked > 0 THEN
    RAISE EXCEPTION 'GATE 4 FAILED: another company user appeared in the list';
  END IF;

  RAISE NOTICE 'GATE 4 ok - % candidate(s), all real, none from another company', n;
END;
$g4$;

-- GATE 4b - the SECURITY DEFINER function is the ONLY route to this data.
-- If a client could read auth.users directly, the careful scoping inside the
-- function would be decoration.
DO $g4b$
BEGIN
  BEGIN
    PERFORM 1 FROM auth.users LIMIT 1;
    RAISE EXCEPTION 'GATE 4b FAILED: authenticated can read auth.users directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'GATE 4b ok - auth.users is unreadable except through the function';
  END;
END;
$g4b$;

DO $g5$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vyron_list_company_master_candidates(
    current_setting('qa099.co_safety')::uuid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE 5 FAILED: % candidates returned for a company not held', n;
  END IF;
  RAISE NOTICE 'GATE 5 ok - cross-company request returns nothing, not an error';
END;
$g5$;
COMMIT;

-- =========================================================================
-- GATE 6 - AN ADDRESS THAT MATCHES NOBODY IS REPORTED, NOT SMOOTHED OVER
-- Baseline counts taken as postgres: the grant table is closed to clients.
-- =========================================================================
SELECT set_config('qa099.cma_before', count(*)::text, false)
  FROM public.vyron_company_master_admins;
SELECT set_config('qa099.cu_before', count(*)::text, false)
  FROM public.company_users;

BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g6$
DECLARE r jsonb;
BEGIN
  SELECT public.vyron_grant_company_master_admin_by_email(
           current_setting('qa099.co_core')::uuid, 'nobody-at-all@vyron.invalid') INTO r;
  IF coalesce((r ->> 'ok')::boolean, true) THEN
    RAISE EXCEPTION 'GATE 6 FAILED: an unknown address reported success (%)', r;
  END IF;
  IF r ->> 'reason' <> 'no_account' THEN
    RAISE EXCEPTION 'GATE 6 FAILED: unexpected reason %', r;
  END IF;
  RAISE NOTICE 'GATE 6 ok - no_account reported honestly';
END;
$g6$;
COMMIT;

DO $g6b$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vyron_company_master_admins;
  IF n <> current_setting('qa099.cma_before')::int THEN
    RAISE EXCEPTION 'GATE 6 FAILED: a failed lookup wrote % row(s)',
      n - current_setting('qa099.cma_before')::int;
  END IF;
  RAISE NOTICE 'GATE 6b ok - nothing was written';
END;
$g6b$;

-- =========================================================================
-- GATE 7 - A REAL GRANT BY EMAIL, AND WHAT IT DOES NOT DO
-- =========================================================================
SELECT set_config('qa099.target_email', u.email, false)
  FROM auth.users u WHERE u.id = current_setting('qa099.u_safety')::uuid;

BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g7$
DECLARE r jsonb; offered int;
BEGIN
  SELECT public.vyron_grant_company_master_admin_by_email(
           current_setting('qa099.co_core')::uuid,
           current_setting('qa099.target_email')) INTO r;
  IF NOT coalesce((r ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'GATE 7 FAILED: the grant was refused (%)', r;
  END IF;
  IF (r ->> 'auth_user_id')::uuid <> current_setting('qa099.u_safety')::uuid THEN
    RAISE EXCEPTION 'GATE 7 FAILED: the address resolved to the wrong account (%)', r;
  END IF;

  -- The selector stops offering somebody who now holds it.
  SELECT count(*) INTO offered
    FROM public.vyron_list_company_master_candidates(
           current_setting('qa099.co_core')::uuid) c
   WHERE c.auth_user_id = current_setting('qa099.u_safety')::uuid AND NOT c.is_admin;
  IF offered <> 0 THEN
    RAISE EXCEPTION 'GATE 7 FAILED: an existing administrator is still offered the grant';
  END IF;

  RAISE NOTICE 'GATE 7 ok - granted, and no longer offered';
END;
$g7$;
COMMIT;

DO $g7b$
DECLARE n int; audit_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vyron_company_master_admins
                  WHERE company_id = current_setting('qa099.co_core')::uuid
                    AND auth_user_id = current_setting('qa099.u_safety')::uuid
                    AND status = 'active') THEN
    RAISE EXCEPTION 'GATE 7 FAILED: no active grant row exists';
  END IF;

  SELECT count(*) INTO n FROM public.company_users;
  IF n <> current_setting('qa099.cu_before')::int THEN
    RAISE EXCEPTION 'GATE 7 FAILED: company_users changed by %',
      n - current_setting('qa099.cu_before')::int;
  END IF;

  -- Exactly one audit row, written by the 098 function - not a second one here.
  SELECT count(*) INTO audit_n FROM public.vyron_audit_log
   WHERE action = 'company_master_admin.granted'
     AND company_id = current_setting('qa099.co_core')::uuid
     AND metadata ->> 'target_auth_user_id' = current_setting('qa099.u_safety');
  IF audit_n <> 1 THEN
    RAISE EXCEPTION 'GATE 7 FAILED: % audit rows for one grant', audit_n;
  END IF;

  RAISE NOTICE 'GATE 7b ok - audited once, company_users untouched';
END;
$g7b$;

-- =========================================================================
-- GATE 8 - THE GRANT IS COMPANY MASTER AUTHORITY AND NOTHING ELSE
-- The person granted in GATE 7 may now administer :co_core's identity. They
-- must have gained no HR or payroll tenancy by it.
-- =========================================================================
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_safety'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g8$
DECLARE can boolean; n int; spine int; co uuid := current_setting('qa099.co_core')::uuid;
BEGIN
  SELECT public.vyron_can_manage_company_master_admins(co) INTO can;
  IF NOT can THEN
    RAISE EXCEPTION 'GATE 8 FAILED: the explicit grant conferred no authority';
  END IF;

  SELECT count(*) INTO n FROM public.vyron_list_company_master_candidates(co);
  IF n = 0 THEN
    RAISE EXCEPTION 'GATE 8 FAILED: the new administrator sees no candidates';
  END IF;

  -- The discriminator. The grant must not have entered the HR/payroll spine.
  SELECT count(*) INTO spine FROM public.vyron_user_company_ids() x WHERE x = co;
  IF spine <> 0 THEN
    RAISE EXCEPTION 'GATE 8 FAILED: the grant leaked into the HR/payroll tenancy spine';
  END IF;

  RAISE NOTICE 'GATE 8 ok - identity authority granted, HR/payroll tenancy not';
END;
$g8$;
COMMIT;

-- =========================================================================
-- GATE 9 - CLEAN UP, so the fixture is left as it was found
-- =========================================================================
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('qa099.u_admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $g9$
DECLARE changed boolean;
BEGIN
  SELECT public.vyron_revoke_company_master_admin(
    current_setting('qa099.co_core')::uuid,
    current_setting('qa099.u_safety')::uuid) INTO changed;
  IF NOT changed THEN
    RAISE EXCEPTION 'GATE 9 FAILED: the test grant could not be revoked';
  END IF;
  RAISE NOTICE 'GATE 9 ok - test grant revoked';
END;
$g9$;
COMMIT;

DO $done$ BEGIN RAISE NOTICE 'sql/099 QA: all gates passed'; END; $done$;

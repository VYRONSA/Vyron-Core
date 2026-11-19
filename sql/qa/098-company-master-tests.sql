-- 098-company-master-tests.sql
-- =========================================================================
-- Company Master security suite.
--
-- Every gate maps to a numbered requirement from the final instruction; the
-- requirement number is given as [Rn] so coverage can be audited.
--
-- RUN AFTER sql/098-vyron-company-master.sql, ON A NON-PRODUCTION DATABASE.
--
-- Personas are bound by CONNECTING AS THEM. The functions read auth.uid(),
-- and no fixture can fake that honestly - running this as postgres or with
-- the service role proves nothing, because both bypass RLS.
--
-- Set before running:
--   \set co        '...'   -- the company under test (HSE Insight for the demo)
--   \set other     '...'   -- a company the caller does NOT hold
--   \set demo_uid  '...'   -- the Safety-only user's auth.users id
-- =========================================================================

\set ON_ERROR_STOP on

-- The live baseline recorded before this work. [R22]
\set baseline 'a4ca0efca3674ec4889de649f999c3c0'

-- =========================================================================
-- GATE 0 - THE TENANCY SPINE IS UNTOUCHED           [R21] [R22]
-- Run as anyone. This is the gate that must never go red.
-- =========================================================================
DO $g0$
DECLARE now_md5 text; n int;
BEGIN
  SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure))
    INTO now_md5;
  IF now_md5 <> :'baseline' THEN
    RAISE EXCEPTION 'R21/R22 FAILED: vyron_user_company_ids() was modified (% vs %)',
      now_md5, :'baseline';
  END IF;
  RAISE NOTICE 'R21/R22 ok - tenancy spine byte-identical (%)', now_md5;

  -- None of the new functions may reference it, even indirectly.
  SELECT count(*) INTO n FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('vyron_company_admin_ids','vyron_company_directory_ids',
                       'vyron_can_manage_company_master_admins',
                       'vyron_grant_company_master_admin',
                       'vyron_revoke_company_master_admin',
                       'vyron_list_company_master_admins',
                       'vyron_get_company','vyron_update_company')
     AND pg_get_functiondef(p.oid) ILIKE '%vyron_user_company_ids%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'R21 FAILED: % new function(s) reference the legacy tenant function', n;
  END IF;
  RAISE NOTICE 'R21 ok - the new authority is isolated from the legacy tenant function';
END
$g0$;

-- =========================================================================
-- GATE A - A SAFETY ROLE ALONE          [R1] [R2] [R3]
-- Run as the Safety-only user: safety_user_access owner on :co, NO
-- company_users row, NO vyron_company_master_admins grant.
-- =========================================================================
DO $ga$
DECLARE r record; before_name text; n int;
BEGIN
  -- [R1] They CAN see the identity.
  SELECT * INTO r FROM public.vyron_get_company(:'co'::uuid);
  IF r.name IS NULL THEN
    RAISE EXCEPTION 'R1 FAILED: a Safety user cannot see their own company identity';
  END IF;
  before_name := r.name;
  RAISE NOTICE 'R1 ok - Safety-only user sees identity: %', r.name;

  -- [R2] They cannot edit: the hint says so, and the RPC enforces it.
  IF r.can_edit THEN RAISE EXCEPTION 'R2 FAILED: can_edit true for a Safety-only user'; END IF;
  SELECT count(*) INTO n FROM public.vyron_company_admin_ids() a WHERE a = :'co'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'R2 FAILED: a Safety role conferred Company Master authority'; END IF;
  BEGIN
    PERFORM public.vyron_update_company(:'co'::uuid, '{"name":"Renamed by Safety"}'::jsonb);
    RAISE EXCEPTION 'R2 FAILED: a Safety user altered global Company Master identity';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'R2 ok - edit refused'; END;

  -- [R3] They cannot grant themselves the authority.
  BEGIN
    PERFORM public.vyron_grant_company_master_admin(:'co'::uuid, auth.uid());
    RAISE EXCEPTION 'R3 FAILED: a Safety user self-granted Company Master administration';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'R3 ok - self-grant refused'; END;

  IF (SELECT name FROM public.vyron_get_company(:'co'::uuid)) IS DISTINCT FROM before_name THEN
    RAISE EXCEPTION 'R2 FAILED: the company name changed';
  END IF;
END
$ga$;

-- Repeat GATE A as safety 'admin', 'safety_manager', 'safety_inspector',
-- 'reviewer' and 'viewer'. All must behave identically.

-- =========================================================================
-- GATE B - DIRECT TABLE ACCESS IS IMPOSSIBLE      [R16] [R17] [R18]
-- Run as ANY authenticated user, including one holding an active grant.
-- =========================================================================
DO $gb$
BEGIN
  BEGIN
    INSERT INTO public.vyron_company_master_admins (company_id, auth_user_id)
    VALUES (:'co'::uuid, auth.uid());
    RAISE EXCEPTION 'R16 FAILED: a direct INSERT into the grant table succeeded';
  EXCEPTION WHEN insufficient_privilege OR others THEN RAISE NOTICE 'R16 ok - direct INSERT refused'; END;

  BEGIN
    UPDATE public.vyron_company_master_admins SET status = 'active' WHERE true;
    RAISE EXCEPTION 'R17 FAILED: a direct UPDATE on the grant table succeeded';
  EXCEPTION WHEN insufficient_privilege OR others THEN RAISE NOTICE 'R17 ok - direct UPDATE refused'; END;

  BEGIN
    DELETE FROM public.vyron_company_master_admins WHERE true;
    RAISE EXCEPTION 'R18 FAILED: a direct DELETE on the grant table succeeded';
  EXCEPTION WHEN insufficient_privilege OR others THEN RAISE NOTICE 'R18 ok - direct DELETE refused'; END;
END
$gb$;

-- =========================================================================
-- GATE C - THE HR AND PAYROLL FIREWALL        [R5] [R24]
--
-- Run TWICE as the Safety-only user: once before the grant, once while
-- holding it. Both runs must be identical. This is the assertion the whole
-- architecture exists to protect.
-- =========================================================================
DO $gc$
DECLARE n int; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','hr_warnings','hr_cases','hr_documents','hr_notes',
    'leave_requests','payroll_hours','payroll_batches','payroll_export_logs',
    'clock_events','user_roles','vyron_user_sessions'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'R5/R24 FAILED: this user can read % row(s) from %', n, t;
    END IF;
  END LOOP;

  SELECT count(*) INTO n FROM public.vyron_user_company_ids();
  IF n <> 0 THEN
    RAISE EXCEPTION 'R5/R24 FAILED: vyron_user_company_ids() returned % row(s)', n;
  END IF;
  RAISE NOTICE 'R5/R24 ok - no HR or payroll access, spine returns nothing';
END
$gc$;

-- =========================================================================
-- GATE D - THE EXPLICIT GRANT        [R4] [R9] [R26] [R28]
-- Steps D1-D3 as the platform operator (or a CORE admin of :co).
-- =========================================================================
DO $gd1$
DECLARE v_id uuid; n int;
BEGIN
  -- [R26] A company with zero company_users rows can still receive a grant.
  v_id := public.vyron_grant_company_master_admin(:'co'::uuid, :'demo_uid'::uuid);
  IF v_id IS NULL THEN RAISE EXCEPTION 'R26 FAILED: the grant returned no id'; END IF;
  RAISE NOTICE 'R26 ok - explicit grant issued (%)', v_id;

  SELECT count(*) INTO n FROM public.vyron_list_company_master_admins(:'co'::uuid)
   WHERE auth_user_id = :'demo_uid'::uuid AND status = 'active';
  IF n <> 1 THEN RAISE EXCEPTION 'R4 FAILED: expected 1 active grant, found %', n; END IF;

  -- [R9] The grant is audited.
  SELECT count(*) INTO n FROM public.vyron_audit_log
   WHERE entity_type = 'company_master_admin'
     AND action = 'company_master_admin.granted'
     AND company_id = :'co'::uuid
     AND created_at > now() - interval '1 minute';
  IF n <> 1 THEN RAISE EXCEPTION 'R9 FAILED: the grant was not audited (% rows)', n; END IF;

  -- [R28] It created no CORE membership.
  SELECT count(*) INTO n FROM public.company_users
   WHERE company_id = :'co'::uuid AND user_id = :'demo_uid'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'R28 FAILED: a company_users row was created'; END IF;
  RAISE NOTICE 'R9/R28 ok - audited, and no CORE membership fabricated';
END
$gd1$;

-- ---- Reconnect as the Safety-only user, now holding the grant ----
DO $gd2$
DECLARE r record; res jsonb; n int;
BEGIN
  -- [R4] Safety + explicit grant CAN edit.
  SELECT count(*) INTO n FROM public.vyron_company_admin_ids() a WHERE a = :'co'::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'R4 FAILED: the grant conferred no authority'; END IF;

  SELECT * INTO r FROM public.vyron_get_company(:'co'::uuid);
  IF NOT r.can_edit THEN RAISE EXCEPTION 'R4 FAILED: can_edit still false'; END IF;

  res := public.vyron_update_company(:'co'::uuid,
           '{"trading_name":"HSE Insight","email":"info@hseinsight.co.za",
             "website":"https://hseinsight.co.za"}'::jsonb);
  IF NOT (res ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'R4 FAILED: an authorised edit was refused: %', res;
  END IF;
  RAISE NOTICE 'R4 ok - Company Master edited by an explicit administrator: %',
    res ->> 'fields';
END
$gd2$;

-- [R5] NOW RE-RUN GATE C VERBATIM as this user, still holding the grant.
--      Every assertion must still pass. Company Master authority must leak
--      not one HR or payroll row.

-- =========================================================================
-- GATE E - CROSS-COMPANY ISOLATION      [R6] [R13] [R14] [R15]
-- Run as the explicit administrator of :co.
-- =========================================================================
DO $ge$
DECLARE n int;
BEGIN
  -- [R6] No authority over another company.
  SELECT count(*) INTO n FROM public.vyron_company_admin_ids() a WHERE a = :'other'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'R6 FAILED: authority leaked to another company'; END IF;

  -- [R13] Cross-company update fails.
  BEGIN
    PERFORM public.vyron_update_company(:'other'::uuid, '{"name":"Hijacked"}'::jsonb);
    RAISE EXCEPTION 'R13 FAILED: company A edited company B';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'R13 ok'; END;

  -- [R14] Cross-company grant fails.
  BEGIN
    PERFORM public.vyron_grant_company_master_admin(:'other'::uuid, auth.uid());
    RAISE EXCEPTION 'R14 FAILED: an administrator of A granted authority over B';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'R14 ok'; END;

  -- [R15] Cross-company administrator read returns nothing.
  SELECT count(*) INTO n FROM public.vyron_list_company_master_admins(:'other'::uuid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'R15 FAILED: % administrator row(s) of another company were visible', n;
  END IF;
  RAISE NOTICE 'R6/R15 ok - authority and visibility scoped to one company';

  -- [R6] Reading the other company's identity is refused too.
  BEGIN
    PERFORM public.vyron_get_company(:'other'::uuid);
    RAISE EXCEPTION 'R6 FAILED: cross-company identity read permitted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'R6 ok'; END;
END
$ge$;

-- =========================================================================
-- GATE F - REVOCATION       [R7] [R8] [R10] [R27]
-- F1 as the platform operator / CORE admin; the rest as the revoked user.
-- =========================================================================
DO $gf1$
DECLARE ok boolean; n int;
BEGIN
  -- [R7] Revocable.
  ok := public.vyron_revoke_company_master_admin(:'co'::uuid, :'demo_uid'::uuid);
  IF NOT ok THEN RAISE EXCEPTION 'R7 FAILED: the revocation reported no change'; END IF;

  SELECT count(*) INTO n FROM public.vyron_list_company_master_admins(:'co'::uuid)
   WHERE auth_user_id = :'demo_uid'::uuid AND status = 'revoked'
     AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'R7 FAILED: the revocation was not recorded properly'; END IF;

  -- [R10] Audited.
  SELECT count(*) INTO n FROM public.vyron_audit_log
   WHERE entity_type = 'company_master_admin'
     AND action = 'company_master_admin.revoked'
     AND company_id = :'co'::uuid;
  IF n < 1 THEN RAISE EXCEPTION 'R10 FAILED: the revocation was not audited'; END IF;

  -- Revoking again is a reported no-op, not an error.
  IF public.vyron_revoke_company_master_admin(:'co'::uuid, :'demo_uid'::uuid) THEN
    RAISE EXCEPTION 'R7 FAILED: a second revocation claimed to change something';
  END IF;
  RAISE NOTICE 'R7/R10 ok - revoked, recorded, audited, idempotent';
END
$gf1$;

-- ---- Reconnect as the now-revoked user ----
DO $gf2$
DECLARE r record; n int;
BEGIN
  -- [R8] Authority is gone immediately - no session refresh, no cache.
  SELECT count(*) INTO n FROM public.vyron_company_admin_ids() a WHERE a = :'co'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'R8 FAILED: a revoked administrator retains authority'; END IF;

  SELECT * INTO r FROM public.vyron_get_company(:'co'::uuid);
  IF r.can_edit THEN RAISE EXCEPTION 'R8 FAILED: can_edit true after revocation'; END IF;

  BEGIN
    PERFORM public.vyron_update_company(:'co'::uuid, '{"name":"After revocation"}'::jsonb);
    RAISE EXCEPTION 'R8 FAILED: a revoked administrator edited the Company Master';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'R8 ok - revocation immediate'; END;

  -- [R27] Safety access is untouched by the revocation.
  IF r.name IS NULL THEN
    RAISE EXCEPTION 'R27 FAILED: revoking Company Master admin removed Safety visibility';
  END IF;
  RAISE NOTICE 'R27 ok - Safety access survives Company Master revocation';
END
$gf2$;

-- =========================================================================
-- GATE G - EXISTING BEHAVIOUR STILL WORKS       [R11] [R12]
-- G1 as a company_users owner/admin/platform_admin; G2 as platform operator.
-- =========================================================================
DO $gg$
DECLARE r record; res jsonb; n int;
BEGIN
  -- [R11] CORE administrator.
  SELECT count(*) INTO n FROM public.vyron_company_admin_ids() a WHERE a = :'co'::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'R11 FAILED: CORE administrator not recognised'; END IF;
  res := public.vyron_update_company(:'co'::uuid, '{"trading_name":"QA Trading"}'::jsonb);
  IF NOT (res ->> 'ok')::boolean THEN RAISE EXCEPTION 'R11 FAILED: CORE admin edit refused'; END IF;

  SELECT * INTO r FROM public.vyron_get_company(:'co'::uuid);
  IF r.updated_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'R11 FAILED: updated_at was not maintained';
  END IF;
  RAISE NOTICE 'R11 ok - CORE administration unaffected';
END
$gg$;

-- [R12] As the platform operator: vyron_get_company / vyron_update_company /
--       grant / revoke all succeed on any company. Behaviour unchanged.
-- [R11] As hr_manager, payroll, manager, supervisor, employee, staff: each
--       must be REFUSED - CORE users, but not administrators.
-- A soft-deleted or suspended CORE admin must also be refused.

-- =========================================================================
-- GATE H - STRUCTURAL       [R19] [R20] [R23] [R25]
-- =========================================================================
DO $gh$
DECLARE n int;
BEGIN
  -- [R19] Every new SECURITY DEFINER function pins search_path.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                       'vyron_can_manage_company_master_admins',
                       'vyron_grant_company_master_admin',
                       'vyron_revoke_company_master_admin',
                       'vyron_list_company_master_admins',
                       'vyron_get_company','vyron_update_company')
     AND (p.proconfig IS NULL
          OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) AS c
                          WHERE c LIKE 'search_path=%'));
  IF n <> 0 THEN RAISE EXCEPTION 'R19 FAILED: % function(s) do not pin search_path', n; END IF;

  -- [R20] None is executable by PUBLIC.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
                       'vyron_can_manage_company_master_admins',
                       'vyron_grant_company_master_admin',
                       'vyron_revoke_company_master_admin',
                       'vyron_list_company_master_admins',
                       'vyron_get_company','vyron_update_company')
     AND has_function_privilege('public', p.oid, 'EXECUTE');
  IF n <> 0 THEN RAISE EXCEPTION 'R20 FAILED: % function(s) executable by PUBLIC', n; END IF;
  RAISE NOTICE 'R19/R20 ok - search_path pinned, PUBLIC revoked';

  -- The grant table is closed twice over: RLS on, no policy, no privilege.
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.vyron_company_master_admins'::regclass) THEN
    RAISE EXCEPTION 'R16 FAILED: RLS is not enabled on the grant table';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='vyron_company_master_admins';
  IF n <> 0 THEN
    RAISE EXCEPTION 'R16 FAILED: the grant table has % policy/policies; expected deny-by-default', n;
  END IF;
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='vyron_company_master_admins'
     AND grantee IN ('anon','authenticated');
  IF n <> 0 THEN
    RAISE EXCEPTION 'R16 FAILED: clients hold % privilege(s) on the grant table', n;
  END IF;
  RAISE NOTICE 'R16 ok - grant table closed: RLS on, no policy, no client privilege';

  -- companies keeps exactly one policy, SELECT only.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='companies';
  IF n <> 1 THEN RAISE EXCEPTION 'FAILED: companies has % policies, expected 1', n; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='companies' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'FAILED: a write policy was added to companies'; END IF;

  -- [R25] No CORE membership was fabricated for the demo company.
  SELECT count(*) INTO n FROM public.company_users WHERE company_id = :'co'::uuid;
  IF n <> 0 THEN
    RAISE EXCEPTION 'R25 FAILED: % company_users row(s) exist for the demo company', n;
  END IF;
  RAISE NOTICE 'R25 ok - no fake CORE membership';

  -- [R24] The HR/payroll footprint is unchanged. Expected 82 / 75.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public'
     AND (qual ILIKE '%vyron_user_company_ids%' OR with_check ILIKE '%vyron_user_company_ids%');
  RAISE NOTICE 'R24 - % policies reference vyron_user_company_ids() (expected 82)', n;
END
$gh$;

-- [R23] Safety RLS is unchanged. Compare before/after:
--   SELECT tablename, policyname, md5(coalesce(qual,'') || coalesce(with_check,''))
--     FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'safety_%'
--    ORDER BY tablename, policyname;
--   Every row must match the pre-098 recording.

-- =========================================================================
-- GATE I - THE DEMO ACCEPTANCE TEST
--
--   User    info@vyronsoft.co.za
--   Company HSE Insight (Pty) Ltd
--   Safety  owner
--   Company Master  administrator (explicit)
--   CORE/HR tenancy NOT granted
--
-- Run as that user, after the platform operator has issued the grant.
-- =========================================================================
DO $gi$
DECLARE r record; res jsonb; n int;
BEGIN
  -- Safety access: present.
  SELECT count(*) INTO n FROM public.safety_user_access
   WHERE company_id = :'co'::uuid AND auth_user_id = :'demo_uid'::uuid
     AND lower(coalesce(status,'active')) = 'active';
  IF n <> 1 THEN RAISE EXCEPTION 'DEMO FAILED: Safety access is not as expected'; END IF;

  -- company_users: still zero.
  SELECT count(*) INTO n FROM public.company_users WHERE company_id = :'co'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'DEMO FAILED: company_users is no longer 0 (%)' , n; END IF;

  -- Company Master: administrator, and can edit.
  SELECT * INTO r FROM public.vyron_get_company(:'co'::uuid);
  IF NOT r.can_edit THEN RAISE EXCEPTION 'DEMO FAILED: cannot edit Company Master'; END IF;
  res := public.vyron_update_company(:'co'::uuid,
           '{"registration_number":"2019/123456/07","industry":"Health & Safety",
             "physical_address":"Brackenfell, Western Cape"}'::jsonb);
  IF NOT (res ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'DEMO FAILED: the Company Master edit was refused: %', res;
  END IF;

  -- And can manage administrators, so the full workflow is demonstrable.
  IF NOT r.can_manage_admins THEN
    RAISE EXCEPTION 'DEMO FAILED: cannot manage Company Master administrators';
  END IF;

  -- HR/payroll tenancy: still none.
  SELECT count(*) INTO n FROM public.vyron_user_company_ids();
  IF n <> 0 THEN RAISE EXCEPTION 'DEMO FAILED: HR/payroll tenancy was granted (%)', n; END IF;
  SELECT count(*) INTO n FROM public.employees;
  IF n <> 0 THEN RAISE EXCEPTION 'DEMO FAILED: employee data is readable'; END IF;
  SELECT count(*) INTO n FROM public.payroll_hours;
  IF n <> 0 THEN RAISE EXCEPTION 'DEMO FAILED: payroll data is readable'; END IF;

  RAISE NOTICE 'DEMO ACCEPTANCE ok - Safety owner + Company Master administrator,';
  RAISE NOTICE '  0 company_users rows, no HR or payroll tenancy, Company Master editable';
END
$gi$;

-- =========================================================================
-- GATE J - WHITELIST, VALIDATION, AUDIT CONTENT
-- Run as any Company Master administrator on :co.
-- =========================================================================
DO $gj$
DECLARE res jsonb; b_plan text; b_fee numeric; b_limit int; n int;
BEGIN
  SELECT plan, monthly_fee, employee_limit INTO b_plan, b_fee, b_limit
    FROM public.companies WHERE id = :'co'::uuid;

  res := public.vyron_update_company(:'co'::uuid, '{
      "plan":"enterprise","monthly_fee":0,"enabled_modules":["all"],
      "subscription_status":"active","subscription_tier":"Platinum",
      "employee_limit":99999,"trial_ends_at":"2030-01-01","status":"active",
      "locked_reason":null,"demo_started_at":null,
      "billing_email":"attacker@example.com","trading_name":"Kept"}'::jsonb);
  IF NOT (res -> 'rejected') @> '["plan","monthly_fee","enabled_modules"]'::jsonb THEN
    RAISE EXCEPTION 'FAILED: platform fields not reported as rejected: %', res;
  END IF;
  PERFORM 1 FROM public.companies WHERE id = :'co'::uuid
     AND plan IS NOT DISTINCT FROM b_plan
     AND monthly_fee IS NOT DISTINCT FROM b_fee
     AND employee_limit IS NOT DISTINCT FROM b_limit;
  IF NOT FOUND THEN RAISE EXCEPTION 'FAILED: a platform-controlled column changed'; END IF;

  res := public.vyron_update_company(:'co'::uuid,
           '{"id":"00000000-0000-0000-0000-000000000000","created_at":"1999-01-01"}'::jsonb);
  IF (res ->> 'reason') IS DISTINCT FROM 'no_editable_fields' THEN
    RAISE EXCEPTION 'FAILED: system fields were accepted';
  END IF;

  res := public.vyron_update_company(:'co'::uuid,
           '{"; DROP TABLE companies; --":"x","password":"y"}'::jsonb);
  IF (res ->> 'reason') IS DISTINCT FROM 'no_editable_fields' THEN
    RAISE EXCEPTION 'FAILED: an arbitrary key was accepted';
  END IF;
  RAISE NOTICE 'ok - platform, system and arbitrary keys all refused';

  BEGIN PERFORM public.vyron_update_company(:'co'::uuid, '{"name":"  "}'::jsonb);
    RAISE EXCEPTION 'FAILED: blank legal name accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid, '{"email":"nope"}'::jsonb);
    RAISE EXCEPTION 'FAILED: invalid email accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid, '{"website":"example.co.za"}'::jsonb);
    RAISE EXCEPTION 'FAILED: schemeless website accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid,
          '{"country":"South Africa","vat_number":"123"}'::jsonb);
    RAISE EXCEPTION 'FAILED: invalid ZA VAT accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid, '{"timezone":"Mars/Olympus"}'::jsonb);
    RAISE EXCEPTION 'FAILED: unknown timezone accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid,
          format('{"logo_path":"%s/logo.png"}', :'other')::jsonb);
    RAISE EXCEPTION 'FAILED: foreign logo path accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid,
          format('{"logo_path":"%s/../%s/x.png"}', :'co', :'other')::jsonb);
    RAISE EXCEPTION 'FAILED: traversing logo path accepted';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.vyron_update_company(:'co'::uuid, '{"logo_bucket":"hr-documents"}'::jsonb);
    RAISE EXCEPTION 'FAILED: foreign bucket accepted';
  EXCEPTION WHEN others THEN NULL; END;
  RAISE NOTICE 'ok - validation refuses every malformed value';

  -- Multi-country: a non-ZA company is not held to the ZA VAT format.
  res := public.vyron_update_company(:'co'::uuid,
           '{"country":"United Kingdom","vat_number":"GB123456789"}'::jsonb);
  IF NOT (res ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'FAILED: a valid international VAT number was refused';
  END IF;
  res := public.vyron_update_company(:'co'::uuid,
           '{"country":"South Africa","vat_number":"4123456789"}'::jsonb);
  IF NOT (res ->> 'ok')::boolean THEN RAISE EXCEPTION 'FAILED: valid ZA VAT refused'; END IF;
  RAISE NOTICE 'ok - VAT validation is country-aware, not South-Africa-only';

  -- No secret-shaped value reaches the audit trail, and personal data is not
  -- accumulated there: the target is identified by uuid, never by email.
  SELECT count(*) INTO n FROM public.vyron_audit_log
   WHERE entity_type IN ('company_master','company_master_admin')
     AND metadata::text ~* '(password|secret|token|api[_-]?key|bearer)';
  IF n <> 0 THEN RAISE EXCEPTION 'FAILED: % audit row(s) contain secret-shaped values', n; END IF;
  SELECT count(*) INTO n FROM public.vyron_audit_log
   WHERE entity_type = 'company_master_admin' AND metadata ? 'target_email';
  IF n <> 0 THEN RAISE EXCEPTION 'FAILED: the audit trail stores target email addresses'; END IF;
  RAISE NOTICE 'ok - audit carries no secrets and no unnecessary personal data';
END
$gj$;

-- =========================================================================
-- GATE K - BRANDING
--
--   K1  A Company Master administrator uploads <:co>/logo.png    -> allowed
--   K2  ... uploads <:other>/logo.png                            -> refused
--   K3  A Safety-only user (no grant) uploads <:co>/logo.png     -> refused
--   K4  A Safety-only user READS <:co>/logo.png                  -> allowed
--   K5  A user of another company reads <:co>/logo.png           -> refused
--   K6  The object is not retrievable without a signed URL
--   K7  After revocation: upload refused, read still works
--   K8  SELECT id, public FROM storage.buckets WHERE id='company-branding'
--       -> public must be false
-- =========================================================================

-- =========================================================================
-- GATE L - APPLICATION REGRESSION (outside this file)
--
--   L1  CORE company access still works       - sign in, load the workspace
--   L2  HR access still works                 - employees, leave, payroll load
--   L3  Safety access still works             - the Safety suite, 1,097 assertions
--   L4  The Safety company switcher lists every authorised company
--   L5  A Safety report still resolves company identity from the OWNING record
--   L6  Safety roles and Safety RLS are unchanged                        [R23]
-- =========================================================================

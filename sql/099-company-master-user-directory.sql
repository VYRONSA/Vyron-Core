-- 099-company-master-user-directory.sql
-- =========================================================================
-- VYRON COMPANY MASTER - ADMINISTRATOR SELECTION
--
-- One problem, narrowly solved: granting Company Master administration used
-- to require pasting a raw auth.users UUID. A UUID cannot be checked by the
-- person typing it, so the only feedback on a mistyped grant is that the
-- wrong human gains authority over a company's shared identity. This adds the
-- lookup that lets the UI offer a name and an email instead.
--
-- Prerequisites: sql/098 (vyron_company_master_admins,
--                vyron_can_manage_company_master_admins,
--                vyron_grant_company_master_admin).
--
-- Idempotent. Safe to re-run.
--
-- -------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   1. It does not change sql/098. No function, table, policy or grant
--      created there is altered; this file only adds to it.
--
--   2. It does not modify public.vyron_user_company_ids(), and reads nothing
--      from HR or payroll. The CORE/HR tenancy spine is untouched.
--
--   3. It creates no company_users row and confers no authority of any kind.
--      Appearing in the candidate list means only "this person is already
--      associated with this company"; it is not a permission and grants
--      nothing until someone with authority explicitly grants it.
--
--   4. It exposes no user who is not already associated with the company the
--      caller is administering. There is no "all users" listing here, and the
--      company id is not taken on trust: the functions below return nothing
--      unless vyron_can_manage_company_master_admins() says yes for exactly
--      that company.
--
--   5. It does not infer Company Master authority from a Safety or HR role.
--      A Safety user appears as a CANDIDATE - somebody you may choose to
--      grant to - and holds nothing until the grant is made.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 0. Prerequisites
-- -------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.vyron_can_manage_company_master_admins(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/098 must be applied first: vyron_can_manage_company_master_admins() is missing';
  END IF;
  IF to_regprocedure('public.vyron_grant_company_master_admin(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/098 must be applied first: vyron_grant_company_master_admin() is missing';
  END IF;
END;
$pre$;

-- -------------------------------------------------------------------------
-- 1. The candidate directory
--
--    People already associated with ONE company, resolved to a name and an
--    email so a human can recognise them.
--
--    Three association sources, matching the directory in sql/098 section 4:
--      a. CORE membership (company_users);
--      b. VYRON SAFETY membership (safety_user_access), which is why a
--         demonstration company with no CORE users still has candidates;
--      c. existing Company Master administrators, so the list can mark who
--         already holds the authority rather than offering a duplicate grant.
--
--    Identity comes from auth.users rather than from the association rows.
--    company_users carries its own user_email column which may be stale or
--    absent, and safety_user_access carries none at all; auth.users is the
--    record the grant will actually point at, so it is the record shown.
--
--    company_users rows with a NULL user_id are omitted on purpose. There is
--    no account to grant to, so offering the row would produce an entry that
--    cannot be selected.
--
--    The Safety branch is compiled in only where safety_user_access exists,
--    the same way sql/098 section 4 handles a CORE-only deployment.
-- -------------------------------------------------------------------------
DO $cand$
DECLARE
  v_safety text := '';
  v_sql    text;
BEGIN
  IF to_regclass('public.safety_user_access') IS NOT NULL THEN
    v_safety := $safety$
        UNION ALL
        SELECT sua.auth_user_id AS uid, 'safety'::text AS src
          FROM public.safety_user_access sua
         WHERE sua.company_id = p_company_id
           AND sua.auth_user_id IS NOT NULL
           AND lower(coalesce(sua.status, 'active')) = 'active'
    $safety$;
  END IF;

  v_sql := $fn$
    CREATE OR REPLACE FUNCTION public.vyron_list_company_master_candidates(
      p_company_id uuid
    )
    RETURNS TABLE (
      auth_user_id uuid,
      email        text,
      display_name text,
      sources      text[],
      is_admin     boolean
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $body$
      WITH assoc AS (
        SELECT cu.user_id AS uid, 'core'::text AS src
          FROM public.company_users cu
         WHERE cu.company_id = p_company_id
           AND cu.user_id IS NOT NULL
           AND cu.deleted_at IS NULL
           AND lower(coalesce(cu.status, 'active')) = 'active'
        __SAFETY__
        UNION ALL
        SELECT cma.auth_user_id AS uid, 'company_master'::text AS src
          FROM public.vyron_company_master_admins cma
         WHERE cma.company_id = p_company_id
           AND cma.status = 'active'
      )
      SELECT
        a.uid,
        u.email::text,
        nullif(btrim(coalesce(
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'name',
          btrim(concat_ws(' ',
            u.raw_user_meta_data ->> 'first_name',
            u.raw_user_meta_data ->> 'last_name')),
          '')), '') AS display_name,
        array_agg(DISTINCT a.src ORDER BY a.src) AS sources,
        bool_or(a.src = 'company_master') AS is_admin
      FROM assoc a
      JOIN auth.users u ON u.id = a.uid
      -- The gate. Written as a WHERE clause so an unauthorised caller gets an
      -- empty set - the same answer a company with no candidates gives, which
      -- means the call confirms nothing about a company you may not manage.
      WHERE p_company_id IS NOT NULL
        AND public.vyron_can_manage_company_master_admins(p_company_id)
      GROUP BY a.uid, u.email, u.raw_user_meta_data
      ORDER BY 3 NULLS LAST, 2;
    $body$;
  $fn$;

  EXECUTE replace(v_sql, '__SAFETY__', v_safety);
END;
$cand$;

COMMENT ON FUNCTION public.vyron_list_company_master_candidates(uuid) IS
  'Users already associated with ONE company (CORE membership, VYRON SAFETY membership, or an existing Company Master grant), resolved to name and email so an administrator can be chosen by identity instead of by UUID. Returns an empty set unless vyron_can_manage_company_master_admins() allows the caller for that company. Confers nothing: presence here is association, not authority.';

REVOKE ALL ON FUNCTION public.vyron_list_company_master_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_list_company_master_candidates(uuid) TO authenticated;

-- -------------------------------------------------------------------------
-- 2. Granting by email address
--
--    The candidate list covers the ordinary case. It cannot cover one: a
--    person who holds a VYRON account but is not yet associated with this
--    company at all - which is how the first administrator of a company
--    reaches the list in the first place. Removing the UUID box without this
--    would remove that capability rather than improve it.
--
--    This is an EXACT match on one address. It is not a search, it returns no
--    user record, and it sits behind the same authority gate as the grant it
--    performs. The one thing it does reveal to an already-authorised
--    administrator is whether an address has a VYRON account, and that is
--    reported honestly: a silent success on a mistyped address would leave
--    somebody believing a grant exists when it does not.
--
--    The grant itself is still made by vyron_grant_company_master_admin(),
--    unchanged from sql/098 - so the authority check, the company and user
--    existence checks and the audit row all still happen exactly once, in the
--    one place allowed to write the grant table.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_grant_company_master_admin_by_email(
  p_company_id uuid,
  p_email      text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid   uuid;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_company_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A company and an email address are required' USING ERRCODE = '22023';
  END IF;

  -- Before the address is looked up, not after: an unauthorised caller must
  -- not be able to use this as an account-existence oracle.
  IF NOT public.vyron_can_manage_company_master_admins(p_company_id) THEN
    RAISE EXCEPTION 'Not authorised to manage Company Master administrators'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.id INTO v_uid
    FROM auth.users u
   WHERE lower(u.email) = v_email
   ORDER BY u.created_at
   LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;

  -- Delegated on purpose. Re-implementing the insert here would mean two
  -- places that write the grant table and two audit paths to keep in step.
  v_id := public.vyron_grant_company_master_admin(p_company_id, v_uid);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'auth_user_id', v_uid);
END;
$fn$;

COMMENT ON FUNCTION public.vyron_grant_company_master_admin_by_email(uuid, text) IS
  'Grants Company Master administration to the account holding one exact email address. Authority is checked before the address is read, and the grant itself is delegated to vyron_grant_company_master_admin() so the write and its audit row happen in exactly one place. Returns ok=false with reason no_account when no VYRON account holds that address.';

REVOKE ALL ON FUNCTION public.vyron_grant_company_master_admin_by_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_grant_company_master_admin_by_email(uuid, text) TO authenticated;

COMMIT;

-- =========================================================================
-- VERIFICATION (read-only; run after COMMIT)
--
--   -- Both functions exist, are SECURITY DEFINER and pin search_path:
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('vyron_list_company_master_candidates',
--                        'vyron_grant_company_master_admin_by_email');
--
--   -- The CORE/HR spine is untouched by this file:
--   SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure));
--   -- expect a4ca0efca3674ec4889de649f999c3c0
-- =========================================================================

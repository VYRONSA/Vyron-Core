-- 098-vyron-company-master.sql
-- =========================================================================
-- VYRON COMPANY MASTER
--
-- Establishes public.companies as the shared VYRON company master with:
--   * a controlled read/write interface every module can consume;
--   * a company DIRECTORY primitive, separate from the CORE/HR tenancy spine;
--   * an EXPLICIT, company-scoped Company Master administration grant that is
--     independent of every module's own role model.
--
-- Supersedes and incorporates the review package
-- "vyron-company-master-098-revision" - see sql/098-NOTES.md §3 for what was
-- adopted from it and what was corrected.
--
-- Prerequisites: sql/001 (companies, company_users), sql/060
--                (vyron_is_platform_operator), vyron_audit_log.
--                safety_user_access is optional - see section 4.
--
-- Idempotent. Safe to re-run.
--
-- -------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   1. It does not modify public.vyron_user_company_ids().
--
--      That function is the tenancy spine of CORE/HR. Verified live
--      2026-09-07: 82 RLS policies across 75 tables reference it, and those
--      policies carry no additional role check - company membership alone
--      grants sight of the data. Widening it would hand every Safety user,
--      down to 'viewer', read access to HR disciplinary records and payroll.
--
--      Live baseline: md5(pg_get_functiondef(...))
--                     = a4ca0efca3674ec4889de649f999c3c0
--      That hash must be identical after this migration.
--
--   2. It grants Company Master administration to no module role.
--
--      Not to safety_user_access.role = 'owner', not to 'admin', not to any
--      Safety role. A Safety owner becomes a Company Master administrator only
--      by an explicit grant recorded in section 3.
--
--   3. It adds no policy to public.companies.
--
--      GRANT SELECT,INSERT,UPDATE ON companies TO authenticated is already in
--      place; only the absence of an RLS policy prevents direct writes today.
--      An UPDATE policy would open every column at once, and a policy cannot
--      express a field whitelist. Writes go through vyron_update_company().
--
--   4. It creates no company_users membership for anybody. A Company Master
--      administrator gets Company Master authority and nothing else: no HR
--      tenancy, no payroll tenancy, no module access of any kind.
--
--   5. It touches no VYRON SAFETY object beyond SELECTing safety_user_access
--      inside the directory function.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 0. Prerequisites
-- -------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.companies (run sql/001 first)';
  END IF;
  IF to_regclass('public.company_users') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.company_users (run sql/001 first)';
  END IF;
  IF to_regclass('public.vyron_audit_log') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_audit_log';
  END IF;
  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator() (run sql/060 first)';
  END IF;
END
$pre$;

-- -------------------------------------------------------------------------
-- 1. Company Master identity columns
--
--    Additive only. Every column is nullable with no default, so no existing
--    row changes and nothing reading companies today is affected.
--
--    physical_address is RETAINED, not replaced: _app-shell.tsx,
--    contract-intelligence.ts and hr-pdf-service.ts all read it.
--
--    billing_email is NOT repurposed. It is billing-specific and
--    platform-controlled; `email` is the new general company address.
-- -------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS vat_number          text,
  ADD COLUMN IF NOT EXISTS email               text,
  ADD COLUMN IF NOT EXISTS website             text,
  ADD COLUMN IF NOT EXISTS postal_address      text,
  ADD COLUMN IF NOT EXISTS address_line1       text,
  ADD COLUMN IF NOT EXISTS address_line2       text,
  ADD COLUMN IF NOT EXISTS address_city        text,
  ADD COLUMN IF NOT EXISTS address_region      text,
  ADD COLUMN IF NOT EXISTS address_postal_code text,
  ADD COLUMN IF NOT EXISTS industry            text,
  ADD COLUMN IF NOT EXISTS logo_bucket         text,
  ADD COLUMN IF NOT EXISTS logo_path           text;

COMMENT ON COLUMN public.companies.email IS
  'General company email address. Distinct from billing_email, which remains billing-specific and platform-controlled.';
COMMENT ON COLUMN public.companies.physical_address IS
  'Legacy single-line address. Retained because _app-shell.tsx, contract-intelligence.ts and hr-pdf-service.ts read it. Maintained alongside the structured address_* columns rather than replaced by them.';
COMMENT ON COLUMN public.companies.logo_bucket IS
  'Storage bucket holding the company logo. Constrained to company-branding by vyron_update_company().';
COMMENT ON COLUMN public.companies.logo_path IS
  'Authoritative logo reference: object path within logo_bucket, always prefixed with the company id, served by signed URL. There is deliberately no logo_url column - a stored public URL would be a second, non-authoritative identity and would outlive the access check that produced it.';

-- -------------------------------------------------------------------------
-- 2. EXPLICIT Company Master administration
--
--    WHY A DEDICATED TABLE, having looked for somewhere to reuse:
--
--      user_roles          - company- and user-scoped, but BOTH its policies
--                            are gated on vyron_user_company_ids(), so a user
--                            without HR tenancy can neither read nor hold a
--                            row; and its CHECK permits only admin|manager|
--                            staff, so adding a value means altering a
--                            constraint HR depends on.
--      role_permissions    - a global role-to-module matrix. Neither company-
--                            nor user-scoped.
--      company_users       - carries module_access and module_permissions, but
--                            using them requires a company_users row, which is
--                            exactly the HR tenancy this must not confer.
--      employee_store_access - HR-specific (employee to store).
--
--    Every candidate either couples Company Master to HR tenancy or requires
--    changing an HR constraint. Hence a table of its own, deliberately narrow.
--
--    A row here grants Company Master administration for ONE company and
--    NOTHING else.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_company_master_admins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  /*
   * A real foreign key, not merely a validated parameter. Without it a
   * deleted auth user leaves an active grant behind forever; with it the
   * authority disappears the moment the principal does.
   */
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active',
  granted_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_company_master_admins_status_check
    CHECK (status IN ('active', 'revoked')),
  -- One row per user per company; a re-grant reactivates rather than stacking.
  CONSTRAINT vyron_company_master_admins_unique_user_company
    UNIQUE (company_id, auth_user_id),
  -- A revoked row must carry its revocation timestamp, and an active row must
  -- not. Without this a row could read 'active' while looking revoked.
  CONSTRAINT vyron_company_master_admins_revocation_consistency
    CHECK (
      (status = 'active'  AND revoked_at IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.vyron_company_master_admins IS
  'Explicit Company Master administration, granted per user per company. Independent of every module role model: a row here confers authority over shared company identity and nothing else - no HR tenancy, no payroll tenancy, no module access, no Safety authority. Written only by vyron_grant_company_master_admin() and vyron_revoke_company_master_admin().';
COMMENT ON COLUMN public.vyron_company_master_admins.status IS
  'active | revoked. A revoked row is kept rather than deleted so the grant and its withdrawal both remain auditable, and a later re-grant reactivates the same row.';

CREATE INDEX IF NOT EXISTS idx_vyron_company_master_admins_user
  ON public.vyron_company_master_admins (auth_user_id, status);
CREATE INDEX IF NOT EXISTS idx_vyron_company_master_admins_company
  ON public.vyron_company_master_admins (company_id, status);

ALTER TABLE public.vyron_company_master_admins ENABLE ROW LEVEL SECURITY;

/*
 * Closed to clients entirely, in two independent ways.
 *
 *   1. RLS is enabled with NO policy. In PostgreSQL that is deny-by-default:
 *      no row is visible and no row may be written, whatever privileges say.
 *   2. Every table privilege is revoked from anon and authenticated, so even
 *      if a policy were added carelessly later there is no privilege for it
 *      to enable.
 *
 * public.companies is the cautionary case: its table-level GRANT already
 * permits UPDATE, so only the absence of a policy holds the line there. Here
 * both locks are turned.
 *
 * Reads go through vyron_list_company_master_admins(); writes go through the
 * grant and revoke functions. Both are SECURITY DEFINER and check authority.
 */
REVOKE ALL ON TABLE public.vyron_company_master_admins FROM anon;
REVOKE ALL ON TABLE public.vyron_company_master_admins FROM authenticated;

-- -------------------------------------------------------------------------
-- 3. Who may administer Company Master administration
--
--    Deliberately its own function rather than an inline check: the grant
--    function, the revoke function and the list function must all agree, and
--    a future explicit permission is added here once rather than three times.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_can_manage_company_master_admins(
  p_company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT
    p_company_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.vyron_is_platform_operator()

      -- A CORE administrator of THIS company.
      OR EXISTS (
        SELECT 1 FROM public.company_users cu
         WHERE cu.company_id = p_company_id
           AND cu.user_id = auth.uid()
           AND cu.deleted_at IS NULL
           AND lower(coalesce(cu.status, 'active')) = 'active'
           AND lower(coalesce(cu.role, '')) IN ('owner', 'admin', 'platform_admin')
      )

      -- An existing Company Master administrator of THIS company, so the
      -- authority is delegable within a company without involving the
      -- platform operator every time.
      --
      -- This is not a self-grant route: a caller who holds no authority here
      -- matches none of the three branches and is refused, so nobody can
      -- bootstrap themselves.
      OR EXISTS (
        SELECT 1 FROM public.vyron_company_master_admins cma
         WHERE cma.company_id = p_company_id
           AND cma.auth_user_id = auth.uid()
           AND cma.status = 'active'
      )
    );
$fn$;

COMMENT ON FUNCTION public.vyron_can_manage_company_master_admins(uuid) IS
  'Whether the caller may grant or revoke Company Master administration for one company. Platform operator, CORE owner/admin/platform_admin, or an existing active Company Master administrator of that same company. No module role qualifies, and a caller holding none of these cannot grant themselves anything.';

REVOKE ALL ON FUNCTION public.vyron_can_manage_company_master_admins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_can_manage_company_master_admins(uuid) TO authenticated;

-- -------------------------------------------------------------------------
-- 4. Company DIRECTORY tenancy                                    ** NEW **
--
--    Answers exactly one question: which companies may this authenticated
--    user see the IDENTITY of? It answers nothing about what that user may do
--    inside any module, and it must never be reused as an HR/payroll RLS
--    authority. Read by vyron_get_company() and the company-branding read
--    policy, and by nothing else.
--
--    CORE membership is matched on user_id only. Verified live 2026-09-07:
--    of 4 active company_users rows, 2 carry user_id and 0 carry
--    auth_user_id; the 2 without a UUID link have last_login_at = never, so
--    auth.uid() could not match them under any rule. The live companies
--    SELECT policy already relies on user_id = auth.uid() with no email
--    fallback, and CORE works. See sql/098-NOTES.md.
--
--    Safety status is an ALLOWLIST ('active' only), not a denylist: a status
--    value nobody anticipated should withhold access, not grant it.
-- -------------------------------------------------------------------------
DO $dir$
BEGIN
  IF to_regclass('public.safety_user_access') IS NULL THEN
    -- CORE-only deployment: the directory degrades to CORE plus explicit grants.
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.vyron_company_directory_ids()
      RETURNS SETOF uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $body$
        SELECT cu.company_id
          FROM public.company_users cu
         WHERE cu.company_id IS NOT NULL
           AND cu.deleted_at IS NULL
           AND lower(coalesce(cu.status, 'active')) = 'active'
           AND auth.uid() IS NOT NULL
           AND cu.user_id = auth.uid()
        UNION
        SELECT cma.company_id
          FROM public.vyron_company_master_admins cma
         WHERE auth.uid() IS NOT NULL
           AND cma.auth_user_id = auth.uid()
           AND cma.status = 'active';
      $body$;
    $fn$;
  ELSE
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.vyron_company_directory_ids()
      RETURNS SETOF uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $body$
        -- CORE / HR membership.
        SELECT cu.company_id
          FROM public.company_users cu
         WHERE cu.company_id IS NOT NULL
           AND cu.deleted_at IS NULL
           AND lower(coalesce(cu.status, 'active')) = 'active'
           AND auth.uid() IS NOT NULL
           AND cu.user_id = auth.uid()

        UNION   -- de-duplicating on purpose: three sources, one company id.

        -- VYRON SAFETY membership. Identity visibility only; confers nothing
        -- inside Safety and nothing inside CORE.
        SELECT sua.company_id
          FROM public.safety_user_access sua
         WHERE sua.company_id IS NOT NULL
           AND auth.uid() IS NOT NULL
           AND sua.auth_user_id = auth.uid()
           AND lower(coalesce(sua.status, 'active')) = 'active'

        UNION

        -- Explicit Company Master administrators. If you may edit a company's
        -- identity you must be able to see it.
        SELECT cma.company_id
          FROM public.vyron_company_master_admins cma
         WHERE auth.uid() IS NOT NULL
           AND cma.auth_user_id = auth.uid()
           AND cma.status = 'active';
      $body$;
    $fn$;
  END IF;
END
$dir$;

COMMENT ON FUNCTION public.vyron_company_directory_ids() IS
  'Companies whose IDENTITY the caller may see, across VYRON modules. Answers "which company" only, never "what may they do in it". Read by vyron_get_company() and the company-branding read policy and by nothing else - it must never become an HR or payroll RLS authority. Deliberately separate from vyron_user_company_ids(), which gates 82 policies across 75 tables and is not modified by this migration.';

REVOKE ALL ON FUNCTION public.vyron_company_directory_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_company_directory_ids() TO authenticated;

-- -------------------------------------------------------------------------
-- 5. Company Master ADMINISTRATION authority
--
--    Three independent sources, and no module role among them:
--      a. the platform operator (applied by the callers, which OR it in);
--      b. a CORE company_users owner / admin / platform_admin;
--      c. an EXPLICIT grant in vyron_company_master_admins.
--
--    (c) is what lets a user administer a company's identity without holding
--    HR or payroll tenancy in it - the case a demonstration company needs, and
--    equally the case for a real customer whose company administrator is not
--    an HR user.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_company_admin_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  -- (b) CORE administrators.
  SELECT cu.company_id
    FROM public.company_users cu
   WHERE cu.company_id IS NOT NULL
     AND cu.deleted_at IS NULL
     AND lower(coalesce(cu.status, 'active')) = 'active'
     AND lower(coalesce(cu.role, '')) IN ('owner', 'admin', 'platform_admin')
     AND auth.uid() IS NOT NULL
     AND cu.user_id = auth.uid()

  UNION

  -- (c) Explicit Company Master administrators. Note what is NOT here: no
  -- module grant table of any kind. A Safety owner becomes a Company Master
  -- administrator only by being granted one explicitly.
  SELECT cma.company_id
    FROM public.vyron_company_master_admins cma
   WHERE auth.uid() IS NOT NULL
     AND cma.auth_user_id = auth.uid()
     AND cma.status = 'active';
$fn$;

COMMENT ON FUNCTION public.vyron_company_admin_ids() IS
  'Companies whose Company Master identity the caller may EDIT: CORE company_users owner/admin/platform_admin, or an explicit active grant in vyron_company_master_admins. No module role confers this - a Safety owner or admin is not a Company Master administrator unless explicitly granted. The platform operator is handled by the callers, which OR vyron_is_platform_operator() alongside this function.';

REVOKE ALL ON FUNCTION public.vyron_company_admin_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_company_admin_ids() TO authenticated;

-- -------------------------------------------------------------------------
-- 6. Granting, revoking and listing Company Master administration
--
--    A company with neither a CORE administrator nor an existing grant is
--    bootstrapped by the platform operator. That is the onboarding path for a
--    real customer whose administrator is not an HR user, and for a
--    demonstration company that has no HR users at all.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_grant_company_master_admin(
  p_company_id   uuid,
  p_auth_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_id  uuid;
  v_was text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_company_id IS NULL OR p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'A company and a user are required' USING ERRCODE = '22023';
  END IF;

  -- The gate, before anything is read about the target or written anywhere.
  IF NOT public.vyron_can_manage_company_master_admins(p_company_id) THEN
    RAISE EXCEPTION 'Not authorised to manage Company Master administrators'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_auth_user_id) THEN
    RAISE EXCEPTION 'Authenticated user does not exist' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_was
    FROM public.vyron_company_master_admins
   WHERE company_id = p_company_id AND auth_user_id = p_auth_user_id;

  INSERT INTO public.vyron_company_master_admins
    (company_id, auth_user_id, status, granted_by, granted_at,
     revoked_by, revoked_at, updated_at)
  VALUES
    (p_company_id, p_auth_user_id, 'active', auth.uid(), now(),
     NULL, NULL, now())
  ON CONFLICT (company_id, auth_user_id) DO UPDATE
    SET status     = 'active',
        granted_by = EXCLUDED.granted_by,
        granted_at = now(),
        revoked_by = NULL,
        revoked_at = NULL,
        updated_at = now()
  RETURNING id INTO v_id;

  -- Same transaction as the grant. The target is identified by uuid only:
  -- their email address is not needed to establish what happened, and an
  -- audit trail is not the place to accumulate personal data.
  INSERT INTO public.vyron_audit_log
    (company_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (
    p_company_id,
    lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
    'company_master_admin.granted',
    'company_master_admin',
    v_id::text,
    jsonb_build_object(
      'target_auth_user_id', p_auth_user_id,
      'previous_status',     coalesce(v_was, 'none'),
      'new_status',          'active',
      'actor_id',            auth.uid()));

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.vyron_grant_company_master_admin(uuid, uuid) IS
  'Grants explicit Company Master administration for one company to one user. Confers no HR tenancy, no payroll tenancy and no module access, and creates no company_users row. Audited as company_master_admin.granted.';

REVOKE ALL ON FUNCTION public.vyron_grant_company_master_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_grant_company_master_admin(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.vyron_revoke_company_master_admin(
  p_company_id   uuid,
  p_auth_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_company_id IS NULL OR p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'A company and a user are required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.vyron_can_manage_company_master_admins(p_company_id) THEN
    RAISE EXCEPTION 'Not authorised to manage Company Master administrators'
      USING ERRCODE = '42501';
  END IF;

  -- Revoked, not deleted: the grant and its withdrawal both stay auditable,
  -- and a later re-grant reactivates this row rather than losing the history.
  UPDATE public.vyron_company_master_admins
     SET status     = 'revoked',
         revoked_by = auth.uid(),
         revoked_at = now(),
         updated_at = now()
   WHERE company_id = p_company_id
     AND auth_user_id = p_auth_user_id
     AND status = 'active'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN false;   -- nothing active to revoke; not an error
  END IF;

  INSERT INTO public.vyron_audit_log
    (company_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (
    p_company_id,
    lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
    'company_master_admin.revoked',
    'company_master_admin',
    v_id::text,
    jsonb_build_object(
      'target_auth_user_id', p_auth_user_id,
      'previous_status',     'active',
      'new_status',          'revoked',
      'actor_id',            auth.uid()));

  RETURN true;
END;
$fn$;

COMMENT ON FUNCTION public.vyron_revoke_company_master_admin(uuid, uuid) IS
  'Revokes explicit Company Master administration. The row is marked revoked rather than deleted so the grant and its withdrawal both remain auditable. Takes effect immediately: vyron_company_admin_ids() reads status = active. Audited as company_master_admin.revoked.';

REVOKE ALL ON FUNCTION public.vyron_revoke_company_master_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_revoke_company_master_admin(uuid, uuid) TO authenticated;

/*
 * The only read path to the grant table. The table itself is closed, so a
 * caller with authority over company A cannot enumerate company B's
 * administrators - the predicate is evaluated per company, not per row.
 */
CREATE OR REPLACE FUNCTION public.vyron_list_company_master_admins(
  p_company_id uuid
)
RETURNS TABLE (
  id           uuid,
  company_id   uuid,
  auth_user_id uuid,
  status       text,
  granted_by   uuid,
  granted_at   timestamptz,
  revoked_by   uuid,
  revoked_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT cma.id, cma.company_id, cma.auth_user_id, cma.status,
         cma.granted_by, cma.granted_at, cma.revoked_by, cma.revoked_at
    FROM public.vyron_company_master_admins cma
   WHERE cma.company_id = p_company_id
     AND public.vyron_can_manage_company_master_admins(p_company_id);
$fn$;

COMMENT ON FUNCTION public.vyron_list_company_master_admins(uuid) IS
  'Company Master administrators for one company, for anyone entitled to manage them. Returns nothing for a company the caller may not administer.';

REVOKE ALL ON FUNCTION public.vyron_list_company_master_admins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_list_company_master_admins(uuid) TO authenticated;

-- -------------------------------------------------------------------------
-- 7. Read the Company Master
--
--    Identity only. No billing, subscription, plan, licence, limit or
--    platform-control field - a Safety inspector reading the company name has
--    no business learning its monthly fee.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_get_company(p_company_id uuid)
RETURNS TABLE (
  id                  uuid,
  name                text,
  trading_name        text,
  registration_number text,
  vat_number          text,
  industry            text,
  email               text,
  phone               text,
  website             text,
  contact_person      text,
  physical_address    text,
  postal_address      text,
  address_line1       text,
  address_line2       text,
  address_city        text,
  address_region      text,
  address_postal_code text,
  country             text,
  timezone            text,
  logo_bucket         text,
  logo_path           text,
  updated_at          timestamptz,
  can_edit            boolean,
  can_manage_admins   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'A company must be named' USING ERRCODE = '22023';
  END IF;

  -- "Not found" and "not yours" are deliberately the same answer: telling them
  -- apart confirms that a company exists to someone not entitled to know it.
  IF NOT (public.vyron_is_platform_operator()
          OR p_company_id IN (SELECT public.vyron_company_directory_ids())) THEN
    RAISE EXCEPTION 'Company not found' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.trading_name, c.registration_number,
         c.vat_number, c.industry, c.email, c.phone, c.website,
         c.contact_person, c.physical_address, c.postal_address,
         c.address_line1, c.address_line2, c.address_city,
         c.address_region, c.address_postal_code, c.country, c.timezone,
         c.logo_bucket, c.logo_path, c.updated_at,
         -- UX hints, so a screen can render read-only rather than offering a
         -- form that would be refused on save. NOT the security boundary -
         -- vyron_update_company() and the grant functions re-check.
         (public.vyron_is_platform_operator()
          OR c.id IN (SELECT public.vyron_company_admin_ids())) AS can_edit,
         public.vyron_can_manage_company_master_admins(c.id) AS can_manage_admins
    FROM public.companies c
   WHERE c.id = p_company_id;
END;
$fn$;

COMMENT ON FUNCTION public.vyron_get_company(uuid) IS
  'Company Master identity for a company the caller may see. Returns no billing, subscription, plan, licence or platform-control field. can_edit and can_manage_admins are UX hints; the write functions remain the security authority.';

REVOKE ALL ON FUNCTION public.vyron_get_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_get_company(uuid) TO authenticated;

-- -------------------------------------------------------------------------
-- 8. Write the Company Master
--
--    Whitelisted, validated, audited, atomic. The only write path.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vyron_update_company(
  p_company_id uuid,
  p_patch      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  -- The only columns a company administrator may write. Everything else -
  -- enabled_modules, plan, subscription_status, subscription_tier,
  -- employee_limit, monthly_fee, trial_ends_at, locked_reason,
  -- demo_started_at, status, billing_email - is platform-controlled, and id,
  -- created_at and updated_at are system-generated.
  editable   constant text[] := ARRAY[
    'name','trading_name','registration_number','vat_number','industry',
    'email','phone','website','contact_person',
    'physical_address','postal_address','address_line1','address_line2',
    'address_city','address_region','address_postal_code',
    'country','timezone','logo_bucket','logo_path'
  ];
  k           text;
  before_row  public.companies%ROWTYPE;
  changed     jsonb  := '{}'::jsonb;
  old_vals    jsonb  := '{}'::jsonb;
  rejected    text[] := ARRAY[]::text[];
  v           text;
  eff_country text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_company_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'A company and a patch object are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO before_row FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found' USING ERRCODE = '42501';
  END IF;

  -- The whole security surface, in one statement. A module role that has not
  -- been granted Company Master administration is refused here, as is any
  -- administrator of a different company.
  IF NOT (public.vyron_is_platform_operator()
          OR p_company_id IN (SELECT public.vyron_company_admin_ids())) THEN
    RAISE EXCEPTION 'Not permitted to administer this company'
      USING ERRCODE = '42501';
  END IF;

  -- Split the patch. A key that is not whitelisted is reported back to the
  -- caller and ignored - never written, and never silently swallowed either.
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k = ANY (editable) THEN
      changed := changed || jsonb_build_object(k, p_patch -> k);
    ELSE
      rejected := rejected || k;
    END IF;
  END LOOP;

  IF changed = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_editable_fields',
                              'rejected', to_jsonb(rejected));
  END IF;

  -- ---- Validation -------------------------------------------------------
  IF changed ? 'name' THEN
    IF coalesce(btrim(changed ->> 'name'), '') = '' THEN
      RAISE EXCEPTION 'Legal company name is required' USING ERRCODE = '22023';
    END IF;
    IF length(btrim(changed ->> 'name')) > 200 THEN
      RAISE EXCEPTION 'Legal company name is too long (200 characters maximum)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF changed ? 'email' AND coalesce(btrim(changed ->> 'email'), '') <> '' THEN
    IF btrim(changed ->> 'email') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'Company email is not a valid address' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF changed ? 'website' AND coalesce(btrim(changed ->> 'website'), '') <> '' THEN
    IF btrim(changed ->> 'website') !~* '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'Website must begin with http:// or https://'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Country-aware, deliberately not South-Africa-only. VYRON is intended to
  -- operate in more than one country, so only a company recorded as South
  -- African is held to the SARS format; every other country is length-checked.
  IF changed ? 'vat_number' AND coalesce(btrim(changed ->> 'vat_number'), '') <> '' THEN
    v := btrim(changed ->> 'vat_number');
    eff_country := upper(coalesce(changed ->> 'country', before_row.country, ''));
    IF eff_country IN ('SOUTH AFRICA', 'ZA', 'RSA') THEN
      IF regexp_replace(v, '\s', '', 'g') !~ '^4[0-9]{9}$' THEN
        RAISE EXCEPTION
          'A South African VAT number is 10 digits beginning with 4'
          USING ERRCODE = '22023';
      END IF;
    ELSIF length(v) > 32 THEN
      RAISE EXCEPTION 'VAT number is too long (32 characters maximum)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF changed ? 'timezone' AND coalesce(btrim(changed ->> 'timezone'), '') <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names
                    WHERE name = btrim(changed ->> 'timezone')) THEN
      RAISE EXCEPTION 'Unknown timezone' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Branding must live in the branding bucket, under this company's own
  -- folder. Without the prefix check an administrator of company A could point
  -- A's logo_path at B's object and read it through A's signed URL.
  IF changed ? 'logo_bucket' AND coalesce(btrim(changed ->> 'logo_bucket'), '') <> ''
     AND btrim(changed ->> 'logo_bucket') <> 'company-branding' THEN
    RAISE EXCEPTION 'Company branding is stored in the company-branding bucket'
      USING ERRCODE = '22023';
  END IF;

  IF changed ? 'logo_path' AND coalesce(btrim(changed ->> 'logo_path'), '') <> '' THEN
    v := btrim(changed ->> 'logo_path');
    IF split_part(v, '/', 1) <> p_company_id::text THEN
      RAISE EXCEPTION 'A logo path must begin with this company''s id'
        USING ERRCODE = '22023';
    END IF;
    IF v LIKE '%..%' OR v LIKE '/%' THEN
      RAISE EXCEPTION 'A logo path may not traverse directories'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ---- Before-values, for the audit, for changed keys only ---------------
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO old_vals
    FROM jsonb_each(to_jsonb(before_row))
   WHERE key IN (SELECT jsonb_object_keys(changed));

  UPDATE public.companies AS c
     SET name                = COALESCE(changed ->> 'name', c.name),
         trading_name        = CASE WHEN changed ? 'trading_name'        THEN nullif(btrim(changed ->> 'trading_name'), '')        ELSE c.trading_name END,
         registration_number = CASE WHEN changed ? 'registration_number' THEN nullif(btrim(changed ->> 'registration_number'), '') ELSE c.registration_number END,
         vat_number          = CASE WHEN changed ? 'vat_number'          THEN nullif(btrim(changed ->> 'vat_number'), '')          ELSE c.vat_number END,
         industry            = CASE WHEN changed ? 'industry'            THEN nullif(btrim(changed ->> 'industry'), '')            ELSE c.industry END,
         email               = CASE WHEN changed ? 'email'               THEN nullif(btrim(changed ->> 'email'), '')               ELSE c.email END,
         phone               = CASE WHEN changed ? 'phone'               THEN nullif(btrim(changed ->> 'phone'), '')               ELSE c.phone END,
         website             = CASE WHEN changed ? 'website'             THEN nullif(btrim(changed ->> 'website'), '')             ELSE c.website END,
         contact_person      = CASE WHEN changed ? 'contact_person'      THEN nullif(btrim(changed ->> 'contact_person'), '')      ELSE c.contact_person END,
         physical_address    = CASE WHEN changed ? 'physical_address'    THEN nullif(btrim(changed ->> 'physical_address'), '')    ELSE c.physical_address END,
         postal_address      = CASE WHEN changed ? 'postal_address'      THEN nullif(btrim(changed ->> 'postal_address'), '')      ELSE c.postal_address END,
         address_line1       = CASE WHEN changed ? 'address_line1'       THEN nullif(btrim(changed ->> 'address_line1'), '')       ELSE c.address_line1 END,
         address_line2       = CASE WHEN changed ? 'address_line2'       THEN nullif(btrim(changed ->> 'address_line2'), '')       ELSE c.address_line2 END,
         address_city        = CASE WHEN changed ? 'address_city'        THEN nullif(btrim(changed ->> 'address_city'), '')        ELSE c.address_city END,
         address_region      = CASE WHEN changed ? 'address_region'      THEN nullif(btrim(changed ->> 'address_region'), '')      ELSE c.address_region END,
         address_postal_code = CASE WHEN changed ? 'address_postal_code' THEN nullif(btrim(changed ->> 'address_postal_code'), '') ELSE c.address_postal_code END,
         country             = CASE WHEN changed ? 'country'             THEN nullif(btrim(changed ->> 'country'), '')             ELSE c.country END,
         timezone            = CASE WHEN changed ? 'timezone'            THEN nullif(btrim(changed ->> 'timezone'), '')            ELSE c.timezone END,
         logo_bucket         = CASE WHEN changed ? 'logo_bucket'         THEN nullif(btrim(changed ->> 'logo_bucket'), '')         ELSE c.logo_bucket END,
         logo_path           = CASE WHEN changed ? 'logo_path'           THEN nullif(btrim(changed ->> 'logo_path'), '')           ELSE c.logo_path END,
         -- System-generated. Never client-controlled, and there is no trigger
         -- on companies to do it for us.
         updated_at          = now()
   WHERE c.id = p_company_id;

  -- Same transaction as the UPDATE. Any RAISE above rolls both back, so a
  -- successful-change audit row cannot exist without the change, and the
  -- change cannot exist without the audit row.
  --
  -- Only company identity is recorded: every column named in `changed` comes
  -- from the editable whitelist above, so no credential can reach the log.
  INSERT INTO public.vyron_audit_log
    (company_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (
    p_company_id,
    lower(coalesce(auth.jwt() ->> 'email', 'unknown')),
    'company_master.updated',
    'company_master',
    p_company_id::text,
    jsonb_build_object(
      'fields',   (SELECT jsonb_agg(key) FROM jsonb_object_keys(changed) AS key),
      'old',      old_vals,
      'new',      changed,
      'rejected', to_jsonb(rejected),
      'actor_id', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'ok',         true,
    'company_id', p_company_id,
    'fields',     (SELECT jsonb_agg(key) FROM jsonb_object_keys(changed) AS key),
    'rejected',   to_jsonb(rejected));
END;
$fn$;

COMMENT ON FUNCTION public.vyron_update_company(uuid, jsonb) IS
  'Controlled Company Master write. Platform operator, CORE administrator, or explicit Company Master administrator only. Whitelisted identity fields; platform-controlled and system fields are returned as rejected and never written. Audits into vyron_audit_log in the same transaction as the update.';

REVOKE ALL ON FUNCTION public.vyron_update_company(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vyron_update_company(uuid, jsonb) TO authenticated;

-- -------------------------------------------------------------------------
-- 9. Company branding storage
--
--    Private bucket. Object convention <company_id>/logo.<ext>, so the company
--    id is the first path segment and the policies can key on it - the same
--    convention as hr-documents (sql/092) and safety-site-photos.
--
--    READ  = directory access. A Safety inspector viewing a report needs the
--            logo; seeing it discloses nothing they cannot already see.
--    WRITE = Company Master administrator. Replacing a logo changes what
--            appears on issued documents, so it is an administrative act.
--
--    hr-pdf-service.ts already probes company.logo_bucket and logo_path, so
--    it becomes functional here with no code change. No logo_url column is
--    added: a stored public URL would be a second, non-authoritative identity
--    that outlives the access check that produced it.
-- -------------------------------------------------------------------------
DO $branding$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets is absent (not a Supabase project); skipping the company-branding bucket.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('company-branding', 'company-branding', false, 5242880,   -- 5 MB
          ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  ON CONFLICT (id) DO UPDATE
    SET public             = false,          -- never public, even on a re-run
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'company_branding_read') THEN
    CREATE POLICY company_branding_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'company-branding'
        AND (
          public.vyron_is_platform_operator()
          OR (storage.foldername(name))[1] IN (
               SELECT c::text FROM public.vyron_company_directory_ids() AS c)
        ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'company_branding_insert') THEN
    CREATE POLICY company_branding_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'company-branding'
        AND (
          public.vyron_is_platform_operator()
          OR (storage.foldername(name))[1] IN (
               SELECT c::text FROM public.vyron_company_admin_ids() AS c)
        ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'company_branding_update') THEN
    CREATE POLICY company_branding_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'company-branding'
        AND (
          public.vyron_is_platform_operator()
          OR (storage.foldername(name))[1] IN (
               SELECT c::text FROM public.vyron_company_admin_ids() AS c)
        ))
      WITH CHECK (
        bucket_id = 'company-branding'
        AND (
          public.vyron_is_platform_operator()
          OR (storage.foldername(name))[1] IN (
               SELECT c::text FROM public.vyron_company_admin_ids() AS c)
        ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'company_branding_delete') THEN
    CREATE POLICY company_branding_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'company-branding'
        AND (
          public.vyron_is_platform_operator()
          OR (storage.foldername(name))[1] IN (
               SELECT c::text FROM public.vyron_company_admin_ids() AS c)
        ));
  END IF;
END
$branding$;

COMMIT;

-- =========================================================================
-- POST-CONDITIONS (run after applying; all must hold)
--
--   -- 1. THE critical one. Must equal a4ca0efca3674ec4889de649f999c3c0.
--   SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure));
--
--   -- 2. The HR/payroll footprint is unchanged (expected 82 / 75).
--   SELECT count(*) AS policies, count(DISTINCT tablename) AS tables
--     FROM pg_policies WHERE schemaname='public'
--      AND (qual ILIKE '%vyron_user_company_ids%'
--           OR with_check ILIKE '%vyron_user_company_ids%');
--
--   -- 3. companies still has exactly one policy, SELECT only.
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='companies';
--
--   -- 4. The eight new functions exist, are SECURITY DEFINER, pin search_path.
--   SELECT proname, prosecdef, proconfig FROM pg_proc
--    WHERE proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
--                      'vyron_can_manage_company_master_admins',
--                      'vyron_grant_company_master_admin',
--                      'vyron_revoke_company_master_admin',
--                      'vyron_list_company_master_admins',
--                      'vyron_get_company','vyron_update_company');
--
--   -- 5. The grant table is closed: RLS on, no policy, no client privilege.
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.vyron_company_master_admins'::regclass;
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='vyron_company_master_admins';
--   SELECT count(*) FROM information_schema.role_table_grants
--    WHERE table_name='vyron_company_master_admins'
--      AND grantee IN ('anon','authenticated');
--   -- Expect: true, 0, 0.
--
--   -- 6. The branding bucket is private.
--   SELECT id, public FROM storage.buckets WHERE id='company-branding';
--
-- =========================================================================
-- BOOTSTRAPPING A COMPANY WITH NO CORE ADMINISTRATOR
--
-- Run as the platform operator. This is the onboarding path for a real
-- customer whose company administrator is not an HR user, and for a
-- demonstration company such as HSE Insight, which has no company_users rows.
--
--   SELECT public.vyron_grant_company_master_admin(
--     '<company_id>'::uuid,
--     '<auth_user_id>'::uuid);
--
-- The grantee gains authority over company identity only. They do NOT gain HR
-- or payroll tenancy: vyron_user_company_ids() is untouched, so all 82 of its
-- policies across 75 tables continue to exclude them. No company_users row is
-- created.
-- =========================================================================

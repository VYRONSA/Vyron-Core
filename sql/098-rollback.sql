-- 098-rollback.sql
-- =========================================================================
-- Reverses sql/098-vyron-company-master.sql.
--
-- Conservative by design. It removes everything 098 created and destroys no
-- pre-existing data: the identity columns, uploaded logos and audit history
-- are all left in place, because each could hold information that exists only
-- because 098 was live. Destructive cleanup is documented at the tail and
-- deliberately not executed.
--
-- Nothing needs restoring: 098 modified no pre-existing object.
--   vyron_user_company_ids()      - never touched (md5 a4ca0efca3674ec4889de649f999c3c0)
--   vyron_get_company_access()    - never touched
--   vyron_is_platform_operator()  - never touched
--   every policy on public.companies                  - never touched
--   the 82 policies on the 75 HR/payroll tables       - never touched
--   every VYRON SAFETY object                         - never touched
--
-- ORDER MATTERS. The review package dropped vyron_company_master_admins while
-- vyron_company_admin_ids() and vyron_company_directory_ids() still referenced
-- it, leaving those two functions pointing at a table that no longer exists.
-- Because 098 CREATES both of those functions, a full rollback simply drops
-- them too - there is nothing to "restore", and the dependency resolves.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. Storage policies, before the functions their predicates call.
-- -------------------------------------------------------------------------
DO $rb$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS company_branding_read   ON storage.objects;
    DROP POLICY IF EXISTS company_branding_insert ON storage.objects;
    DROP POLICY IF EXISTS company_branding_update ON storage.objects;
    DROP POLICY IF EXISTS company_branding_delete ON storage.objects;
  END IF;
END
$rb$;

-- -------------------------------------------------------------------------
-- 2. The Company Master RPCs.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.vyron_update_company(uuid, jsonb);
DROP FUNCTION IF EXISTS public.vyron_get_company(uuid);

-- -------------------------------------------------------------------------
-- 3. The administration RPCs, before the authority function they all call.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.vyron_list_company_master_admins(uuid);
DROP FUNCTION IF EXISTS public.vyron_revoke_company_master_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.vyron_grant_company_master_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.vyron_can_manage_company_master_admins(uuid);

-- -------------------------------------------------------------------------
-- 4. The two tenancy primitives 098 created. Dropping them is what makes it
--    safe to drop the grant table below.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.vyron_company_admin_ids();
DROP FUNCTION IF EXISTS public.vyron_company_directory_ids();

-- -------------------------------------------------------------------------
-- 5. The grant table.
--
--    Dropped, because 098 created it and nothing pre-existing depends on it -
--    but only AFTER every function above is gone. The record of who was
--    granted authority survives independently in vyron_audit_log, which this
--    rollback does not touch, so the history is not lost with the table.
-- -------------------------------------------------------------------------
DROP TABLE IF EXISTS public.vyron_company_master_admins;

COMMIT;

-- =========================================================================
-- VERIFY THE ROLLBACK
--
--   -- The eight functions are gone.
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('vyron_company_directory_ids','vyron_company_admin_ids',
--                      'vyron_can_manage_company_master_admins',
--                      'vyron_grant_company_master_admin',
--                      'vyron_revoke_company_master_admin',
--                      'vyron_list_company_master_admins',
--                      'vyron_get_company','vyron_update_company');
--   -- Expect: 0 rows.
--
--   -- The grant table is gone.
--   SELECT to_regclass('public.vyron_company_master_admins');  -- expect NULL
--
--   -- The tenancy spine is untouched, as it was throughout.
--   SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure));
--   -- Expect: a4ca0efca3674ec4889de649f999c3c0
--
--   -- companies still has exactly one policy, SELECT only.
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='companies';
--
--   -- The grant/revoke history survives the rollback.
--   SELECT action, count(*) FROM public.vyron_audit_log
--    WHERE entity_type='company_master_admin' GROUP BY action;
-- =========================================================================

-- =========================================================================
-- NOT ROLLED BACK AUTOMATICALLY - each destroys data
--
-- 1. THE BRANDING BUCKET AND ITS OBJECTS
--    Deleting the bucket deletes every company logo in it.
--
--      -- DELETE FROM storage.objects WHERE bucket_id = 'company-branding';
--      -- DELETE FROM storage.buckets WHERE id = 'company-branding';
--
-- 2. THE COMPANY MASTER IDENTITY COLUMNS
--    Any VAT number, general email, website, postal or structured address,
--    industry or logo reference captured while 098 was live is destroyed the
--    moment these are dropped. Export first if the data matters.
--
--      -- SELECT id, name, vat_number, email, website, postal_address,
--      --        address_line1, address_line2, address_city, address_region,
--      --        address_postal_code, industry, logo_bucket, logo_path
--      --   FROM public.companies;
--
--      -- ALTER TABLE public.companies
--      --   DROP COLUMN IF EXISTS vat_number,
--      --   DROP COLUMN IF EXISTS email,
--      --   DROP COLUMN IF EXISTS website,
--      --   DROP COLUMN IF EXISTS postal_address,
--      --   DROP COLUMN IF EXISTS address_line1,
--      --   DROP COLUMN IF EXISTS address_line2,
--      --   DROP COLUMN IF EXISTS address_city,
--      --   DROP COLUMN IF EXISTS address_region,
--      --   DROP COLUMN IF EXISTS address_postal_code,
--      --   DROP COLUMN IF EXISTS industry,
--      --   DROP COLUMN IF EXISTS logo_bucket,
--      --   DROP COLUMN IF EXISTS logo_path;
--
-- 3. AUDIT HISTORY WRITTEN BY 098
--    The log records what happened - company identity changes, and every
--    grant and revocation of Company Master administration. It is deliberately
--    retained: it is the only surviving record of who held authority over a
--    company's identity once the grant table is dropped.
--
--      -- DELETE FROM public.vyron_audit_log
--      --  WHERE entity_type IN ('company_master', 'company_master_admin');
-- =========================================================================

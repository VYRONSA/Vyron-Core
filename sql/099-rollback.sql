-- 099-rollback.sql
-- =========================================================================
-- Reverses sql/099-company-master-user-directory.sql.
--
-- 099 only ADDED two functions. Nothing was altered and nothing was written,
-- so removing them restores the exact pre-099 state: sql/098 is untouched,
-- no grant row is affected, and no audit history is lost.
--
-- After this runs the Company Master screen falls back to entering an auth
-- user UUID directly, which is how it worked before 099. The grant itself
-- still goes through vyron_grant_company_master_admin() from sql/098.
-- =========================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.vyron_grant_company_master_admin_by_email(uuid, text);
DROP FUNCTION IF EXISTS public.vyron_list_company_master_candidates(uuid);

COMMIT;

-- Verification: both should return NULL.
--   SELECT to_regprocedure('public.vyron_list_company_master_candidates(uuid)');
--   SELECT to_regprocedure('public.vyron_grant_company_master_admin_by_email(uuid, text)');
--
-- And sql/098 must still be intact:
--   SELECT to_regprocedure('public.vyron_grant_company_master_admin(uuid, uuid)');

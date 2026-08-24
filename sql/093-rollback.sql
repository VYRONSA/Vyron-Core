-- 093-rollback.sql
-- Reverses sql/093-workforce-automation-engine-tenant-scoped.sql.
--
-- Safe: the three tables are created by 093 and hold no pre-existing data. If Road &
-- Recovery has already written exception escalations into them, DROPping them discards
-- that operational history — check before running.
--
--   SELECT count(*) FROM public.workforce_automation_actions;
--
-- Does NOT touch sql/090, sql/091, sql/092 or sql/031.

BEGIN;

DROP TABLE IF EXISTS public.workforce_automation_audit_log CASCADE;
DROP TABLE IF EXISTS public.workforce_automation_approvals CASCADE;
DROP TABLE IF EXISTS public.workforce_automation_actions   CASCADE;

COMMIT;

NOTIFY pgrst, 'reload schema';

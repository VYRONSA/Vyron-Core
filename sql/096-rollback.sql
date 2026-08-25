-- ============================================================================
-- sql/096-rollback.sql
--
-- Exact inverse of sql/096-mobile-workforce-incidents.sql.
--
-- Everything 096 added is additive: eight columns on an existing table, three
-- CHECK constraints, three indexes on that table, and one index on
-- mobile_workforce_evidence. Dropping the columns takes their constraints with
-- them; the indexes are dropped explicitly.
--
-- No column that existed before 096 is touched, no policy is altered, and no
-- pre-existing row is rewritten.
--
-- ONE OPERATIONAL WARNING. Dropping these columns DESTROYS the triage data they
-- hold: the category, severity, danger and emergency flags on every incident
-- reported since the migration. The incidents themselves survive — id, employee,
-- description, position, status and timestamps are all pre-096 columns — but a
-- control room loses the ability to tell an injury from a near miss on anything
-- already reported. Export before rolling back, or accept that knowingly.
--
-- Evidence is unaffected: incident photographs are ordinary
-- mobile_workforce_evidence rows carrying metadata.incidentId, and 096 added no
-- column there. Only the lookup index goes.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS public.idx_mobile_evidence_incident;

DROP INDEX IF EXISTS public.idx_mobile_incidents_urgent;
DROP INDEX IF EXISTS public.idx_mobile_incidents_employee;
DROP INDEX IF EXISTS public.idx_mobile_incidents_triage;

ALTER TABLE public.mobile_workforce_incidents
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS emergency_required,
  DROP COLUMN IF EXISTS immediate_danger,
  DROP COLUMN IF EXISTS people_involved,
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS gps_accuracy,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS category;

COMMIT;

NOTIFY pgrst, 'reload schema';

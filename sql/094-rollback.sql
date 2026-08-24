-- 094-rollback.sql
-- Reverses sql/094-companies-enabled-modules.sql.
--
-- ###########################################################################
-- # WARNING — DATA LOSS IF ENTITLEMENTS HAVE BEEN GRANTED                   #
-- #                                                                         #
-- # Dropping this column discards every company's module entitlement. If    #
-- # any company has been granted road_recovery (or any other module) since  #
-- # sql/094 ran, that grant is destroyed and must be re-applied by hand.    #
-- #                                                                         #
-- # Check FIRST:                                                            #
-- #   SELECT id, name, enabled_modules FROM public.companies                #
-- #    WHERE enabled_modules <> '[]'::jsonb;                                #
-- # If that returns any row, capture it before proceeding.                  #
-- #                                                                         #
-- # Also note: with the column absent, /api/tenant/modules returns HTTP 500 #
-- # again (handled by the client, which falls back to modules: []).         #
-- ###########################################################################
--
-- Does NOT touch sql/090, sql/091, sql/092 or sql/031.
-- IDEMPOTENT: DROP COLUMN IF EXISTS. Re-running is a no-op.

BEGIN;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS enabled_modules;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- sql/097-rollback.sql
--
-- Exact inverse of sql/097-mobile-device-registrations.sql.
--
-- mobile_device_registrations is a NEW table, so this touches nothing that
-- existed before it: no column dropped from an existing relation, no policy on
-- an existing relation altered, no pre-existing row rewritten. Dropping the
-- table takes its policy, indexes and constraints with it.
--
-- The data lost is the device registry itself. That is recoverable by design —
-- every app re-registers its device on next launch and sign-in, because a push
-- token is a rotating capability rather than a record of anything.
--
-- ONE OPERATIONAL WARNING. Between dropping this table and restoring it, no
-- push notification can be addressed to any handset. In-app polling continues to
-- work, so employees still see their notifications on opening the app; they
-- simply stop being told about them while the phone is in a pocket.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.mobile_device_registrations;

COMMIT;

NOTIFY pgrst, 'reload schema';

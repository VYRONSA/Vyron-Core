-- ============================================================================
-- sql/095-rollback.sql
--
-- Exact inverse of sql/095-rr-operation-receipts.sql.
--
-- rr_operation_receipts is a NEW table introduced by that migration, so this
-- rollback touches nothing that existed before it: no column is dropped from an
-- existing relation, no policy on an existing relation is altered, and no
-- pre-existing row is rewritten. Dropping the table takes its own policy,
-- indexes and constraints with it.
--
-- The only data lost is the receipts themselves, which are transient by design
-- — they record that an operation ran, not the operation's own effect. The
-- mutations those receipts guarded remain committed in their own tables.
--
-- ONE OPERATIONAL WARNING. Between dropping this table and restoring it, any
-- client still holding a queued offline operation loses its duplicate
-- protection: a retry that arrives after the rollback will execute again,
-- because the receipt proving it already ran is gone. Drain the offline queues
-- before rolling back, or accept that risk knowingly.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.rr_operation_receipts;

COMMIT;

NOTIFY pgrst, 'reload schema';

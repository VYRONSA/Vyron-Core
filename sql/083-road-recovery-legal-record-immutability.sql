-- 083-road-recovery-legal-record-immutability.sql
-- VYRON CORE — Road & Recovery Phase 7: legal records become undeletable in fact.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT
-- ---------------------------------------------------------------------------
--
-- Three tables are documented in sql/049 as NON-DELETABLE:
--
--     public.rr_authorisations          "a legal record. It is voided, never destroyed"
--     public.rr_release_authorisations  "deleting one would erase the answer to
--                                        on whose authority this vehicle left, or got scrapped"
--     public.rr_storage_bookings        "it underpins a storage charge and the accrual
--                                        sealed against it"
--
-- That intent was enforced by GRANTS ALONE. A grant constrains a ROLE, so `authenticated`
-- was correctly refused and `service_role` was refused for want of a grant — but the table
-- OWNER could delete any of these rows outright, permanently, with nothing to stop it.
--
-- Every other protected Road & Recovery table already guards itself with a trigger bound
-- to the TABLE, precisely because a trigger constrains EVERYONE:
--
--     rr_service_state_events, rr_dispatch_candidates, rr_standby_summary,
--     rr_compliance_evaluations, rr_requirement_waivers, rr_module_provisioning,
--     rr_custody_events, rr_storage_accrual, rr_charge_calculations, rr_charge_lines,
--     rr_evidence_requirements, rr_job_rate_snapshot, rr_billable_facts,
--     rr_billing_disputes, rr_intelligence_thresholds
--
-- These three were the exception, and nothing in the test suite had ever attempted the
-- deletion as the owner. Phase 7's hardening suite does, across every protected table and
-- every role, which is how the gap surfaced.
--
-- ---------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------
--
-- A BEFORE DELETE trigger on each of the three, refusing the deletion and saying what to
-- do instead. UPDATE is untouched: all three are edited in normal operation — an
-- authorisation is voided, a storage booking is checked out — and this migration changes
-- none of that.
--
-- SAFE. Nothing in the application deletes from any of these tables, verified by search
-- across lib/, app/ and sql/ before the trigger was added.
--
-- Idempotent and safe to re-run. Requires sql/071, sql/075 and sql/077.

BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_authorisations') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_authorisations. Run sql/071 before sql/083.';
  END IF;
  IF to_regclass('public.rr_release_authorisations') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_release_authorisations. Run sql/075 before sql/083.';
  END IF;
  IF to_regclass('public.rr_storage_bookings') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_storage_bookings. Run sql/077 before sql/083.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_authorisations
-- ---------------------------------------------------------------------------
--
-- An authorisation is the counterparty's agreement to pay for work. Six weeks later it is
-- the only answer to "who said we could do this, and up to how much". Deleting one does
-- not undo the work; it deletes the evidence that the work was agreed.
CREATE OR REPLACE FUNCTION public.rr_authorisations_forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $guard$
BEGIN
  RAISE EXCEPTION
    'public.rr_authorisations is not deletable. Authorisation % is a legal record: void it (status = ''void'', void_reason, voided_at, voided_by) so the history of what was agreed, and by whom, survives.',
    OLD.authorisation_number;
END;
$guard$;

DROP TRIGGER IF EXISTS rr_authorisations_forbid_delete ON public.rr_authorisations;
CREATE TRIGGER rr_authorisations_forbid_delete
  BEFORE DELETE ON public.rr_authorisations
  FOR EACH ROW EXECUTE FUNCTION public.rr_authorisations_forbid_delete();

-- ---------------------------------------------------------------------------
-- 2. rr_release_authorisations
-- ---------------------------------------------------------------------------
--
-- Release and disposal authority. If a vehicle is later reported stolen, or an owner
-- disputes that their car was scrapped, this row is the operator's defence. It must
-- outlive every other record on the job.
CREATE OR REPLACE FUNCTION public.rr_release_authorisations_forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $guard$
BEGIN
  RAISE EXCEPTION
    'public.rr_release_authorisations is not deletable. The % authority % answers "on whose authority did this vehicle leave, or get scrapped": void it (status = ''void'', void_reason, voided_at, voided_by) rather than destroying it.',
    OLD.authority_type, OLD.authority_reference;
END;
$guard$;

DROP TRIGGER IF EXISTS rr_release_authorisations_forbid_delete ON public.rr_release_authorisations;
CREATE TRIGGER rr_release_authorisations_forbid_delete
  BEFORE DELETE ON public.rr_release_authorisations
  FOR EACH ROW EXECUTE FUNCTION public.rr_release_authorisations_forbid_delete();

-- ---------------------------------------------------------------------------
-- 3. rr_storage_bookings
-- ---------------------------------------------------------------------------
--
-- An occupancy underpins a storage charge and the accrual sealed against it. Deleting the
-- booking would orphan a sealed accrual and leave a charge nobody can explain.
CREATE OR REPLACE FUNCTION public.rr_storage_bookings_forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $guard$
BEGIN
  RAISE EXCEPTION
    'public.rr_storage_bookings is not deletable. Occupancy % underpins a storage charge and the accrual sealed against it; close it by checking the vehicle out rather than destroying the record.',
    COALESCE(OLD.bay_reference, OLD.id::text);
END;
$guard$;

DROP TRIGGER IF EXISTS rr_storage_bookings_forbid_delete ON public.rr_storage_bookings;
CREATE TRIGGER rr_storage_bookings_forbid_delete
  BEFORE DELETE ON public.rr_storage_bookings
  FOR EACH ROW EXECUTE FUNCTION public.rr_storage_bookings_forbid_delete();

COMMIT;

NOTIFY pgrst, 'reload schema';

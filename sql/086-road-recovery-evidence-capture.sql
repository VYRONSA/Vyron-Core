-- 086-road-recovery-evidence-capture.sql
-- VYRON CORE — Road & Recovery evidence can be CAPTURED, not only waived.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS MISSING, AND WHAT WAS NOT
-- ---------------------------------------------------------------------------
--
-- Everything needed to STORE Road & Recovery evidence already existed and is untouched
-- by this migration:
--
--   public.mobile_workforce_evidence   the evidence repository, extended by sql/072 with
--                                      storage_bucket, storage_path, service_job_id,
--                                      captured_by_role and metadata
--   public.rr_evidence_links           which requirement a captured item satisfies —
--                                      APPEND-ONLY, and what the compliance engine counts
--   public.rr_evidence_requirements    the job's frozen requirement snapshot
--   storage bucket `rr-evidence`       private, path <company_id>/<service_job_id>/<file>,
--                                      tenant INSERT/SELECT policies, and UPDATE/DELETE
--                                      reserved to platform operators because it is evidence
--
-- What was missing was a WAY IN. Only BYSTAND had a capture endpoint, so a tow job's
-- fourteen requirements could be waived but never satisfied, and every job reached billing
-- on waivers. That gap is closed in the application layer, not here.
--
-- This migration therefore adds NO table, NO bucket and NO column. It widens one CHECK.
--
-- ---------------------------------------------------------------------------
-- WHY TWO NEW EVIDENCE TYPES AND NOT FOURTEEN
-- ---------------------------------------------------------------------------
--
-- The precise identity of a captured item is the REQUIREMENT it satisfies, and that
-- already has a home: rr_evidence_links.requirement_code, carrying values the requirement
-- policy defines (registration_photo, vin_photo, pre_service_condition, ...). Copying
-- those fourteen codes into evidence_type would create a second vocabulary for the same
-- fact, and the two would drift the first time a tenant customised a policy.
--
-- What evidence_type describes is the CONTEXT a capture happened in — which is why
-- sql/072 added four `bystand_*` values rather than reusing 'other'. The same reasoning
-- gives exactly two more:
--
--   rr_requirement   captured against a Road & Recovery requirement; the requirement code
--                    is in rr_evidence_links, and one item may satisfy several
--   rr_custody       captured against a custody event — the condition of a vehicle at
--                    handover, yard arrival or release. rr_custody_events.evidence_id
--                    already points at it; nothing wrote one until now
--
-- Storage check-in and release attach evidence through rr_storage_bookings.evidence_id,
-- which is a custody moment, so they use rr_custody rather than a third value.
--
-- WIDENED, NEVER NARROWED. Every existing value keeps working, including the four sql/072
-- added. No row is rewritten and no capture path that works today stops working.
--
-- Idempotent and safe to re-run. Requires sql/031 (mobile evidence) and sql/072.

BEGIN;

DO $evidence_types$
BEGIN
  IF to_regclass('public.mobile_workforce_evidence') IS NULL THEN
    RAISE NOTICE
      'Prerequisite missing: public.mobile_workforce_evidence. Run sql/031 and sql/072 before sql/086.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_workforce_evidence_type_check'
  ) THEN
    ALTER TABLE public.mobile_workforce_evidence
      DROP CONSTRAINT mobile_workforce_evidence_type_check;
  END IF;

  ALTER TABLE public.mobile_workforce_evidence
    ADD CONSTRAINT mobile_workforce_evidence_type_check CHECK (
      evidence_type IN (
        -- Original six (sql/031). Unchanged, still valid.
        'clock_in', 'clock_out', 'arrive_site', 'complete_job', 'incident', 'other',
        -- Road & Recovery BYSTAND (sql/072). Unchanged, still valid.
        'bystand_scene',
        'bystand_periodic',
        'bystand_stand_down',
        'bystand_report_attachment',
        -- Road & Recovery requirement and custody capture (sql/086).
        'rr_requirement',  -- satisfies one or more requirements; codes in rr_evidence_links
        'rr_custody'       -- condition/handover evidence for a custody or storage event
      )
    );
END
$evidence_types$;

COMMIT;

NOTIFY pgrst, 'reload schema';
